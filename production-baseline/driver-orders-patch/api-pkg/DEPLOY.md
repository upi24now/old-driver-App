# Driver Order Lifecycle — additive patch (DEPLOY / ROLLBACK)

Adds ONLY 11 PG-only driver order-lifecycle routes (no Firestore in any new route,
no mirror, no customer-app change, no frontend change). Inserted as one block before
the single anchor `app.use("/api", routes_default)`; everything else is byte-for-byte
identical to the current live bundle.

New routes (all driverAuth via the existing `__dsRequireDriver`, all PG-only):
  - GET   /api/drivers/:uid/active-orders     (PG miss => {ok:false} so app keeps Firestore fallback)
  - GET   /api/drivers/me/offer-stream        (SSE; pending offers for the driver from PG)
  - GET   /api/orders/:id/stream              (PG existence + ownership/offer check, then next() => existing Firestore SSE)
  - POST  /api/orders/:id/accept
  - POST  /api/orders/:id/reject
  - POST  /api/orders/:id/timeout
  - POST  /api/orders/:id/driver-cancel       (owner-only: rejects unassigned/foreign orders)
  - POST  /api/orders/:id/complete            (owner-only; server OTP required; CASH/COD never credits wallet; idempotent credit)
  - PATCH /api/orders/:id/stage               (owner-only via WHERE driver_uid = uid)
  - PATCH /api/orders/:id/location            (owner-only via WHERE driver_uid = uid)
  - GET   /api/drivers/me/trips

Authorization: every write/stream route is scoped to the authenticated driver.
`stream` only serves from PG when the caller is the assigned driver or is currently
offered the order; otherwise it falls through to the existing route. `driver-cancel`
and `complete` require `driver_uid = <caller>` (a NULL/unassigned or foreign order is
rejected). `stage`/`location` mutate only rows where `driver_uid = <caller>`.

Untouched: OTP login, PIN, /drivers/me, driver-plans, wallet, Razorpay, profile, KYC,
customer order creation, Phase 1 mirror (stays OFF), frontend.
NO new secrets/env vars required.

## Net behavior on deploy
The Driver App is API-primary but falls back to Firestore whenever a READ route does
NOT return `{ok:true,...}`. Live orders are still created in Firestore (mirror OFF), so
PG holds no real orders yet => every new READ route returns a JSON miss => the app keeps
its existing Firestore behavior. Net effect of THIS deploy = ZERO behavior change until
orders exist in PG. The routes are fully functional for any order that IS in PG
(verified end-to-end against a fresh DB built from migrations/002).

## Checksums (see SHA256SUMS.txt)
  BASE  (must match current live — the driver-plan patch output):
        dedff18a3ddb71d5c1eed84614accef642163e11b77ec1f79e6e95a818d37503
  PATCH (deploy this):
        395ffcb2265179178487878f853b2a86b8eac8a53a77928737c20a28c633b719

## STEP 1 — DB migration (run ONCE, BEFORE deploy; idempotent, no data change)
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_driver_orders_pg.sql
  # On production every CREATE TABLE / ADD COLUMN is IF NOT EXISTS, so all are no-ops
  # EXCEPT the one genuinely new column: orders.delivered_at (nullable, additive).
  # Adds btree idx_orders_driver_status + idx_wallet_tx_order inside a transaction,
  # then builds GIN idx_orders_offer_gin CONCURRENTLY (outside the transaction) so it
  # never write-locks the live orders table. No data is mutated.
  # NOTE: because of CONCURRENTLY, do NOT wrap this file in your own BEGIN/COMMIT.

## STEP 2 — DEPLOY (on VPS, in the api-pkg dir; adjust DIST)
  DIST=dist/production-api.js
  sha256sum "$DIST"                                   # expect dedff18a...
  cp "$DIST" "$DIST.bak.$(date +%Y%m%d-%H%M%S)"       # backup current live
  cp /path/to/production-api.js "$DIST"               # install patched
  sha256sum "$DIST"                                   # expect 395ffcb2...
  pm2 restart bike-courier-api
  pm2 logs bike-courier-api --lines 50

## ROLLBACK (instant; safe to leave migration applied — new col/table simply go unused)
  DIST=dist/production-api.js
  cp "$DIST.bak.<timestamp>" "$DIST"                  # restore previous live (dedff18a...)
  sha256sum "$DIST"                                   # expect dedff18a...
  pm2 restart bike-courier-api

## Post-deploy verification (replace HOST + real driver ID token)
  # 401 JSON (not 404) without a token == route is mounted:
  curl -i -X POST https://HOST/api/orders/__none__/accept -H 'Content-Type: application/json' -d '{}'
  # With token, no PG order yet => JSON miss (app falls back to Firestore):
  curl -i https://HOST/api/drivers/<uid>/active-orders -H "Authorization: Bearer <IDT>"   # {ok:false,...}
  # Existing route unaffected:
  curl -i https://HOST/api/drivers/me -H "Authorization: Bearer <IDT>"                    # 200
