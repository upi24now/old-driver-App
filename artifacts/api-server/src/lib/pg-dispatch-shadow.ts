/**
 * PostgreSQL Dispatcher Shadow Comparator  (Phase 5B — SHADOW MODE)
 *
 * READ-ONLY. This module NEVER writes to Firestore, PostgreSQL, or order state,
 * never sends FCM, never assigns drivers. Its only job is to independently
 * recompute the dispatch decision from PostgreSQL data and compare it against
 * the authoritative decision the Firestore dispatcher already made, then log
 * the verdict (MATCH / DIFF / ERROR).
 *
 * The Firestore round-robin dispatcher (round-robin-dispatcher.ts) remains the
 * ONLY component that assigns drivers, updates orders, sends FCM, and handles
 * timeout / accept / reject. Nothing here can affect production behaviour:
 * every entry point is fire-and-forget and swallows its own errors.
 *
 * ── Faithful reproduction of the Firestore algorithm ─────────────────────────
 * The Firestore dispatcher (assignNextDriver) selects a driver by:
 *   1. drivers WHERE isOnline == true
 *   2. keep expiry === 0 (legacy / no-subscription) OR expiry > now
 *   3. drop anyone in the order's rejectedBy[]
 *   4. sort by uid ascending
 *   5. round-robin: start AFTER lastDispatchedDriverUid (wrap), else index 0
 *
 * The PG side mirrors steps 1–5 against PostgreSQL columns:
 *   isOnline               → drivers.is_online
 *   subscriptionExpiresAt  → drivers.subscription_expires_at (NULL == legacy/0)
 *   order.rejectedBy[]     → orders.rejected_by[]
 *   round-robin cursor     → the pre-dispatch cursor (see note below)
 *
 * ── Round-robin cursor note ──────────────────────────────────────────────────
 * lastDispatchedDriverUid is SHARED order state, not a driver attribute. The
 * Firestore dispatcher advances it to the chosen driver inside the same
 * assignment transaction, and the PG shadow order-mirror write does the same a
 * moment later. By the time this comparator runs (after assignment) the PG
 * order row's last_dispatched_uid may already point at the just-chosen driver,
 * which would corrupt the round-robin reproduction. We therefore use the
 * PRE-dispatch cursor value captured by the dispatcher and passed in via
 * `fs.lastUid`. The cursor is order-dispatch state common to both stores; what
 * this shadow actually verifies is that PG DRIVER data (online / subscription /
 * rejected / offer history) yields the SAME selection.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  driversTable,
  orderOffersTable,
  ordersTable,
} from "@workspace/db";
import { logger } from "./logger";

// ─── Pure types ───────────────────────────────────────────────────────────────

/** A driver as the dispatcher sees it: identity + subscription expiry (epoch ms, null = legacy/no-sub). */
export interface ShadowDriver {
  uid: string;
  subscriptionExpiresAtMs: number | null;
}

/** The authoritative Firestore decision context, captured at assignment time. */
export interface FsDecision {
  /** The driver Firestore actually chose. */
  firestoreDriver: string;
  /** Firestore's eligible candidate pool (post online+subscription+rejected filter), uids. */
  pool: string[];
  /** Firestore order.rejectedBy[] at decision time. */
  rejectedBy: string[];
  /** Pre-dispatch round-robin cursor (lastDispatchedDriverUid), or null. */
  lastUid: string | null;
  /** Count of drivers Firestore saw as isOnline==true (pre subscription/rejected filter). */
  onlineCount: number;
}

/** A snapshot of the PostgreSQL state used to independently recompute the decision. */
export interface PgSnapshot {
  /** Drivers with is_online == true. */
  onlineDrivers: ShadowDriver[];
  /** orders.rejected_by[]. */
  rejectedBy: string[];
  /** Driver uids whose order_offers row for this order is in status 'rejected'. */
  offerHistoryRejected: string[];
  /** Comparison clock (epoch ms). */
  nowMs: number;
}

export type ShadowOutcome = "match" | "diff";

export interface ShadowResult {
  outcome: ShadowOutcome;
  pgDriver: string | null;
  reason?: string;
  detail: {
    fsPoolSize: number;
    pgPoolSize: number;
    fsOnline: number;
    pgOnline: number;
    fsRejected: string[];
    pgRejected: string[];
    offerHistoryRejected: string[];
  };
}

// ─── Pure selection (mirror of assignNextDriver steps 2–5) ─────────────────────

/**
 * Mirror of the Firestore dispatcher's subscription rule `expiry === 0 || expiry > now`.
 *
 * Firestore coerces a missing/non-numeric subscriptionExpiresAt to 0 and lets
 * that driver through (legacy / no-subscription passthrough). When mirrored into
 * PG, "missing" becomes NULL and a stored Firestore 0 becomes Date(0) → 0 ms.
 * Both must be treated as legacy-allowed to reproduce the Firestore decision.
 */
function isSubscriptionEligible(expiryMs: number | null, nowMs: number): boolean {
  return expiryMs === null || expiryMs === 0 || expiryMs > nowMs;
}

/**
 * Apply the subscription + rejected filters, sort by uid, and pick the
 * round-robin successor of `lastUid`. Pure — no I/O.
 */
export function selectPgCandidate(
  drivers:    ShadowDriver[],
  rejectedBy: string[],
  lastUid:    string | null,
  nowMs:      number,
): { pool: string[]; chosen: string | null } {
  const rejected = new Set(rejectedBy);

  const eligible = drivers
    // expiry 0 / null (legacy, no subscription) OR expiry in the future
    .filter((d) => isSubscriptionEligible(d.subscriptionExpiresAtMs, nowMs))
    .filter((d) => !rejected.has(d.uid))
    .map((d) => d.uid)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (eligible.length === 0) return { pool: [], chosen: null };

  let startIdx = 0;
  if (lastUid) {
    const pos = eligible.indexOf(lastUid);
    if (pos !== -1) startIdx = (pos + 1) % eligible.length;
  }

  return { pool: eligible, chosen: eligible[startIdx]! };
}

// ─── Pure comparison ──────────────────────────────────────────────────────────

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * Compare the authoritative Firestore decision against an independent PG recompute.
 * Pure — takes already-fetched snapshots and returns the verdict + reason.
 */
export function compareDispatchDecision(fs: FsDecision, pg: PgSnapshot): ShadowResult {
  const { pool: pgPool, chosen: pgChosen } = selectPgCandidate(
    pg.onlineDrivers,
    pg.rejectedBy,
    fs.lastUid,
    pg.nowMs,
  );

  const pgOnlineUids = pg.onlineDrivers.map((d) => d.uid);
  const pgEligibleBySub = new Set(
    pg.onlineDrivers
      .filter((d) => isSubscriptionEligible(d.subscriptionExpiresAtMs, pg.nowMs))
      .map((d) => d.uid),
  );

  const detail = {
    fsPoolSize:           fs.pool.length,
    pgPoolSize:           pgPool.length,
    fsOnline:             fs.onlineCount,
    pgOnline:             pg.onlineDrivers.length,
    fsRejected:           [...fs.rejectedBy].sort(),
    pgRejected:           [...pg.rejectedBy].sort(),
    offerHistoryRejected: [...pg.offerHistoryRejected].sort(),
  };

  const chosenMatch       = fs.firestoreDriver === pgChosen;
  const poolSetMatch      = setEquals(fs.pool, pgPool);
  const rejectedMatch     = setEquals(fs.rejectedBy, pg.rejectedBy);
  const onlineMatch       = fs.onlineCount === pg.onlineDrivers.length;
  const offerHistoryMatch = setEquals(pg.rejectedBy, pg.offerHistoryRejected);

  if (chosenMatch && poolSetMatch && rejectedMatch && onlineMatch && offerHistoryMatch) {
    return { outcome: "match", pgDriver: pgChosen, detail };
  }

  // Diff — determine the most specific reason, most-causal first.
  let reason: string;
  if (!pgOnlineUids.includes(fs.firestoreDriver)) {
    reason = "missing driver";
  } else if (!pgEligibleBySub.has(fs.firestoreDriver)) {
    reason = "subscription mismatch";
  } else if (!rejectedMatch) {
    reason = "rejected list mismatch";
  } else if (!offerHistoryMatch) {
    reason = "offer history mismatch";
  } else if (!poolSetMatch) {
    reason = "different candidate pool";
  } else if (!onlineMatch) {
    reason = "online count mismatch";
  } else {
    reason = "other";
  }

  return { outcome: "diff", pgDriver: pgChosen, reason, detail };
}

/**
 * Pure timeout-eligibility comparison.
 * Firestore returns an order to the pool when its dispatch deadline has passed.
 * PG agrees when the driver's offer row carries an expiry that is at/after due.
 */
export function compareTimeoutDecision(
  fsEligible:        boolean,
  pgOfferExpiresAtMs: number | null,
  nowMs:             number,
): { outcome: ShadowOutcome; pgEligible: boolean; reason?: string } {
  const pgEligible = pgOfferExpiresAtMs !== null && pgOfferExpiresAtMs <= nowMs;
  if (fsEligible === pgEligible) return { outcome: "match", pgEligible };
  return { outcome: "diff", pgEligible, reason: "timeout eligibility mismatch" };
}

// ─── PG snapshot reader (READ-ONLY) ────────────────────────────────────────────

/** Read the PG state needed to recompute a dispatch decision for one order. */
export async function readPgSnapshot(orderId: string): Promise<PgSnapshot> {
  const nowMs = Date.now();

  const driverRows = await db
    .select({
      uid:    driversTable.uid,
      expiry: driversTable.subscriptionExpiresAt,
    })
    .from(driversTable)
    .where(eq(driversTable.isOnline, true));

  const onlineDrivers: ShadowDriver[] = driverRows.map((r) => ({
    uid: r.uid,
    subscriptionExpiresAtMs: r.expiry ? r.expiry.getTime() : null,
  }));

  const orderRows = await db
    .select({ rejectedBy: ordersTable.rejectedBy })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const rejectedBy = orderRows[0]?.rejectedBy ?? [];

  const offerRows = await db
    .select({ driverUid: orderOffersTable.driverUid })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.orderId, orderId),
        eq(orderOffersTable.status, "rejected"),
      ),
    );

  const offerHistoryRejected = offerRows.map((r) => r.driverUid);

  return { onlineDrivers, rejectedBy, offerHistoryRejected, nowMs };
}

// ─── Live entry points (fire-and-forget; never throw) ──────────────────────────

/**
 * Shadow-compare one Firestore assignment decision. READ-ONLY.
 * Call as `void pgShadowCompareDispatch(...)` after the FS assignment commits.
 */
export async function pgShadowCompareDispatch(orderId: string, fs: FsDecision): Promise<void> {
  try {
    const snapshot = await readPgSnapshot(orderId);
    const result = compareDispatchDecision(fs, snapshot);

    if (result.outcome === "match") {
      logger.info(
        { orderId, firestoreDriver: fs.firestoreDriver, pgDriver: result.pgDriver },
        "[PG_DISPATCH_SHADOW_MATCH]",
      );
    } else {
      logger.warn(
        {
          orderId,
          firestoreDriver: fs.firestoreDriver,
          pgDriver:        result.pgDriver,
          reason:          result.reason,
          ...result.detail,
        },
        "[PG_DISPATCH_SHADOW_DIFF]",
      );
    }
  } catch (err) {
    logger.error({ err, orderId }, "[PG_DISPATCH_SHADOW_ERROR]");
  }
}

/**
 * Shadow-compare one Firestore timeout decision. READ-ONLY.
 * Call as `void pgShadowCompareTimeout(...)` when FS returns an order to the pool.
 */
export async function pgShadowCompareTimeout(
  orderId:   string,
  driverUid: string | null,
): Promise<void> {
  try {
    if (!driverUid) {
      // Firestore did not actually reset/time out a driver for this order
      // (returnToPool's transaction bailed). Nothing happened, so there is
      // nothing to compare — stay silent rather than emit a misleading MATCH.
      return;
    }

    const nowMs = Date.now();
    const rows = await db
      .select({ expiresAt: orderOffersTable.expiresAt })
      .from(orderOffersTable)
      .where(
        and(
          eq(orderOffersTable.orderId, orderId),
          eq(orderOffersTable.driverUid, driverUid),
        ),
      )
      .limit(1);

    const pgOfferExpiresAtMs = rows[0]?.expiresAt ? rows[0].expiresAt.getTime() : null;
    // Firestore already decided this order timed out, so fsEligible is true.
    const result = compareTimeoutDecision(true, pgOfferExpiresAtMs, nowMs);

    if (result.outcome === "match") {
      logger.info(
        { orderId, firestoreDriver: driverUid, pgDriver: driverUid, kind: "timeout" },
        "[PG_DISPATCH_SHADOW_MATCH]",
      );
    } else {
      logger.warn(
        {
          orderId,
          firestoreDriver: driverUid,
          pgDriver:        driverUid,
          reason:          result.reason,
          kind:            "timeout",
          pgEligible:      result.pgEligible,
        },
        "[PG_DISPATCH_SHADOW_DIFF]",
      );
    }
  } catch (err) {
    logger.error({ err, orderId }, "[PG_DISPATCH_SHADOW_ERROR]");
  }
}
