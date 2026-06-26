# Driver Plan Activation — additive patch (DEPLOY / ROLLBACK)

Adds ONLY two routes + makes /me surface subscription state from PG:
  - POST /api/driver-plans/create-order    (driverAuth; server-priced; creates Razorpay order; inserts driver_plan_orders)
  - POST /api/driver-plans/verify-payment  (driverAuth; HMAC-verifies; writes drivers.subscription_plan/_expires_at)
  - GET  /api/drivers/me now returns subscriptionPlan / subscriptionExpiresAt from PG (was hard-null)

Untouched: OTP, PIN, customer orders/payment, existing customer Razorpay routes, Phase 1 mirror (stays OFF), frontend.
Reuses EXISTING prod env vars VITE_RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET — NO new secrets.
Plan pricing/duration computed server-side: daily Rs3/12h, weekly Rs19/7d, monthly Rs100/30d.

## Checksums (see SHA256SUMS.txt)
  BASE  (must match current live):  2ce3e5ea416ece4e22090965fb10fea5a2cb8bf66e3b3af0f617ad5be036b015
  PATCH (deploy this):              dedff18a3ddb71d5c1eed84614accef642163e11b77ec1f79e6e95a818d37503

## STEP 1 — DB migration (run ONCE, BEFORE deploy; idempotent, no data change)
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_driver_plan_activation.sql
  # adds drivers.subscription_plan, drivers.subscription_expires_at; creates driver_plan_orders

## STEP 2 — DEPLOY (on VPS, in the api-pkg dir; adjust DIST)
  DIST=dist/production-api.js
  sha256sum "$DIST"                                   # expect 2ce3e5ea...
  cp "$DIST" "$DIST.bak.$(date +%Y%m%d-%H%M%S)"       # backup
  cp /path/to/production-api.js "$DIST"               # install patched
  sha256sum "$DIST"                                   # expect dedff18a...
  pm2 restart bike-courier-api
  pm2 logs bike-courier-api --lines 50

## ROLLBACK (instant; safe to leave migration applied — new cols/table simply go unused)
  DIST=dist/production-api.js
  cp "$DIST.bak.<timestamp>" "$DIST"                  # or: cp base-2ce3e5ea-production-api.js "$DIST"
  sha256sum "$DIST"                                   # expect 2ce3e5ea...
  pm2 restart bike-courier-api

## Post-deploy verification (replace HOST + real driver ID token)
  curl -i -X POST https://HOST/api/driver-plans/create-order -H 'Content-Type: application/json' -d '{"planType":"monthly"}'   # 401 JSON (not 404)
  curl -i -X POST https://HOST/api/driver-plans/create-order -H "Authorization: Bearer <IDT>" -H 'Content-Type: application/json' -d '{"planType":"monthly"}'  # 200 {razorpayOrderId,amount,currency,keyId}
  curl -i https://HOST/api/drivers/me -H "Authorization: Bearer <IDT>"   # 200 incl subscriptionPlan/subscriptionExpiresAt
