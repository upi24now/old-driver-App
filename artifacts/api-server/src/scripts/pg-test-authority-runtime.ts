// ── Phase 5G-B runtime harness — PG dispatcher TEST-ONLY write authority ─────
// Proves the PG dispatcher write services can perform REAL commits, exercised
// ONLY against isolated PG-only test orders whose ids start with
// "TEST_PG_DISPATCH_". Production/customer orders are never touched: every
// service call below is scoped to a specific test id, and the full set of
// NON-test orders + offers is checksummed before/after to prove zero collateral.
//
// SAFETY CONTRACT (all enforced/asserted in this file):
//   - Writes are enabled ONLY inside this process via ALLOW_PG_DISPATCH_WRITES=true.
//   - PG_FCM_SEND_ENABLED stays false → no FCM is ever sent (services contain no
//     FCM call regardless; the claim service only stamps the claim columns).
//   - We call the committing services DIRECTLY on test ids. We deliberately do
//     NOT call runPgDispatcherPass(), which scans the whole pool and could write
//     to real orders.
//   - The Firestore dispatcher in the live api-server workflow is untouched and
//     remains authoritative for all real orders. Default prod env is unchanged.
//
// Set the env gates BEFORE importing the modules that read them at call-time.
const ENV_KEYS = ["DISPATCH_SOURCE", "ALLOW_PG_DISPATCH_WRITES", "PG_FCM_SEND_ENABLED"] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];
process.env["DISPATCH_SOURCE"] = "pg";
process.env["ALLOW_PG_DISPATCH_WRITES"] = "true";
process.env["PG_FCM_SEND_ENABLED"] = "false";

import { eq, sql } from "drizzle-orm";
import { db, ordersTable, orderOffersTable } from "@workspace/db";
import {
  resolvePgWriteGates,
  planDispatchStartup,
} from "../lib/dispatch-source";
import {
  pgAssignDriverToOrder,
  pgClaimFcmDispatch,
  pgReturnOrderToPool,
} from "../lib/pg-dispatch-service";
import { logger } from "../lib/logger";

const PREFIX = "TEST_PG_DISPATCH_"; // 17 chars
const ASSIGN_ID = `${PREFIX}ASSIGN`;
const TIMEOUT_ID = `${PREFIX}TIMEOUT`;
const CLAIM_ID = `${PREFIX}CLAIM`;
const TEST_DRIVER = `${PREFIX}DRIVER`;
const INSTANCE_ID = `${PREFIX}HARNESS`;

let failures = 0;
function check(name: string, cond: boolean, extra: unknown = ""): void {
  if (cond) {
    logger.info({ name }, `  ✓ ${name}`);
  } else {
    failures += 1;
    logger.error({ name, extra }, `  ✗ ${name}`);
  }
}

/** Count + content checksum of every NON-test row in a table (left(id,17) guard). */
async function snapshotNonTest(
  table: "orders" | "order_offers",
  idCol: "id" | "order_id",
): Promise<{ cnt: number; checksum: string }> {
  const res = await db.execute(
    sql.raw(
      `SELECT count(*)::int AS cnt,
              coalesce(md5(string_agg(rowmd5, '' ORDER BY rowmd5)), 'EMPTY') AS checksum
       FROM (
         SELECT md5(to_jsonb(t)::text) AS rowmd5
         FROM ${table} t
         WHERE left(t.${idCol}, 17) <> '${PREFIX}'
       ) s;`,
    ),
  );
  const wrapped = res as unknown as { rows?: Array<{ cnt: number; checksum: string }> };
  const rows = wrapped.rows ?? (res as unknown as Array<{ cnt: number; checksum: string }>);
  const row = rows[0];
  return { cnt: Number(row?.cnt ?? 0), checksum: String(row?.checksum ?? "EMPTY") };
}

async function snapshotOrder(id: string) {
  const rows = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      driverUid: ordersTable.driverUid,
      dispatchTimeoutAt: ordersTable.dispatchTimeoutAt,
      fcmDispatchClaimedAt: ordersTable.fcmDispatchClaimedAt,
      fcmDispatchClaimedBy: ordersTable.fcmDispatchClaimedBy,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function offers(id: string) {
  return db
    .select({
      driverUid: orderOffersTable.driverUid,
      status: orderOffersTable.status,
    })
    .from(orderOffersTable)
    .where(eq(orderOffersTable.orderId, id));
}

async function deleteTestRows(): Promise<void> {
  await db
    .delete(orderOffersTable)
    .where(sql`left(${orderOffersTable.orderId}, 17) = ${PREFIX}`);
  await db.delete(ordersTable).where(sql`left(${ordersTable.id}, 17) = ${PREFIX}`);
}

async function countTestRows(): Promise<{ orders: number; offers: number }> {
  const o = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(sql`left(${ordersTable.id}, 17) = ${PREFIX}`);
  const f = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orderOffersTable)
    .where(sql`left(${orderOffersTable.orderId}, 17) = ${PREFIX}`);
  return { orders: o[0]?.n ?? 0, offers: f[0]?.n ?? 0 };
}

async function main(): Promise<void> {
  // ── Assert the gates are open for writes but FCM stays closed ────────────────
  const gates = resolvePgWriteGates();
  const plan = planDispatchStartup("pg", gates);
  logger.info(
    {
      allowPgDispatchWrites: gates.allowPgDispatchWrites,
      pgFcmSendEnabled: gates.pgFcmSendEnabled,
      startFirestore: plan.startFirestore,
      pgDispatcherVerifyOnly: plan.pgDispatcherVerifyOnly,
    },
    "[PG_TEST_AUTHORITY] gates resolved (writes ON, FCM OFF; Firestore stays authoritative in the live workflow)",
  );
  check("ALLOW_PG_DISPATCH_WRITES open", gates.allowPgDispatchWrites === true);
  check("PG_FCM_SEND_ENABLED closed", gates.pgFcmSendEnabled === false);
  check("plan: Firestore still starts", plan.startFirestore === true);
  check("plan: writes allowed (verify-only OFF)", plan.pgDispatcherVerifyOnly === false);

  // ── BEFORE: checksum every non-test order + offer ───────────────────────────
  const beforeOrders = await snapshotNonTest("orders", "id");
  const beforeOffers = await snapshotNonTest("order_offers", "order_id");
  logger.info({ beforeOrders, beforeOffers }, "[PG_TEST_AUTHORITY] BEFORE non-test snapshot");

  // ── Seed isolated PG-only test orders ───────────────────────────────────────
  const past = new Date(Date.now() - 5 * 60_000);
  const future = new Date(Date.now() + 5 * 60_000);
  await deleteTestRows();
  await db.insert(ordersTable).values([
    // ASSIGN: poolable, no driver → pgAssignDriverToOrder should commit.
    { id: ASSIGN_ID, status: "searching", rejectedBy: [] },
    // TIMEOUT: dispatched + expired + a pending offer → pgReturnOrderToPool.
    {
      id: TIMEOUT_ID,
      status: "dispatched",
      driverUid: TEST_DRIVER,
      dispatchTimeoutAt: past,
    },
    // CLAIM: dispatched, claim slot empty → pgClaimFcmDispatch should commit.
    {
      id: CLAIM_ID,
      status: "dispatched",
      driverUid: TEST_DRIVER,
      dispatchTimeoutAt: future,
    },
  ]);
  // Pending offer for the TIMEOUT order so we can prove it flips to timed_out.
  await db
    .insert(orderOffersTable)
    .values({ orderId: TIMEOUT_ID, driverUid: TEST_DRIVER, status: "pending", expiresAt: past });
  logger.info({ seeded: [ASSIGN_ID, TIMEOUT_ID, CLAIM_ID] }, "[PG_TEST_AUTHORITY] seeded test orders");

  // ── 1) ASSIGNMENT — real commit ─────────────────────────────────────────────
  const assignRes = await pgAssignDriverToOrder(ASSIGN_ID, TEST_DRIVER, {
    driverName: "Test Driver",
    driverRating: "5.0",
    driverTrips: 0,
  });
  const aAfter = await snapshotOrder(ASSIGN_ID);
  const aOffers = await offers(ASSIGN_ID);
  check("assign service ok", assignRes.ok === true, assignRes);
  check("assign → status dispatched", aAfter?.status === "dispatched", aAfter);
  check("assign → driver_uid set", aAfter?.driverUid === TEST_DRIVER, aAfter);
  check(
    "assign → pending offer row created",
    aOffers.length === 1 && aOffers[0]?.status === "pending",
    aOffers,
  );
  logger.info({ order: aAfter, offers: aOffers }, "[PG_TEST_ASSIGN_COMMIT]");

  // ── 2) TIMEOUT — real commit ────────────────────────────────────────────────
  const returnRes = await pgReturnOrderToPool(TIMEOUT_ID);
  const tAfter = await snapshotOrder(TIMEOUT_ID);
  const tOffers = await offers(TIMEOUT_ID);
  check("timeout service ok", returnRes.ok === true, returnRes);
  check("timeout → status searching", tAfter?.status === "searching", tAfter);
  check("timeout → driver_uid cleared", tAfter?.driverUid === null, tAfter);
  check(
    "timeout → pending offer becomes timed_out",
    tOffers.length === 1 && tOffers[0]?.status === "timed_out",
    tOffers,
  );
  logger.info({ order: tAfter, offers: tOffers }, "[PG_TEST_TIMEOUT_COMMIT]");

  // ── 3) CLAIM — real commit, NO FCM ──────────────────────────────────────────
  const claimRes = await pgClaimFcmDispatch(CLAIM_ID, INSTANCE_ID);
  const cAfter = await snapshotOrder(CLAIM_ID);
  check("claim service ok", claimRes.ok === true, claimRes);
  check("claim → fcm_dispatch_claimed_at set", cAfter?.fcmDispatchClaimedAt != null, cAfter);
  check("claim → fcm_dispatch_claimed_by set", cAfter?.fcmDispatchClaimedBy === INSTANCE_ID, cAfter);
  check("claim → no FCM sent (gate closed)", gates.pgFcmSendEnabled === false);
  logger.info({ order: cAfter, fcmSent: false }, "[PG_TEST_CLAIM_COMMIT]");

  // ── AFTER: re-checksum every non-test order + offer ─────────────────────────
  const afterOrders = await snapshotNonTest("orders", "id");
  const afterOffers = await snapshotNonTest("order_offers", "order_id");
  const ordersUnchanged =
    beforeOrders.cnt === afterOrders.cnt && beforeOrders.checksum === afterOrders.checksum;
  const offersUnchanged =
    beforeOffers.cnt === afterOffers.cnt && beforeOffers.checksum === afterOffers.checksum;

  if (ordersUnchanged && offersUnchanged) {
    logger.info(
      { beforeOrders, afterOrders, beforeOffers, afterOffers },
      "[PG_TEST_NO_REAL_ORDER_CHANGE] non-test orders + offers byte-identical before/after",
    );
  } else {
    failures += 1;
    logger.error(
      { beforeOrders, afterOrders, beforeOffers, afterOffers },
      "[PG_TEST_ERROR] a NON-test order/offer changed during the run (concurrent live shadow-writer? re-run in a quiet window)",
    );
  }
  check("non-test orders unchanged", ordersUnchanged, { beforeOrders, afterOrders });
  check("non-test offers unchanged", offersUnchanged, { beforeOffers, afterOffers });

  // ── Cleanup — delete all TEST_PG_DISPATCH_% rows ────────────────────────────
  await deleteTestRows();
  const remaining = await countTestRows();
  check("cleanup → 0 test orders remain", remaining.orders === 0, remaining);
  check("cleanup → 0 test offers remain", remaining.offers === 0, remaining);
  logger.info({ remaining }, "[PG_TEST_AUTHORITY] cleanup complete");

  // ── Restore env to its original values ──────────────────────────────────────
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
  logger.info(
    { DISPATCH_SOURCE: process.env["DISPATCH_SOURCE"] ?? "(unset → firestore)" },
    "[PG_TEST_AUTHORITY] env restored",
  );

  if (failures === 0) {
    logger.info("[PG_TEST_AUTHORITY] VERDICT=PASS — real commits on test rows only, no FCM, no real-order change");
    process.exit(0);
  }
  logger.error({ failures }, "[PG_TEST_AUTHORITY] VERDICT=FAIL");
  process.exit(1);
}

main().catch((e) => {
  logger.error({ err: e }, "[PG_TEST_ERROR] fatal — attempting cleanup");
  deleteTestRows()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
