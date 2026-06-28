# Driver Delivery Live Fix — VPS Apply Instructions (base `b2f1643f`)

Backend-only, byte-safe **additive** patch to the live production API bundle.
**No mobile app rebuild required.** Nothing in OTP / MPIN / Driver-Plan / Razorpay /
login / sessions / UI is touched.

## What this adds

A single additive code block (one IIFE, marker `__BCD_DRIVER_DELIVERY`) spliced into the
live bundle immediately **before** `app2.use("/api", routes_default);` so its routes
register first (first-match-wins). It provides the driver-facing delivery API the existing
Driver App already calls, plus a broadcast dispatch poller:

- **Broadcast dispatch poller** (every 3s, single-flight): finds pending orders (<15 min
  old, `status IN (pending|searching|finding_driver)`, `driver_uid IS NULL`) with no active
  offer, selects ALL eligible drivers (`drivers.verification_status='approved'` +
  `account_status='active'` + `driver_locations.is_online=TRUE` + an `active` row in
  `driver_plans` with `expires_at > now()`), inserts `order_offers` rows
  (idempotent via `NOT EXISTS`), and sends FCM to each via the bundle's own
  `notificationService_exports.sendNotification({audience:"specific_driver", ...})`
  (channel `incoming_orders_v2`). First driver to accept wins.
- `GET   /api/drivers/me/offer-stream` — SSE stream of current offers (`OrderDoc[]`).
- `PATCH /api/drivers/me/fcm-token` — saves the push token via the bundle's own
  `notificationService_exports.saveFCMToken` (expo vs fcm auto-detected).
- `POST  /api/orders/:orderId/accept` — order-keyed first-wins claim; delegates the atomic
  claim to the bundle's existing `pgAcceptOffer`. Reasons:
  `already_claimed | not_in_offer | expired | order_missing`.
- `PATCH /api/orders/:orderId/stage` — advance delivery stage.
- `POST  /api/orders/:orderId/complete` — OTP verify (bundle's `pgVerifyDeliveryOtp`) →
  `delivered` → wallet settlement. **CASH/COD never credits** the withdrawable wallet
  (audit-only `cash_collected` row, amount 0). ONLINE/PREPAID credits the fare exactly once
  (guarded on an existing `credit` txn for the order). Settlement is idempotent and
  **fails loud** (HTTP 500 `credit_failed`, `delivered:true`) if the credit errors after
  delivery, so the app retries and the order self-heals — no lost or double payout.
  Concurrent retries are serialized per `(uid, orderId)` with a Postgres **session
  advisory lock** (`pg_advisory_lock`), so even 10 parallel `/complete` calls credit the
  fare exactly once (proven). No DB migration required.
- `PATCH /api/orders/:orderId/location` — driver GPS upsert into `driver_locations`.
- `GET   /api/orders/:orderId/stream` — SSE order status (`{status}`), **ownership-gated**
  (`driver_uid = me`).
- `GET   /api/drivers/:uid/active-orders` — the driver's active (non-terminal) assigned
  orders as `{ ok, orders: OrderDoc[] }`. **Self-only** (`:uid` must equal the
  authenticated driver, else 403). Returns `200` with `[]` when there are none.

## Files in this folder

| File | Purpose |
|---|---|
| `production-api.PATCHED.js` | The ready-to-ship patched bundle (this is what you deploy). |
| `INSERTED-BLOCK.js` | The exact additive block that was spliced in (for review/audit). |
| `apply-patch.py` | The byte-safe patcher (re-runnable on a fresh base if needed). |
| `SHA256SUMS.txt` | Checksums for the base, patched bundle, and block. |

## Checksums

- Base bundle (`live-production-api_1782580938044.js`): `b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c`
- Patched bundle (`production-api.PATCHED.js`): `734a3a544bad671d9495ff29d2229cd5d2babe3d572ef346789fbcd1206b5095`
- Inserted block (as embedded): `3b39b534d26b85549ee3449de681d519cb64977b1b814ec5d4d6656777a0e807`
- Size delta: **+28,549 bytes** (block only; base otherwise byte-identical).

## How the patch is built (re-runnable)

```bash
python3 apply-patch.py <BASE_BUNDLE.js> production-api.PATCHED.js
```

The patcher aborts unless it finds the mount anchor `app2.use("/api", routes_default);`
exactly **once** and the `__BCD_DRIVER_DELIVERY` marker is **absent** (so it never
double-applies). It writes a `.bak` of the input.

## Deploy on the VPS (operator steps)

1. Back up the current live bundle.
2. Copy `production-api.PATCHED.js` over the live bundle file PM2 runs as
   `bike-courier-api`, **OR** keep the filename and update the PM2 entry to point at it.
3. Verify syntax on the box (ESM bundle — check as `.mjs`):
   ```bash
   cp production-api.PATCHED.js /tmp/check.mjs && node --check /tmp/check.mjs && echo OK
   ```
4. `pm2 reload bike-courier-api` (zero-downtime) or `pm2 restart bike-courier-api`.
5. Tail logs for `[BCD] driver_delivery_block_installed` (confirms the block loaded) and,
   on the first pending order, `[BCD] dispatched`.

## Rollback

Restore the backed-up original bundle and `pm2 reload bike-courier-api`. The block is
purely additive (one self-contained IIFE + 8 routes registered before the `/api` mount);
removing it returns the bundle to its exact prior behavior.

## Pre-deploy verification done in this repo

- ESM `node --check` passes on the patched bundle.
- Block registered at line 111706, **before** the `/api` mount at line 112293.
- All 8 routes present; mount anchor still appears exactly once.
- Block SQL reconciled against the bundle's **own** Drizzle schema (the authoritative shape
  of the VPS DB): `orders` (pickup_address/delivery_address/user_id/weight_kg/...),
  `order_offers` (text `id`, `round`, `fare_offered`, `created_at`, `updated_at`),
  `driver_locations`, `driver_plans`, `driver_wallets`, `wallet_transactions`
  (`balance_before`/`balance_after`).
- Logic proven on a faithful schema mirror with isolated seed rows:
  eligibility selects only online+approved+active-plan drivers; offer insert is idempotent
  (one live offer per order/driver); accept is first-wins (second driver → `already_claimed`);
  CASH completion writes only a `cash_collected` audit row (amount 0, balance unchanged);
  ONLINE completion credits the fare exactly once (idempotent on retry).

> NOTE: the VPS database is not reachable from this repo, so the proof ran against a
> schema mirror built from the bundle's own Drizzle definitions. The Replit-managed
> Postgres replica is a **different** database and must not be used to judge this schema.
