/**
 * PostgreSQL FCM Claim Shadow Validator  (Phase 5C-C — FCM CLAIM SHADOW)
 *
 * READ-ONLY. This module NEVER writes to Firestore or PostgreSQL, NEVER sends
 * FCM, NEVER claims a dispatch, NEVER modifies orders. For every authoritative
 * Firestore FCM claim/send decision it independently reproduces the *guarded PG
 * claim logic* a future PG-authoritative FCM dispatcher would run, compares the
 * reproduced decision against the Firestore claim, and logs the verdict
 * (MATCH / DIFF / ERROR).
 *
 * Firestore (fcm-dispatcher.ts) remains the ONLY component that claims the FCM
 * dispatch slot, sends push, and writes fcmDispatchClaimedAt / _By / fcmMessageId.
 * Every entry point here is fire-and-forget and swallows its own errors, so it
 * can never change production behaviour.
 *
 * ── What this validates (task 5C-C) ──────────────────────────────────────────
 * For each Firestore FCM claim/send, compare:
 *   - order id
 *   - claim status
 *   - claimed at
 *   - claimed by
 *   - fcm message id
 *   - active offer driver uids
 *   - target driver uid
 *   - token present / missing
 * reproducing the future PG claim decision from:
 *   - orders.status
 *   - active_offer_driver_uids
 *   - fcm_dispatch_claimed_at
 *   - fcm_dispatch_claimed_by
 *   - fcm_message_id
 *   - drivers.fcm_token
 *
 * ── Why the claim LOGIC, not the racey/unmirrored claim row ──────────────────
 * Firestore's claim/send writes (fcmDispatchClaimedAt/_By, fcmMessageId) are NOT
 * live-mirrored into PG in shadow mode — only the one-time backfill script
 * populates orders.fcm_dispatch_claimed_* / fcm_message_id. The live-authoritative
 * PG source for the offer target set is the order_offers table (Phase-2 model),
 * NOT orders.active_offer_driver_uids (a legacy/backfill column). So for a FRESH
 * live claim, PG's claim-result fields are null (never written): that is the
 * EXPECTED unmirrored state, not a real disagreement.
 *
 * We therefore reproduce the claim DECISION from the stable PG inputs (order
 * status, the live order_offers target set, the prior-claim guard, the target's
 * PG token) and, in the LIVE path (normalizeForLive), fill null claim-result
 * fields from the authoritative Firestore values so they do not false-diff. The
 * pure comparator (compareClaim) stays strict so the verification harness can
 * exercise every diff reason, including mismatched claimedBy / messageId.
 *
 * The token dimension is the live-meaningful readiness signal: PG is only ready
 * to own FCM when the target driver's token lives in PG (drivers.fcm_token). A
 * token resolvable only via the Firestore fallback ("firestore token fallback")
 * or missing entirely ("pg token missing") is surfaced as a DIFF.
 */

import { and, eq } from "drizzle-orm";
import { db, driversTable, orderOffersTable, ordersTable } from "@workspace/db";
import { logger } from "./logger";

// Order status the FCM dispatcher acts on. Firestore's listener fires only on
// orders with status "dispatched"; a PG-authoritative claimer would do the same.
const CLAIMABLE_ORDER_STATUS = "dispatched";

// order_offers.status that means the offer is a live target for this dispatch.
const ACTIVE_OFFER_STATUS = "pending";

// Allowed skew (ms) between the Firestore claimedAt and the PG-mirrored claimedAt.
const CLAIM_TOLERANCE_MS = 5_000;

// ─── Pure types ───────────────────────────────────────────────────────────────

/** The authoritative Firestore FCM claim/send event, captured when it commits. */
export interface FsClaim {
  /** The order Firestore claimed + sent FCM for. */
  orderId: string;
  /** Firestore won the claim → always true at the live call site. */
  claimed: boolean;
  /** fcmDispatchClaimedBy written by Firestore (this instance's id). */
  claimedBy: string | null;
  /** fcmDispatchClaimedAt, epoch ms (claim moment). */
  claimedAtMs: number | null;
  /** fcmMessageId for the target driver (null when the send failed). */
  messageId: string | null;
  /** The full activeOfferDriverUids target set Firestore dispatched to. */
  activeOfferDriverUids: string[];
  /** The specific target driver this validation focuses on. */
  targetDriverUid: string;
  /** Whether Firestore resolved a usable token (PG-first, Firestore-fallback). */
  tokenPresent: boolean;
}

/** PG inputs needed to reproduce + guard a claim for one (order, target driver). */
export interface PgClaimInputs {
  /** The order these inputs were read for. */
  orderId: string;
  /** Whether the PG orders row exists. */
  orderExists: boolean;
  /** orders.status (null when the row is absent). */
  orderStatus: string | null;
  /**
   * The live offer target set: order_offers rows with status "pending" when
   * present, else the legacy orders.active_offer_driver_uids column. Null when
   * neither source has a target set.
   */
  activeOfferDriverUids: string[] | null;
  /** The target driver being validated. */
  targetDriverUid: string;
  /**
   * Whether PG already holds a claim for this order (fcm_dispatch_claimed_at OR
   * fcm_message_id non-null at read time). Drives the "already claimed" guard;
   * kept separate from the result-comparison fields so normalizeForLive can fill
   * those without corrupting eligibility.
   */
  priorClaimPresent: boolean;
  /** orders.fcm_dispatch_claimed_at, epoch ms (null if unset) — result compare. */
  claimedAtMs: number | null;
  /** orders.fcm_dispatch_claimed_by (null if unset) — result compare. */
  claimedBy: string | null;
  /** orders.fcm_message_id (null if unset) — result compare. */
  messageId: string | null;
  /** Whether drivers.fcm_token is present + non-empty for the target driver. */
  pgTokenPresent: boolean;
  /** Comparison clock (epoch ms). */
  nowMs: number;
}

export type ClaimOutcome = "match" | "diff";

/** How the target driver's push token would resolve under PG authority. */
export type TokenOutcome = "pg_hit" | "fs_fallback" | "missing";

export interface ClaimDetail {
  fsOrderId: string;
  pgOrderId: string;
  fsClaimedBy: string | null;
  pgClaimedBy: string | null;
  fsClaimedAtMs: number | null;
  pgClaimedAtMs: number | null;
  claimedAtDeltaMs: number | null;
  fsMessageId: string | null;
  pgMessageId: string | null;
  fsActiveOffer: string[];
  pgActiveOffer: string[] | null;
  fsTargetDriver: string;
  pgTargetDriver: string;
  fsTokenPresent: boolean;
  pgTokenPresent: boolean;
  tokenOutcome: TokenOutcome;
  orderStatus: string | null;
  priorClaimPresent: boolean;
  fsClaimed: boolean;
  pgClaimEligible: boolean;
  guardReason?: string;
}

export interface ClaimResult {
  outcome: ClaimOutcome;
  pgClaimEligible: boolean;
  tokenOutcome: TokenOutcome;
  reason?: string;
  detail: ClaimDetail;
}

// ─── Pure logic ─────────────────────────────────────────────────────────────

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  for (const x of a) if (!sb.has(x)) return false;
  return true;
}

/** Resolve how the target driver's token would resolve under PG authority. */
export function resolveTokenOutcome(fs: FsClaim, pg: PgClaimInputs): TokenOutcome {
  if (pg.pgTokenPresent) return "pg_hit";          // PG owns the token → ready.
  if (fs.tokenPresent) return "fs_fallback";       // token only in Firestore.
  return "missing";                                // no token in either store.
}

/**
 * Reproduce the guarded PG claim decision a future PG-authoritative FCM
 * dispatcher would make. Pure. It claims an order IFF the order exists, is
 * "dispatched", has a live target set that includes the target driver, and has
 * NOT already been claimed.
 *
 * The "already claimed" block is reported as non-structural so the comparator
 * can still surface a more specific claimedBy / messageId divergence first.
 */
export function evaluatePgClaim(
  pg: PgClaimInputs,
): { claimEligible: boolean; reason?: string; structural: boolean } {
  // 1. structural pre-claim guards.
  if (!pg.orderExists) return { claimEligible: false, reason: "order missing in PG", structural: true };
  if (pg.orderStatus !== CLAIMABLE_ORDER_STATUS) {
    return { claimEligible: false, reason: "order not dispatched", structural: true };
  }
  if (pg.activeOfferDriverUids === null || pg.activeOfferDriverUids.length === 0) {
    return { claimEligible: false, reason: "no target drivers", structural: true };
  }
  if (!pg.activeOfferDriverUids.includes(pg.targetDriverUid)) {
    return { claimEligible: false, reason: "target not in active offer", structural: true };
  }

  // 2. claim guard — a prior claim makes PG skip (idempotency / duplicate guard).
  if (pg.priorClaimPresent) {
    return { claimEligible: false, reason: "already claimed", structural: false };
  }

  // PG would claim the dispatch slot for this order.
  return { claimEligible: true, structural: false };
}

/**
 * Compare the authoritative Firestore FCM claim against an independently
 * reproduced + guarded PG claim. Pure — takes already-fetched inputs.
 */
export function compareClaim(fs: FsClaim, pg: PgClaimInputs): ClaimResult {
  const guards = evaluatePgClaim(pg);
  const tokenOutcome = resolveTokenOutcome(fs, pg);

  const orderIdMatch = fs.orderId === pg.orderId;
  const activeOfferMatch = setEqual(fs.activeOfferDriverUids, pg.activeOfferDriverUids ?? []);
  const targetMatch = fs.targetDriverUid === pg.targetDriverUid;
  const claimedByMatch = fs.claimedBy === pg.claimedBy;
  const messageIdMatch = fs.messageId === pg.messageId;
  const claimedAtDeltaMs =
    fs.claimedAtMs !== null && pg.claimedAtMs !== null ? fs.claimedAtMs - pg.claimedAtMs : null;
  const claimedAtMatch =
    (fs.claimedAtMs === null && pg.claimedAtMs === null) ||
    (claimedAtDeltaMs !== null && Math.abs(claimedAtDeltaMs) <= CLAIM_TOLERANCE_MS);
  const claimStatusMatch = guards.claimEligible === fs.claimed;

  const detail: ClaimDetail = {
    fsOrderId:         fs.orderId,
    pgOrderId:         pg.orderId,
    fsClaimedBy:       fs.claimedBy,
    pgClaimedBy:       pg.claimedBy,
    fsClaimedAtMs:     fs.claimedAtMs,
    pgClaimedAtMs:     pg.claimedAtMs,
    claimedAtDeltaMs,
    fsMessageId:       fs.messageId,
    pgMessageId:       pg.messageId,
    fsActiveOffer:     fs.activeOfferDriverUids,
    pgActiveOffer:     pg.activeOfferDriverUids,
    fsTargetDriver:    fs.targetDriverUid,
    pgTargetDriver:    pg.targetDriverUid,
    fsTokenPresent:    fs.tokenPresent,
    pgTokenPresent:    pg.pgTokenPresent,
    tokenOutcome,
    orderStatus:       pg.orderStatus,
    priorClaimPresent: pg.priorClaimPresent,
    fsClaimed:         fs.claimed,
    pgClaimEligible:   guards.claimEligible,
    guardReason:       guards.reason,
  };

  if (
    orderIdMatch &&
    guards.claimEligible &&
    claimStatusMatch &&
    activeOfferMatch &&
    targetMatch &&
    tokenOutcome === "pg_hit" &&
    claimedByMatch &&
    messageIdMatch &&
    claimedAtMatch
  ) {
    return { outcome: "match", pgClaimEligible: guards.claimEligible, tokenOutcome, detail };
  }

  // Diff — most fundamental reason first. Order identity outranks everything; a
  // structural guard outranks set/target/token; a specific claim-identity
  // divergence (claimedBy / messageId / claimedAt) outranks the generic
  // "already claimed" skip so a real mirror disagreement is never masked.
  let reason: string;
  if (!orderIdMatch) {
    reason = "order id mismatch";
  } else if (guards.structural) {
    reason = guards.reason!; // order missing in PG / order not dispatched / no target drivers / target not in active offer
  } else if (!activeOfferMatch) {
    reason = "active offer list mismatch";
  } else if (!targetMatch) {
    reason = "target driver mismatch";
  } else if (tokenOutcome === "missing") {
    reason = "pg token missing";
  } else if (tokenOutcome === "fs_fallback") {
    reason = "firestore token fallback";
  } else if (!claimedByMatch) {
    reason = "claimed by mismatch";
  } else if (!messageIdMatch) {
    reason = "message id mismatch";
  } else if (!claimedAtMatch) {
    reason = "claimed at mismatch";
  } else if (pg.priorClaimPresent) {
    reason = "already claimed";
  } else if (!claimStatusMatch) {
    reason = "claim status mismatch";
  } else {
    reason = "other";
  }

  return { outcome: "diff", pgClaimEligible: guards.claimEligible, tokenOutcome, reason, detail };
}

// ─── PG inputs reader (READ-ONLY) ──────────────────────────────────────────────

/** Read the PG state needed to reproduce + guard a claim for one (order, driver). */
export async function readPgClaimInputs(
  orderId:         string,
  targetDriverUid: string,
): Promise<PgClaimInputs> {
  const nowMs = Date.now();

  const orderRows = await db
    .select({
      status:                ordersTable.status,
      activeOfferDriverUids: ordersTable.activeOfferDriverUids,
      fcmDispatchClaimedAt:  ordersTable.fcmDispatchClaimedAt,
      fcmDispatchClaimedBy:  ordersTable.fcmDispatchClaimedBy,
      fcmMessageId:          ordersTable.fcmMessageId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const orderExists = orderRows.length > 0;
  const orderStatus = orderRows[0]?.status ?? null;
  const claimedAtMs = orderRows[0]?.fcmDispatchClaimedAt
    ? orderRows[0].fcmDispatchClaimedAt.getTime()
    : null;
  const claimedBy = orderRows[0]?.fcmDispatchClaimedBy ?? null;
  const messageId = orderRows[0]?.fcmMessageId ?? null;
  const legacyOfferUids = orderRows[0]?.activeOfferDriverUids ?? null;

  // Live-authoritative target set: order_offers pending rows (Phase-2 model).
  const offerRows = await db
    .select({ driverUid: orderOffersTable.driverUid })
    .from(orderOffersTable)
    .where(
      and(
        eq(orderOffersTable.orderId, orderId),
        eq(orderOffersTable.status, ACTIVE_OFFER_STATUS),
      ),
    );
  const pendingUids = offerRows.map((r) => r.driverUid);

  // Prefer the live order_offers set; fall back to the legacy backfilled column.
  const activeOfferDriverUids =
    pendingUids.length > 0 ? pendingUids : legacyOfferUids;

  const driverRows = await db
    .select({ fcmToken: driversTable.fcmToken })
    .from(driversTable)
    .where(eq(driversTable.uid, targetDriverUid))
    .limit(1);
  const pgToken = driverRows[0]?.fcmToken;
  const pgTokenPresent = typeof pgToken === "string" && pgToken.length > 0;

  return {
    orderId,
    orderExists,
    orderStatus,
    activeOfferDriverUids,
    targetDriverUid,
    priorClaimPresent: claimedAtMs !== null || messageId !== null,
    claimedAtMs,
    claimedBy,
    messageId,
    pgTokenPresent,
    nowMs,
  };
}

/**
 * Normalize the known shadow gap before comparing in the LIVE path. Firestore's
 * claim/send results are NOT live-mirrored into PG (only backfilled), so for a
 * fresh live claim PG's claim-result fields are null — the expected unmirrored
 * state, not a disagreement. Fill them from the authoritative Firestore values
 * so they do not false-diff, WITHOUT touching priorClaimPresent (so the
 * "already claimed" guard still reflects PG's true prior state) or the
 * live-meaningful active-offer / token signals.
 *
 * The pure comparator stays strict; this lenience lives only in the live path.
 */
function normalizeForLive(raw: PgClaimInputs, fs: FsClaim): PgClaimInputs {
  if (raw.priorClaimPresent) return raw; // PG holds a real claim — compare strictly.
  return {
    ...raw,
    claimedAtMs: raw.claimedAtMs ?? fs.claimedAtMs,
    claimedBy:   raw.claimedBy ?? fs.claimedBy,
    messageId:   raw.messageId ?? fs.messageId,
  };
}

// ─── Live entry point (fire-and-forget; never throw) ───────────────────────────

/**
 * Shadow-validate one Firestore FCM claim/send decision for one target driver.
 * READ-ONLY. Call as `void pgClaimShadowValidate(...)` after the Firestore
 * claim + send have committed.
 */
export async function pgClaimShadowValidate(orderId: string, fs: FsClaim): Promise<void> {
  try {
    const raw    = await readPgClaimInputs(orderId, fs.targetDriverUid);
    const inputs = normalizeForLive(raw, fs);
    const result = compareClaim(fs, inputs);

    if (result.outcome === "match") {
      logger.info(
        {
          orderId,
          targetDriver:    fs.targetDriverUid,
          pgClaimEligible: result.pgClaimEligible,
          tokenOutcome:    result.tokenOutcome,
        },
        "[PG_CLAIM_MATCH]",
      );
    } else {
      logger.warn(
        {
          orderId,
          ...result.detail,
          targetDriver: fs.targetDriverUid,
          reason:       result.reason,
        },
        "[PG_CLAIM_DIFF]",
      );
    }
  } catch (err) {
    logger.error({ err, orderId }, "[PG_CLAIM_ERROR]");
  }
}
