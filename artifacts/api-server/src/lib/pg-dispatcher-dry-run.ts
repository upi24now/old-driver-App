/**
 * PG Dispatcher Dry-Run (Phase 5E-C)
 *
 * A READ-ONLY shadow loop that runs ONLY when DISPATCH_SOURCE=pg_shadow. It
 * reproduces what a future PostgreSQL-authoritative dispatcher *would* decide,
 * logs the candidate driver, and (when Firestore is reachable) compares that
 * candidate against the live Firestore assignment — but it changes nothing.
 *
 * HARD GUARANTEES (Phase 5E-C scope):
 *   - Does NOT assign drivers.
 *   - Does NOT update orders (PG or Firestore).
 *   - Does NOT send FCM.
 *   - Does NOT write Firestore.
 *   - The Firestore dispatcher remains fully authoritative in every mode.
 *
 * It performs only SELECTs against PG (orders + the read-only
 * pgFindEligibleDrivers service) and, for comparison, a read-only Firestore
 * `.get()` on the order document. No writes, no transactions, no FCM.
 */

import { inArray } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { adminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { pgFindEligibleDrivers, type PgEligibleDriver } from "./pg-dispatch-service";

// Mirrors POOL_STATUSES in round-robin-dispatcher.ts / pg-dispatch-service.ts.
const POOL_STATUSES = ["finding_driver", "searching", "pending"] as const;

// Independent of the Firestore dispatcher's poll cadence. Read-only, so a
// relaxed interval keeps DB/Firestore read volume low.
const DRY_RUN_POLL_INTERVAL_MS = 30_000;

type FsDb = Awaited<ReturnType<typeof adminFirestore>>;

export interface PgDryRunPassResult {
  ordersScanned: number;
  candidates: number;
  noDriver: number;
  errors: number;
}

/**
 * Round-robin selection identical to the Firestore dispatcher: the pool is
 * already sorted by uid ascending; start AFTER the last dispatched uid (wrap
 * around), otherwise pick index 0. Pure function — no I/O.
 */
export function chooseNextDriver(
  pool: PgEligibleDriver[],
  lastUid: string | null,
): PgEligibleDriver | null {
  if (pool.length === 0) return null;
  let startIdx = 0;
  if (lastUid) {
    const pos = pool.findIndex((d) => d.uid === lastUid);
    if (pos !== -1) startIdx = (pos + 1) % pool.length;
  }
  return pool[startIdx] ?? null;
}

/**
 * Run a single dry-run pass over the current PG pool. READ-ONLY. Returns counts
 * for verification harnesses. Never throws — per-order failures are logged as
 * [PG_DRY_RUN_ERROR] and the pass continues.
 */
export async function runPgDryRunPass(fsDb: FsDb | null): Promise<PgDryRunPassResult> {
  const result: PgDryRunPassResult = { ordersScanned: 0, candidates: 0, noDriver: 0, errors: 0 };

  let pool: { id: string; lastDispatchedUid: string | null }[];
  try {
    pool = await db
      .select({
        id: ordersTable.id,
        lastDispatchedUid: ordersTable.lastDispatchedUid,
      })
      .from(ordersTable)
      .where(inArray(ordersTable.status, POOL_STATUSES as unknown as string[]));
  } catch (err) {
    logger.error({ err }, "[PG_DRY_RUN_ERROR] failed to read PG order pool");
    result.errors += 1;
    return result;
  }

  result.ordersScanned = pool.length;

  for (const order of pool) {
    try {
      const eligible = await pgFindEligibleDrivers(order.id);
      const chosen = chooseNextDriver(eligible, order.lastDispatchedUid);

      if (!chosen) {
        result.noDriver += 1;
        logger.warn(
          {
            orderId: order.id,
            poolSize: eligible.length,
            lastUid: order.lastDispatchedUid,
          },
          "[PG_DRY_RUN_NO_DRIVER]",
        );
        continue;
      }

      // Compare against the live Firestore assignment when Firestore is reachable.
      // READ-ONLY .get(); never mutates Firestore.
      let firestoreDriver: string | null = null;
      let comparison: "match" | "diff" | "no_fs_assignment" | "fs_unavailable" =
        fsDb ? "no_fs_assignment" : "fs_unavailable";

      if (fsDb) {
        try {
          const snap = await fsDb.doc(`orders/${order.id}`).get();
          if (snap.exists) {
            const d = snap.data() as Record<string, unknown> | undefined;
            firestoreDriver = typeof d?.["driverUid"] === "string" ? (d["driverUid"] as string) : null;
          }
          if (firestoreDriver != null) {
            comparison = firestoreDriver === chosen.uid ? "match" : "diff";
          }
        } catch (err) {
          comparison = "fs_unavailable";
          logger.warn(
            { err, orderId: order.id },
            "[PG_DRY_RUN_ERROR] Firestore comparison read failed (non-blocking)",
          );
        }
      }

      result.candidates += 1;
      logger.info(
        {
          orderId: order.id,
          pgCandidate: chosen.uid,
          firestoreDriver,
          comparison,
          poolSize: eligible.length,
          lastUid: order.lastDispatchedUid,
        },
        "[PG_DRY_RUN_CANDIDATE]",
      );
    } catch (err) {
      result.errors += 1;
      logger.error({ err, orderId: order.id }, "[PG_DRY_RUN_ERROR]");
    }
  }

  return result;
}

let dryRunTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the dry-run loop. Called ONLY when DISPATCH_SOURCE=pg_shadow. Logs
 * [PG_DRY_RUN_START], runs one pass immediately, then polls on an interval.
 * Read-only throughout — does not affect the authoritative Firestore dispatcher.
 */
export async function startPgDispatcherDryRun(): Promise<void> {
  if (dryRunTimer) {
    logger.warn("[PG_DRY_RUN_START] already running — skipping duplicate start");
    return;
  }

  let fsDb: FsDb | null = null;
  try {
    fsDb = await adminFirestore();
  } catch (err) {
    // Firestore comparison is optional; the PG-side dry-run still runs and logs.
    logger.warn(
      { err },
      "[PG_DRY_RUN_START] Firebase Admin unavailable — running PG dry-run without Firestore comparison",
    );
  }

  logger.info(
    { pollIntervalMs: DRY_RUN_POLL_INTERVAL_MS, firestoreComparison: !!fsDb },
    "[PG_DRY_RUN_START]",
  );

  void runPgDryRunPass(fsDb).catch((e) =>
    logger.error({ err: e }, "[PG_DRY_RUN_ERROR] initial pass failed"),
  );

  dryRunTimer = setInterval(() => {
    void runPgDryRunPass(fsDb).catch((e) =>
      logger.error({ err: e }, "[PG_DRY_RUN_ERROR] poll pass failed"),
    );
  }, DRY_RUN_POLL_INTERVAL_MS);
}
