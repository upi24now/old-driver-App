# Single-Device Login — ROLLBACK

Instant, safe rollback for the single-device-login / PIN-primary additive patch.
The patch is a **pure additive bundle swap** plus an **idempotent, additive-only**
DB migration, so rollback is just restoring the previous bundle. No data is ever
destroyed by rolling back.

## Checksums
  BASE  (the previous live bundle — roll back TO this):
        395ffcb2265179178487878f853b2a86b8eac8a53a77928737c20a28c633b719
  PATCH (the bundle you are rolling back FROM):
        21ee8ca710a6667fac31e518a2d6e63d15f11e7cc1132bfa4e94411e9003fd93

## STEP 1 — Restore the previous bundle (instant)
  DIST=dist/production-api.js
  sha256sum "$DIST"                          # confirm currently 21ee8ca7... (patched)
  cp "$DIST.bak.<timestamp>" "$DIST"         # restore the backup taken at deploy
  sha256sum "$DIST"                          # MUST now be 395ffcb2... (base)
  pm2 restart bike-courier-api
  pm2 logs bike-courier-api --lines 50

If no `.bak` exists, the base bundle (`395ffcb2...`) is the driver-orders patch
output; restore that exact file and confirm the SHA256 matches before restarting.

## What reverting the bundle does
  - Removes single-device session enforcement entirely (the `__dsRequireDriver`
    wrapper is gone with the bundle, so `x-session-id` is ignored again).
  - Removes the four auth overrides/additions: OTP 3/24h rate limiting,
    `sessionId` on verify-otp/verify-pin/set-pin, and the PIN routes
    (`set-pin`, `pin-status`, `verify-pin`).
  - The base bundle's own pre-existing `/api/auth/send-otp` + `/api/auth/verify-otp`
    handlers resume serving (first-match-wins reverts to them).
  - Wallet, Plans, KYC, Orders lifecycle, Profile, Razorpay, customer app, FCM
    dispatcher: unchanged in both directions — they were never touched.

## STEP 2 — DB (NORMALLY DO NOTHING)
The migration only **adds** nullable columns + one append-only table. After a bundle
rollback they are simply unused, so **leave them in place** — this makes re-deploy a
one-step bundle swap and keeps any already-minted `active_session_id` values intact.

Only if you must fully remove the schema (NOT required for rollback):
  ALTER TABLE drivers DROP COLUMN IF EXISTS active_session_id;
  ALTER TABLE drivers DROP COLUMN IF EXISTS active_session_at;
  DROP TABLE IF EXISTS otp_send_events;
  -- Leave pin_hash / pin_set_at / pin_failed_attempts / pin_locked_until:
  -- they belong to the separately-shipped PIN-login feature, not this patch.

## STEP 3 — Verify rollback
  sha256sum dist/production-api.js                                   # expect 395ffcb2...
  # PIN route should no longer exist (expect 404, not 200/401/429/400):
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://HOST/api/auth/verify-pin \
       -H 'Content-Type: application/json' -d '{"phone":"9999999999","pin":"123456"}'
  # verify-otp should no longer return a sessionId field (base handler):
  curl -s -X POST https://HOST/api/auth/verify-otp -H 'Content-Type: application/json' \
       -d '{"phone":"9999999999","otp":"000000"}'

## Re-deploy after rollback
Because the migration was left in place, re-deploy is just STEP 2 of DEPLOY.md
(swap the bundle back to `21ee8ca7...` and `pm2 restart`). No migration re-run needed.
