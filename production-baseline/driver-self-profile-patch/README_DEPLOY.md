# Driver self-profile patch — `GET /api/drivers/me` (bike-courier-api, VPS)

## What this fixes
Driver login completed on the backend (verify-otp 200 → set-pin 200 → verify-pin 200)
but the app bounced back to **/login**. Cause: the live bundle has **no dedicated
`GET /api/drivers/me` route**, so the request fell through to the admin route
`router11.get("/:uid", adminAuth)` (with `uid="me"`). A normal driver token has no
admin claim, so it received:

```
403 {"error":"Forbidden — account does not have admin access"}
```

The driver app treats any non-404 `/drivers/me` error as fatal → bounce to `/login`.

## The fix (single route, purely additive)
Register an **app-level** `GET /api/drivers/me`, gated by the bundle's existing
`driverAuth` middleware, spliced **before** `app.use("/api", routes_default)` so Express
matches it ahead of the admin param route. It returns the driver's **own** profile in
the same shape the admin `/:uid` route returns (`{ ok, driver, location }`), or `404`
when no PG row exists yet (preserving the app's new-signup path).

- Only the literal path `me` is intercepted. Every real `/:uid` (a true driver uid)
  still routes to the admin (`adminAuth`) handler — **admin authorization is unchanged.**

## Scope — confirmed NOT touched
Admin routes/panel · driver plans (`/api/driver-plans/*`) · Razorpay/payment ·
delivery/order routes · customer app · wallet schema. No Firestore / Storage /
Functions / Realtime DB added (Firebase still used only for OTP/custom-token/FCM —
this patch reuses the existing `driverAuth` → `auth.verifyIdToken`, adds nothing new).
The only change vs base is a single inserted 2,426-byte block.

## Integrity (verify before deploy)
- BASE    sha256: `7a7ff11d4037aa1a9c8697d79ce92f1076149b984e125d6fe96bede24e081162`
  (the current live bundle = the auth-routes patched build)
- PATCHED sha256: `893830df2d872b2bbc1e6805cbc3eb4fb6af63a73f831aa96f6eda7092b47ce6`
- Inserted block: **2,426 bytes**, single contiguous add (`diff`: `205119a205120,205163` — 0 deletions / 0 modifications).

`apply-patch.py` hard-asserts the BASE SHA and aborts if the live bundle differs.

```bash
sha256sum production-api.PATCHED.js   # must equal the PATCHED sha above
```

## Files in this package
- `production-api.PATCHED.js` — the patched bundle to deploy.
- `drivers-me-body.js`        — the route source that gets spliced (single source of truth).
- `apply-patch.py`            — byte-safe patcher (re-creates PATCHED from the verified base).
- `harness.mjs`               — deterministic runtime proof (route behavior + admin preservation).

## Deploy (VPS, PM2 process `bike-courier-api`)
```bash
# 1. Verify integrity:
sha256sum production-api.PATCHED.js   # == 893830df2d872b2bbc1e6805cbc3eb4fb6af63a73f831aa96f6eda7092b47ce6

# 2. Back up the current live file first (match the filename PM2 launches):
cp /path/to/current/production-api.js /path/to/current/production-api.BACKUP-7a7ff11d.js

# 3. Put the patched bundle in place:
cp production-api.PATCHED.js /path/to/current/production-api.js

# 4. Restart:
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50   # expect: [DRIVERS_ME_PATCH] GET /api/drivers/me self-profile route mounted (driverAuth)
```

## Verify (after restart)
```bash
# No token → 401 (route exists and is driver-gated, NOT the admin 403):
curl -s -o /dev/null -w '%{http_code}\n' https://<API_HOST>/api/drivers/me        # 401

# With a real driver id token → 200 + {"ok":true,"driver":{...}} (previously 403):
curl -s https://<API_HOST>/api/drivers/me -H "Authorization: Bearer <DRIVER_ID_TOKEN>"
```
End-to-end: open the driver app, log in for `8299013350` with the MPIN →
verify-pin 200 → `/drivers/me` 200 → Home/onboarding (no bounce to login).

## Rollback (instant)
```bash
cp /path/to/current/production-api.BACKUP-7a7ff11d.js /path/to/current/production-api.js
pm2 restart bike-courier-api
```
The patch is purely additive; restoring the backup file fully reverts it. No DDL, no
schema change, nothing else to undo.

## Proof performed before delivery
1. **Current prod bundle SHA**: `7a7ff11d…4bb84c` (asserted by the patcher; aborts otherwise).
2. **Patched bundle SHA**: `893830df…b47ce6`.
3. **Exact route changed**: added `GET /api/drivers/me` (driverAuth). No existing route modified/removed.
4. **Only `/api/drivers/me` self-profile changed**: `diff` = `205119a205120,205163` — single inserted block, 0 deletions / 0 modifications; byte-safe reconstruction reproduces the base exactly.
5. **Admin routes still require admin**: `router11.get("/:uid", adminAuth)` and `adminAuth` unchanged; harness check #4 — `GET /api/drivers/<realUid>` with a driver token still → **403 "account does not have admin access"**.
6. **Mobile MPIN sequence**: harness checks #1/#5 — `GET /api/drivers/me` with a driver token → **200 `{ok,driver,location}`**, never the admin 403; #2 — no row → **404** (new-signup path preserved); #3 — no token → **401**.
7. **Syntax check**: `node --check production-api.PATCHED.js` → OK.
8. **Rollback**: restore `production-api.BACKUP-7a7ff11d.js` + `pm2 restart` (see above).
