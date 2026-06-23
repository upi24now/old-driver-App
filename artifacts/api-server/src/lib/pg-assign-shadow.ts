/**
 * PostgreSQL Assignment Shadow Validator  (Phase 5C-A — ASSIGNMENT SHADOW)
 *
 * READ-ONLY. This module NEVER writes to Firestore, PostgreSQL, or order state,
 * never sends FCM, never assigns drivers. For every SUCCESSFUL Firestore
 * assignment it independently reproduces the *guarded PG assignment logic* a
 * future PG-authoritative dispatcher would run, compares the resulting
 * assignment against the authoritative Firestore assignment, and logs the
 * verdict (MATCH / DIFF / ERROR).
 *
 * Firestore (round-robin-dispatcher.ts) remains the ONLY component that assigns
 * drivers, updates orders, sends FCM, and handles timeout / accept / reject.
 * Every entry point here is fire-and-forget and swallows its own errors, so it
 * can never change production behaviour.
 *
 * ── What this validates (task 5C-A) ──────────────────────────────────────────
 * For each Firestore assignment, compare:
 *   - order id
 *   - assigned driver uid
 *   - rejected drivers
 *   - round-robin cursor
 *   - order status
 *   - timeout value
 * and reproduce the guarded PG assignment conditions required for a FUTURE PG
 * assignment:
 *   - status eligible
 *   - driver not already assigned
 *   - driver not rejected
 *   - timeout valid
 *
 * ── Why the assignment LOGIC, not the PG mirror row ──────────────────────────
 * The PG shadow order-mirror (pgUpsertOrder) runs fire-and-forget AFTER the
 * Firestore commit and mirrors the PRE-assignment order document, so the
 * persisted PG order row can momentarily carry a stale status / cursor /
 * timeout. Depending on that racey mirror would produce false diffs. Instead we
 * reproduce what a PG-authoritative assignment transaction WOULD decide from
 * stable PG inputs (online drivers, rejected_by, offer history) — exactly the
 * decision PG must make after cutover — and compare THAT to Firestore. The
 * order/offer rows are read only for the guard checks, and the guards tolerate
 * the mirror race (a poolable OR dispatched status, a null OR same-driver
 * assignment are both accepted).
 *
 * The round-robin cursor a PG assignment sets is its own chosen driver, so the
 * cursor comparison is `pgChosen === fs.cursor` (Firestore likewise sets
 * lastDispatchedDriverUid to the driver it chose).
 */

import { eq } from "drizzle-orm";
import { db, orderOffersTable, ordersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  readPgSnapshot,
  selectPgCandidate,
  type ShadowDriver,
} from "./pg-dispatch-shadow";

// Mirror of round-robin-dispatcher.ts DISPATCH_TIMEOUT_SECONDS. Keep in sync.
const DISPATCH_TIMEOUT_SECONDS = 60;

// The status a successful dispatch assignment produces.
const ASSIGNED_STATUS = "dispatched";

// Statuses from which an assignment is valid. We accept the just-written
// "dispatched" too so the guard tolerates the fire-and-forget mirror race.
const ASSIGNABLE_STATUSES = new Set(["searching", "pending", "dispatched"]);

// Allowed skew (ms) between the Firestore timeout and the PG-reproduced timeout.
// Both are `assignTime + DISPATCH_TIMEOUT_SECONDS`, computed a few ms apart in
// separate writes, so a small tolerance is expected and not a real difference.
const TIMEOUT_TOLERANCE_MS = 5_000;

// ─── Pure types ───────────────────────────────────────────────────────────────

/** The authoritative Firestore assignment, captured the moment it commits. */
export interface FsAssignment {
  /** The order Firestore assigned. */
  orderId: string;
  /** The driver Firestore assigned. */
  driverUid: string;
  /** order.rejectedBy[] at assignment time. */
  rejectedBy: string[];
  /** Post-assignment round-robin cursor (lastDispatchedDriverUid == driverUid). */
  cursor: string;
  /** Order status after assignment ("dispatched"). */
  status: string;
  /** Firestore dispatchTimeoutAt, epoch ms. */
  timeoutAtMs: number;
  /** Pre-dispatch round-robin cursor, used to reproduce PG selection. */
  lastUid: string | null;
  /** Count of drivers Firestore saw online (observability only). */
  onlineCount: number;
}

/** PG inputs needed to reproduce + guard a PG assignment for one order. */
export interface PgAssignmentInputs {
  /** The order these inputs were read for. */
  orderId: string;
  /** Drivers with is_online == true (for selection). */
  onlineDrivers: ShadowDriver[];
  /** orders.rejected_by[]. */
  rejectedBy: string[];
  /** Driver uids with a 'rejected' order_offers row for this order. */
  offerHistoryRejected: string[];
  /** Whether the PG orders row exists. */
  orderExists: boolean;
  /** orders.status (null when the row is absent). */
  orderStatus: string | null;
  /** orders.driver_uid (null when unassigned). */
  orderDriverUid: string | null;
  /** True if any DIFFERENT driver already holds an 'accepted' offer. */
  acceptedByOther: boolean;
  /** Whether the assigned driver's order_offers row exists. */
  offerExists: boolean;
  /** The assigned driver's offer expires_at, epoch ms (null if absent). */
  offerExpiresAtMs: number | null;
  /** Comparison clock (epoch ms). */
  nowMs: number;
}

export type ShadowOutcome = "match" | "diff";

export interface AssignDetail {
  fsOrderId: string;
  pgOrderId: string;
  fsDriver: string;
  pgDriver: string | null;
  fsCursor: string;
  pgCursor: string | null;
  fsStatus: string;
  pgStatus: string;
  fsRejected: string[];
  pgRejected: string[];
  fsTimeoutAtMs: number;
  pgTimeoutAtMs: number;
  timeoutDeltaMs: number;
  guardEligible: boolean;
  guardReason?: string;
}

export interface AssignResult {
  outcome: ShadowOutcome;
  pgDriver: string | null;
  reason?: string;
  detail: AssignDetail;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * Reproduce the guarded PG assignment conditions a future PG-authoritative
 * dispatcher must satisfy before committing an assignment. Pure.
 *
 * Guards (in order): status eligible → driver not already assigned →
 * driver not rejected → timeout valid.
 */
export function evaluateAssignmentGuards(
  fs: FsAssignment,
  pg: PgAssignmentInputs,
): { eligible: boolean; reason?: string } {
  // 1. status eligible — order present and in an assignable status.
  if (!pg.orderExists) return { eligible: false, reason: "order missing in PG" };
  if (pg.orderStatus !== null && !ASSIGNABLE_STATUSES.has(pg.orderStatus)) {
    return { eligible: false, reason: "status not eligible" };
  }

  // 2. driver not already assigned — no other driver holds the order.
  if (pg.acceptedByOther) return { eligible: false, reason: "driver already assigned" };
  if (pg.orderDriverUid !== null && pg.orderDriverUid !== fs.driverUid) {
    return { eligible: false, reason: "driver already assigned" };
  }

  // 3. driver not rejected — neither in rejected_by[] nor in offer history.
  if (pg.rejectedBy.includes(fs.driverUid) || pg.offerHistoryRejected.includes(fs.driverUid)) {
    return { eligible: false, reason: "driver rejected" };
  }

  // 4. timeout valid — the assignment's timeout window is still in the future.
  if (!(fs.timeoutAtMs > pg.nowMs)) return { eligible: false, reason: "timeout invalid" };

  return { eligible: true };
}

/**
 * Compare the authoritative Firestore assignment against an independently
 * reproduced + guarded PG assignment. Pure — takes already-fetched inputs.
 */
export function compareAssignment(fs: FsAssignment, pg: PgAssignmentInputs): AssignResult {
  // Reproduce the PG selection using the pre-dispatch cursor (same as the
  // dispatch shadow — see pg-dispatch-shadow.ts cursor note).
  const { chosen: pgChosen } = selectPgCandidate(
    pg.onlineDrivers,
    pg.rejectedBy,
    fs.lastUid,
    pg.nowMs,
  );

  const guards = evaluateAssignmentGuards(fs, pg);

  // A PG assignment would set expires_at = now + DISPATCH_TIMEOUT_SECONDS; when
  // the mirrored offer row is already present, prefer its actual value.
  const pgTimeoutAtMs =
    pg.offerExpiresAtMs ?? pg.nowMs + DISPATCH_TIMEOUT_SECONDS * 1000;

  const driverMatch   = pgChosen === fs.driverUid;
  // A PG assignment advances the cursor to the driver it chose.
  const cursorMatch   = pgChosen === fs.cursor;
  const statusMatch   = fs.status === ASSIGNED_STATUS;
  const rejectedMatch = setEquals(fs.rejectedBy, pg.rejectedBy);
  const timeoutDeltaMs = fs.timeoutAtMs - pgTimeoutAtMs;
  const timeoutMatch  = Math.abs(timeoutDeltaMs) <= TIMEOUT_TOLERANCE_MS;

  const detail: AssignDetail = {
    fsOrderId:      fs.orderId,
    pgOrderId:      pg.orderId,
    fsDriver:       fs.driverUid,
    pgDriver:       pgChosen,
    fsCursor:       fs.cursor,
    pgCursor:       pgChosen,
    fsStatus:       fs.status,
    pgStatus:       ASSIGNED_STATUS,
    fsRejected:     [...fs.rejectedBy].sort(),
    pgRejected:     [...pg.rejectedBy].sort(),
    fsTimeoutAtMs:  fs.timeoutAtMs,
    pgTimeoutAtMs,
    timeoutDeltaMs,
    guardEligible:  guards.eligible,
    guardReason:    guards.reason,
  };

  const orderIdMatch = fs.orderId === pg.orderId;

  if (
    orderIdMatch &&
    guards.eligible &&
    driverMatch &&
    cursorMatch &&
    statusMatch &&
    rejectedMatch &&
    timeoutMatch
  ) {
    return { outcome: "match", pgDriver: pgChosen, detail };
  }

  // Diff — most fundamental reason first. Order identity outranks everything;
  // a failed guard then outranks field diffs.
  let reason: string;
  if (!orderIdMatch) {
    reason = "order id mismatch";
  } else if (!guards.eligible) {
    reason = guards.reason!;
  } else if (!driverMatch) {
    reason = "assigned driver mismatch";
  } else if (!rejectedMatch) {
    reason = "rejected list mismatch";
  } else if (!cursorMatch) {
    reason = "round-robin cursor mismatch";
  } else if (!statusMatch) {
    reason = "order status mismatch";
  } else if (!timeoutMatch) {
    reason = "timeout value mismatch";
  } else {
    reason = "other";
  }

  return { outcome: "diff", pgDriver: pgChosen, reason, detail };
}

// ─── PG inputs reader (READ-ONLY) ──────────────────────────────────────────────

/** Read the PG state needed to reproduce + guard an assignment for one order. */
export async function readPgAssignmentInputs(
  orderId:   string,
  driverUid: string,
): Promise<PgAssignmentInputs> {
  // Driver pool + rejected_by + offer-history come from the shared snapshot.
  const snap = await readPgSnapshot(orderId);

  const orderRows = await db
    .select({
      status:    ordersTable.status,
      driverUid: ordersTable.driverUid,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  const orderExists    = orderRows.length > 0;
  const orderStatus    = orderRows[0]?.status ?? null;
  const orderDriverUid = orderRows[0]?.driverUid ?? null;

  const offerRows = await db
    .select({
      driverUid: orderOffersTable.driverUid,
      status:    orderOffersTable.status,
      expiresAt: orderOffersTable.expiresAt,
    })
    .from(orderOffersTable)
    .where(eq(orderOffersTable.orderId, orderId));

  const assignedOffer  = offerRows.find((r) => r.driverUid === driverUid);
  const acceptedByOther = offerRows.some(
    (r) => r.status === "accepted" && r.driverUid !== driverUid,
  );

  return {
    orderId,
    onlineDrivers:        snap.onlineDrivers,
    rejectedBy:           snap.rejectedBy,
    offerHistoryRejected: snap.offerHistoryRejected,
    orderExists,
    orderStatus,
    orderDriverUid,
    acceptedByOther,
    offerExists:          assignedOffer !== undefined,
    offerExpiresAtMs:     assignedOffer?.expiresAt ? assignedOffer.expiresAt.getTime() : null,
    nowMs:                Date.now(),
  };
}

// ─── Live entry point (fire-and-forget; never throw) ───────────────────────────

/**
 * Shadow-validate one Firestore assignment. READ-ONLY.
 * Call as `void pgShadowCompareAssignment(...)` after the FS assignment commits.
 */
export async function pgShadowCompareAssignment(
  orderId: string,
  fs:      FsAssignment,
): Promise<void> {
  try {
    const inputs = await readPgAssignmentInputs(orderId, fs.driverUid);
    const result = compareAssignment(fs, inputs);

    if (result.outcome === "match") {
      logger.info(
        { orderId, firestoreDriver: fs.driverUid, pgDriver: result.pgDriver },
        "[PG_ASSIGN_MATCH]",
      );
    } else {
      logger.warn(
        {
          orderId,
          ...result.detail,
          firestoreDriver: fs.driverUid,
          pgDriver:        result.pgDriver,
          reason:          result.reason,
        },
        "[PG_ASSIGN_DIFF]",
      );
    }
  } catch (err) {
    logger.error({ err, orderId }, "[PG_ASSIGN_ERROR]");
  }
}
