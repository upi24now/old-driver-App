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

import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  orderOffersTable,
  orderOtpsTable,
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

// ── pgGetCompletedTrips ───────────────────────────────────────────────────────

/**
 * Return up to `limitCount` delivered orders for a driver, newest first.
 *
 * Equivalent to the Firestore query:
 *   orders WHERE driverUid == uid AND status == "delivered"
 *           ORDER BY deliveredAt DESC LIMIT 20
 */
export async function pgGetCompletedTrips(
  driverUid:  string,
  limitCount = 20,
): Promise<Order[]> {
  const rows = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.driverUid, driverUid),
        eq(ordersTable.status, "delivered"),
      ),
    )
    .orderBy(sql`${ordersTable.deliveredAt} DESC NULLS LAST`)
    .limit(limitCount);

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

// ── Phase 1B shadow-write helpers ─────────────────────────────────────────────
//
// The functions below are called by the round-robin dispatcher and the
// pg-shadow-writer Firestore listener.  They are best-effort: all errors are
// caught internally and logged; none of these functions ever throws.

// ── status precedence (Phase 5H-BRIDGE-2) ─────────────────────────────────────

/**
 * Statuses from which a pool/dispatch-cycle ingress mirror may still move an
 * order. `returnToPool` legitimately resets a "dispatched" order back to
 * "searching", so "dispatched" is included. Once an order is claimed
 * ("driver_assigned"), in a delivery stage, or terminal ("delivered" /
 * "cancelled"), a stale or replayed pool/cycle ingress event must NEVER
 * resurrect it back toward the pool. The guard is applied as a `setWhere` on the
 * conflict update so a blocked write is a silent no-op (the existing row wins).
 */
const POOL_MIRRORABLE_STATUSES = ["searching", "pending", "dispatched"] as const;

// ── pgUpsertOrder ─────────────────────────────────────────────────────────────

/**
 * Options controlling pgUpsertOrder's conflict behaviour.
 *
 * Defaults reproduce the original dispatcher behaviour exactly (no guard, no
 * offer-set mirror, status from data) so existing callers are unaffected.
 */
export interface PgUpsertOrderOpts {
  /** Force the written status instead of reading data.status. */
  overrideStatus?: string;
  /**
   * Phase 5H-BRIDGE-2: only apply the conflict UPDATE when the EXISTING row is
   * still pool-mirrorable (searching/pending/dispatched). Prevents a delayed or
   * replayed pool/cycle ingress event from resurrecting a claimed/terminal
   * order. Used by the Firestore→PG ingress listeners; left off for the
   * dispatcher's own authoritative shadow write.
   */
  guardRegression?: boolean;
  /**
   * Phase 5H-BRIDGE-2: also mirror active_offer_driver_uids from the Firestore
   * doc (the driver-reject / offer-set field). Off by default so the
   * dispatcher's dispatch-time upsert leaves the column untouched as before.
   */
  mirrorOfferSet?: boolean;
  /**
   * Phase 5H-BRIDGE-3: the exact set of EXISTING statuses from which a guarded
   * conflict UPDATE may proceed. Defaults to POOL_MIRRORABLE_STATUSES
   * (searching/pending/dispatched) — the firestore-authoritative behaviour, where
   * a returnToPool (dispatched→searching) originates in Firestore and MUST mirror
   * to PG. In pg-authoritative mode the pool-ingress listener narrows this to
   * [searching, pending] so a stale/replayed pool "added" event can never regress
   * a PG-authoritative "dispatched" row back into the pool (in pg mode the
   * dispatched→searching transition originates in PG and is projected outward, so
   * no Firestore→PG mirror of it is needed). Only meaningful when guardRegression.
   */
  guardStatuses?: readonly string[];
}

/**
 * Upsert an order row from Firestore document data.
 *
 * Called by the dispatcher immediately after a successful Firestore assign
 * transaction, giving PG a mirrored row with all the metadata the customer app
 * wrote when it created the order.
 *
 * On conflict (order already exists in PG from a previous dispatch cycle) only
 * dispatch-cycle fields are updated; customer info, route, and fare columns are
 * left unchanged to avoid clobbering richer data from a prior sync.
 *
 * The driverUid column has no FK constraint during Phase 1B (drivers may not be
 * in PG yet), so FK violations cannot occur here.
 */
export async function pgUpsertOrder(
  orderId:        string,
  data:           Record<string, unknown>,
  opts:           PgUpsertOrderOpts = {},
): Promise<void> {
  const {
    overrideStatus,
    guardRegression = false,
    mirrorOfferSet = false,
    guardStatuses = POOL_MIRRORABLE_STATUSES,
  } = opts;
  const str = (k: string): string | null => {
    const v = data[k];
    return typeof v === "string" ? v : null;
  };
  const numStr = (k: string): string | null => {
    const v = data[k];
    if (typeof v === "number") return String(v);
    if (typeof v === "string" && v !== "") return v;
    return null;
  };
  const intVal = (k: string): number | null => {
    const v = data[k];
    return typeof v === "number" ? Math.round(v) : null;
  };
  const boolVal = (k: string): boolean => {
    const v = data[k];
    return typeof v === "boolean" ? v : false;
  };
  const arrStr = (k: string): string[] => {
    const v = data[k];
    return Array.isArray(v)
      ? (v as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  };
  const tsDate = (k: string): Date | null => {
    const v = data[k];
    if (v instanceof Date) return v;
    if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
      return (v as { toDate(): Date }).toDate();
    }
    return null;
  };

  const status           = overrideStatus ?? str("status") ?? "searching";
  const rejectedBy       = arrStr("rejectedBy");
  const lastDispatchedUid = str("lastDispatchedDriverUid") ?? str("lastDispatchedUid");
  const dispatchTimeoutAt = tsDate("dispatchTimeoutAt");
  const dispatchedAt      = tsDate("dispatchedAt");
  // Only mirror the offer set when explicitly requested (Phase 5H-BRIDGE-2);
  // otherwise leave the column untouched so the dispatcher's upsert is unchanged.
  const offerSetField     = mirrorOfferSet
    ? { activeOfferDriverUids: arrStr("activeOfferDriverUids") }
    : {};

  try {
    await db
      .insert(ordersTable)
      .values({
        id:             orderId,
        status,
        customerName:   str("customerName"),
        customerPhone:  str("customerPhone"),
        pickup:         str("pickup"),
        pickupCity:     str("pickupCity"),
        drop:           str("drop"),
        dropCity:       str("dropCity"),
        distanceKm:     numStr("distanceKm"),
        durationMin:    intVal("durationMin"),
        fareEstimate:   numStr("fareEstimate"),
        paymentMode:    str("paymentMode"),
        surge:          boolVal("surge"),
        surgeMultiplier: numStr("surgeMultiplier") ?? "1",
        parcelType:     str("parcelType"),
        parcelEmoji:    str("parcelEmoji"),
        parcelWeight:   str("parcelWeight"),
        driverUid:      str("driverUid"),
        driverName:     str("driverName"),
        driverRating:   str("driverRating"),
        driverTrips:    intVal("driverTrips"),
        rejectedBy,
        lastDispatchedUid,
        dispatchTimeoutAt,
        dispatchedAt,
        ...offerSetField,
      })
      .onConflictDoUpdate({
        target: ordersTable.id,
        set: {
          status,
          driverUid:        str("driverUid"),
          driverName:       str("driverName"),
          driverRating:     str("driverRating"),
          driverTrips:      intVal("driverTrips"),
          rejectedBy,
          lastDispatchedUid,
          dispatchTimeoutAt,
          dispatchedAt:     dispatchedAt ?? sql`${ordersTable.dispatchedAt}`,
          updatedAt:        sql`now()`,
          ...offerSetField,
        },
        // Phase 5H-BRIDGE-2/3: when guarding, only update if the EXISTING row is
        // still in the caller-supplied mirrorable set — never resurrect a
        // claimed/terminal order, and (pg mode) never regress a PG-authoritative
        // dispatched row from a stale pool event.
        ...(guardRegression
          ? { setWhere: inArray(ordersTable.status, [...guardStatuses]) }
          : {}),
      });
  } catch (err) {
    logger.error({ err, orderId, status }, "[pgUpsertOrder] error (non-blocking)");
  }
}

// ── pgShadowCancelOrder ───────────────────────────────────────────────────────

/**
 * Terminal cancellation mirror (Phase 5H-BRIDGE-2).
 *
 * Cancellation must ALWAYS win and must never be lost to a race with pool
 * ingress. Unlike pgShadowSetStatus (UPDATE-only — a no-op when the order was
 * never mirrored), this is an UPSERT:
 *
 *   - row missing → INSERT a minimal cancelled row (id + status + cancelled_at).
 *     The order is thereby out of the pool query immediately, so a later/delayed
 *     pool ingress upsert (guardRegression) finds a terminal row and skips.
 *   - row present → force status='cancelled', preserving the original
 *     cancelled_at via COALESCE so a snapshot replay on restart never re-stamps
 *     the timestamp.
 *
 * The only status it will not overwrite is "delivered" (a completed order is
 * also terminal and must not be flipped). Firestore never has an order be both,
 * so this is purely defensive against a stale replayed event.
 *
 * Never throws.
 */
export async function pgShadowCancelOrder(orderId: string): Promise<void> {
  const now = new Date();
  try {
    await db
      .insert(ordersTable)
      .values({ id: orderId, status: "cancelled", cancelledAt: now })
      .onConflictDoUpdate({
        target: ordersTable.id,
        set: {
          status:      "cancelled",
          cancelledAt: sql`coalesce(${ordersTable.cancelledAt}, ${now})`,
          updatedAt:   now,
        },
        setWhere: ne(ordersTable.status, "delivered"),
      });
  } catch (err) {
    logger.error({ err, orderId }, "[pgShadowCancelOrder] error (non-blocking)");
  }
}

// ── pgShadowSetStatus ─────────────────────────────────────────────────────────

/**
 * Best-effort status field update for shadow writer listeners.
 *
 * Maps each delivery status to its corresponding stage-timestamp column and
 * writes both atomically.  Called from the Firestore listeners in
 * pg-shadow-writer.ts and from POST /complete for the delivered status.
 *
 * Never throws; errors are logged for monitoring.
 */
export async function pgShadowSetStatus(
  orderId: string,
  status:  string,
  extra:   Partial<typeof ordersTable.$inferInsert> = {},
): Promise<void> {
  const now = new Date();

  const tsFields: Partial<typeof ordersTable.$inferInsert> = {};
  switch (status) {
    case "driver_assigned": tsFields.acceptedAt  = now; break;
    case "to_pickup":       tsFields.toPickupAt  = now; break;
    case "at_pickup":       tsFields.atPickupAt  = now; break;
    case "to_drop":         tsFields.toDropAt    = now; break;
    case "at_drop":         tsFields.atDropAt    = now; break;
    case "delivered":       tsFields.deliveredAt = now; break;
    case "cancelled":       tsFields.cancelledAt = now; break;
    default: break;
  }

  try {
    await db
      .update(ordersTable)
      .set({ status, updatedAt: now, ...tsFields, ...extra })
      .where(eq(ordersTable.id, orderId));
  } catch (err) {
    logger.error({ err, orderId, status }, "[pgShadowSetStatus] error (non-blocking)");
  }
}

// ── pgShadowMarkAccept ────────────────────────────────────────────────────────

/**
 * Lenient accept mirror for the Firestore shadow listener.
 *
 * Unlike pgAcceptOffer (which uses a guarded transaction for the live path),
 * this function applies both writes unconditionally — if no offer row exists
 * yet (e.g. the dispatcher write race), the offer update silently matches
 * 0 rows, which is acceptable in shadow mode.
 *
 * Writes:
 *   order_offers  SET status='accepted', responded_at=now()
 *                 WHERE order_id=? AND driver_uid=? AND status='pending'
 *   orders        SET status='driver_assigned', driver_uid=?, driver_name=?,
 *                     accepted_at=now(), updated_at=now()
 *                 WHERE id=?
 *
 * Never throws.
 */
export async function pgShadowMarkAccept(
  orderId:    string,
  driverUid:  string,
  driverName: string | null = null,
): Promise<void> {
  const now = new Date();

  try {
    await db
      .update(orderOffersTable)
      .set({ status: "accepted", respondedAt: now })
      .where(
        and(
          eq(orderOffersTable.orderId,   orderId),
          eq(orderOffersTable.driverUid, driverUid),
          eq(orderOffersTable.status,    "pending"),
        ),
      );

    await db
      .update(ordersTable)
      .set({
        status:     "driver_assigned",
        driverUid,
        driverName: driverName ?? null,
        acceptedAt: now,
        updatedAt:  now,
      })
      .where(eq(ordersTable.id, orderId));
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgShadowMarkAccept] error (non-blocking)");
  }
}

// ── pgUpsertOrderOtp ──────────────────────────────────────────────────────────

/**
 * Upsert an OTP row from the Firestore orders/{orderId}/private/otp subcollection.
 *
 * Called by the PG shadow writer whenever the OTP document is created or
 * updated in Firestore.  On conflict (same order_id already has an OTP row)
 * the value is overwritten — this covers the rare case where the customer app
 * re-generates the OTP before delivery.
 *
 * The INSERT will fail with a FK violation if the orders row does not yet
 * exist in PG (OTP written before order is dispatched).  This is logged and
 * swallowed — the OTP will be re-synced once the order row lands via
 * pgUpsertOrder.
 *
 * Never throws.
 */
export async function pgUpsertOrderOtp(
  orderId: string,
  value:   string,
): Promise<void> {
  try {
    await db
      .insert(orderOtpsTable)
      .values({ orderId, value })
      .onConflictDoUpdate({
        target: orderOtpsTable.orderId,
        set:    { value },
      });
  } catch (err) {
    logger.error({ err, orderId }, "[pgUpsertOrderOtp] error (non-blocking)");
  }
}
