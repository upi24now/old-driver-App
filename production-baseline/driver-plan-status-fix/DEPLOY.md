# Driver-Plans STATUS read-route fix (minimal, additive)

Adds the **two missing read-only routes** to the live VPS bundle so the Driver App can read its
authoritative plan from PostgreSQL and clear a stale cached plan on expiry:

- `GET /api/driver-plans/status`
- `GET /api/driver-plans/current` (identical alias)

Both read **PostgreSQL `driver_plans` ONLY** (`status='active' AND expires_at > now()`).
No active row → `{ "active": false, "plan": null }` (the app clears its cache).

## Scope (what this does NOT touch)
NOTHING except adding the two GET routes. It does **not** alter create-order, verify-payment,
onboarding-fee, Razorpay, delivery/order routes, OTP, MPIN, login, sessions, wallet, customer
booking, or any UI. The mobile app is **not** rebuilt for the backend fix.

## SHA256
- BASE (currently deployed PG-guard bundle): `0beb1fa5c46126bfcb7c0f2221f55270651e7489b39fb8ad6bea5679a25c7860`
- PATCHED (deploy this):                      `246519b97efcd770c9b76a3825348d1d6ee8c09482739b15847462f4674bb84c`
- Delta: +3788 bytes (one inserted block + newline). Byte-identical otherwise.

## Deploy
```bash
# 0. confirm the live bundle matches BASE before patching
sha256sum /path/to/dist/production-api.js   # expect 0beb1fa5...

# 1. back up the live bundle
cp /path/to/dist/production-api.js /path/to/dist/production-api.js.bak.$(date +%Y%m%d-%H%M%S)

# 2. drop in the patched bundle
cp production-api.PATCHED.js /path/to/dist/production-api.js
sha256sum /path/to/dist/production-api.js   # expect 246519b9...

# 3. restart
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50    # expect: [BCD-PG-STATUS] ... routes registered (PG-only)
```

## Verify (live)
```bash
# without a token -> 401 (proves the route exists; it used to 404)
curl -s -o /dev/null -w "%{http_code}\n" https://api.bikecourierservice.com/api/driver-plans/status   # 401

# with a real driver idToken -> 200 JSON (active:false when no live PG row, active:true otherwise)
curl -s https://api.bikecourierservice.com/api/driver-plans/status -H "Authorization: Bearer <DRIVER_ID_TOKEN>"
# -> {"active":false,"plan":null}   OR   {"active":true,"plan":{"id":"daily",...,"expiresAt":"..."}}
```
App effect: `syncSubscriptionFromServer()` receives the body, overwrites and persists the local
cache (clears it on `active:false`); the Duty-ON gate and subscription screen self-heal on next
foreground/login — no device cache wipe required.

## Rollback (instant)
```bash
cp /path/to/dist/production-api.js.bak.<TS> /path/to/dist/production-api.js
pm2 restart bike-courier-api
```
Restoring BASE (`0beb1fa5…`) reverts to 404 on both routes; nothing else changes.

## Proof (reproducible locally)
```bash
python3 apply-patch.py     # regenerates PATCHED + prints SHA + byte-safety assertion
node proof-status.mjs       # 12/12 pass — exercises the SHIPPED bundle bytes (guard + status blocks)
```
Covers: routes registered (401 not 404); no PG row → active:false; daily purchase → +12h reflected
by /status; active plan → create-order 409 (no double charge); weekly +7d; monthly +30d;
expired row → active:false + re-purchase allowed.
