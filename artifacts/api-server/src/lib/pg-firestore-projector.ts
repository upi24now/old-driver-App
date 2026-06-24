/**
 * PG → Firestore Projector — Phase 5H-BRIDGE-3
 *
 * Drains the durable `dispatch_projections` outbox (written transactionally by
 * pg-dispatch-service.ts) and projects each committed PG dispatcher decision
 * into the Firestore order document that the existing Driver App, Customer App,
 * and Firestore FCM dispatcher already read.
 *
 * Design — "PG decides → project result to Firestore":
 *   - There is NO PG-native FCM path and NO app migration. The Firestore order
 *     doc stays the single thing the apps + FCM read; we just make the PG
 *     dispatcher's decision visible there.
 *   - Assignment projection writes the SAME fields the round-robin dispatcher
 *     writes (status=dispatched, driverUid, dispatchedAt/dispatchedToDriverAt,
 *     dispatchTimeoutAt, lastDispatchedDriverUid) and DELETES the four FCM guard
 *     fields, so the unchanged Firestore FCM dispatcher claims + sends for the
 *     new cycle. It additionally sets activeOfferDriverUids=[driverUid] (the
 *     Phase-2 explicit offer set, which equals the fcm-dispatcher's driverUid
 *     fallback target — identical FCM behaviour).
 *   - The PG FCM *claim* is intentionally NOT projected: doing so would pre-claim
 *     the order in Firestore and BLOCK the authoritative Firestore FCM dispatcher
 *     from sending. The Firestore FCM dispatcher performs its own claim.
 *
 * SAFETY (defense-in-depth):
 *   - Firestore writes happen ONLY when BOTH resolvePgProjectionEnabled() (strict
 *     PG_PROJECTION_ENABLED==="true") AND DISPATCH_SOURCE==="pg". Otherwise the
 *     worker runs VERIFY-ONLY: it computes the lag/health metric and logs what it
 *     WOULD project, but performs no Firestore write and leaves rows pending. The
 *     gate is re-resolved every pass and cannot be bypassed by a caller argument.
 *   - Each projection applies inside a Firestore transaction guarded exactly like
 *     the round-robin dispatcher (assignment only onto a still-poolable, driverless
 *     doc; timeout only onto a still-dispatched doc), so it can NEVER clobber an
 *     order the apps have since accepted (driver_assigned…) or cancelled. A guard
 *     miss is a safe idempotent skip, not an error.
 *   - At-least-once delivery + idempotent guarded apply = effectively-once state.
 *
 * In Bridge-3 (DISPATCH_SOURCE=firestore, ALLOW_PG_DISPATCH_WRITES=false) the
 * outbox is empty (no gated PG write ever commits) and the gate is closed, so the
 * worker is fully inert: it polls, finds nothing, writes nothing.
 *
 * Log tags (searchable):
 *   [PG_PROJECTOR_START]   — worker started
 *   [PG_PROJECT_APPLIED]   — projection committed to Firestore
 *   [PG_PROJECT_SKIPPED]   — guard miss / obsolete (Firestore doc moved on)
 *   [PG_PROJECT_VERIFY]    — verify-only: would project (no write)
 *   [PG_PROJECT_RETRY]     — transient failure, scheduled for backoff retry
 *   [PG_PROJECT_FAILED]    — exhausted MAX_ATTEMPTS, left for inspection
 *   [PG_PROJECT_HEALTH]    — lag metric (pending count + oldest age)
 */

import { and, asc, eq, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  dispatchProjectionsTable,
  type DispatchProjection,
  type DispatchProjectionPayload,
} from "@workspace/db";

import { adminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { resolveDispatchSource, resolvePgProjectionEnabled } from "./dispatch-source";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE       = 20;
const MAX_ATTEMPTS     = 5;
const BASE_BACKOFF_MS  = 5_000;

// Firestore collection the projector writes to. Production ALWAYS uses "orders"
// (the collection the apps + Firestore dispatcher read). This is overridable
// ONLY to let verification harnesses target an isolated collection that the live
// round-robin dispatcher does not watch, so tests never touch real driver flow.
// Never set PG_PROJECTION_COLLECTION in production. Resolved at call time (like
// the gate flags) so it cannot be frozen at an unexpected module-load moment.
// Hardened: an override is HONORED only when PG_PROJECTION_ALLOW_COLLECTION_OVERRIDE
// === "true" as well. An accidental PG_PROJECTION_COLLECTION in production (without
// the allow-flag) is IGNORED — projection stays on "orders" — and logged loudly,
// so projection can never silently misroute to a collection the apps don't read.
function resolveProjectionCollection(): string {
  const override = process.env["PG_PROJECTION_COLLECTION"]?.trim();
  if (!override || override === "orders") return "orders";
  if (process.env["PG_PROJECTION_ALLOW_COLLECTION_OVERRIDE"] === "true") return override;
  logger.warn(
    { override },
    '[PG_PROJECT_COLLECTION_GUARD] PG_PROJECTION_COLLECTION override ignored — set PG_PROJECTION_ALLOW_COLLECTION_OVERRIDE=true to honor it; using "orders"',
  );
  return "orders";
}

// Statuses a fresh order is in while still in the dispatch pool. Mirrors
// POOL_STATUSES in round-robin-dispatcher.ts — the projector applies an
// assignment ONLY onto a doc still in one of these states (and with no driver).
const POOL_STATUSES = ["finding_driver", "searching", "pending"] as const;

type ApplyOutcome = "applied" | "skipped";

export interface ProjectorPassResult {
  verifyOnly: boolean;
  processed:  number;
  applied:    number;
  skipped:    number;
  retried:    number;
  failed:     number;
  /** Rows still pending after this pass (lag). */
  pending:    number;
  /** Age in ms of the oldest pending row (lag), or null when none. */
  oldestPendingAgeMs: number | null;
}

// ── Firestore apply functions ─────────────────────────────────────────────────

/**
 * Project an assignment onto orders/{orderId}. Guarded exactly like the RR
 * dispatcher: only assign a doc still in the pool with no driver. Returns
 * "skipped" when the doc is absent or has moved on (idempotent no-op).
 */
async function applyAssignment(
  fs:       FirebaseFirestore.Firestore,
  orderId:  string,
  payload:  DispatchProjectionPayload,
): Promise<ApplyOutcome> {
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
  const ref = fs.doc(`${resolveProjectionCollection()}/${orderId}`);

  const driverUid = payload.driverUid;
  if (!driverUid) {
    // Malformed payload — nothing to project. Treat as a permanent skip.
    return "skipped";
  }

  let outcome: ApplyOutcome = "skipped";
  await fs.runTransaction(async (tx) => {
    outcome = "skipped";
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const d = snap.data() as Record<string, unknown>;
    // Guard (mirror RR L226-227): only a still-poolable, driverless doc.
    if (!POOL_STATUSES.includes(d["status"] as typeof POOL_STATUSES[number])) return;
    if (d["driverUid"]) return;

    // Use the PG decision timestamps so dispatch + timeout math stays consistent
    // with what the PG dispatcher decided. Fall back to "now" only if a payload
    // field is somehow absent (should not happen for assignment events).
    const dispatchedAt = payload.dispatchedAtMs
      ? Timestamp.fromMillis(payload.dispatchedAtMs)
      : Timestamp.now();
    const timeoutAt = payload.dispatchTimeoutAtMs
      ? Timestamp.fromMillis(payload.dispatchTimeoutAtMs)
      : Timestamp.now();

    tx.update(ref, {
      status:                  "dispatched",
      driverUid,
      dispatchedAt,
      dispatchedToDriverAt:    dispatchedAt,
      dispatchTimeoutAt:       timeoutAt,
      lastDispatchedDriverUid: driverUid,
      activeOfferDriverUids:   payload.activeOfferDriverUids ?? [driverUid],
      updatedAt:               FieldValue.serverTimestamp(),
      // Clear FCM guard fields so the Firestore FCM dispatcher fires for this cycle.
      fcmDispatchedAt:         FieldValue.delete(),
      fcmDispatchClaimedAt:    FieldValue.delete(),
      fcmDispatchClaimedBy:    FieldValue.delete(),
      fcmMessageId:            FieldValue.delete(),
    });
    outcome = "applied";
  });

  return outcome;
}

/**
 * Project a timeout (return-to-pool) onto orders/{orderId}. Guarded exactly like
 * the RR dispatcher timeout: only reset a still-dispatched doc. Returns "skipped"
 * when the doc is absent or already moved on.
 */
async function applyTimeout(
  fs:      FirebaseFirestore.Firestore,
  orderId: string,
): Promise<ApplyOutcome> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = fs.doc(`${resolveProjectionCollection()}/${orderId}`);

  let outcome: ApplyOutcome = "skipped";
  await fs.runTransaction(async (tx) => {
    outcome = "skipped";
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const d = snap.data() as Record<string, unknown>;
    // Guard (mirror RR L413): only reset a still-dispatched doc.
    if (d["status"] !== "dispatched") return;

    tx.update(ref, {
      status:                "searching",
      driverUid:             null,
      dispatchTimeoutAt:     FieldValue.delete(),
      activeOfferDriverUids: FieldValue.delete(),
      fcmDispatchedAt:       FieldValue.delete(),
      fcmDispatchClaimedAt:  FieldValue.delete(),
      fcmDispatchClaimedBy:  FieldValue.delete(),
      fcmMessageId:          FieldValue.delete(),
      updatedAt:             FieldValue.serverTimestamp(),
    });
    outcome = "applied";
  });

  return outcome;
}

/**
 * Project an offer-set removal onto orders/{orderId} — Phase 5J-Tier-9B.
 *
 * Mirrors the Driver App's former Firestore arrayRemove(activeOfferDriverUids)
 * write when a driver rejects or times out an offer. Idempotent (arrayRemove of
 * an absent value is a no-op). Guarded against terminal/cancelled docs so it can
 * NEVER resurrect a completed order. Crucially, it does NOT touch the FCM guard
 * fields, so it can never re-trigger the Firestore FCM dispatcher (which fires
 * only on assignment). Returns "skipped" when the doc is absent or terminal.
 */
async function applyOfferRemoval(
  fs:      FirebaseFirestore.Firestore,
  orderId: string,
  payload: DispatchProjectionPayload,
): Promise<ApplyOutcome> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = fs.doc(`${resolveProjectionCollection()}/${orderId}`);

  const driverUid = payload.driverUid;
  if (!driverUid) {
    // Malformed payload — nothing to remove. Permanent skip.
    return "skipped";
  }

  let outcome: ApplyOutcome = "skipped";
  await fs.runTransaction(async (tx) => {
    outcome = "skipped";
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const d = snap.data() as Record<string, unknown>;
    // No terminal/cancelled resurrection — never write a completed order.
    if (d["status"] === "delivered" || d["status"] === "cancelled") return;

    tx.update(ref, {
      activeOfferDriverUids: FieldValue.arrayRemove(driverUid),
      updatedAt:             FieldValue.serverTimestamp(),
    });
    outcome = "applied";
  });

  return outcome;
}

/**
 * Project a driver-initiated pre-pickup cancellation (return-to-pool) onto
 * orders/{orderId} — Phase 5J-Tier-9C.
 *
 * Mirrors the Driver App's former Firestore write (status="pending",
 * driverUid=null + cancel metadata) and additionally clears the offer set + FCM
 * guard fields so the re-dispatch fires cleanly.
 *
 * Guards (idempotent + non-destructive):
 *   - Absent doc                  → skip.
 *   - delivered / cancelled       → skip (never resurrect a terminal order).
 *   - driverUid !== the canceller → skip: a NEWER authoritative state has
 *     already moved the doc on (e.g. the PG dispatcher re-dispatched it to
 *     another driver, or it was already returned to the pool), so the cancel is
 *     obsolete and must not clobber it.
 */
async function applyDriverCancel(
  fs:      FirebaseFirestore.Firestore,
  orderId: string,
  payload: DispatchProjectionPayload,
): Promise<ApplyOutcome> {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = fs.doc(`${resolveProjectionCollection()}/${orderId}`);

  const driverUid = payload.driverUid;
  if (!driverUid) {
    // Malformed payload — nothing to project. Permanent skip.
    return "skipped";
  }
  const reason = payload.driverCancelReason ?? "";

  let outcome: ApplyOutcome = "skipped";
  await fs.runTransaction(async (tx) => {
    outcome = "skipped";
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const d = snap.data() as Record<string, unknown>;
    // No terminal resurrection.
    if (d["status"] === "delivered" || d["status"] === "cancelled") return;
    // Only retract THIS driver's assignment — a newer state (re-dispatch /
    // already-pooled) that no longer names this driver wins.
    if (d["driverUid"] !== driverUid) return;

    tx.update(ref, {
      status:                "pending",
      driverUid:             null,
      driverName:            "",
      driverCancelledBy:     driverUid,
      driverCancelReason:    reason,
      driverCancelledAt:     FieldValue.serverTimestamp(),
      activeOfferDriverUids: FieldValue.delete(),
      dispatchTimeoutAt:     FieldValue.delete(),
      fcmDispatchedAt:       FieldValue.delete(),
      fcmDispatchClaimedAt:  FieldValue.delete(),
      fcmDispatchClaimedBy:  FieldValue.delete(),
      fcmMessageId:          FieldValue.delete(),
      updatedAt:             FieldValue.serverTimestamp(),
    });
    outcome = "applied";
  });

  return outcome;
}

async function applyProjection(
  fs:  FirebaseFirestore.Firestore,
  row: DispatchProjection,
): Promise<ApplyOutcome> {
  switch (row.eventType) {
    case "assignment":
      return applyAssignment(fs, row.orderId, row.payload);
    case "timeout":
      return applyTimeout(fs, row.orderId);
    case "offer_removal":
      return applyOfferRemoval(fs, row.orderId, row.payload);
    case "driver_cancel":
      return applyDriverCancel(fs, row.orderId, row.payload);
    default:
      // Unknown event type — never auto-retry; surface and skip.
      logger.warn(
        { id: String(row.id), orderId: row.orderId, eventType: row.eventType },
        "[PG_PROJECT_SKIPPED] unknown eventType",
      );
      return "skipped";
  }
}

// ── lag / health metric ───────────────────────────────────────────────────────

async function readProjectionHealth(): Promise<{ pending: number; oldestPendingAgeMs: number | null }> {
  const [agg] = await db
    .select({
      pending: sql<number>`count(*)::int`,
      oldest:  sql<Date | null>`min(${dispatchProjectionsTable.createdAt})`,
    })
    .from(dispatchProjectionsTable)
    .where(eq(dispatchProjectionsTable.status, "pending"));

  const pending = agg?.pending ?? 0;
  const oldest  = agg?.oldest ?? null;
  return {
    pending,
    oldestPendingAgeMs: oldest ? Date.now() - new Date(oldest).getTime() : null,
  };
}

// ── pass ──────────────────────────────────────────────────────────────────────

/**
 * Run one projector pass. Re-resolves the gate internally — Firestore writes
 * happen only when PG_PROJECTION_ENABLED==="true" AND DISPATCH_SOURCE==="pg";
 * otherwise verify-only (no Firestore write, rows left pending). The gate cannot
 * be bypassed by a caller. Never throws.
 */
export async function runDispatchProjectorPass(): Promise<ProjectorPassResult> {
  const verifyOnly = !(resolvePgProjectionEnabled() && resolveDispatchSource().value === "pg");

  let processed = 0;
  let applied   = 0;
  let skipped   = 0;
  let retried   = 0;
  let failed    = 0;

  try {
    const now = new Date();
    // Per-order causal sequencing: a row is eligible ONLY if no EARLIER row (lower
    // bigserial id) for the SAME order is still unfinished (pending OR failed).
    // Without this, retry/backoff could let a later event (e.g. a timeout) project
    // while its preceding assignment is delayed — and since a guard-miss is
    // terminally marked "projected", the later event could be consumed against a
    // stale Firestore doc, leaving Firestore dispatched while PG is back in pool.
    // A permanently-failed predecessor intentionally BLOCKS its order's later rows
    // (surfaced via [PG_PROJECT_FAILED] + lag metric) rather than corrupting order.
    const earlier = alias(dispatchProjectionsTable, "earlier");
    const rows = await db
      .select()
      .from(dispatchProjectionsTable)
      .where(
        and(
          eq(dispatchProjectionsTable.status, "pending"),
          lte(dispatchProjectionsTable.availableAt, now),
          notExists(
            db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.orderId, dispatchProjectionsTable.orderId),
                  lt(earlier.id, dispatchProjectionsTable.id),
                  inArray(earlier.status, ["pending", "failed"]),
                ),
              ),
          ),
        ),
      )
      // FIFO: total order by bigserial id, processed serially below so per-order
      // ordering (assignment before its timeout) is always preserved.
      .orderBy(asc(dispatchProjectionsTable.id))
      .limit(BATCH_SIZE);

    let fs: FirebaseFirestore.Firestore | null = null;
    if (!verifyOnly && rows.length > 0) {
      fs = await adminFirestore();
    }

    for (const row of rows) {
      processed++;

      if (verifyOnly) {
        logger.info(
          { id: String(row.id), orderId: row.orderId, eventType: row.eventType },
          "[PG_PROJECT_VERIFY] would project (no write — gate closed or not pg mode)",
        );
        continue;
      }

      try {
        const outcome = await applyProjection(fs!, row);
        await db
          .update(dispatchProjectionsTable)
          .set({
            status:      "projected",
            attempts:    row.attempts + 1,
            projectedAt: new Date(),
            updatedAt:   new Date(),
            lastError:   null,
          })
          .where(eq(dispatchProjectionsTable.id, row.id));

        if (outcome === "applied") {
          applied++;
          logger.info(
            { id: String(row.id), orderId: row.orderId, eventType: row.eventType },
            "[PG_PROJECT_APPLIED]",
          );
        } else {
          skipped++;
          logger.info(
            { id: String(row.id), orderId: row.orderId, eventType: row.eventType },
            "[PG_PROJECT_SKIPPED] Firestore doc absent or moved on (idempotent no-op)",
          );
        }
      } catch (err) {
        const attempts = row.attempts + 1;
        const permanent = attempts >= MAX_ATTEMPTS;
        const backoffMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
        await db
          .update(dispatchProjectionsTable)
          .set({
            status:      permanent ? "failed" : "pending",
            attempts,
            lastError:   err instanceof Error ? err.message : String(err),
            availableAt: new Date(Date.now() + backoffMs),
            updatedAt:   new Date(),
          })
          .where(eq(dispatchProjectionsTable.id, row.id));

        if (permanent) {
          failed++;
          logger.error(
            { err, id: String(row.id), orderId: row.orderId, eventType: row.eventType, attempts },
            "[PG_PROJECT_FAILED] exhausted retries — left for inspection",
          );
        } else {
          retried++;
          logger.warn(
            { err, id: String(row.id), orderId: row.orderId, eventType: row.eventType, attempts, backoffMs },
            "[PG_PROJECT_RETRY] transient failure — scheduled for backoff retry",
          );
        }
      }
    }

    const health = await readProjectionHealth();
    if (health.pending > 0 || applied > 0 || failed > 0) {
      logger.info(
        {
          verifyOnly,
          processed,
          applied,
          skipped,
          retried,
          failed,
          pending: health.pending,
          oldestPendingAgeMs: health.oldestPendingAgeMs,
        },
        "[PG_PROJECT_HEALTH]",
      );
    }

    return {
      verifyOnly,
      processed,
      applied,
      skipped,
      retried,
      failed,
      pending: health.pending,
      oldestPendingAgeMs: health.oldestPendingAgeMs,
    };
  } catch (err) {
    logger.error({ err }, "[PG_PROJECT_HEALTH] pass error (non-blocking)");
    return {
      verifyOnly,
      processed,
      applied,
      skipped,
      retried,
      failed,
      pending: -1,
      oldestPendingAgeMs: null,
    };
  }
}

// ── worker ─────────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Start the PG → Firestore projector poller. Fire-and-forget; errors are logged
 * internally and never throw. Started unconditionally at boot (like the shadow
 * writer) — it is inert until the gate opens. A `running` guard prevents
 * overlapping passes if one runs longer than the poll interval.
 */
export async function startDispatchProjector(): Promise<void> {
  if (timer) {
    logger.warn("[PG_PROJECTOR_START] already running — ignoring duplicate start");
    return;
  }

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE, maxAttempts: MAX_ATTEMPTS },
    "[PG_PROJECTOR_START] PG → Firestore projector started (gated; inert until PG_PROJECTION_ENABLED=true AND DISPATCH_SOURCE=pg)",
  );

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runDispatchProjectorPass();
    } catch (err) {
      logger.error({ err }, "[PG_PROJECT_HEALTH] tick error (non-blocking)");
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

/** Stop the poller (used by tests / graceful shutdown). */
export function stopDispatchProjector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
