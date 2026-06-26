# Single-Device Login — additive patch (DEPLOY / ROLLBACK)

Adds single-device login + PIN-primary auth to the Bike Courier API as ONE additive
block spliced in immediately AFTER the last global middleware
`app.use((0, import_pino_http.default)({ logger }));` — i.e. after `express.json()`
is installed (so `req.body` is parsed) and BEFORE both the base bundle's own
pre-existing `/api/auth/send-otp`+`/api/auth/verify-otp` additive override AND the
final `app.use("/api", routes_default)` mount. Registering first is what makes our
handlers win Express first-match routing. Everything else is byte-for-byte identical
to the current live bundle (the driver-orders patch `395ffcb2`). No Firestore is used
for any business data; no customer-app change.

## What the block does

OVERRIDES (registered before the base's pre-existing OTP override AND `routes_default`,
so Express first-match-wins selects OUR handler):
  - POST /api/auth/send-otp    — now rate-limited to 3 sends / rolling 24h per phone
                                 (test phones from `TEST_OTP_PHONES` bypass). Returns
                                 `devOtp` only when `NODE_ENV !== production`.
  - POST /api/auth/verify-otp  — unchanged OTP verify; now ALSO mints a session id,
                                 stores it on `drivers.active_session_id`, returns
                                 `{ token, sessionId }`.

ADDS (not present in the base bundle):
  - POST /api/auth/set-pin     — Firebase-gated; stores a scrypt PIN hash
                                 (`scrypt$<saltHex>$<hashHex>`, identical to the
                                 canonical source) + claims this device; returns
                                 `{ ok, sessionId }`.
  - GET  /api/auth/pin-status  — Firebase-gated read-only `{ hasPin }`.
  - POST /api/auth/verify-pin  — phone + 6-digit PIN → same custom token as verify-otp.
                                 3 wrong attempts → 24h lock (`FOR UPDATE` race-safe).
                                 Returns `{ token, sessionId }`. 404 when no PIN set
                                 (client falls back to OTP).

SINGLE-DEVICE ENFORCEMENT:
  - The block WRAPS the existing `__dsRequireDriver` auth gate (a mutable function
    binding — no compiled bytes are edited). After the Firebase token is verified, it
    loads `drivers.active_session_id`; if it is non-NULL and does not match the
    request's `x-session-id` header, it returns `401 {error:"SESSION_REPLACED",
    message:"Logged in on another device"}`. The app clears auth and returns to login.
  - Null-safe: when `active_session_id` is NULL (legacy rows / pre-first-login), the
    check is skipped, so existing sessions keep working until the next login claims a
    device.
  - Fail-open on a session-check DB error (never hard-blocks a token-verified driver).

Scope note: enforcement covers the order-lifecycle routes gated by `__dsRequireDriver`
plus the four auth routes above. Wallet/Plans/KYC/Profile/Razorpay routes (gated by
their own compiled auth) are intentionally NOT modified, per the strict change scope.

Untouched: Wallet, Plans, KYC, Orders lifecycle, Profile, Razorpay, customer app,
frontend, FCM dispatcher. NO new secrets/env vars required.

## Checksums (see SHA256SUMS.txt)
  BASE  (must match current live — the driver-orders patch output):
        395ffcb2265179178487878f853b2a86b8eac8a53a77928737c20a28c633b719
  PATCH (deploy this):
        21ee8ca710a6667fac31e518a2d6e63d15f11e7cc1132bfa4e94411e9003fd93

## STEP 1 — DB migration (run ONCE, BEFORE deploy; idempotent, no data change)
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_single_device_login.sql
  # Adds drivers.active_session_id / active_session_at (nullable), the
  # otp_send_events table + index, and defensively (IF NOT EXISTS) the PIN columns.
  # Every statement is IF NOT EXISTS, so on prod the PIN columns are no-ops and only
  # the genuinely new session columns + otp_send_events table are created. No data is
  # mutated. Wrapped in a single BEGIN/COMMIT.

## STEP 2 — DEPLOY (on VPS, in the api-pkg dir; adjust DIST)
  DIST=dist/production-api.js
  sha256sum "$DIST"                                   # expect 395ffcb2...
  cp "$DIST" "$DIST.bak.$(date +%Y%m%d-%H%M%S)"       # backup current live
  cp /path/to/production-api.js "$DIST"               # install patched
  sha256sum "$DIST"                                   # expect 21ee8ca7...
  pm2 restart bike-courier-api
  pm2 logs bike-courier-api --lines 50

## ROLLBACK (instant; safe to leave migration applied — new col/table simply go unused)
  DIST=dist/production-api.js
  cp "$DIST.bak.<timestamp>" "$DIST"                  # restore previous live (395ffcb2...)
  sha256sum "$DIST"                                   # expect 395ffcb2...
  pm2 restart bike-courier-api
  # Reverting the bundle removes all session enforcement and the new PIN routes.
  # The added DB columns/table are simply unused; no rollback SQL is required. If you
  # must also drop them:
  #   ALTER TABLE drivers DROP COLUMN IF EXISTS active_session_id;
  #   ALTER TABLE drivers DROP COLUMN IF EXISTS active_session_at;
  #   DROP TABLE IF EXISTS otp_send_events;
  #   (leave pin_* — they belong to the PIN-login feature)

## Post-deploy verification (replace HOST + real driver ID token + phone/pin)
  # verify-pin returns a token + sessionId:
  curl -s -X POST https://HOST/api/auth/verify-pin -H 'Content-Type: application/json' \
       -d '{"phone":"9999999999","pin":"123456"}'          # {token, sessionId} or 404/401/429
  # SESSION_REPLACED on a stale/empty x-session-id for an order-lifecycle route once a
  # device is active:
  curl -i -X POST https://HOST/api/orders/__none__/accept -H "Authorization: Bearer <IDT>" \
       -H 'x-session-id: stale-value' -H 'Content-Type: application/json' -d '{}'  # 401 SESSION_REPLACED
  # Matching x-session-id passes through to normal route behavior:
  curl -i -X POST https://HOST/api/orders/__none__/accept -H "Authorization: Bearer <IDT>" \
       -H 'x-session-id: <minted>' -H 'Content-Type: application/json' -d '{}'     # not SESSION_REPLACED
  # OTP send rate limit: 4th send within 24h => 429:
  curl -s -X POST https://HOST/api/auth/send-otp -H 'Content-Type: application/json' -d '{"phone":"9999999999"}'
