# Driver Delivery Live Fix — VPS Apply Instructions

Backend-only, byte-safe **additive** patch to the live production API bundle.
**No mobile app rebuild required.** Nothing in OTP / MPIN / Driver-Plan / Razorpay /
login / sessions / UI is touched.

## What this adds

A single additive code block (one IIFE) spliced into the live bundle, immediately
**before** `app2.use("/api", routes_default);` so its routes register first. It provides
the driver-facing delivery API the existing Driver App already calls, plus a broadcast
dispatch poller:

- **Broadcast dispatch poller** (every 3s, single-flight): finds pending orders (<15 min
  old) with no active offer, selects ALL eligible drivers (online + verified +
  active plan), inserts `order_offers` rows, and sends FCM to each via the bundle's own
  `sendNotification({audience:"specific_driver", ...})`. First driver to accept wins.
- `GET   /api/drivers/me/offer-stream` — SSE stream of current offers (OrderDoc[]).
- `PATCH /api/drivers/me/fcm-token` — writes the SAME `push_token*` columns as the
  existing per-uid token route.
- `POST  /api/orders/:orderId/accept` — order-keyed first-wins claim
  (`UPDATE ... WHERE driver_uid IS NULL`); reasons: `already_claimed | not_in_offer |
  expired | order_missing`.
- `PATCH /api/orders/:orderId/stage` — advance delivery stage.
- `POST  /api/orders/:orderId/complete` — OTP verify → `delivered` → wallet credit.
  **CASH/COD never credits** the withdrawable wallet (audit-only `cash_collected` row).
  Settlement is idempotent and **fails loud** (HTTP 500 `credit_failed`) if the credit
  errors after delivery, so the app retries and the order self-heals — no lost payout.
- `PATCH /api/orders/:orderId/location` — driver GPS for live tracking.
- `GET   /api/orders/:orderId/stream` — SSE order status (`{status}`), **ownership-gated**
  (`driver_uid = me`).

## Files in this folder

| File | Purpose |
|---|---|
| `live-production-api.PATCHED.js` | The ready-to-ship patched bundle (this is what you deploy). |
| `INSERTED-BLOCK.js` | The additive block only (for review). |
| `apply-patch.py` | Byte-safe patcher (only needed to re-generate the patched file). |

## Integrity (verify before deploy)

```
ORIGINAL  sha256: b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c
PATCHED   sha256: 306b55b16253c5afeb2ec5723cd0c74564aab7632d93099eaec2055ba0fff943
BLOCK     sha256: fbe3e251bad59a5b9fb27979aa4727c69e91460f937d1116c082b33f2e32c91c
SIZE      original 4162200 B  →  patched 4186586 B   (delta = +24386 B = block size, exact)
```

The patched file differs from the original by the inserted block ONLY: `cmp` reports the
first (and only structural) difference exactly at the splice offset; all bytes before it
are identical.

```bash
# Optional independent re-verification:
sha256sum live-production-api.PATCHED.js          # must equal PATCHED sha256 above
node --check live-production-api.PATCHED.js        # must print nothing (parse OK)
grep -c 'app2.use("/api", routes_default);' live-production-api.PATCHED.js   # must be 1
```

## Deploy steps (operator, on the VPS)

> No auto-deploy is performed by this patch. Apply manually.

1. **Back up the current bundle.**
   ```bash
   cp /home/<user>/api-pkg/dist/production-api.js \
      /home/<user>/api-pkg/dist/production-api.js.bak-$(date +%Y%m%d-%H%M%S)
   ```

2. **Drop in the patched bundle** (rename to the entry the process expects):
   ```bash
   cp live-production-api.PATCHED.js /home/<user>/api-pkg/dist/production-api.js
   node --check /home/<user>/api-pkg/dist/production-api.js   # sanity parse on the box
   ```
   No `npm install` is needed — the patch adds NO new dependencies (it reuses the bundle's
   own `pool`/`db`/`logger`/`sendNotification`/table bindings).

3. **Reload PM2** (zero new env required):
   ```bash
   pm2 reload bike-courier-api --update-env
   pm2 logs bike-courier-api --lines 50
   ```
   On boot you should see the log line `[BCD] driver_delivery_block_installed`.

4. **Smoke test** (real driver token or curl through the API host):
   - `GET /api/drivers/me/offer-stream` with a driver `Authorization` header → SSE opens.
   - Create/await a pending order → within a few seconds the poller logs a dispatch and
     eligible drivers receive FCM + the offer appears on `offer-stream`.
   - `POST /api/orders/:id/accept` from one driver → `200`; a second driver → `already_claimed`.
   - Complete a non-cash order → wallet credited once; complete a CASH/COD order → no
     wallet credit (audit row only).

## Rollback

```bash
cp /home/<user>/api-pkg/dist/production-api.js.bak-<timestamp> \
   /home/<user>/api-pkg/dist/production-api.js
pm2 reload bike-courier-api --update-env
```

Because the change is purely additive (new routes registered before the `/api` mount and
a poller), reverting the file fully removes it with no schema or data migration to undo.

## Notes / assumptions

- Tables used already exist in prod: `orders`, `order_offers`
  (partial-unique on `(order_id, driver_uid) WHERE status='offered'`), `drivers`,
  `driver_locations`, `driver_plans`, `driver_wallets`, `wallet_transactions`.
  No DDL runs at request time.
- FCM uses the bundle's existing notification service (`sendNotification`) — no new
  Firebase config.
- The poller is bounded (orders <15 min old) and single-flight (no overlapping passes).
