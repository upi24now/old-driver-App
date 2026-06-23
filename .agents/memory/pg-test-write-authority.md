---
name: PG dispatcher test-only write-authority harness (5G-B)
description: How to prove the PG dispatcher can really commit without touching real orders, against a DB that has a concurrent live shadow-writer.
---

# Proving PG dispatcher real-write authority safely

To prove the PG write services (`pgAssignDriverToOrder`, `pgReturnOrderToPool`, `pgClaimFcmDispatch`) can perform REAL commits without endangering production:

- **Call the committing services DIRECTLY on isolated test ids — never `runPgDispatcherPass()` with writes on.** The pass scans the whole pool / all expired dispatches and would mutate REAL orders. Direct calls scoped to `TEST_PG_DISPATCH_*` ids are the only safe way to exercise the commit path.
- Test rows use a fixed prefix; isolate with `left(id,17) = 'TEST_PG_DISPATCH_'` (exact, no LIKE wildcards — `_` is a LIKE wildcard and would broaden the match). Prefix is exactly 17 chars.
- Driver uid can be synthetic (`TEST_PG_DISPATCH_DRIVER`) — `orders.driver_uid` / `order_offers.driver_uid` have NO FK to drivers, so no real driver row is needed and `driversTable` is never touched.
- Enable `ALLOW_PG_DISPATCH_WRITES=true` in-process ONLY; keep `PG_FCM_SEND_ENABLED=false`. The services contain no FCM call anyway (claim only stamps `fcm_dispatch_claimed_at/_by`).

## No-real-change proof under a live concurrent writer
The live api-server runs the **PG shadow-writer** continuously (mirrors Firestore events into PG), so it writes real rows during the harness window. Prove isolation with a count + per-row checksum (`md5(string_agg(md5(to_jsonb(row)::text) ORDER BY ...))`) over ALL non-test rows before/after.

**Key property:** because every harness write is scoped to test ids, this check can only ever produce a FALSE FAIL (the shadow-writer legitimately changed a real row mid-run) — never a false PASS for a harness-induced write. On mismatch, re-run in a quiet window; do not "fix" by loosening the check.

## Verdict gate
`VERDICT=PASS` requires: gates correct, all three commits verified (status/driver/offer transitions + claim stamps), non-test checksum unchanged, cleanup leaves 0 test rows, env restored. Live workflow must still log `value=firestore` + `writesAllowed=false` (harness runs as a separate process and never restarts the artifact workflow).
