/**
 * PG Dispatcher (Phase 5F)
 *
 * The PostgreSQL-authoritative dispatcher, wired to start ONLY when
 * DISPATCH_SOURCE=pg. It executes the FULL PG decision path each cycle using the
 * existing PG dispatch services:
 *   - pgCheckExpiredDispatches  (read-only)  → timeout sweep
 *   - pgFindEligibleDrivers     (read-only)  → eligible pool per order
 *   - chooseNextDriver          (pure)       → round-robin selection
 *   - pgAssignDriverToOrder     (write)      → assign + open offer
 *   - pgClaimFcmDispatch        (write)      → claim the FCM dispatch
 *   - pgReturnOrderToPool       (write)      → return an expired order to the pool
 *
 * ── VERIFY_ONLY mode (Phase 5F) ──────────────────────────────────────────────
 * In Phase 5F the dispatcher ALWAYS runs in VERIFY_ONLY mode (the startup plan
 * hardwires verifyOnly=true for `pg`). In this mode it executes the complete
 * read-only decision path and LOGS every intended write, but commits NOTHING:
 *   - DOES NOT call pgAssignDriverToOrder  → logs [PG_VERIFY_ASSIGN]
 *   - DOES NOT call pgReturnOrderToPool    → logs [PG_VERIFY_TIMEOUT]
 *   - DOES NOT call pgClaimFcmDispatch     → logs [PG_VERIFY_CLAIM]
 *   - DOES NOT send FCM
 *   - Per-order failures are logged as [PG_VERIFY_ERROR] and the pass continues.
 *
 * The Firestore dispatcher remains fully authoritative in every mode. The
 * committing branch below (verifyOnly === false) is the implementation a future
 * cutover phase (5G+) will enable; it is never reached while Phase 5F pins
 * verifyOnly=true.
 */

import { randomUUID } from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  pgFindEligibleDrivers,
  pgAssignDriverToOrder,
  pgClaimFcmDispatch,
  pgCheckExpiredDispatches,
  pgReturnOrderToPool,
} from "./pg-dispatch-service";
import { chooseNextDriver } from "./pg-dispatcher-dry-run";

// Mirrors POOL_STATUSES in round-robin-dispatcher.ts / pg-dispatch-service.ts.
const POOL_STATUSES = ["searching", "pending"] as const;

// Matches the dry-run cadence; independent of the Firestore dispatcher's poll.
const POLL_INTERVAL_MS = 30_000;

// Stable per-process identity used to claim an FCM dispatch (mirrors the
// Firestore FCM dispatcher's claim-owner concept).
const INSTANCE_ID = randomUUID();

export interface PgDispatcherPassResult {
  /** Orders that an assignment was intended for / committed to. */
  assign: number;
  /** Expired dispatches that a return-to-pool was intended for / committed to. */
  timeout: number;
  /** FCM-dispatch claims intended for / committed to. */
  claim: number;
  /** Pool orders with no eligible driver this pass. */
  noDriver: number;
  /** Per-step failures (never thrown — counted and logged). */
  errors: number;
}

/**
 * Run a single dispatcher pass. When verifyOnly is true (Phase 5F) it commits
 * nothing and only logs intended writes; otherwise it performs the guarded
 * writes via the PG dispatch services. Never throws — per-item failures are
 * logged as [PG_VERIFY_ERROR] and the pass continues.
 */
export async function runPgDispatcherPass(
  verifyOnly: boolean,
): Promise<PgDispatcherPassResult> {
  const result: PgDispatcherPassResult = {
    assign: 0,
    timeout: 0,
    claim: 0,
    noDriver: 0,
    errors: 0,
  };

  // ── Step 1: timeout sweep — expired dispatches return to the pool ───────────
  try {
    const expired = await pgCheckExpiredDispatches(); // read-only
    for (const order of expired) {
      try {
        if (verifyOnly) {
          result.timeout += 1;
          logger.info(
            {
              orderId: order.id,
              driverUid: order.driverUid,
              dispatchTimeoutAt: order.dispatchTimeoutAt,
            },
            "[PG_VERIFY_TIMEOUT] would return expired dispatch to pool (no write)",
          );
        } else {
          const r = await pgReturnOrderToPool(order.id);
          if (r.ok) result.timeout += 1;
          else
            logger.warn(
              { orderId: order.id, reason: r.reason },
              "[PG_DISPATCHER] return-to-pool skipped",
            );
        }
      } catch (err) {
        result.errors += 1;
        logger.error(
          { err, orderId: order.id },
          "[PG_VERIFY_ERROR] timeout step failed",
        );
      }
    }
  } catch (err) {
    result.errors += 1;
    logger.error({ err }, "[PG_VERIFY_ERROR] expired-dispatch sweep failed");
  }

  // ── Step 2: assignment — match poolable orders to eligible drivers ──────────
  let pool: { id: string; lastDispatchedUid: string | null }[];
  try {
    pool = await db
      .select({
        id: ordersTable.id,
        lastDispatchedUid: ordersTable.lastDispatchedUid,
      })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.status, POOL_STATUSES as unknown as string[]),
          isNull(ordersTable.driverUid),
        ),
      );
  } catch (err) {
    result.errors += 1;
    logger.error({ err }, "[PG_VERIFY_ERROR] failed to read PG order pool");
    return result;
  }

  for (const order of pool) {
    try {
      const eligible = await pgFindEligibleDrivers(order.id); // read-only
      const chosen = chooseNextDriver(eligible, order.lastDispatchedUid);

      if (!chosen) {
        result.noDriver += 1;
        logger.warn(
          {
            orderId: order.id,
            poolSize: eligible.length,
            lastUid: order.lastDispatchedUid,
          },
          "[PG_DISPATCHER] no eligible driver — skip",
        );
        continue;
      }

      if (verifyOnly) {
        // Intended assignment — log, do NOT commit.
        result.assign += 1;
        logger.info(
          {
            orderId: order.id,
            driverUid: chosen.uid,
            driverName: chosen.name,
            driverRating: chosen.rating,
            driverTrips: chosen.trips,
            poolSize: eligible.length,
            lastUid: order.lastDispatchedUid,
          },
          "[PG_VERIFY_ASSIGN] would assign driver + open offer (no write)",
        );

        // Intended FCM-dispatch claim that would follow a committed assign —
        // log, do NOT commit, do NOT send FCM.
        result.claim += 1;
        logger.info(
          { orderId: order.id, instanceId: INSTANCE_ID, driverUid: chosen.uid },
          "[PG_VERIFY_CLAIM] would claim FCM dispatch (no write, no FCM sent)",
        );
        continue;
      }

      // ── Committing path (verifyOnly === false): NOT reached in Phase 5F ──────
      const assigned = await pgAssignDriverToOrder(order.id, chosen.uid, {
        driverName: chosen.name,
        driverRating: chosen.rating,
        driverTrips: chosen.trips,
      });
      if (!assigned.ok) {
        logger.warn(
          { orderId: order.id, reason: assigned.reason },
          "[PG_DISPATCHER] assign skipped",
        );
        continue;
      }
      result.assign += 1;

      const claimed = await pgClaimFcmDispatch(order.id, INSTANCE_ID);
      if (claimed.ok) {
        result.claim += 1;
        // FCM push wiring is intentionally deferred to a later phase — the
        // claim/send separation mirrors the Firestore flow and Phase 5F does
        // not send any FCM from PG.
      } else {
        logger.warn(
          { orderId: order.id, reason: claimed.reason },
          "[PG_DISPATCHER] claim skipped",
        );
      }
    } catch (err) {
      result.errors += 1;
      logger.error(
        { err, orderId: order.id },
        "[PG_VERIFY_ERROR] assign step failed",
      );
    }
  }

  return result;
}

let dispatcherTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the PG dispatcher loop. Called ONLY when DISPATCH_SOURCE=pg. In Phase 5F
 * verifyOnly is always true, so this commits nothing and sends no FCM — it only
 * logs intended writes. Runs one pass immediately, then polls on an interval.
 */
export async function startPgDispatcher(verifyOnly: boolean): Promise<void> {
  if (dispatcherTimer) {
    logger.warn("[PG_DISPATCHER_START] already running — skipping duplicate start");
    return;
  }

  logger.info(
    { verifyOnly, pollIntervalMs: POLL_INTERVAL_MS, instanceId: INSTANCE_ID },
    `[PG_DISPATCHER_START] verifyOnly=${verifyOnly}`,
  );

  void runPgDispatcherPass(verifyOnly).catch((e) =>
    logger.error({ err: e }, "[PG_VERIFY_ERROR] initial pass failed"),
  );

  dispatcherTimer = setInterval(() => {
    void runPgDispatcherPass(verifyOnly).catch((e) =>
      logger.error({ err: e }, "[PG_VERIFY_ERROR] poll pass failed"),
    );
  }, POLL_INTERVAL_MS);
}
