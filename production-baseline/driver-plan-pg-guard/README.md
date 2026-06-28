# Driver-Plans PG-Authoritative Money-Path Patch (`[BCD-PG]`)

URGENT fix for `api.bikecourierservice.com` (ESM esbuild bundle, PM2 `bike-courier-api`, **no app rebuild**).

## The bug

The deployed `POST /api/driver-plans/create-order` active-plan guard checked **Firestore**, but
the source of truth is **PostgreSQL `driver_plans`**. A driver who already holds an active PG plan
could still mint a new Razorpay order → **double charge**.

## The fix (additive override, first-match-wins)

A single contiguous `[BCD-PG]` block is spliced **immediately before** the existing `[BCD]` block
so Express serves the new PG-authoritative handlers first. Only two routes are re-registered; every
original byte is preserved.

- `POST /api/driver-plans/create-order` — queries PG `driver_plans` **first**
  (`status='active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1`).
  If active → **HTTP 409** `{active:true, error:"Driver already has an active plan.", plan:{planId,status,expiresAt}}`,
  **no** Razorpay order, **no** row written. Otherwise creates the order + inserts a `created`
  (`active=false`) row carrying the selected plan, with `notes:{driver_uid, plan_id}` on the Razorpay order.
- `POST /api/driver-plans/verify-payment` — HMAC-verifies, then writes PG `driver_plans` as
  authoritative: **daily +12h, weekly +7d, monthly +30d**; cancels any other active row and
  activates only the paid row, guaranteeing **exactly one active plan per driver**. Idempotent
  (already-active replay returns current state, no re-charge). Best-effort Firestore mirror so the
  app's subscription display keeps working.

### Hardening (per code review)
- **One-active race closed** — activation runs inside a per-driver `pg_advisory_xact_lock`
  (same key namespace as create-order) + `FOR UPDATE` re-read, so concurrent verifies for one
  driver are serialised and can never leave two active rows.
- **Self-heal is server-authoritative** — if the `created` row was lost, the plan is derived from
  the **Razorpay order** (`notes.plan_id`, else charged amount → plan), **never** from the client
  body, and rejects an order whose `notes.driver_uid` ≠ the authenticated driver (403).

Untouched: OTP / MPIN / login / sessions / delivery routes / customer booking / UI / Razorpay config.

## SHA256

| Artifact | SHA256 |
| --- | --- |
| Base (currently deployed) | `a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae` |
| Patched (deploy this) `production-api.PATCHED.js` | `0beb1fa5c46126bfcb7c0f2221f55270651e7489b39fb8ad6bea5679a25c7860` |

Byte delta: **+18180** bytes, purely additive (re-stripping the inserted block reproduces the base
byte-for-byte — asserted by `apply-patch.py`).

## Proofs

- `harness.mjs` — mock-PG end-to-end through the real handler code: **20/20** (409 guard writes
  nothing/charges nothing, strict 12h/7d/30d expiry, one-active, idempotent, Firestore mirror,
  server-authoritative self-heal that ignores a client "daily" lie, cross-driver 403, bad-sig 400).
- `sql-proof.mjs` — exact SQL against a real-Postgres schema mirror: **9/9** (guard read, no-write
  on 409, real-timestamptz expiry math, one-active, **parallel two-connection concurrency proof**
  that the advisory lock serialises to exactly one active row).

Run locally (needs `pg` + `express` resolvable):
```bash
node --check INSERTED-BLOCK.js
node harness.mjs      # 20/20
node sql-proof.mjs    # 9/9  (uses $DATABASE_URL, isolated schema, auto-dropped)
```

## Deploy (on the VPS)

```bash
# 1. Back up the live bundle
cp /path/to/production-api.js /path/to/production-api.js.bak-$(date +%Y%m%d%H%M%S)

# 2. Confirm the backup matches the expected base SHA before replacing
sha256sum /path/to/production-api.js
#   expect: a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae

# 3. Drop in the patched bundle and confirm its SHA
cp production-api.PATCHED.js /path/to/production-api.js
sha256sum /path/to/production-api.js
#   expect: 0beb1fa5c46126bfcb7c0f2221f55270651e7489b39fb8ad6bea5679a25c7860

# 4. Restart
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50   # look for: [BCD-PG] PG-authoritative driver-plans guard registered
```

## Verify (after restart)

```bash
# New handler is registered (auth-gated, so 401 — NOT 404):
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.bikecourierservice.com/api/driver-plans/create-order
#   expect: 401

# A driver with an active PG plan is blocked from a second order:
curl -s -X POST https://api.bikecourierservice.com/api/driver-plans/create-order \
  -H "authorization: Bearer <DRIVER_ID_TOKEN>" -H "content-type: application/json" \
  -d '{"driverUid":"<UID>","planType":"weekly"}'
#   expect: HTTP 409 {"active":true,"error":"Driver already has an active plan.","plan":{...}}
```

## Rollback (instant)

```bash
cp /path/to/production-api.js.bak-<timestamp> /path/to/production-api.js
pm2 restart bike-courier-api
```
Reverting the bundle removes the `[BCD-PG]` override entirely; the previous `[BCD]` handlers resume.
