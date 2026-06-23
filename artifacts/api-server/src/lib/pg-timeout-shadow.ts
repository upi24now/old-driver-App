/**
 * PostgreSQL Timeout Shadow Validator  (Phase 5C-B — TIMEOUT SHADOW)
 *
 * READ-ONLY. This module NEVER writes to Firestore, PostgreSQL, or order state,
 * never sends FCM, never returns orders to the pool, never modifies offers. For
 * every authoritative Firestore TIMEOUT event (an order returned to the pool
 * because its dispatch deadline elapsed) it independently reproduces the
 * *guarded PG timeout logic* a future PG-authoritative timeout poller would run,
 * compares the reproduced decision against the Firestore timeout, and logs the
 * verdict (MATCH / DIFF / ERROR).
 *
 * Firestore (round-robin-dispatcher.ts → checkExpiredDispatches / returnToPool)
 * remains the ONLY component that controls timeout, returns orders to the pool,
 * updates orders, and times out offers. Every entry point here is fire-and-forget
 * and swallows its own errors, so it can never change production behaviour.
 *
 * ── What this validates (task 5C-B) ──────────────────────────────────────────
 * For each Firestore timeout, compare:
 *   - order id
 *   - driver uid
 *   - dispatchTimeoutAt
 *   - offer expiry
 *   - timeout eligibility
 *   - return-to-pool eligibility
 * reproducing the future PG timeout decision from:
 *   - order status
 *   - offer status
 *   - expires_at
 *   - dispatch_timeout_at
 *
 * ── Why the timeout LOGIC, not the racey mirror status ───────────────────────
 * returnToPool fires two best-effort PG shadow WRITES immediately after the
 * Firestore reset commits: pgTimeoutOffer (offer status pending → timed_out) and
 * pgShadowSetStatus(searching) (order status dispatched → searching). This
 * validator is kicked off as `void` in the same block, so it races those writes
 * and may observe either the pre- or post-write status. Crucially, NEITHER write
 * touches the timeout VALUES — pgTimeoutOffer leaves order_offers.expires_at
 * intact and pgShadowSetStatus(searching) leaves orders.dispatch_timeout_at
 * intact — so the values we compare are stable. Only the two status fields flip.
 *
 * We therefore reproduce the timeout DECISION from the stable expiry values and
 * tolerate the known post-write status transitions in the LIVE path
 * (normalizeForLive): an order status of "searching" is tolerated alongside
 * "dispatched", and an offer status of "timed_out" is normalized back to its
 * active state, because in shadow mode the ONLY thing that can set an offer to
 * timed_out is this same returnToPool write — never an independent PG poller.
 * The pure comparator (compareTimeout) stays strict so the verification harness
 * can exercise every diff reason, including "already timed out".
 */

import { and, eq } from "drizzle-orm";
import { db, orderOffersTable, ordersTable } from "@workspace/db";
import { logger } from "./logger";

// Mirror of round-robin-dispatcher.ts DISPATCH_TIMEOUT_SECONDS. Keep in sync.
const DISPATCH_TIMEOUT_SECONDS = 60;

// Order statuses from which a timeout / return-to-pool is valid. Firestore times
// out from "dispatched"; by the time this runs it may already be reset to
// "searching" by the fire-and-forget shadow write, so both are tolerated.
const ELIGIBLE_ORDER_STATUSES = new Set(["dispatched", "searching"]);

// Offer status that means the offer is still live and can legitimately time out.
const ACTIVE_OFFER_STATUS = "pending";

// Allowed skew (ms) between the Firestore timeout value and the PG-reproduced
// timeout/expiry value. Both are `assignTime + DISPATCH_TIMEOUT_SECONDS` written
// a few ms apart in separate stores, so a small tolerance is expected.
const TIMEOUT_TOLERANCE_MS = 5_000;

// ─── Pure types ───────────────────────────────────────────────────────────────

/** The authoritative Firestore timeout event, captured the moment it commits. */
export interface FsTimeout {
  /** The order Firestore returned to the pool. */
  orderId: string;
  /** The driver whose dispatch timed out (captured before driverUid is nulled). */
  driverUid: string;
  /** Firestore dispatchTimeoutAt at timeout, epoch ms (value before delete). */
  dispatchTimeoutAtMs: number;
  /** Firestore decided the dispatch elapsed → always true at the call site. */
  eligible: boolean;
  /** Firestore reset the order to "searching" → always true at the call site. */
  returnedToPool: boolean;
}

/** PG inputs needed to reproduce + guard a timeout for one (order, driver). */
export interface PgTimeoutInputs {
  /** The order these inputs were read for. */
  orderId: string;
  /** Whether the PG orders row exists. */
  orderExists: boolean;
  /** orders.status (null when the row is absent). */
  orderStatus: string | null;
  /** orders.dispatch_timeout_at, epoch ms (null if unset). */
  orderDispatchTimeoutAtMs: number | null;
  /** Whether the timed-out driver's order_offers row exists. */
  offerExists: boolean;
  /** order_offers.driver_uid as stored in PG (null when the offer is absent). */
  offerDriverUid: string | null;
  /** order_offers.status for the driver (null when absent). */
  offerStatus: string | null;
  /** The driver's offer expires_at, epoch ms (null if absent). */
  offerExpiresAtMs: number | null;
  /** Comparison clock (epoch ms). */
  nowMs: number;
}

export type ShadowOutcome = "match" | "diff";

export interface TimeoutDetail {
  fsOrderId: string;
  pgOrderId: string;
  fsDriver: string;
  pgOfferDriver: string | null;
  fsDispatchTimeoutAtMs: number;
  pgDispatchTimeoutAtMs: number | null;
  pgOfferExpiresAtMs: number | null;
  dispatchTimeoutDeltaMs: number | null;
  offerExpiryDeltaMs: number | null;
  orderStatus: string | null;
  offerStatus: string | null;
  fsEligible: boolean;
  pgEligible: boolean;
  fsReturnToPool: boolean;
  pgReturnToPool: boolean;
  guardReason?: string;
}

export interface TimeoutResult {
  outcome: ShadowOutcome;
  pgEligible: boolean;
  reason?: string;
  detail: TimeoutDetail;
}

// ─── Pure logic ─────────────────────────────────────────────────────────────

/**
 * Reproduce the guarded PG timeout decision a future PG-authoritative timeout
 * poller would make. A poller scans dispatched orders whose dispatch deadline
 * has elapsed and returns them to the pool, timing out the offer. Pure.
 *
 * Guards (in order): order present + dispatch-eligible → offer present →
 * offer still active (not accepted / rejected / already timed out) → expired.
 */
export function evaluatePgTimeout(
  pg: PgTimeoutInputs,
): { eligible: boolean; returnToPool: boolean; reason?: string } {
  const blocked = (reason: string) => ({ eligible: false, returnToPool: false, reason });

  // 1. order present and in a state the timeout poller acts on.
  if (!pg.orderExists) return blocked("order missing in PG");
  if (pg.orderStatus !== null && !ELIGIBLE_ORDER_STATUSES.has(pg.orderStatus)) {
    return blocked("order not eligible");
  }

  // 2. offer for this driver must exist to be timed out.
  if (!pg.offerExists) return blocked("missing offer");

  // 3. offer must still be live — terminal states are not re-timed-out.
  if (pg.offerStatus === "accepted") return blocked("already accepted");
  if (pg.offerStatus === "rejected") return blocked("already rejected");
  if (pg.offerStatus === "timed_out") return blocked("already timed out");
  if (pg.offerStatus !== null && pg.offerStatus !== ACTIVE_OFFER_STATUS) {
    return blocked("offer not active");
  }

  // 4. the ORDER dispatch deadline must have elapsed. This is the actual trigger
  //    a future PG timeout poller uses (index orders_dispatched_timeout_idx on
  //    status + dispatch_timeout_at): SELECT … WHERE status dispatched AND
  //    dispatch_timeout_at <= now. dispatch_timeout_at therefore drives the
  //    DECISION, not merely a compared value.
  if (pg.orderDispatchTimeoutAtMs === null) return blocked("dispatch timeout missing");
  if (pg.orderDispatchTimeoutAtMs > pg.nowMs) return blocked("not yet expired");

  // 5. the offer's own expiry must also have elapsed (corroborates the order
  //    deadline; both stores hold assignTime + DISPATCH_TIMEOUT_SECONDS).
  if (!(pg.offerExpiresAtMs !== null && pg.offerExpiresAtMs <= pg.nowMs)) {
    return blocked("not yet expired");
  }

  // PG would time the offer out AND return the order to the pool.
  return { eligible: true, returnToPool: true };
}

/**
 * Compare the authoritative Firestore timeout against an independently
 * reproduced + guarded PG timeout. Pure — takes already-fetched inputs.
 */
export function compareTimeout(fs: FsTimeout, pg: PgTimeoutInputs): TimeoutResult {
  const guards = evaluatePgTimeout(pg);

  const dispatchTimeoutDeltaMs =
    pg.orderDispatchTimeoutAtMs !== null
      ? fs.dispatchTimeoutAtMs - pg.orderDispatchTimeoutAtMs
      : null;
  const offerExpiryDeltaMs =
    pg.offerExpiresAtMs !== null ? fs.dispatchTimeoutAtMs - pg.offerExpiresAtMs : null;

  const orderIdMatch = fs.orderId === pg.orderId;
  // PG must hold the offer for the SAME driver Firestore timed out, compared
  // against the driver_uid actually stored on the PG offer row.
  const driverMatch = pg.offerDriverUid !== null && pg.offerDriverUid === fs.driverUid;
  const dispatchTimeoutMatch =
    dispatchTimeoutDeltaMs !== null && Math.abs(dispatchTimeoutDeltaMs) <= TIMEOUT_TOLERANCE_MS;
  const offerExpiryMatch =
    offerExpiryDeltaMs !== null && Math.abs(offerExpiryDeltaMs) <= TIMEOUT_TOLERANCE_MS;
  const eligibilityMatch = guards.eligible === fs.eligible;
  const returnToPoolMatch = guards.returnToPool === fs.returnedToPool;

  const detail: TimeoutDetail = {
    fsOrderId:               fs.orderId,
    pgOrderId:               pg.orderId,
    fsDriver:                fs.driverUid,
    pgOfferDriver:           pg.offerDriverUid,
    fsDispatchTimeoutAtMs:   fs.dispatchTimeoutAtMs,
    pgDispatchTimeoutAtMs:   pg.orderDispatchTimeoutAtMs,
    pgOfferExpiresAtMs:      pg.offerExpiresAtMs,
    dispatchTimeoutDeltaMs,
    offerExpiryDeltaMs,
    orderStatus:             pg.orderStatus,
    offerStatus:             pg.offerStatus,
    fsEligible:              fs.eligible,
    pgEligible:              guards.eligible,
    fsReturnToPool:          fs.returnedToPool,
    pgReturnToPool:          guards.returnToPool,
    guardReason:             guards.reason,
  };

  if (
    orderIdMatch &&
    guards.eligible &&
    driverMatch &&
    dispatchTimeoutMatch &&
    offerExpiryMatch &&
    eligibilityMatch &&
    returnToPoolMatch
  ) {
    return { outcome: "match", pgEligible: guards.eligible, detail };
  }

  // Diff — most fundamental reason first. Order identity outranks everything; a
  // failed guard then outranks value/eligibility diffs.
  let reason: string;
  if (!orderIdMatch) {
    reason = "order id mismatch";
  } else if (!guards.eligible) {
    reason = guards.reason!;
  } else if (!driverMatch) {
    reason = pg.offerDriverUid === null ? "missing offer" : "driver uid mismatch";
  } else if (!dispatchTimeoutMatch) {
    reason = "dispatch timeout value mismatch";
  } else if (!offerExpiryMatch) {
    reason = "offer expiry value mismatch";
  } else if (!eligibilityMatch) {
    reason = "timeout eligibility mismatch";
  } else if (!returnToPoolMatch) {
    reason = "return-to-pool eligibility mismatch";
  } else {
    reason = "other";
  }

  return { outcome: "diff", pgEligible: guards.eligible, reason, detail };
}

// ─── PG inputs reader (READ-ONLY) ──────────────────────────────────────────────

/** Read the PG state needed to reproduce + guard a timeout for one (order, driver). */
export async function readPgTimeoutInputs(
  orderId:   string,
  driverUid: string,
): Promise<PgTimeoutInputs> {
  const nowMs = Date.now();

  const orderRows = await db
    .select({
      status:           ordersTable.status,
      dispatchTimeoutAt: ordersTable.dispatchTimeoutAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const orderExists = orderRows.length > 0;
  const orderStatus = orderRows[0]?.status ?? null;
  const orderDispatchTimeoutAtMs = orderRows[0]?.dispatchTimeoutAt
    ? orderRows[0].dispatchTimeoutAt.getTime()
    : null;

  const offerRows = await db
    .select({
      driverUid: orderOffersTable.driverUid,
      status:    orderOffersTable.status,
      expiresAt: orderOffersTable.expiresAt,
    })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.orderId, orderId),
        eq(orderOffersTable.driverUid, driverUid),
      ),
    )
    .limit(1);

  const offerExists = offerRows.length > 0;
  const offerDriverUid = offerRows[0]?.driverUid ?? null;
  const offerStatus = offerRows[0]?.status ?? null;
  const offerExpiresAtMs = offerRows[0]?.expiresAt ? offerRows[0].expiresAt.getTime() : null;

  return {
    orderId,
    orderExists,
    orderStatus,
    orderDispatchTimeoutAtMs,
    offerExists,
    offerDriverUid,
    offerStatus,
    offerExpiresAtMs,
    nowMs,
  };
}

/**
 * Normalize the two known shadow-write race transitions before comparing in the
 * LIVE path. Firestore has already authoritatively timed out this driver, so:
 *   - an offer status of "timed_out" is the pgTimeoutOffer shadow write catching
 *     up (never an independent PG timeout in shadow mode) → treat as active.
 *   - an order status of "searching" is already tolerated by the guard.
 * The pure comparator stays strict; this lenience lives only in the live path.
 */
function normalizeForLive(raw: PgTimeoutInputs): PgTimeoutInputs {
  if (raw.offerStatus === "timed_out") {
    return { ...raw, offerStatus: ACTIVE_OFFER_STATUS };
  }
  return raw;
}

// ─── Live entry point (fire-and-forget; never throw) ───────────────────────────

/**
 * Shadow-validate one Firestore timeout. READ-ONLY.
 * Call as `void pgTimeoutShadowValidate(...)` after returnToPool commits.
 */
export async function pgTimeoutShadowValidate(orderId: string, fs: FsTimeout): Promise<void> {
  try {
    const raw    = await readPgTimeoutInputs(orderId, fs.driverUid);
    const inputs = normalizeForLive(raw);
    const result = compareTimeout(fs, inputs);

    if (result.outcome === "match") {
      logger.info(
        { orderId, firestoreDriver: fs.driverUid, pgEligible: result.pgEligible },
        "[PG_TIMEOUT_MATCH]",
      );
    } else {
      logger.warn(
        {
          orderId,
          ...result.detail,
          firestoreDriver: fs.driverUid,
          reason:          result.reason,
        },
        "[PG_TIMEOUT_DIFF]",
      );
    }
  } catch (err) {
    logger.error({ err, orderId }, "[PG_TIMEOUT_ERROR]");
  }
}

export { DISPATCH_TIMEOUT_SECONDS };
