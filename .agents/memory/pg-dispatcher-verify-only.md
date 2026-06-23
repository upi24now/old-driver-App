---
name: PG dispatcher VERIFY_ONLY (Phase 5F)
description: The pg-mode PostgreSQL dispatcher and its verify-only gate; startup matrix; how to runtime-verify with deterministic counts.
---

# PG dispatcher — verify-only gate

`pg-dispatcher.ts` is the PostgreSQL-authoritative dispatcher started ONLY when `DISPATCH_SOURCE=pg`. `runPgDispatcherPass(verifyOnly)` runs the full decision path:
- timeout sweep via `pgCheckExpiredDispatches()` (read-only)
- assignment via `pgFindEligibleDrivers()` (read-only) + `chooseNextDriver()` (reused from the dry-run module, single round-robin source of truth)

**The `verifyOnly` flag is the only thing standing between "logs intended writes" and "commits".** When true: logs `[PG_VERIFY_ASSIGN]` / `[PG_VERIFY_TIMEOUT]` / `[PG_VERIFY_CLAIM]`, `continue`s, calls NO committing service, sends NO FCM. When false: calls `pgReturnOrderToPool` / `pgAssignDriverToOrder` / `pgClaimFcmDispatch` (commit path). Per-item errors → `[PG_VERIFY_ERROR]`, never throws.

**Why the commit branch exists but is dormant:** it is the real implementation a later cutover phase enables. `planDispatchStartup()` hardwires `pgDispatcherVerifyOnly: true`, and `index.ts` is the only caller — so `verifyOnly=false` is unreachable until cutover. Before ever flipping it, gate on: FCM send wiring, claim idempotency, and a rollback switch (these were NOT built in the verify-only phase).

## Startup matrix (planDispatchStartup)
- `firestore` → Firestore dispatcher only
- `pg_shadow` → Firestore dispatcher + PG dry-run (read-only loop)
- `pg` → Firestore dispatcher + PG dispatcher (verify-only)

Firestore (FCM + round-robin + shadow writer) ALWAYS starts first and stays authoritative in every mode. The PG components are purely additive via the index.ts gate.

## Runtime-verifying verify-only with deterministic counts
Live PG-only orders (no Firestore counterpart) are touched by NOTHING in the live workflow — the RR dispatcher works on Firestore, the shadow writer only mirrors Firestore→PG. So seed isolated test rows to force each branch deterministically:
- `status='searching'`, `driver_uid=NULL`, `rejected_by=[]` → assign candidate (yields ASSIGN+CLAIM iff ≥1 live driver is eligible).
- `status='dispatched'`, `dispatch_timeout_at` in the past → always yields TIMEOUT (it's purely status+time based).

Then prove no-write by re-selecting the seeded rows byte-identical and asserting 0 `order_offers` created (the only PG writers of offers are the committing assign/return services). Delete the rows after. See also `artifact-workflow-env-injection.md` for why this runs as a separate harness process, not the artifact workflow.
