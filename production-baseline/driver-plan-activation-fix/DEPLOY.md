# Driver Plan one-active-plan fix — additive override (DEPLOY / ROLLBACK)

Fixes the double-charge / multiple-active-plan bug on the LIVE bundle by re-registering
**only** these two routes ahead of the base routes (Express first-match-wins):

- `POST /api/driver-plans/create-order` — returns **409** `{active:true,error,plan}` when a non-expired
  active plan exists; otherwise creates the Razorpay order for the **selected** plan and writes a
  `driver_plans` row `status='created'`.
- `POST /api/driver-plans/verify-payment` — HMAC-verifies, then in ONE transaction cancels every other
  active row and activates **only** the row matching `razorpay_order_id`, computing `expires_at` from
  THAT plan. Never defaults to monthly.

**Untouched:** `/status`, `/current` (still served by the base bundle — after this fix there is exactly
one active row, so they already return the correct plan), OTP, MPIN, login, sessions, Firebase Auth,
wallet, orders, customer Razorpay, all UI. No new dependencies. No runtime DDL.

Reuses existing env: `VITE_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. The block reuses the bundle's own
top-level `pool` (pg) and `auth` (Firebase Admin) bindings.

## CONFIRM-BEFORE-DEPLOY (facts I could not see without the live bundle/DB)
1. **driver-auth gate (most important)** — the block PREFERS the bundle's canonical driver gate
   `__dsRequireDriver` (keeps single-device `x-session-id` session enforcement) and only falls back to a
   self-contained `verifyIdToken` if that gate is absent. `apply-patch.py` prints which path will be used.
   If it prints the WARNING (gate not found), tell me the name of the gate the live `create-order` route
   uses (or send `dist/production-api.js`) so I wire the exact one — otherwise these two routes would
   skip session-replacement enforcement that the rest of the API has.
2. **`amount` unit** — this block writes `driver_plans.amount` in **paise** (300 / 1900 / 10000) to match
   the Razorpay charge. If your existing rows store **rupees**, change `amountPaise` -> rupees in the
   `__DPA_PLANS` catalog at the top of `INSERTED-BLOCK.js`.
3. **daily duration** — `expires_at` is computed FROM the paid row's stored `duration_days` (Rule 4),
   so daily = **1 day** (`durationDays: 1`). The `driver_plans.duration_days` column is an integer, so a
   12h daily cannot be expressed there without a schema change. If you truly need 12h, change the column
   to numeric and set `daily.durationDays` to `0.5` — otherwise daily expires in 1 day ("tomorrow").
4. **bindings** — `apply-patch.py` aborts safely if `pool` / `auth` are not present under those names in
   the live bundle. If it aborts, send me `dist/production-api.js` and I'll splice it manually.

## STEP 1 — data cleanup (run ONCE on the prod Postgres; review SELECTs first)
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f cleanup.sql
    # or paste sections 0-2 (review), then 3-4 (cleanup+verify) interactively

## STEP 2 — patch the live bundle (ON THE VPS, in the api-pkg dir)
    cd /path/to/api-pkg
    sha256sum dist/production-api.js                         # record BASE sha
    python3 /path/to/apply-patch.py dist/production-api.js   # writes .bak + patched, prints both SHA256
    node --check dist/production-api.js                      # must print nothing (syntax OK)

## STEP 3 — reload
    pm2 reload bike-courier-api --update-env
    pm2 logs bike-courier-api --lines 60

## ROLLBACK (instant)
    cd /path/to/api-pkg
    cp dist/production-api.js.bak.<timestamp> dist/production-api.js
    sha256sum dist/production-api.js                         # must equal the BASE sha from STEP 2
    pm2 reload bike-courier-api --update-env
# Data cleanup is non-destructive (status only); safe to leave applied after rollback.

## Post-deploy verification (replace HOST + a real driver ID token IDT for 918299013350)
# A) active plan present -> 409, NO Razorpay order
    curl -i -X POST https://HOST/api/driver-plans/create-order \
      -H "Authorization: Bearer $IDT" -H 'Content-Type: application/json' \
      -d '{"planId":"daily"}'     # expect HTTP/1.1 409 {"active":true,"error":"Driver already has an active plan.","plan":{...}}
    curl -i -X POST https://HOST/api/driver-plans/create-order \
      -H "Authorization: Bearer $IDT" -H 'Content-Type: application/json' \
      -d '{"planId":"weekly"}'    # expect 409
    curl -i -X POST https://HOST/api/driver-plans/create-order \
      -H "Authorization: Bearer $IDT" -H 'Content-Type: application/json' \
      -d '{"planId":"monthly"}'   # expect 409

# B) expire the active plan in test DB (cleanup.sql section 5), then:
    curl -i -X POST https://HOST/api/driver-plans/create-order \
      -H "Authorization: Bearer $IDT" -H 'Content-Type: application/json' \
      -d '{"planId":"daily"}'     # expect 200 {"razorpayOrderId":"order_...","amount":300,"currency":"INR","planId":"daily",...}

# C) after Razorpay checkout in the app, verify-payment activates daily only; then:
    curl -s https://HOST/api/driver-plans/status -H "Authorization: Bearer $IDT"   # plan.planId == daily, status active
    # DB: SELECT count(*) FROM driver_plans WHERE driver_uid='918299013350' AND status='active' AND expires_at>NOW();  -> 1
