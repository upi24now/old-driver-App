# Combined Driver Plan + Delivery bundle

Built on the **current live bundle** (`297c2543…`), so it keeps everything already
running and adds the plan fixes. **One** file to deploy: `live-production-api.PATCHED.js`.

## What's included
1. **Driver-delivery patch (preserved, unchanged):** `/api/drivers/me/offer-stream`,
   `/api/drivers/me/fcm-token`, `/api/drivers/:uid/active-orders`, accept / stage /
   complete / order-stream, the dispatch poller, and the `[BCD]` marker.
2. **Strict plan expiry** (in `pgActivatePlanByOrderId`, the verify-payment activation path):
   ```js
   const expiresAt = new Date(startedAt.getTime() + (
     row.planId === "daily"   ? 12 * 60 * 60 * 1e3 :
     row.planId === "weekly"  ? 7  * DAY_MS        :
     row.planId === "monthly" ? 30 * DAY_MS        :
     row.durationDays * DAY_MS));
   ```
   - Driven by the **actual paid row's `plan_id`** (the row matched by
     `razorpay_order_id`). Daily = activation + 12h, Weekly = +7d, Monthly = +30d.
   - **Never defaults to monthly** — an unrecognised plan falls back to *that row's own*
     `duration_days`, not to a hardcoded plan.
   - **One active row per driver (one-active invariant):** on activation, any other
     `status='active'` rows for the same driver are set to `expired` before the paid
     row is activated — so a driver can only ever hold a single active plan.
   - **No monthly default:** `resolvePlan` no longer falls back to monthly; a
     missing/blank/unknown `planId` is rejected with **400** (DEFAULT_PLAN_ID is kept
     only as the suggested default in the GET "/" plan list).
3. **Active-plan guard** in `POST /api/driver-plans/create-order` (runs before Razorpay /
   any DB insert):
   ```js
   const __activePlan = await pgGetActivePlan(uid); // status='active' AND expires_at > now()
   if (__activePlan) {
     res.status(409).json({ active: true, error: "Driver already has an active plan.",
       plan: { planId, status, expiresAt } });
     return; // no Razorpay order, no driver_plans row
   }
   ```

## Untouched
OTP, MPIN, login, sessions, customer booking, wallet, Razorpay keys/config, UI, DB
schema, and all delivery routes (preserved as-is). Plan **prices** unchanged
(daily ₹3 / weekly ₹19 / monthly ₹100).

## Verification (all passing)
- **A/B/C** — with an active daily row present, `create-order` for daily / weekly /
  monthly each returns **409**, creates **no** Razorpay order and **no** new row
  (the guard keys on the *driver's* active plan, not the requested plan).
- **D** — after the active plan is cancelled/expired: new daily = **12h**,
  weekly = **7d (168h)**, monthly = **30d (720h)**; unknown plan never becomes monthly.
- **E** — `offer-stream`, `me/fcm-token`, `:uid/active-orders` are registered behind
  `driverAuth`, which returns **401** (not 404) when the `Authorization: Bearer` header
  is missing/invalid.

## Hashes
- **BASE (current live)** sha256: `297c2543edbdefe54a38f6442cf755bf05bc9040fb0f43705f5f1cac0c038bd2`
- **PATCHED bundle** sha256: `6f415a8d0fc305b959b179b3235f18b059e4596a19d5c4643a2b1cc252ec123b`
- byte delta: +758 (CHANGE1+4 +281, CHANGE2 +504, CHANGE3 -27)

## Deploy (VPS)
```bash
scp live-production-api.PATCHED.js <user>@<vps-host>:/tmp/
ssh <user>@<vps-host>

cd /tmp
sha256sum live-production-api.PATCHED.js
# must equal: 6f415a8d0fc305b959b179b3235f18b059e4596a19d5c4643a2b1cc252ec123b

# verify as a module (bundle is ESM — do NOT `node --check` a bare .js)
cp live-production-api.PATCHED.js /tmp/check.mjs && node --check /tmp/check.mjs

# back up current, drop in, reload
cp /home/<user>/api-pkg/dist/production-api.js \
   /home/<user>/api-pkg/dist/production-api.js.bak-$(date +%Y%m%d-%H%M%S)
cp /tmp/live-production-api.PATCHED.js /home/<user>/api-pkg/dist/production-api.js
cd /home/<user>/api-pkg && node --check dist/production-api.js
pm2 reload bike-courier-api --update-env
pm2 logs bike-courier-api --lines 50   # expect: [BCD] driver_delivery_block_installed
```

## Post-deploy smoke
```bash
# E — must be 401, not 404
for p in drivers/me/offer-stream drivers/me/fcm-token drivers/918299013350/active-orders; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://<api-host>/api/$p"
done

# A/B/C — with an active plan, expect 409 (use a real driver Bearer token)
curl -s -X POST "https://<api-host>/api/driver-plans/create-order" \
  -H "Authorization: Bearer <driver-id-token>" -H "Content-Type: application/json" \
  -d '{"planId":"weekly"}' -w "\nHTTP %{http_code}\n"
```
```sql
-- D — after activating a fresh plan, hours should be 12 / 168 / 720
SELECT plan_id, started_at, expires_at,
       EXTRACT(EPOCH FROM (expires_at - started_at))/3600 AS hours
FROM driver_plans WHERE status='active' ORDER BY started_at DESC LIMIT 5;
```

## Rollback
```bash
ls -t /home/<user>/api-pkg/dist/production-api.js.bak-*
cp /home/<user>/api-pkg/dist/production-api.js.bak-<timestamp> \
   /home/<user>/api-pkg/dist/production-api.js
pm2 reload bike-courier-api --update-env
```
Purely additive/in-place edits — restoring the backup fully reverts; no schema/data
migration to undo.
