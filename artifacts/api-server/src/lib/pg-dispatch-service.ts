/**
 * PG Dispatch Write Services (Phase 5E-A)
 *
 * Foundation write services a future PostgreSQL-authoritative dispatcher will
 * call.  These mirror the round-robin / FCM dispatcher logic that today runs
 * against Firestore (round-robin-dispatcher.ts, fcm-dispatcher.ts), but they
 * operate purely on PostgreSQL.
 *
 * IMPORTANT — Phase 5E-A scope:
 *   - These functions are NOT wired into the live dispatcher.  No route, no
 *     listener, and no poller calls them.  They exist so a later cutover phase
 *     can switch dispatch authority from Firestore to PG.
 *   - They perform NO Firestore writes and trigger NO FCM sends.  FCM remains
 *     the responsibility of the existing Firestore fcm-dispatcher.
 *   - All mutations use atomic guarded updates (single-statement WHERE guards or
 *     transactions) so two concurrent callers cannot double-assign, double-claim,
 *     or split-brain an order.  PostgreSQL MVCC guarantees exactly one writer
 *     satisfies the guard; the loser sees 0 affected rows and returns ok:false.
 *
 * Typed result union (business-logic failures are returned, never thrown):
 *   { ok: true; ... }
 *   { ok: false; reason: string }
 *
 * Functions throw only on unexpected infrastructure errors (connection failure).
 */

import { and, eq, inArray, isNull, lte, or, gt, sql } from "drizzle-orm";
import {
  db,
  dispatchProjectionsTable,
  driversTable,
  orderOffersTable,
  ordersTable,
  type DispatchProjectionPayload,
  type Order,
} from "@workspace/db";
import { logger } from "./logger";

// A drizzle transaction handle (the argument the db.transaction callback gets).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Phase 5H-BRIDGE-3 — durable transactional outbox enqueue.
 *
 * Insert a PG → Firestore projection row INSIDE the caller's write transaction
 * so the projection commits atomically with the state change it describes. This
 * is what makes the projector durable: a projection can never be lost (it lands
 * with the write) and can never leak (nothing is enqueued unless the gated PG
 * write actually commits). The projector worker (pg-firestore-projector.ts)
 * later drains these rows to Firestore in FIFO order.
 */
async function enqueueDispatchProjection(
  tx:        DbTx,
  orderId:   string,
  eventType: "assignment" | "timeout",
  payload:   DispatchProjectionPayload,
): Promise<void> {
  await tx.insert(dispatchProjectionsTable).values({ orderId, eventType, payload });
}

// Mirrors DISPATCH_TIMEOUT_SECONDS in round-robin-dispatcher.ts.
const DISPATCH_TIMEOUT_SECONDS = 60;

// Statuses that mean "this order is in the pool, needs a driver".
// Mirrors POOL_STATUSES in round-robin-dispatcher.ts.
const POOL_STATUSES = ["searching", "pending"] as const;

// ── Result + payload types ───────────────────────────────────────────────────

export interface PgEligibleDriver {
  uid:    string;
  name:   string | null;
  rating: string | null;   // stringified to match the Firestore dispatcher shape
  trips:  number | null;
}

export interface PgAssignMetadata {
  driverName?:   string | null;
  driverRating?: string | null;
  driverTrips?:  number | null;
}

export type PgAssignResult =
  | { ok: true; timeoutAt: Date }
  | { ok: false; reason: "not_assignable" | "unknown" };

export type PgClaimResult =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "order_missing" | "unknown" };

export type PgReturnResult =
  | { ok: true }
  | { ok: false; reason: "not_dispatched" | "unknown" };

// ── pgFindEligibleDrivers ─────────────────────────────────────────────────────

/**
 * Return the eligible driver pool for an order, sorted by uid ascending.
 *
 * Reproduces the Firestore round-robin dispatcher's driver query:
 *   drivers WHERE isOnline == true
 *     AND (subscriptionExpiresAt absent/0 OR subscriptionExpiresAt > now)
 *     AND uid NOT IN order.rejectedBy
 *   sorted by uid (stable round-robin ordering)
 *
 * Subscription parity: Firestore treats a missing/0 subscriptionExpiresAt as
 * "allow through" (legacy / test drivers) and otherwise requires expiry in the
 * future.  In PG, subscription_expires_at is NULL where Firestore lacked it, so
 * the guard is: subscription_expires_at IS NULL OR > now().
 *
 * Read-only.  Returns [] when the order is missing or no driver qualifies.
 */
export async function pgFindEligibleDrivers(
  orderId: string,
): Promise<PgEligibleDriver[]> {
  const now = new Date();

  // rejectedBy lives on the order row; read it first so we can exclude.
  const orderRows = await db
    .select({ rejectedBy: ordersTable.rejectedBy })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const rejectedBy: string[] = orderRows[0]?.rejectedBy ?? [];

  const rows = await db
    .select({
      uid:    driversTable.uid,
      name:   driversTable.name,
      rating: driversTable.rating,
      trips:  driversTable.tripsTotal,
    })
    .from(driversTable)
    .where(
      and(
        eq(driversTable.isOnline, true),
        or(
          isNull(driversTable.subscriptionExpiresAt),
          gt(driversTable.subscriptionExpiresAt, now),
        ),
      ),
    )
    .orderBy(sql`${driversTable.uid} ASC`);

  // rating defaults to 5.0 when absent (schema parity with Firestore); stringify
  // to match the Firestore dispatcher's metadata shape.
  return rows
    .filter((d) => !rejectedBy.includes(d.uid))
    .map((d) => ({
      uid:    d.uid,
      name:   d.name,
      rating: d.rating != null ? String(d.rating) : null,
      trips:  d.trips,
    }));
}

// ── pgAssignDriverToOrder ─────────────────────────────────────────────────────

/**
 * Atomically assign a driver to an order and open its offer.
 *
 * Guarded update — assigns only when the order is still in the pool and has no
 * driver yet:
 *   UPDATE orders
 *     SET status='dispatched', driver_uid=?, driver metadata,
 *         dispatched_at=now(), dispatch_timeout_at=now()+60s,
 *         last_dispatched_uid=?, FCM guard fields cleared, updated_at=now()
 *     WHERE id=? AND status IN ('searching','pending') AND driver_uid IS NULL
 *   → 0 rows = already assigned or no longer poolable → { ok:false }
 *
 * The FCM dispatch claim fields are cleared as part of opening a fresh dispatch
 * cycle, mirroring the Firestore dispatcher, so a subsequent pgClaimFcmDispatch
 * can claim exactly once for this assignment.
 *
 * On success an order_offers row is upserted to status='pending' (fresh offer)
 * with the same expiry as the dispatch timeout.  Both writes run in one
 * transaction so the order and its offer can never diverge.
 */
export async function pgAssignDriverToOrder(
  orderId:   string,
  driverUid: string,
  metadata:  PgAssignMetadata = {},
): Promise<PgAssignResult> {
  const now       = new Date();
  const timeoutAt = new Date(now.getTime() + DISPATCH_TIMEOUT_SECONDS * 1000);

  try {
    return await db.transaction(async (tx) => {
      // ── Step 1: guarded assign on the order row ─────────────────────────────
      const assigned = await tx
        .update(ordersTable)
        .set({
          status:               "dispatched",
          driverUid,
          driverName:           metadata.driverName   ?? null,
          driverRating:         metadata.driverRating ?? null,
          driverTrips:          metadata.driverTrips  ?? null,
          dispatchedAt:         now,
          dispatchTimeoutAt:    timeoutAt,
          lastDispatchedUid:    driverUid,
          // Clear FCM guard fields so the claim service can fire for this cycle.
          fcmDispatchedAt:      null,
          fcmDispatchClaimedAt: null,
          fcmDispatchClaimedBy: null,
          fcmMessageId:         null,
          updatedAt:            now,
        })
        .where(
          and(
            eq(ordersTable.id, orderId),
            inArray(ordersTable.status, [...POOL_STATUSES]),
            isNull(ordersTable.driverUid),
          ),
        )
        .returning({ id: ordersTable.id });

      if (assigned.length === 0) {
        // Guarded UPDATE matched 0 rows — nothing was written, so returning here
        // commits an empty (no-op) transaction with the correct reason. Calling
        // tx.rollback() would throw and surface as "unknown" to the caller.
        logger.info(
          { orderId, driverUid },
          "[PG_DISPATCH_SERVICE_ASSIGN] blocked — order not poolable or already assigned",
        );
        return { ok: false, reason: "not_assignable" } as const;
      }

      // ── Step 2: open / refresh the offer for this driver ────────────────────
      await tx
        .insert(orderOffersTable)
        .values({
          orderId,
          driverUid,
          status:    "pending",
          expiresAt: timeoutAt,
        })
        .onConflictDoUpdate({
          target: [orderOffersTable.orderId, orderOffersTable.driverUid],
          set: {
            status:      "pending",
            offeredAt:   now,
            expiresAt:   timeoutAt,
            respondedAt: null,
          },
        });

      // ── Step 3: durable PG → Firestore projection (Phase 5H-BRIDGE-3) ───────
      // Enqueued INSIDE this transaction so it commits atomically with the
      // assignment — only when the gated write above actually lands. The
      // projector mirrors this decision into the Firestore order doc the apps +
      // Firestore FCM dispatcher read. activeOfferDriverUids is the Phase-2
      // explicit offer set (== the fcm-dispatcher driverUid fallback target).
      await enqueueDispatchProjection(tx, orderId, "assignment", {
        driverUid,
        dispatchedAtMs:        now.getTime(),
        dispatchTimeoutAtMs:   timeoutAt.getTime(),
        activeOfferDriverUids: [driverUid],
      });

      logger.info(
        { orderId, driverUid, timeoutAt },
        "[PG_DISPATCH_SERVICE_ASSIGN] assigned",
      );
      return { ok: true, timeoutAt } as const;
    });
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[PG_DISPATCH_SERVICE_ASSIGN] transaction error");
    return { ok: false, reason: "unknown" };
  }
}

// ── pgClaimFcmDispatch ────────────────────────────────────────────────────────

/**
 * Atomically claim the FCM dispatch for an order (duplicate-push guard).
 *
 * Guarded update — claims only when no prior claim exists:
 *   UPDATE orders
 *     SET fcm_dispatch_claimed_at=now(), fcm_dispatch_claimed_by=?
 *     WHERE id=? AND fcm_dispatch_claimed_at IS NULL
 *   → 1 row = this caller won the claim
 *   → 0 rows = already claimed (or order missing) → { ok:false }
 *
 * This is the PG analogue of the Firestore claimFcmDispatch transaction.  It
 * performs the claim ONLY — it never sends FCM.  The caller (a future PG
 * dispatcher) is responsible for the actual push, exactly as the Firestore flow
 * separates claim from send.
 */
export async function pgClaimFcmDispatch(
  orderId:    string,
  instanceId: string,
): Promise<PgClaimResult> {
  const now = new Date();

  try {
    const claimed = await db
      .update(ordersTable)
      .set({
        fcmDispatchClaimedAt: now,
        fcmDispatchClaimedBy: instanceId,
        updatedAt:            now,
      })
      .where(
        and(
          eq(ordersTable.id, orderId),
          isNull(ordersTable.fcmDispatchClaimedAt),
        ),
      )
      .returning({ id: ordersTable.id });

    if (claimed.length > 0) {
      logger.info({ orderId, instanceId }, "[PG_DISPATCH_SERVICE_CLAIM] claimed");
      return { ok: true };
    }

    // 0 rows: either already claimed or the order does not exist. Distinguish so
    // callers can tell a genuine race from a missing order.
    const existing = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (existing.length === 0) {
      logger.info({ orderId, instanceId }, "[PG_DISPATCH_SERVICE_CLAIM] order missing");
      return { ok: false, reason: "order_missing" };
    }

    logger.info({ orderId, instanceId }, "[PG_DISPATCH_SERVICE_CLAIM] blocked — already claimed");
    return { ok: false, reason: "already_claimed" };
  } catch (err) {
    logger.error({ err, orderId, instanceId }, "[PG_DISPATCH_SERVICE_CLAIM] error");
    return { ok: false, reason: "unknown" };
  }
}

// ── pgCheckExpiredDispatches ──────────────────────────────────────────────────

/**
 * Return all dispatched orders whose dispatch_timeout_at has passed.
 *
 * Reproduces the Firestore poller's expiry sweep:
 *   orders WHERE status='dispatched' AND dispatch_timeout_at <= now()
 *
 * Read-only — it identifies expired dispatches but does not mutate them.  A
 * future PG dispatcher would feed each result to pgReturnOrderToPool.
 */
export async function pgCheckExpiredDispatches(): Promise<Order[]> {
  const now = new Date();

  const rows = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "dispatched"),
        lte(ordersTable.dispatchTimeoutAt, now),
      ),
    )
    .orderBy(sql`${ordersTable.dispatchTimeoutAt} ASC`);

  logger.info({ count: rows.length }, "[PG_DISPATCH_SERVICE_TIMEOUT] expired dispatches found");
  return rows;
}

// ── pgReturnOrderToPool ───────────────────────────────────────────────────────

/**
 * Atomically return a dispatched order to the searching pool.
 *
 * Guarded update — only acts on a currently-dispatched order:
 *   UPDATE orders
 *     SET status='searching', driver_uid=NULL, FCM claim fields cleared
 *     WHERE id=? AND status='dispatched'
 *   → 0 rows = order not dispatched (accepted/cancelled/already returned) → { ok:false }
 *
 * Also marks every still-pending offer for the order as timed_out (the driver
 * was NOT added to rejected_by, mirroring Firestore timeout semantics, so the
 * driver may be re-offered in a later cycle).  Both writes run in one
 * transaction.
 */
export async function pgReturnOrderToPool(
  orderId: string,
): Promise<PgReturnResult> {
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const returned = await tx
        .update(ordersTable)
        .set({
          status:               "searching",
          driverUid:            null,
          dispatchTimeoutAt:    null,
          fcmDispatchedAt:      null,
          fcmDispatchClaimedAt: null,
          fcmDispatchClaimedBy: null,
          fcmMessageId:         null,
          updatedAt:            now,
        })
        .where(
          and(
            eq(ordersTable.id, orderId),
            eq(ordersTable.status, "dispatched"),
          ),
        )
        .returning({ id: ordersTable.id });

      if (returned.length === 0) {
        // Guarded UPDATE matched 0 rows — nothing was written, so returning here
        // commits an empty (no-op) transaction with the correct reason. Calling
        // tx.rollback() would throw and surface as "unknown" to the caller.
        logger.info(
          { orderId },
          "[PG_DISPATCH_SERVICE_RETURN_TO_POOL] blocked — order not dispatched",
        );
        return { ok: false, reason: "not_dispatched" } as const;
      }

      // Mark still-pending offers as timed_out (no rejected_by mutation).
      await tx
        .update(orderOffersTable)
        .set({ status: "timed_out", respondedAt: now })
        .where(
          and(
            eq(orderOffersTable.orderId, orderId),
            eq(orderOffersTable.status, "pending"),
          ),
        );

      // Durable PG → Firestore projection (Phase 5H-BRIDGE-3): enqueued inside
      // the transaction so it commits atomically with the return-to-pool. The
      // projector resets the Firestore order doc to "searching" (driver cleared).
      await enqueueDispatchProjection(tx, orderId, "timeout", {});

      logger.info({ orderId }, "[PG_DISPATCH_SERVICE_RETURN_TO_POOL] returned to pool");
      return { ok: true } as const;
    });
  } catch (err) {
    logger.error({ err, orderId }, "[PG_DISPATCH_SERVICE_RETURN_TO_POOL] transaction error");
    return { ok: false, reason: "unknown" };
  }
}
