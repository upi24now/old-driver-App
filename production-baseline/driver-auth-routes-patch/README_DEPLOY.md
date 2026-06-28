# PG-only `/api/auth/*` routes patch — bike-courier-api (VPS)

## What this fixes
The current live VPS bundle is **missing the entire `/api/auth/*` router**, so every login call
returns `404 {"error":"Not found"}` — this breaks **both** PIN login and OTP login
(the driver app drives all login through the backend: `verify-pin` / `send-otp` →
`verify-otp` → `set-pin`).

Reported symptom: phone `8299013350` (uid `918299013350`) → "Not found" on PIN login.

## Base bundle (current live)
This patch is built on, and ONLY applies to, the current live bundle:

- BASE    sha256: `246519b97efcd770c9b76a3825348d1d6ee8c09482739b15847462f4674bb84c`

`apply-patch.py` hard-asserts this SHA and aborts if the base differs.

## What it does (PG-only)
Adds one additive Express router mounted **before** the bundle's `app.use("/api", routes_default)`
(i.e. before the catch-all 404), reusing the bundle's existing module-scope bindings
`app`, `pool` (pg Pool), `auth` (Firebase Admin Auth), `import_express34` (express):

- `POST /api/auth/send-otp`    — test-phone bypass via `TEST_OTP_PHONES`, else stores OTP in PG (`auth_otps`), 3/24h rate limit (`otp_send_events`). No SMS sender exists in this backend (unchanged behavior).
- `POST /api/auth/verify-otp`  — atomic `FOR UPDATE` consume; mints Firebase custom token for uid `91`+phone.
- `POST /api/auth/set-pin`     — Firebase **ID-token** gated; stores a scrypt PIN hash (`scrypt$<salt>$<hash>`).
- `GET  /api/auth/pin-status`  — Firebase ID-token gated; returns `{ hasPin }`.
- `POST /api/auth/verify-pin`  — atomic `FOR UPDATE` lockout (3 wrong → 24h); scrypt verify; mints custom token.

**Firebase usage:** only `auth.createCustomToken` and `auth.verifyIdToken`.
**No Firestore. No Storage. No Realtime DB. No Functions. No other Firebase service.**
(Verified: the patch body has 0 references to firestore/db2/collection/FieldValue/Messaging/Storage.)

**Schema:** on startup runs idempotent additive DDL (safe no-op if already present):
`CREATE TABLE IF NOT EXISTS auth_otps`, `otp_send_events`; `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS`
`pin_hash, pin_set_at, pin_failed_attempts, pin_locked_until, active_session_id, active_session_at`.

## What is NOT touched (verified purely additive: 0 deletions / 0 modifications)
PG driver-plans guard · `/api/driver-plans/status` · `/api/driver-plans/current` ·
`/api/driver-plans/create-order` · `/api/driver-plans/verify-payment` · Razorpay/payment ·
delivery routes · customer routes · admin routes · wallet schema · UI.
The only change vs base is a single inserted 14,592-byte block.

## Intentional scope decisions
- `set-pin` / `pin-status` verify the Firebase **ID token only** — they do NOT enforce a
  single-device `x-session-id` policy (no such enforcement exists anywhere in the live bundle;
  adding it would be a new feature that could break first-time setup). `active_session_id` is
  still written so enforcement can be switched on later without a schema change.
- `verify-otp` keeps the original behavior of using the submitted phone directly for the uid
  (`send-otp` already hard-requires a clean 10-digit phone; the app always sends clean digits).

## Files in this package
- `production-api.PATCHED.js` — the patched bundle to deploy.
- `auth-routes-body.js`       — the route source that gets spliced (single source of truth).
- `apply-patch.py`            — byte-safe patcher (re-creates the patched bundle from the verified base).

## Integrity (verify before deploy)
- BASE    sha256: `246519b97efcd770c9b76a3825348d1d6ee8c09482739b15847462f4674bb84c`
- PATCHED sha256: `3125ceb5fbcdb80d70c9bb440bf05243954ba755e7196f3b96c8deb443bc3425`
- Inserted block: 14,592 bytes (only change vs base).

```
sha256sum production-api.PATCHED.js   # must equal the PATCHED sha above
```

## Deploy (VPS, PM2 process `bike-courier-api`)
```bash
# 1. Verify integrity:
sha256sum production-api.PATCHED.js   # == 3125ceb5fbcdb80d70c9bb440bf05243954ba755e7196f3b96c8deb443bc3425

# 2. Back up the current live file first (match the filename PM2 launches):
cp /path/to/current/production-api.js /path/to/current/production-api.BACKUP-246519b9.js

# 3. Put the patched bundle in place:
cp production-api.PATCHED.js /path/to/current/production-api.js

# 4. Restart the process:
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50   # expect: [AUTH_PATCH] /api/auth/* routes mounted ...
                                       #         [AUTH_PATCH] schema ensured ...
```

## Verify (after restart)
```bash
# Was 404 before; now expect a domain response (NOT {"error":"Not found"}):
curl -s -X POST https://<API_HOST>/api/auth/verify-pin \
  -H 'content-type: application/json' \
  -d '{"phone":"8299013350","pin":"000000"}'
# Expect 401 "Incorrect PIN" OR 404 "No PIN set..." OR 200 token — i.e. the route now runs.

curl -s -X POST https://<API_HOST>/api/auth/send-otp \
  -H 'content-type: application/json' -d '{"phone":"8299013350"}'
# Test phone (in TEST_OTP_PHONES) → {"sent":true,"devOtp":"..."}; otherwise {"sent":true}.
```
End-to-end: open the driver app and log in for `8299013350` (PIN if set, else OTP → create PIN).

## Rollback (instant)
```bash
cp /path/to/current/production-api.BACKUP-246519b9.js /path/to/current/production-api.js
pm2 restart bike-courier-api
```
The patch is purely additive; rolling back the file fully reverts it. The additive DDL columns/tables
left behind are harmless (nullable/defaulted; unused by the base bundle).

## Proof performed before delivery
- BASE SHA asserted == `246519b9…4bb84c` by the patcher (aborts otherwise).
- Diff base→patched: **0 deletions / 0 modifications**, 363 added lines (one contiguous block).
- `node --check` on the full patched ESM bundle → OK (no syntax break from the splice).
- Protected routes confirmed still present in the patched bundle (driver-plans status/current/
  create-order/verify-payment, Razorpay, `app.use("/api", routes_default)`).
- Patch body confirmed 0 Firestore/Storage/Messaging refs; only `auth.verifyIdToken` + `auth.createCustomToken`.
- The spliced body (sha `e122f5a9…`) is byte-identical to the version validated end-to-end by the
  PG isolation harness (exact spliced bytes, real Postgres, stubbed Firebase Admin): **20/20 passing**
  — route mount (no 404), no-PIN→404, set-pin gate+hash write, pin-status, verify-pin success,
  3-strike lockout→429, test-phone OTP, PG-stored real-phone OTP send/verify/consume, catch-all 404 intact.
