# Restore `GET /api/drivers/me` on the live VPS bundle

Surgical, additive, drift-tolerant, idempotent restore of **only** the driver
self-profile route `GET /api/drivers/me`. Fixes the post-PIN-login `403` that
prevents the driver app from reaching the home screen.

## Root cause

The bundle's drivers router (`drivers.ts` → `router.get(...)`) has **no `/me`
route**. Its routes are `/`, `/:uid/kyc-status`, `/:uid`, `/:uid/location`,
`/:uid/status`, `/:uid/fcm-token`. So `GET /api/drivers/me` matches
`router.get("/:uid", adminAuth, ...)` with `:uid = "me"`. `adminAuth` verifies the
Firebase token fine (the verify-pin custom token is valid), then runs
`hasAdminClaim(decoded)` — false for a normal driver — and returns
`403 { error: "Forbidden — account does not have admin access" }`.

The driver app treats any non-404 `/drivers/me` response as fatal and bounces to
login, so the home screen never loads even though `verify-pin` returns `200`.

## Fix

Registers a top-level `app.get("/api/drivers/me", ...)` **immediately before**
`app.use("/api", routes_default);`. Express matches in registration order, so this
handler wins for exactly `GET /api/drivers/me`; the admin-gated `/:uid` route is
never reached for this path and is left **completely unchanged**.

- Auth: the **same** Firebase token from `verify-pin` (`auth.verifyIdToken` →
  `decoded.uid`). Returns `401` (never `403`) on a bad token.
- Read: PostgreSQL-authoritative — `drivers` + `driver_documents` by `uid` via
  `pool.query`.
- Response: exact `PgDriverProfile` shape the app expects
  (`{ ok, onboardingStep, nextRoute, driver: { ... , documents } }`), including
  the server-computed `onboardingStep` / `nextRoute` so the app routes to home.

### Guarantees

- **Additive only (0 deletions)** — proven: removing the inserted block
  reproduces the base byte-for-byte; a line/statement diff shows 0 deletions.
- **Drift-tolerant** — no base-SHA lock. Splice located by the unique anchor
  `app.use("/api", routes_default);`. Reuses only the stable module bindings
  `app`, `pool`, `auth`.
- **Idempotent** — re-running is a no-op (marker + route sentinel check).
- **Composes with the auth-routes restore** — both insert before the same anchor,
  independently; order does not matter, no base bytes removed.
- **Safe** — hard-fails *before any write* if the anchor isn't unique or the
  `pool` / `auth` bindings can't be confirmed; auto-creates a timestamped backup.

### Does NOT touch

`/api/auth/*` (verify-pin / OTP), driver plans, Razorpay, orders, dispatch,
offers, wallet, FCM, KYC upload, online/offline, active ride, demo mode, frontend.

> Note: the canonical handler also performs an optional, non-fatal
> "Firestore→PG verification heal". This restore is **PG-only** (per the task) and
> omits that Firestore read to minimise bundle-binding dependencies. If a driver
> was approved only in a legacy Firestore admin panel and PG still shows
> `pending`, they route to `verification-pending` until PG is synced — a one-row
> `UPDATE drivers SET verification_status='approved'` resolves it. All drivers
> whose PG row already reflects their real status are unaffected.

## File: `drivers-me-body.js`

The verbatim route body inserted by the patcher. Do not edit unless you intend to
change the endpoint behaviour.

## Deploy (on the VPS, inside `api-pkg/`)

```bash
# 0. Copy this folder to the VPS (e.g. into api-pkg/)
#    api-pkg/driver-me-route-restore/{apply-me-restore.cjs,drivers-me-body.js,README_DEPLOY.md}

# 1. Apply (auto-backs up, refuses if unsafe)
node driver-me-route-restore/apply-me-restore.cjs dist/production-api.js

# 2. Verify syntax
node --check dist/production-api.js

# 3. Prove the route exists and is BEFORE the /api mount
grep -n 'app.get("/api/drivers/me"\|app.use("/api", routes_default)' dist/production-api.js

# 4. Restart
pm2 restart bike-courier-api --update-env
```

The apply step prints `BACKUP : dist/production-api.js.bak.me-restore.<TIMESTAMP>`.
Note that timestamp for rollback.

## Verification (after restart)

```bash
# (a) PIN login still returns 200 and issues a token (capture it)
TOKEN=$(curl -s -X POST https://api.bikecourierservice.com/api/auth/verify-pin \
  -H 'Content-Type: application/json' \
  -d '{"phone":"8299013350","pin":"<PIN>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
echo "token len: ${#TOKEN}"

# (b) GET /api/drivers/me with that SAME token now returns 200 (was 403)
curl -s -o /dev/null -w "drivers/me -> %{http_code}\n" \
  https://api.bikecourierservice.com/api/drivers/me \
  -H "Authorization: Bearer $TOKEN"

# (c) Inspect the body — expect { ok:true, onboardingStep, nextRoute, driver:{...} }
curl -s https://api.bikecourierservice.com/api/drivers/me \
  -H "Authorization: Bearer $TOKEN" | head -c 600

# (d) App reaches home: open the driver app, log in with PIN — it should now load
#     the dashboard (nextRoute "/(tabs)") instead of bouncing back to login.
```

A `200` with a `driver` object (and `nextRoute: "/(tabs)"` for an approved
driver) means the home screen will load.

## Rollback (single command)

```bash
cp dist/production-api.js.bak.me-restore.<TIMESTAMP> dist/production-api.js && pm2 restart bike-courier-api --update-env
```
