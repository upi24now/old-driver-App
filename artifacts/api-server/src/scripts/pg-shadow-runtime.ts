// ── Phase 5E-D runtime evidence harness — pg_shadow dry-run ─────────────────
// Mirrors the index.ts startup gate (lines 82-138) with DISPATCH_SOURCE=pg_shadow,
// then runs the REAL read-only dry-run loop against live PG + Firestore so we can
// collect [PG_DRY_RUN_START] / [PG_DRY_RUN_CANDIDATE] / [PG_DRY_RUN_NO_DRIVER] /
// [PG_DRY_RUN_ERROR] evidence.
//
// SAFETY: This process starts ONLY the read-only dry-run. The authoritative
// Firestore dispatcher (FCM, round-robin, PG shadow writer) keeps running in the
// live api-server workflow, untouched. This harness assigns no drivers, writes no
// orders (PG or Firestore), and sends no FCM. It exits after enough cycles.
process.env["DISPATCH_SOURCE"] = "pg_shadow";

import { logDispatchSource, planDispatchStartup } from "../lib/dispatch-source";
import { startPgDispatcherDryRun } from "../lib/pg-dispatcher-dry-run";
import { logger } from "../lib/logger";

const RUN_FOR_MS = 75_000; // dry-run pass at t=0,30s,60s ⇒ ≥3 cycles within 75s

async function main(): Promise<void> {
  // ── Mirror index.ts dispatch gate ──────────────────────────────────────────
  const dispatchSource = logDispatchSource();
  const dispatchPlan = planDispatchStartup(dispatchSource.value);

  logger.info(
    {
      value: dispatchSource.value,
      effective: dispatchSource.effective,
      startFirestore: dispatchPlan.startFirestore,
      startPgDryRun: dispatchPlan.startPgDryRun,
      startPgDispatcher: dispatchPlan.startPgDispatcher,
    },
    "[PG_SHADOW_RUNTIME] startup plan (Firestore dispatcher remains authoritative in the live workflow; this harness runs the dry-run only)",
  );

  if (!dispatchPlan.startFirestore) {
    throw new Error("INVARIANT VIOLATION: startFirestore must be true in pg_shadow");
  }
  if (dispatchPlan.startPgDispatcher) {
    throw new Error("INVARIANT VIOLATION: pg_shadow must not start the PG dispatcher");
  }

  if (dispatchPlan.startPgDryRun) {
    await startPgDispatcherDryRun();
  } else {
    throw new Error("INVARIANT VIOLATION: pg_shadow must start the PG dry-run");
  }

  // Keep the process alive long enough to observe ≥3 dry-run cycles, then exit.
  await new Promise((resolve) => setTimeout(resolve, RUN_FOR_MS));
  logger.info("[PG_SHADOW_RUNTIME] window complete — exiting (no writes performed)");
  process.exit(0);
}

main().catch((e) => {
  logger.error({ err: e }, "[PG_SHADOW_RUNTIME] fatal");
  process.exit(1);
});
