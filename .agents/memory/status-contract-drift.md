---
name: Order status pool-vocabulary contract
description: The customer app writes order statuses the driver backend must recognize as "in dispatch pool"; this vocabulary is duplicated across many files and drifts silently.
---

# Order status pool-vocabulary is a cross-app contract

The customer-facing app (external, not in this repo) creates new orders in Firestore
with a pool/waiting status. At least two values are used in production: `searching`
and `finding_driver`. The driver backend must treat ALL such values as "this order
needs a driver" or the order never enters dispatch and gets stuck until cancelled.

**Symptom of drift:** an order sits at its creation status forever, `driverUid` stays
null, no `fcmDispatchedAt`, eventually `cancelled`. The Round-Robin dispatcher's
Firestore listener is `where("status","in",POOL_STATUSES)`, so a status missing from
`POOL_STATUSES` is invisible to dispatch end-to-end (no assign → no `dispatched` →
FCM dispatcher, which watches `dispatched`, never fires → no popup).

**The pool vocabulary is duplicated in many places — keep them in lockstep:**
- `POOL_STATUSES` consts in: round-robin-dispatcher, pg-shadow-writer,
  pg-firestore-projector, pg-dispatch-service, pg-dispatcher, pg-dispatcher-dry-run.
- `inArray(...)` pool filter in routes/orders.ts (hotzone query).
- `POOL_MIRRORABLE_STATUSES` in order-pg-service.ts — the DEFAULT `guardStatuses`
  for guarded `pgUpsertOrder`. A new pool status MUST be added here too, otherwise a
  pre-dispatch PG row INSERTed by the pool-ingress listener at that status cannot be
  advanced to `dispatched` by the guarded dispatch-time upsert → PG offer / SSE
  in-app popup silently drifts. (The guard still excludes claimed/terminal statuses,
  so adding a pool status does not risk resurrecting a delivered/cancelled order.)
- The two inline `guardStatuses` arrays in pg-shadow-writer (pg vs firestore mode).
- `ASSIGNABLE_STATUSES` in pg-assign-shadow.ts (read-only comparator; omitting a
  status only produces false DIFF log noise, not a functional bug).

**Why:** production is `DISPATCH_SOURCE=firestore`, so the Round-Robin dispatcher's
`POOL_STATUSES` is the single change that actually unblocks live dispatch; the PG-side
copies are harmless in firestore mode but must stay aligned for the eventual PG cutover
and for the PG-backed SSE popup.

**How to apply:** whenever the customer app introduces a new creation/pool status,
grep for the old pool list (`["searching", "pending"]`) and add the new value to every
site above in one change. Firestore `in` supports max 10 values — fine for now.

**Cash rule is independent and verified working:** a live cash order delivered with
`balance`/`total_earnings`/`completed_deliveries` UNCHANGED and a single
`cash_collected` amount-0 ledger row — confirming `isCashPayment` gating holds at the
completion write path.
