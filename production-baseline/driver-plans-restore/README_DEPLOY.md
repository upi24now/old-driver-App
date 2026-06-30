# Driver-Plans Route Restore — VPS deploy package

Restores the **driver-plans** API routes that were lost when the live VPS bundle was
rebuilt. The Driver App's **Activate Plan** flow currently gets `404 "Not found"` because
the live `production-api.js` has **no** driver-plans handlers (only the Razorpay library's
own `/plans`, which is unrelated).

- **Target:** `/home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist/production-api.js`
- **Process:** PM2 `bike-courier-api`
- **Method:** additive splice — re-registers 4 routes, touches nothing else.

## What gets restored (exactly 4 routes — nothing else)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/driver-plans/create-order` | PG-authoritative one-active guard + creates Razorpay order |
| POST | `/api/driver-plans/verify-payment` | HMAC verify + one-active activation transaction (self-healing) |
| GET | `/api/driver-plans/status` | reads the live PG `driver_plans` row |
| GET | `/api/driver-plans/current` | identical alias of `/status` |

These match the Driver App calls verbatim (`artifacts/mobile/app/subscription.tsx` →
create-order then verify-payment; `artifacts/mobile/utils/profile-api.ts` → status, fallback
current). **No frontend change is required** — the route paths and response shapes are preserved.

### NOT touched (per the strict scope)
Dispatch, orders, FCM, customer/driver delivery routes, KYC / onboarding-fee, wallet, OTP, MPIN,
login, sessions, and every existing route path. The restore is two self-contained `try/catch`
IIFEs; a registration failure can never crash boot.

## Storage used — PostgreSQL only (no Firestore)

- **`driver_plans`** — the order row is stored here as `status='created'` at create-order, then
  flipped to `status='active'` at verify-payment, keyed by `razorpay_order_id`. This is the single
  source of truth; the app already reads plan state from `GET /status`.
- **No Firestore writes.** This live bundle has **no Firestore binding** (`db2` / `FieldValue` are
  absent), so the previous best-effort `drivers/{uid}` mirror has been **removed**. The block never
  references `db2` or `FieldValue` — it would otherwise throw at runtime in this build.

> **About `driver_plan_orders`:** the original/proven production routes do **not** use a separate
> `driver_plan_orders` table. The plan *order* and the *active plan* are the **same** `driver_plans`
> row (`status` transitions `created → active`). A grep for `driver_plan_orders` in the patched
> bundle will therefore return nothing — by design, matching the behavior that previously ran in
> production. If your DB has a `driver_plan_orders` table, it is simply unused by these routes.

## Response shapes (preserved)

```
create-order   200 -> { razorpayOrderId, orderId, amount, currency, keyId, planId }
               409 -> { active:true, error, plan:{ planId, status:"active", expiresAt } }   // already active
verify-payment 200 -> { ok:true, active:true, planStartAt, planExpiryAt, plan:{ planId, status:"active", expiresAt } }
               400 -> { error:"...invalid signature" }                                       // bad HMAC
status/current 200 -> { active:true, plan:{ id, planId, status:"active", expiresAt } }
               200 -> { active:false, plan:null }                                            // no live row
```

Plan amounts (paise): **daily 300**, **weekly 1900**, **monthly 10000**.
Expiry: **daily +12h**, **weekly +7d**, **monthly +30d**.

## Files in this package

- `INSERTED-BLOCK.js` — the additive code that gets spliced in (387 lines, 4 routes).
- `apply-patch.py` — self-locating, self-verifying, idempotent patcher (writes a NEW file).
- `harness.mjs` — offline behavior proof using in-memory mocks (no DB/network).

---

## Deploy steps (run on the VPS)

```bash
cd /home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist

# 0) copy this package's INSERTED-BLOCK.js + apply-patch.py next to production-api.js
#    (scp/rsync them into e.g. ./driver-plans-restore/)

# 1) back up the live bundle
cp -a production-api.js production-api.js.bak.$(date +%Y%m%d-%H%M%S)

# 2) produce the patched bundle (does NOT touch the live file)
python3 driver-plans-restore/apply-patch.py production-api.js production-api.PATCHED.js

# 3) syntax-validate the patched bundle
node --check production-api.PATCHED.js

# 4) swap into place and restart PM2
mv production-api.PATCHED.js production-api.js
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50   # expect the [BCD-PG] + [BCD-PG-STATUS] "registered" log lines
```

`apply-patch.py` **aborts without writing** if it can't find the splice anchor (exit 3) or the
Express `app` / pg `pool` are missing (exit 4) — it will never produce a broken bundle. It only
hard-requires `app` and `pool`; **auth and Razorpay are resolved defensively at runtime**
(typeof-guarded, with `require("firebase-admin")` / `require("razorpay")` fallbacks), so it does
**not** require a Firestore (`db2`/`FieldValue`) or any specific auth binding. The patcher prints
which auth/Razorpay patterns it detected for your info. If it aborts on the anchor, send the ~30
lines around the Express `app.use(...)` setup and the `var pool =` line.

### Rollback
```bash
cp -a production-api.js.bak.<timestamp> production-api.js && pm2 restart bike-courier-api
```

---

## Grep proof (run after step 4, against the live `production-api.js`)

```bash
# 4 restored routes are present:
grep -nE 'app\.(post|get)\("/api/driver-plans/(create-order|verify-payment|status|current)"' production-api.js

# restore marker + the two registration banners:
grep -n "BCD-PLANS-RESTORE\] BEGIN" production-api.js
grep -n "PG-authoritative driver-plans guard registered" production-api.js
grep -n "driver-plans status/current read-only routes registered" production-api.js

# table used (driver_plans), and confirmation driver_plan_orders is NOT referenced:
grep -c "driver_plans" production-api.js
grep -c "driver_plan_orders" production-api.js     # expected: 0 (see note above)

# scope safety — the restore added NO order/wallet/fcm/delivery routes:
grep -nE '/api/orders/|offer-stream|fcm-token|active-orders' production-api.js | grep -i "BCD-PLANS-RESTORE" || echo "OK: restore block added no forbidden routes"
```

## Curl test (against the live API)

Replace `<ID_TOKEN>` with a valid Firebase ID token for a test driver.

```bash
BASE="https://api.bikecourierservice.com"

# create-order (expect 200 + razorpayOrderId, OR 409 if the driver already has an active plan):
curl -sS -X POST "$BASE/api/driver-plans/create-order" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"planType":"daily"}' | jq .

# status (expect {active:false,plan:null} or {active:true,plan:{...}}):
curl -sS "$BASE/api/driver-plans/status" \
  -H "Authorization: Bearer <ID_TOKEN>" | jq .
```

A `404 "Not found"` on either route means the patch is **not** live yet. A `401`/`200`/`409`
means the route is registered and reachable (auth/guard responding) — i.e. the restore worked.

## Local verification (already run in this package)

```bash
node --check INSERTED-BLOCK.js   # SYNTAX OK
node harness.mjs                 # 18 passed, 0 failed (PG-only: no db2/FieldValue; registration, shapes, guard, HMAC, activation)
```
