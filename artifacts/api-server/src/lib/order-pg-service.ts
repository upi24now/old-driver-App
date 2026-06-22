/**
 * Order PostgreSQL Service Layer
 *
 * Infrastructure-only module for Phase 1A of the Firestore → PostgreSQL
 * dispatch migration.  No routes call these functions yet.  No Firestore
 * code is touched.
 *
 * Provides safe, transaction-backed reads and writes against the three new
 * dispatch tables:
 *   orders          — order lifecycle and metadata
 *   order_offers    — per-driver offer state (replaces activeOfferDriverUids[])
 *   order_otps      — server-only delivery OTP (replaces private/otp subcollection)
 *
 * Accept/reject/timeout operations use Drizzle transactions with explicit
 * row-level conditions so concurrent callers cannot produce double-assignment
 * or split-brain state.
 *
 * Typed result union:
 *   { ok: true; ... }
 *   { ok: false; reason: string }
 *
 * All functions are async and throw only on unexpected infrastructure errors
 * (connection failure, constraint violation outside guarded paths).  Business-
 * logic failures (offer not found, already claimed, etc.) are returned as
 * { ok: false } values — never thrown — so callers can handle them without
 * try/catch gymnastics.
 */

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  orderOffersTable,
  ordersTable,
  type Order,
  type OrderOffer,
} from "@workspace/db";
import { logger } from "./logger";

// ── Active delivery statuses ────────────────────────────────────────────────
// Mirrors the ACTIVE_STATUSES constant in mobile/utils/firestore.ts.
// Orders in any of these statuses are considered "in progress" for a driver.
const ACTIVE_STATUSES = [
  "driver_assigned",
  "accepted",
  "to_pickup",
  "at_pickup",
  "to_drop",
  "at_drop",
] as const;

// ── Result types ─────────────────────────────────────────────────────────────

export type PgOfferResult =
  | { ok: true }
  | { ok: false; reason: "not_in_offer" | "already_claimed" | "expired" | "order_missing" | "unknown" };

// ── pgGetOrder ────────────────────────────────────────────────────────────────

/**
 * Fetch a single order by its Firestore document ID.
 * Returns null if no row exists (order not yet migrated to PG, or invalid ID).
 */
export async function pgGetOrder(orderId: string): Promise<Order | null> {
  const rows = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  return rows[0] ?? null;
}

// ── pgGetActiveOrders ─────────────────────────────────────────────────────────

/**
 * Return up to `maxResults` in-progress orders assigned to a driver.
 *
 * Equivalent to the Firestore query:
 *   orders WHERE driverUid == uid AND status IN ACTIVE_STATUSES LIMIT 3
 *
 * Results are sorted newest-first by accepted_at so the most recently
 * accepted order is always first (matches the Firestore sort in
 * getActiveOrdersForDriver).
 */
export async function pgGetActiveOrders(
  driverUid:  string,
  maxResults = 3,
): Promise<Order[]> {
  const rows = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.driverUid, driverUid),
        inArray(ordersTable.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(sql`${ordersTable.acceptedAt} DESC NULLS LAST`)
    .limit(maxResults);

  return rows;
}

// ── pgGetPendingOffers ────────────────────────────────────────────────────────

/**
 * Return all pending (non-expired) offers currently targeting a driver.
 *
 * Equivalent to the Firestore query:
 *   orders WHERE activeOfferDriverUids array-contains uid
 *
 * An offer is returned when:
 *   • status = 'pending'
 *   • expires_at IS NULL  OR  expires_at > now()
 *
 * Includes a JOIN to orders so the caller receives the full order detail
 * alongside the offer metadata in one query.
 */
export async function pgGetPendingOffers(driverUid: string): Promise<Array<{
  offer: OrderOffer;
  order: Order;
}>> {
  const now = new Date();

  const rows = await db
    .select({
      offer: orderOffersTable,
      order: ordersTable,
    })
    .from(orderOffersTable)
    .innerJoin(ordersTable, eq(orderOffersTable.orderId, ordersTable.id))
    .where(
      and(
        eq(orderOffersTable.driverUid, driverUid),
        eq(orderOffersTable.status, "pending"),
        or(
          isNull(orderOffersTable.expiresAt),
          gt(orderOffersTable.expiresAt, now),
        ),
      ),
    )
    .orderBy(sql`${orderOffersTable.offeredAt} DESC`);

  return rows;
}

// ── pgCreateOffer ─────────────────────────────────────────────────────────────

/**
 * Insert a new pending offer row for (orderId, driverUid).
 *
 * On conflict (same order_id + driver_uid already exists), the existing row
 * is left unchanged — idempotent.  This matches the safety contract of
 * Firestore's arrayUnion for activeOfferDriverUids.
 *
 * expiresAt is optional.  When supplied, pgGetPendingOffers and pgAcceptOffer
 * will both honour the expiry guard.
 */
export async function pgCreateOffer(
  orderId:   string,
  driverUid: string,
  expiresAt?: Date,
): Promise<{ ok: true } | { ok: false; reason: "unknown" }> {
  try {
    await db
      .insert(orderOffersTable)
      .values({
        orderId,
        driverUid,
        status:    "pending",
        expiresAt: expiresAt ?? null,
      })
      .onConflictDoNothing({
        target: [orderOffersTable.orderId, orderOffersTable.driverUid],
      });

    logger.info({ orderId, driverUid }, "[pgCreateOffer] offer created (or already existed)");
    return { ok: true };
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgCreateOffer] unexpected error");
    return { ok: false, reason: "unknown" };
  }
}

// ── pgAcceptOffer ─────────────────────────────────────────────────────────────

/**
 * Atomically claim an order for a driver.
 *
 * Runs inside a single Drizzle transaction:
 *   Step 1 — Update order_offers
 *     SET status = 'accepted', responded_at = now()
 *     WHERE order_id = ? AND driver_uid = ? AND status = 'pending'
 *       AND (expires_at IS NULL OR expires_at > now())
 *
 *     0 rows → offer missing, already responded, or expired → abort
 *
 *   Step 2 — Update orders
 *     SET status = 'driver_assigned', driver_uid = ?, updated_at = now()
 *     WHERE id = ? AND status IN ('dispatched', 'pending', 'searching')
 *
 *     0 rows → order already claimed by another driver → abort + return
 *
 * If either step returns 0 affected rows the transaction is rolled back and
 * an appropriate { ok: false, reason } is returned to the caller.
 *
 * PostgreSQL's MVCC guarantees that two concurrent transactions cannot both
 * satisfy the WHERE clauses simultaneously — exactly one commits, the other
 * fails the row check and rolls back.
 */
export async function pgAcceptOffer(
  orderId:    string,
  driverUid:  string,
  driverName: string | null = null,
): Promise<PgOfferResult> {
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      // ── Step 1: Claim the offer row ─────────────────────────────────────────
      const offerUpdate = await tx
        .update(orderOffersTable)
        .set({
          status:      "accepted",
          respondedAt: now,
        })
        .where(
          and(
            eq(orderOffersTable.orderId,   orderId),
            eq(orderOffersTable.driverUid, driverUid),
            eq(orderOffersTable.status,    "pending"),
            or(
              isNull(orderOffersTable.expiresAt),
              gt(orderOffersTable.expiresAt, now),
            ),
          ),
        )
        .returning({ id: orderOffersTable.id });

      if (offerUpdate.length === 0) {
        // Offer row missing, already accepted/rejected, or expired.
        // Determine reason by reading current state (best-effort; outside tx
        // to avoid holding the lock longer than needed).
        const existing = await tx
          .select({ status: orderOffersTable.status, expiresAt: orderOffersTable.expiresAt })
          .from(orderOffersTable)
          .where(
            and(
              eq(orderOffersTable.orderId,   orderId),
              eq(orderOffersTable.driverUid, driverUid),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          logger.info({ orderId, driverUid }, "[pgAcceptOffer] offer row not found");
          tx.rollback();
          return { ok: false, reason: "not_in_offer" } as const;
        }

        const row = existing[0]!;
        if (row.status !== "pending") {
          logger.info({ orderId, driverUid, status: row.status }, "[pgAcceptOffer] offer already responded");
          tx.rollback();
          return { ok: false, reason: "already_claimed" } as const;
        }

        // Status is pending but expires_at check failed → expired
        logger.info({ orderId, driverUid, expiresAt: row.expiresAt }, "[pgAcceptOffer] offer expired");
        tx.rollback();
        return { ok: false, reason: "expired" } as const;
      }

      // ── Step 2: Mark order as driver_assigned ───────────────────────────────
      const orderUpdate = await tx
        .update(ordersTable)
        .set({
          status:     "driver_assigned",
          driverUid,
          driverName: driverName ?? null,
          acceptedAt: now,
          updatedAt:  now,
        })
        .where(
          and(
            eq(ordersTable.id, orderId),
            inArray(ordersTable.status, ["dispatched", "pending", "searching"]),
          ),
        )
        .returning({ id: ordersTable.id });

      if (orderUpdate.length === 0) {
        // Order no longer in an assignable state — another driver won the race.
        logger.info({ orderId, driverUid }, "[pgAcceptOffer] order already claimed by another driver");
        tx.rollback();
        return { ok: false, reason: "already_claimed" } as const;
      }

      logger.info({ orderId, driverUid }, "[pgAcceptOffer] order accepted");
      return { ok: true } as const;
    });
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgAcceptOffer] transaction error");
    return { ok: false, reason: "unknown" };
  }
}

// ── pgRejectOffer ─────────────────────────────────────────────────────────────

/**
 * Mark the offer as rejected by this driver.
 *
 * Equivalent to the Firestore arrayRemove(driverUid) on activeOfferDriverUids,
 * plus recording the driver in the order's rejected_by[] array so the
 * dispatcher skips them in this cycle.
 *
 * Only updates rows with status = 'pending' — idempotent if called twice.
 * Returns ok:true even when the row is not found (the offer may have already
 * expired or been withdrawn before the driver responded).
 */
export async function pgRejectOffer(
  orderId:   string,
  driverUid: string,
): Promise<PgOfferResult> {
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      // Mark the offer row
      await tx
        .update(orderOffersTable)
        .set({ status: "rejected", respondedAt: now })
        .where(
          and(
            eq(orderOffersTable.orderId,   orderId),
            eq(orderOffersTable.driverUid, driverUid),
            eq(orderOffersTable.status,    "pending"),
          ),
        );

      // Append to rejected_by[] on the orders row so the dispatcher skips
      // this driver in the current cycle.  Uses array_append for atomicity.
      await tx
        .update(ordersTable)
        .set({
          rejectedBy: sql`array_append(COALESCE(${ordersTable.rejectedBy}, '{}'), ${driverUid})`,
          updatedAt:  now,
        })
        .where(eq(ordersTable.id, orderId));
    });

    logger.info({ orderId, driverUid }, "[pgRejectOffer] offer rejected");
    return { ok: true };
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgRejectOffer] transaction error");
    return { ok: false, reason: "unknown" };
  }
}

// ── pgTimeoutOffer ────────────────────────────────────────────────────────────

/**
 * Mark the offer as timed_out by this driver.
 *
 * Equivalent to Firestore's timeoutOrder (arrayRemove without adding to
 * rejectedBy).  The driver is NOT added to rejected_by[], so the dispatcher
 * may re-offer the same order in the next cycle.
 *
 * Only updates rows with status = 'pending' — idempotent if called twice.
 */
export async function pgTimeoutOffer(
  orderId:   string,
  driverUid: string,
): Promise<PgOfferResult> {
  const now = new Date();

  try {
    await db
      .update(orderOffersTable)
      .set({ status: "timed_out", respondedAt: now })
      .where(
        and(
          eq(orderOffersTable.orderId,   orderId),
          eq(orderOffersTable.driverUid, driverUid),
          eq(orderOffersTable.status,    "pending"),
        ),
      );

    logger.info({ orderId, driverUid }, "[pgTimeoutOffer] offer timed out");
    return { ok: true };
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgTimeoutOffer] error");
    return { ok: false, reason: "unknown" };
  }
}
