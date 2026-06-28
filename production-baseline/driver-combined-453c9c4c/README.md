# Bike Courier — Combined Driver Patch for live VPS bundle `453c9c4c`

ONE **byte-safe ADDITIVE** patch to the live VPS production API bundle
(`production-api.js`, ESM, run under PM2 as `bike-courier-api`). **No app rebuild.**
It splices a single self-contained block immediately before the main `/api`
router mount, registering 11 driver-facing routes that reuse only pre-existing
top-level bindings (`app`, `auth`, `db2` Firestore, `FieldValue`, `pool` pg,
`import_razorpay`, `driverAuth`, `logger`). The whole block is wrapped in a
`try/catch` IIFE, so a registration failure can never crash boot.

## What it adds

**Part A — driver-plans (ported from backup `eec273e6`, behavior-preserving):**
- `POST /api/driver-plans/create-order`
- `POST /api/driver-plans/verify-payment`
- `POST /api/driver-plans/onboarding-fee/create-order`
- `POST /api/driver-plans/onboarding-fee/verify-payment`

Plans: daily ₹3/300p (0.5d), weekly ₹19/1900p (7d), monthly ₹100/10000p (30d).
HMAC verify (`sha256` + `timingSafeEqual`); writes Firestore `drivers/{uid}`.
No 409 active-plan guard (backup had none — preserved).

**Part B — the 7 missing driver delivery routes:**
- `PATCH /api/drivers/me/fcm-token`  (PG `drivers` push-token columns)
- `GET   /api/drivers/me/offer-stream`  (SSE; `OrderDoc[]`)
- `GET   /api/drivers/:uid/active-orders`
- `POST  /api/orders/:orderId/accept`  (first-wins Firestore tx; reasons `order_missing|already_claimed|not_in_offer|expired`, TTL 120s)
- `PATCH /api/orders/:orderId/stage`  (status === stage; identity)
- `PATCH /api/orders/:orderId/location`
- `POST  /api/orders/:orderId/complete`  (Firestore tx OTP verify → `delivered`, then PG wallet settle)

Orders/offers are **Firestore-authoritative** (matches the live external dispatcher);
wallet + fcm-token are **PostgreSQL**. NO poller, NO FCM send (dispatch is external).
`GET /api/orders/:orderId/stream` already exists in the base — NOT duplicated.

### Cash/COD rule (enforced)
CASH/COD completions **never** credit the withdrawable wallet, **never** increment
`completed_deliveries` — only an audit-only `cash_collected` ledger row (amount `0`).
ONLINE/PREPAID credit the fare. `isCashPayment` uses an ONLINE allow-list
(`online/prepaid/upi/card/razorpay/paid/wallet/netbanking`); anything unknown/empty/null
= cash (fail-safe). `settleWallet` is idempotent (a prior `credit`/`cash_collected`
row for the order short-circuits). Daily stats count BOTH modes (display only).

## SHA256

| File | SHA256 |
|------|--------|
| BASE (`current-live-production-api-453c9c4c…js`)  | `453c9c4c5b0fe752386535f1476afbdef1a7f40eac7541dabc9171647d5c7dc1` |
| PATCHED (`production-api.patched.js`)             | `a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae` |

(Package `.tar.gz` SHA256 is printed at delivery time.)

The patched bundle differs from BASE **only** by the inserted block:
`patched_bytes − base_bytes = 32010` (the block + its BEGIN/END markers), and
stripping the marked block reproduces BASE byte-for-byte.

## Contents of this package
- `production-api.patched.js` — the ready-to-deploy patched bundle
- `INSERTED-BLOCK.js` — the additive block (source of the splice)
- `apply-patch.py` — byte-safe patcher (reproduce the patched bundle from BASE)
- `harness.mjs` — deterministic mock harness (32 assertions, no live side effects)
- `README.md` — this file

---

## DEPLOY (on the VPS)

```bash
# 0) Locate the live bundle (the file PM2 'bike-courier-api' runs). Example path:
LIVE=/opt/bike-courier-api/production-api.js     # <-- adjust to your real path

# 1) SAFETY: confirm the live file is exactly the expected base before patching.
sha256sum "$LIVE"
# EXPECT: 453c9c4c5b0fe752386535f1476afbdef1a7f40eac7541dabc9171647d5c7dc1
#   If it differs, STOP — the live bundle is not 453c9c4c; do not deploy this patch.

# 2) Back up the current bundle (timestamped).
cp -a "$LIVE" "${LIVE}.bak.$(date +%Y%m%d-%H%M%S)"

# 3) Install the patched bundle (verify its SHA first).
sha256sum production-api.patched.js
# EXPECT: a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae
cp -a production-api.patched.js "$LIVE"

# 4) Restart the PM2 process.
pm2 restart bike-courier-api --update-env

# 5) Confirm registration in logs (look for the marker).
pm2 logs bike-courier-api --lines 50 --nostream | grep -E "BCD|listening"
# EXPECT a line like: "[BCD] routes_registered" {partA:4, partB:7}  AND  "API server listening"
```

> Razorpay keys: the plan routes require `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
> in the process env. If unset, those 4 routes intentionally return **503** (the
> 7 delivery routes are unaffected).

## VERIFY (after deploy)

```bash
HOST=https://<your-api-host>     # or http://127.0.0.1:<port> on the box

# All 11 new routes must return 401 (registered + auth-gated), NOT 404.
for m_p in \
  "PATCH /api/drivers/me/fcm-token" \
  "GET   /api/drivers/me/offer-stream" \
  "GET   /api/drivers/anyuid/active-orders" \
  "POST  /api/orders/x/accept" \
  "PATCH /api/orders/x/stage" \
  "PATCH /api/orders/x/location" \
  "POST  /api/orders/x/complete" \
  "POST  /api/driver-plans/create-order" \
  "POST  /api/driver-plans/verify-payment" \
  "POST  /api/driver-plans/onboarding-fee/create-order" \
  "POST  /api/driver-plans/onboarding-fee/verify-payment" ; do
  m=${m_p%% *}; p=${m_p##* }
  printf '%-8s %-50s -> %s\n' "$m" "$p" "$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$HOST$p")"
done
# EXPECT: every line -> 401

# Control: a GET on the PATCH-only route must be 404 (proves method routing, not catch-all).
curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/drivers/me/fcm-token"   # EXPECT 404
```

## ROLLBACK (instant)

```bash
# Restore the most recent backup and restart.
LIVE=/opt/bike-courier-api/production-api.js      # <-- same path as deploy
BAK=$(ls -1t "${LIVE}".bak.* | head -1)
echo "Restoring $BAK"
cp -a "$BAK" "$LIVE"
pm2 restart bike-courier-api --update-env
sha256sum "$LIVE"   # EXPECT 453c9c4c5b0fe752386535f1476afbdef1a7f40eac7541dabc9171647d5c7dc1
```

## Reproduce the patched bundle from BASE (optional integrity check)

```bash
python3 apply-patch.py <BASE 453c9c4c .js> INSERTED-BLOCK.js out.js
sha256sum out.js   # EXPECT a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae
```
