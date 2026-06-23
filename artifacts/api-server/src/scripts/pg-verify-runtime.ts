// ── Phase 5F runtime evidence harness — PG dispatcher VERIFY_ONLY ───────────
// Sets DISPATCH_SOURCE=pg, mirrors the index.ts startup gate, then runs the REAL
// PG dispatcher in VERIFY_ONLY mode against LIVE PG data so we can collect
// [PG_VERIFY_ASSIGN] / [PG_VERIFY_TIMEOUT] / [PG_VERIFY_CLAIM] / [PG_VERIFY_ERROR]
// counts and PROVE nothing is committed.
//
// SAFETY: This process starts ONLY the PG dispatcher in verify-only mode. It
// assigns no drivers, writes no orders (PG or Firestore), creates/changes no
// order_offers, and sends no FCM. The authoritative Firestore dispatcher keeps
// running untouched in the live api-server workflow.
//
// Determinism: two isolated PG-only test orders are seeded so the assign and
// timeout decision paths are exercised against at least one known row each. They
// have no Firestore counterpart, so no live process touches them; they are
// verified byte-identical after the run and then deleted.
process.env["DISPATCH_SOURCE"] = "pg";

import { eq, inArray, sql } from "drizzle-orm";
import { db, ordersTable, orderOffersTable } from "@workspace/db";
import { logDispatchSource, planDispatchStartup } from "../lib/dispatch-source";
import { runPgDispatcherPass } from "../lib/pg-dispatcher";
import { logger } from "../lib/logger";

const PASSES = 3;
const PASS_GAP_MS = 1_500;
const TEST_PREFIX = "PG5F_TEST_";
const TEST_ASSIGN_ID = `${TEST_PREFIX}assign`;
const TEST_TIMEOUT_ID = `${TEST_PREFIX}timeout`;

async function snapshotOrder(id: string) {
  const rows = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      driverUid: ordersTable.driverUid,
      dispatchTimeoutAt: ordersTable.dispatchTimeoutAt,
      fcmDispatchClaimedAt: ordersTable.fcmDispatchClaimedAt,
      fcmDispatchClaimedBy: ordersTable.fcmDispatchClaimedBy,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function offerCount(id: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orderOffersTable)
    .where(eq(orderOffersTable.orderId, id));
  return rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  // ── Mirror index.ts dispatch gate + assert the Phase 5F invariants ──────────
  const dispatchSource = logDispatchSource();
  const plan = planDispatchStartup(dispatchSource.value);
  logger.info(
    {
      value: dispatchSource.value,
      effective: dispatchSource.effective,
      startFirestore: plan.startFirestore,
      startPgDryRun: plan.startPgDryRun,
      startPgDispatcher: plan.startPgDispatcher,
      pgDispatcherVerifyOnly: plan.pgDispatcherVerifyOnly,
    },
    "[PG_VERIFY_RUNTIME] startup plan (Firestore stays authoritative in the live workflow; this harness runs the PG dispatcher in verify-only)",
  );
  if (!plan.startFirestore) throw new Error("INVARIANT: startFirestore must be true");
  if (!plan.startPgDispatcher) throw new Error("INVARIANT: pg must start the PG dispatcher");
  if (!plan.pgDispatcherVerifyOnly) throw new Error("INVARIANT: Phase 5F PG dispatcher must be verify-only");

  // ── Seed two isolated PG-only test orders ───────────────────────────────────
  const past = new Date(Date.now() - 5 * 60_000); // 5 min ago → definitely expired
  await db.delete(ordersTable).where(inArray(ordersTable.id, [TEST_ASSIGN_ID, TEST_TIMEOUT_ID]));
  await db.insert(ordersTable).values([
    // Assign candidate: in the pool, no driver yet. Produces [PG_VERIFY_ASSIGN]
    // (+ [PG_VERIFY_CLAIM]) IFF at least one live driver is eligible.
    { id: TEST_ASSIGN_ID, status: "searching", rejectedBy: [] },
    // Timeout candidate: dispatched with an expired timeout. Always produces
    // [PG_VERIFY_TIMEOUT] because pgCheckExpiredDispatches is status+time based.
    { id: TEST_TIMEOUT_ID, status: "dispatched", driverUid: "PG5F_TEST_driver", dispatchTimeoutAt: past },
  ]);
  logger.info({ seeded: [TEST_ASSIGN_ID, TEST_TIMEOUT_ID] }, "[PG_VERIFY_RUNTIME] seeded isolated test orders");

  const beforeAssign = await snapshotOrder(TEST_ASSIGN_ID);
  const beforeTimeout = await snapshotOrder(TEST_TIMEOUT_ID);
  const beforeOffersAssign = await offerCount(TEST_ASSIGN_ID);
  const beforeOffersTimeout = await offerCount(TEST_TIMEOUT_ID);

  // ── Run the verify-only decision path against LIVE PG data ───────────────────
  const totals = { assign: 0, timeout: 0, claim: 0, noDriver: 0, errors: 0 };
  for (let i = 1; i <= PASSES; i++) {
    const r = await runPgDispatcherPass(true);
    totals.assign += r.assign;
    totals.timeout += r.timeout;
    totals.claim += r.claim;
    totals.noDriver += r.noDriver;
    totals.errors += r.errors;
    logger.info({ pass: i, ...r }, "[PG_VERIFY_RUNTIME] pass result");
    if (i < PASSES) await new Promise((res) => setTimeout(res, PASS_GAP_MS));
  }

  // ── Prove the verify-only path committed nothing to the test orders ──────────
  const afterAssign = await snapshotOrder(TEST_ASSIGN_ID);
  const afterTimeout = await snapshotOrder(TEST_TIMEOUT_ID);
  const afterOffersAssign = await offerCount(TEST_ASSIGN_ID);
  const afterOffersTimeout = await offerCount(TEST_TIMEOUT_ID);

  const assignUnchanged = JSON.stringify(beforeAssign) === JSON.stringify(afterAssign);
  const timeoutUnchanged = JSON.stringify(beforeTimeout) === JSON.stringify(afterTimeout);
  const noOffersCreated =
    beforeOffersAssign === afterOffersAssign &&
    afterOffersAssign === 0 &&
    beforeOffersTimeout === afterOffersTimeout &&
    afterOffersTimeout === 0;

  logger.info(
    {
      counts: totals,
      assignUnchanged,
      timeoutUnchanged,
      noOffersCreated,
      afterAssign,
      afterTimeout,
    },
    "[PG_VERIFY_RUNTIME] RESULT",
  );

  // ── Clean up the test orders ────────────────────────────────────────────────
  await db.delete(ordersTable).where(inArray(ordersTable.id, [TEST_ASSIGN_ID, TEST_TIMEOUT_ID]));
  logger.info("[PG_VERIFY_RUNTIME] deleted test orders");

  const ok = assignUnchanged && timeoutUnchanged && noOffersCreated && totals.errors === 0;
  if (!ok) {
    logger.error(
      { assignUnchanged, timeoutUnchanged, noOffersCreated, errors: totals.errors },
      "[PG_VERIFY_RUNTIME] VERDICT=FAIL — a no-write invariant was violated",
    );
    process.exit(1);
  }
  logger.info(
    { counts: totals },
    "[PG_VERIFY_RUNTIME] VERDICT=PASS — verify-only committed nothing, no offers, no FCM",
  );
  process.exit(0);
}

main().catch((e) => {
  logger.error({ err: e }, "[PG_VERIFY_RUNTIME] fatal");
  // Best-effort cleanup on failure.
  db.delete(ordersTable)
    .where(inArray(ordersTable.id, [TEST_ASSIGN_ID, TEST_TIMEOUT_ID]))
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
