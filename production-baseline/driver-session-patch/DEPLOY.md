# Driver-session additive patch — DEPLOY / ROLLBACK

Adds ONLY two driver-facing routes to the live API bundle:
  - GET   /api/drivers/me            (driverAuth; PG drivers lookup by uid, phone fallback)
  - PATCH /api/drivers/me/fcm-token  (driverAuth; writes drivers.push_token in PG)

Nothing else changes. OTP, customer, Razorpay, mirror (default OFF), PIN: all untouched.
No DB migration required — prod `drivers` already has push_token* columns and `driver_documents` exists.

## Checksums (see SHA256SUMS.txt)
  BASE  (must match current live):  9e4477c900b13950705f243409ad7d9516068fbae79158da9b6a04c4852817ca
  PATCH (deploy this):              2ce3e5ea416ece4e22090965fb10fea5a2cb8bf66e3b3af0f617ad5be036b015

## DEPLOY (on VPS, in the api-pkg dir; adjust DIST path)
  DIST=dist/production-api.js
  # 0. Pre-flight: confirm live bundle is the expected base
  sha256sum "$DIST"        # expect 9e4477c9...
  # 1. Backup current live bundle
  cp "$DIST" "$DIST.bak.$(date +%Y%m%d-%H%M%S)"
  # 2. Install patched bundle
  cp /path/to/production-api.js "$DIST"
  sha256sum "$DIST"        # expect 2ce3e5ea...
  # 3. Restart PM2 process
  pm2 restart bike-courier-api
  pm2 logs bike-courier-api --lines 50

## ROLLBACK (instant)
  DIST=dist/production-api.js
  # Option A: restore the timestamped backup made in deploy step 1
  cp "$DIST.bak.<timestamp>" "$DIST"
  # Option B: restore the bundled base artifact shipped in this package
  cp /path/to/base-9e4477c9-production-api.js "$DIST"
  sha256sum "$DIST"        # expect 9e4477c9...
  pm2 restart bike-courier-api

## Post-deploy verification (replace HOST + a real driver ID token)
  curl -i https://HOST/api/drivers/me                 # no auth -> 401 JSON (not 403/404)
  curl -i -X PATCH https://HOST/api/drivers/me/fcm-token -H 'Content-Type: application/json' -d '{"fcmToken":"x"}'  # -> 401 JSON (not 404)
  curl -i https://HOST/api/drivers/me -H "Authorization: Bearer <DRIVER_ID_TOKEN>"   # -> 200 { ok, driver, nextRoute }
