# Driver Plan one-active-plan fix — LIVE bundle targeted patch

Built against the EXACT live bundle you sent (`src/routes/driverPlans.ts` compiled into
`dist/production-api.js`). Two surgical, byte-safe edits — nothing else is touched.

- BASE    SHA256 (your file): `b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c`
- PATCHED  SHA256 (expected): `36e3d2183932f2bea369ea2cc097c320007a84302e3cbbc103e76235b860b461`

## What changes (and what does NOT)
**FIX 1 — `POST /api/driver-plans/create-order`:** adds an active-plan guard using the bundle's own
`pgGetActivePlan(uid)`. If a non-expired active plan exists, returns **HTTP 409**
`{active:true, error:"Driver already has an active plan.", plan:{planId,status,expiresAt}}`
and creates **NO** Razorpay order (prevents the double charge). Otherwise behaves exactly as before.

**FIX 2 — `pgActivatePlanByOrderId` (used by `verify-payment`):** now runs in ONE `db.transaction`
that first cancels every OTHER active row for the driver, then activates **only** the row matching
`razorpay_order_id` (this was already the behavior — it never defaulted to monthly). Result: exactly
one active plan per driver. `expires_at` is still computed from that row's own `duration_days`.
Idempotent: re-calling verify for the same order keeps a single active row.

**Untouched:** `driverAuth` (Firebase token gate), `/current`/`/status`/`/active`, OTP, MPIN, login,
sessions, wallet, orders, payouts, customer Razorpay, all other routes. No new deps, no DDL, no env changes.
Uses only bindings already in the bundle: `db`, `driverPlansTable`, `eq`, `and`, `ne`, `db.transaction`,
`pgGetActivePlan`. Razorpay keys (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) are read by the existing code.

## STEP 1 — data cleanup (run ONCE on prod Postgres; review SELECTs first)
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f cleanup.sql

## STEP 2 — patch the live bundle (ON THE VPS, in the dir holding dist/production-api.js)
    sha256sum dist/production-api.js
    # expect: b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c
    #   If it DIFFERS, the running bundle changed since you sent it — stop and send the current file;
    #   the script will also abort safely (anchor-not-found) rather than mis-patch.
    python3 apply-patch.py dist/production-api.js
    # prints BASE + PATCHED sha256 and writes dist/production-api.js.bak.<timestamp>
    # PATCHED should equal: 36e3d2183932f2bea369ea2cc097c320007a84302e3cbbc103e76235b860b461
    node --check dist/production-api.js          # must print nothing (syntax OK)

## STEP 3 — reload
    pm2 reload bike-courier-api --update-env
    pm2 logs bike-courier-api --lines 60

## ROLLBACK (instant)
    cp dist/production-api.js.bak.<timestamp> dist/production-api.js
    sha256sum dist/production-api.js             # must equal the BASE sha above
    pm2 reload bike-courier-api --update-env

## Post-deploy verification (replace HOST + a real driver ID token IDT for an ACTIVE-plan driver)
# A) active plan present -> 409, no Razorpay order
    curl -i -X POST https://HOST/api/driver-plans/create-order \
      -H "Authorization: Bearer $IDT" -H 'Content-Type: application/json' -d '{"planId":"daily"}'
    # expect HTTP/1.1 409  {"active":true,"error":"Driver already has an active plan.","plan":{...}}

# B) for a driver with NO active plan -> 200 with an orderId (normal flow), then pay in app.
#    After verify-payment, confirm exactly one active row:
    psql "$DATABASE_URL" -c "SELECT plan_id,status FROM driver_plans WHERE driver_uid='<uid>' AND status='active' AND expires_at>NOW();"
    # expect exactly ONE row, matching the plan the driver just paid for.
