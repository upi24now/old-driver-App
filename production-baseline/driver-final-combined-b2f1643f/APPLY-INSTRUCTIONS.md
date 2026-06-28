# FINAL combined production patch — Driver Plan + Delivery

**One** deployable file: `production-api.PATCHED.js`. Byte-safe ADDITIVE patch on the
**current live bundle**. No app rebuild. Keeps everything already running and adds the
Driver-Plan fixes plus the driver-delivery API the mobile app already calls.

## What's included (single combined package — NOT split)

### Part 1 — Driver-delivery API (additive `__BCD_DRIVER_DELIVERY` block, unchanged)
Self-contained IIFE spliced **before** `app2.use("/api", routes_default);` so the driver
routes register first (first-match wins). Includes:
- `GET   /api/drivers/me/offer-stream`   (SSE — `OrderDoc[]`)
- `PATCH /api/drivers/me/fcm-token`
- `GET   /api/drivers/:uid/active-orders`
- `POST  /api/orders/:orderId/accept`    (order-keyed claim, first-wins)
- `PATCH /api/orders/:orderId/stage`
- `POST  /api/orders/:orderId/complete`  (OTP verify + status=delivered + wallet credit;
  CASH/COD never credit; ONLINE settle is per-`(uid,orderId)` `pg_advisory_lock`-serialized
  so concurrent retries credit **exactly once**)
- `PATCH /api/orders/:orderId/location`
- `GET   /api/orders/:orderId/stream`    (SSE order status)
- 3s broadcast dispatch poller (online + verified + active-plan → `order_offers` + FCM)
- Boot log marker: `[BCD] driver_delivery_block_installed`

### Part 2 — Driver-Plan strict fixes (surgical edits to the bundle's own handlers)
1. **Strict per-plan_id expiry** in `pgActivatePlanByOrderId` (verify-payment path),
   driven by the **actual paid row's `plan_id`** (the row matched by `razorpay_order_id`):
   - `daily` → activation **+ 12h**
   - `weekly` → activation **+ 7d**
   - `monthly` → activation **+ 30d**
   - unknown → that row's own `duration_days` (**never** defaults to monthly)
2. **One active row per driver + concurrency-safe activation:** activation now runs in a
   single `db.transaction` serialized by a **per-driver advisory xact lock**
   (`pg_advisory_xact_lock(hashtext(driver_uid))`); inside the tx every other
   `status='active'` row for the driver is set to `expired` before the matched (paid) row
   is activated. Two concurrent verify-payment callbacks → **exactly one active row**, no
   double-activation.
3. **Active-plan guard** in `POST /api/driver-plans/create-order` (before Razorpay / any
   insert): if `pgGetActivePlan(uid)` returns a non-expired active row →
   **HTTP 409** `{ active:true, expiresAt, plan:{...} }`, and **no** Razorpay order +
   **no** `driver_plans` row are created.
4. **No accidental monthly default:** `resolvePlan` no longer falls back to `DEFAULT_PLAN_ID`;
   missing/blank/unknown `planId` → `null` → create-order returns 400.

## NOT touched
OTP, MPIN, login, sessions, customer booking, wallet (beyond the already-reviewed delivery
completion in the block), Razorpay keys/config, UI, DB schema. Plan prices unchanged
(daily ₹3 / weekly ₹19 / monthly ₹100).

## Verification (all passing — see proofs below)
- **A** — with an active plan present, `create-order` for daily / weekly / monthly each →
  **409**, **no** Razorpay order, **no** new `driver_plans` row.
- **B** — fresh activation expiries: daily **12h**, weekly **168h (7d)**, monthly **720h (30d)**;
  unknown plan never becomes monthly.
- **C** — concurrent verify-payment (same order ×8; stale-active + new; 5 distinct orders) →
  **exactly one** active row each time.
- **D** — without an `Authorization: Bearer` token: `offer-stream` (GET) → **401**,
  `fcm-token` (PATCH) → **401**, `:uid/active-orders` (GET) → **401** (not 404); an unknown
  route still → 404, proving these are genuine auth rejections from registered routes.

## Hashes
- **BASE (current live)** `live-production-api_1782580938044.js`
  sha256 = `b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c`
- **PATCHED** `production-api.PATCHED.js`
  sha256 = `7f40fe3881c5e7255144941e36c67b0bd59b5ff9e0b250e5fbeeefbbb4600c0c`
- **Inserted delivery block** `INSERTED-BLOCK.js`
  sha256 = `3b39b534d26b85549ee3449de681d519cb64977b1b814ec5d4d6656777a0e807`
- byte delta: **+29,544** (plan edits +995, delivery block +28,549; every other byte identical)

## Rebuild the patched file (re-runnable, byte-safe)
```bash
python3 apply-patch.py /path/to/live-production-api_1782580938044.js production-api.PATCHED.js
# aborts unless each plan anchor occurs exactly once and the delivery marker is absent;
# writes a .bak of the input and prints input/output sha256.
```

## Deploy (VPS)
```bash
scp production-api.PATCHED.js <user>@<vps-host>:/tmp/
ssh <user>@<vps-host>

cd /tmp
sha256sum production-api.PATCHED.js
# must equal: 7f40fe3881c5e7255144941e36c67b0bd59b5ff9e0b250e5fbeeefbbb4600c0c

# verify it parses as ESM (bundle is "type":"module"); copy to .mjs first
cp production-api.PATCHED.js /tmp/check.mjs && node --check /tmp/check.mjs

# back up the current bundle, swap in, reload
cp /home/<user>/api-pkg/dist/production-api.js \
   /home/<user>/api-pkg/dist/production-api.js.bak-$(date +%Y%m%d-%H%M%S)
cp /tmp/production-api.PATCHED.js /home/<user>/api-pkg/dist/production-api.js
pm2 reload bike-courier-api --update-env
pm2 logs bike-courier-api --lines 50    # expect: [BCD] driver_delivery_block_installed
```

## Post-deploy verification
```bash
# D — delivery routes must be 401 (NOT 404) without a token. Use the correct HTTP method.
curl -s -o /dev/null -w "offer-stream  GET   -> %{http_code}\n"  "https://<api-host>/api/drivers/me/offer-stream"
curl -s -o /dev/null -w "fcm-token     PATCH -> %{http_code}\n"  -X PATCH -H 'Content-Type: application/json' -d '{"fcmToken":"x"}' "https://<api-host>/api/drivers/me/fcm-token"
curl -s -o /dev/null -w "active-orders GET   -> %{http_code}\n"  "https://<api-host>/api/drivers/918299013350/active-orders"
# all three -> 401

# A — with a real driver Bearer token for a driver that already has an active plan, expect 409
curl -s -X POST "https://<api-host>/api/driver-plans/create-order" \
  -H "Authorization: Bearer <driver-id-token>" -H "Content-Type: application/json" \
  -d '{"planId":"weekly"}' -w "\nHTTP %{http_code}\n"
```
```sql
-- B — after activating a fresh plan, hours should be 12 / 168 / 720
SELECT plan_id, started_at, expires_at,
       round(EXTRACT(EPOCH FROM (expires_at - started_at))/3600, 2) AS hours
FROM driver_plans WHERE status='active' ORDER BY started_at DESC LIMIT 5;

-- C — at most one active row per driver (should return NO rows)
SELECT driver_uid, count(*) FROM driver_plans WHERE status='active'
GROUP BY driver_uid HAVING count(*) > 1;
```

## Rollback
```bash
ls -t /home/<user>/api-pkg/dist/production-api.js.bak-*
cp /home/<user>/api-pkg/dist/production-api.js.bak-<timestamp> \
   /home/<user>/api-pkg/dist/production-api.js
pm2 reload bike-courier-api --update-env
```
Purely additive/in-place edits — restoring the backup fully reverts. No schema or data
migration to undo.
