---
name: PG dispatcher dry-run (pg_shadow)
description: How the PG dispatcher dry-run loop is gated and what it must never do; round-robin parity contract.
---

# PG dispatcher dry-run service (Phase 5E-C)

A read-only PG dispatch dry-run loop gated behind `DISPATCH_SOURCE=pg_shadow`. It exists to validate that a future PG-primary dispatcher would pick the same drivers as the authoritative Firestore dispatcher, **without taking any action**.

## Hard rule: dry-run is read-only, always
The dry-run module must NEVER:
- assign drivers, write/update orders in PG or Firestore,
- send FCM, or mutate any Firestore document.
It may only: read PG orders, call `pgFindEligibleDrivers` (read), and do a Firestore `.get()` comparison.

**Why:** Firestore dispatcher stays authoritative in *all* DISPATCH_SOURCE modes. pg_shadow is observation-only; any write would create a second authority and double-dispatch.
**How to apply:** never import a PG/Firestore *write* service into `pg-dispatcher-dry-run.ts`. If you need a write, you are no longer in dry-run — that belongs to a later phase.

## Startup gating (planDispatchStartup in dispatch-source.ts)
- `firestore` (default): Firestore dispatchers only, no dry-run, no warning. Default must behave exactly as before.
- `pg_shadow`: Firestore dispatchers + dry-run loop.
- `pg`: Firestore dispatchers + a "not implemented" warning only; NO PG-primary path.
Firestore dispatchers (FCM, round-robin, PG shadow writer) start unconditionally, independent of DISPATCH_SOURCE.

## Round-robin parity contract
`chooseNextDriver(pool, lastUid)` mirrors the Firestore `round-robin-dispatcher.ts` cursor exactly:
- pool sorted uid-ascending,
- start AFTER `lastDispatchedUid` with modulo wrap,
- fall back to index 0 when cursor is null or not found in pool.
**Why:** correctness depends on `pgFindEligibleDrivers` returning uid-asc input; if that ordering changes, parity silently breaks.

## Required log tags
`[PG_DRY_RUN_START]`, `[PG_DRY_RUN_CANDIDATE]`, `[PG_DRY_RUN_NO_DRIVER]`, `[PG_DRY_RUN_ERROR]`. Absence of these under firestore default is the verification that dry-run did not run.
