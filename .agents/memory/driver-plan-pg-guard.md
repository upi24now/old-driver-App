---
name: Driver-plans money-path is PG-authoritative
description: The active-plan guard and plan activation source of truth is PostgreSQL driver_plans, not Firestore; required money-path invariants.
---

# Driver-plans money-path (create-order / verify-payment)

**Rule:** The source of truth for a driver's active subscription plan is the PostgreSQL
`driver_plans` table, NOT Firestore. Any active-plan guard MUST read PG
(`status='active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1`). A driver with an
active PG plan must get HTTP 409 from create-order with NO Razorpay order and NO row written.

**Why:** A deployed build guarded on Firestore while activation wrote PG → a driver with an
active PG plan could mint a second Razorpay order = double charge. Firestore is only a best-effort
mirror for the app's subscription display.

**Invariants verify-payment must hold (money-path):**
- Exactly ONE active plan per driver — cancel-others + activate-paid-row must run inside a
  per-driver `pg_advisory_xact_lock(hashtext('dpa:'+uid)::bigint)` + `FOR UPDATE` re-read.
  Same lock key namespace as create-order so the whole per-driver money path serialises.
  Without the lock, two concurrent verifies can each cancel-then-activate and leave TWO active rows.
- Strict expiry: daily = **+12h** (NOT 24h — `duration_days` is INTEGER so 12h is computed in JS,
  never `duration_days * INTERVAL '1 day'`), weekly +7d, monthly +30d.
- Self-heal (lost `created` row) must be SERVER-authoritative: derive the plan from the Razorpay
  order (`notes.plan_id` we set at create time, else charged amount → plan map
  300→daily/1900→weekly/10000→monthly), and reject if `notes.driver_uid` ≠ authed uid (403).
  NEVER trust a client-supplied plan key — it could activate a cheaper plan than what was paid.
- Idempotent: an already-active-not-expired replay returns current state, no re-charge, no re-write.

**How to apply:** Prod ships as an additive `[BCD-PG]` override spliced BEFORE the older `[BCD]`
block (first-match-wins) in the live VPS esbuild bundle; see
`production-baseline/driver-plan-pg-guard/`. Validate with `harness.mjs` (mock-PG, 20 checks) and
`sql-proof.mjs` (real-PG incl. a 2-connection concurrency proof, 9 checks).
