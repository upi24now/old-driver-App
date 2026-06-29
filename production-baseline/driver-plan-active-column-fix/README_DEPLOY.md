# Driver-Plans verify-payment fix — drop non-existent `active` column

## Root cause (from prod PM2 logs)
```
POST /api/driver-plans/create-order   -> 200 OK   (Razorpay order created)
Razorpay payment                       -> success
POST /api/driver-plans/verify-payment  -> HTTP 500
  DatabaseError: column "active" of relation "driver_plans" does not exist  (42703)
```
The live bundle's PG-authoritative driver-plans block writes a boolean `active`
column into `driver_plans`, but that column does **not exist** in the live schema.
Activation is already represented by the existing **text `status`** column
(`'created' | 'active' | 'cancelled'`). Every READ filters on `status = 'active'`
— nothing reads the boolean. So `active` is redundant; removing it from the writes
matches the existing production schema with **zero behaviour change**.

> Option chosen per the brief: **change backend code to match the existing schema**
> — NOT a DB migration. `active` was not renamed; the live table never had it. The
> correct existing column is `status`, which all reads already use.

## Exact change (4 statements, `active` column removed)
File: live bundle `dist/production-api.js`
Function: the `[BCD-PG]` driver-plans block — `POST /api/driver-plans/create-order`
and `POST /api/driver-plans/verify-payment` (incl. the self-heal insert).

| # | Statement | Before → After |
|---|-----------|----------------|
| 1 | create-order INSERT | `(… status, active, razorpay_order_id …) VALUES (… 'created', false, $6 …)` → `(… status, razorpay_order_id …) VALUES (… 'created', $6 …)` |
| 2 | verify self-heal INSERT | same removal (`'created',false,$6` → `'created',$6`) |
| 3 | cancel other active rows | `SET status = 'cancelled', active = false WHERE …` → `SET status = 'cancelled' WHERE …` |
| 4 | activate paid row | `SET status = 'active', active = true, razorpay_payment_id = $1 …` → `SET status = 'active', razorpay_payment_id = $1 …` |

Bind params `$1..$N` are **unchanged** — `active` used SQL literals (`false`/`true`),
never a bind parameter, so all positional params stay aligned.

## Scope — NOT touched
Auth · MPIN · `/drivers/me` patch · customer app · orders · wallet · delivery flow ·
admin routes/panel · Razorpay verification (HMAC, advisory lock, one-active invariant,
idempotency, self-heal-from-Razorpay-notes) — all preserved. The only bytes that
change are inside those 4 SQL strings (net −60 bytes). The patcher proves this by
re-inserting `active` and reconstructing the input byte-for-byte.

## How to apply (BASE-AGNOSTIC — recommended: patch the real live file)
The patcher keys on the 4 exact SQL literals, not a whole-file hash, so run it
directly against whatever bundle is live — it changes only those 4 statements and
leaves every other byte (including any other patches already deployed) intact.

```bash
APP=/home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg
LIVE=$APP/dist/production-api.js

# 0. record the current live SHA (for your records / rollback verification)
sha256sum "$LIVE"

# 1. back up the live bundle
cp "$LIVE" "$LIVE.bak.$(date +%Y%m%d-%H%M%S)"

# 2. patch the REAL live file in place (asserts the 4 literals, refuses otherwise)
python3 apply-patch.py "$LIVE" /tmp/production-api.PATCHED.js
#   prints: INPUT sha (= your live SHA), PATCHED sha, DELTA -60 bytes,
#           and "SURGICAL-SAFE: re-inserting active reproduces the input byte-for-byte"

# 3. syntax check, then swap in
node --check /tmp/production-api.PATCHED.js
cp /tmp/production-api.PATCHED.js "$LIVE"

# 4. restart
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50
```

### Convenience path (only if your live SHA matches this prebuilt base)
A prebuilt bundle is included for the base captured here:
- BASE    sha256: `7a7ff11d4037aa1a9c8697d79ce92f1076149b984e125d6fe96bede24e081162`
- PATCHED sha256: `a56e35631f09ad6eb02d9823c504cb1971b3f5b17e0fc42f7bdef6a936fd601e`

```bash
sha256sum "$LIVE"   # ONLY use the prebuilt file if this == 7a7ff11d...
cp "$LIVE" "$LIVE.bak.$(date +%Y%m%d-%H%M%S)"
cp production-api.PATCHED.js "$LIVE"
sha256sum "$LIVE"   # expect a56e3563...
pm2 restart bike-courier-api
```
If your live SHA differs, **do not** copy the prebuilt file (it would revert other
patches) — use the in-place `apply-patch.py` path above instead.

## Verify (live, end-to-end)
```bash
# in the app: buy a plan -> Razorpay success ->
# POST /api/driver-plans/verify-payment  now returns 200 (was 500)
pm2 logs bike-courier-api --lines 50   # no more: column "active" ... does not exist
```
Functional: create-order → payment → verify-payment → **plan activated** → success.
After activation, `GET /api/driver-plans/status` returns `active:true` with the new expiry.

## Rollback (instant)
```bash
cp "$LIVE.bak.<TS>" "$LIVE"
pm2 restart bike-courier-api
```
No DB/DDL change was made, so nothing else to undo.

## Proof performed before delivery
- `apply-patch.py`: each buggy literal present exactly once; after patch **0** `active`
  driver_plans writes remain; reverse reconstruction == base byte-for-byte; DELTA −60 B.
- `node --check production-api.PATCHED.js` → OK.
- `harness.mjs` (5/5 PASS) against a TEMP table with the live (no-`active`) schema:
  1. OLD insert → **42703 column "active" does not exist** (reproduces the prod 500)
  2. NEW create-order insert → row `status='created'`
  3. NEW activate paid row → exactly 1 row updated
  4. exactly one active row remains, and it is the paid order (one-active invariant holds)
  5. OLD activate → 42703 (confirms every active-column write was the bug)
