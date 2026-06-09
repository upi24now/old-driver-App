/**
 * Round-Robin Order Dispatcher
 *
 * Complements fcm-dispatcher.ts (which sends FCM once a driverUid is set).
 * This module owns the dispatch _cycle_:
 *
 *   1. Listens for orders with status "searching" or "pending" (no driver yet).
 *   2. Queries online drivers, skips those in the order's rejectedBy list.
 *   3. Atomically assigns the next driver: status → "dispatched", sets driverUid,
 *      records dispatchTimeoutAt = now + DISPATCH_TIMEOUT_SECONDS.
 *   4. Clears FCM dispatch guard fields so fcm-dispatcher.ts re-fires for the
 *      newly assigned driver (the document re-enters the status=="dispatched"
 *      Firestore query as an "added" event).
 *   5. Every POLL_INTERVAL_MS, finds dispatched orders whose dispatchTimeoutAt
 *      has passed and resets them to "searching" — the Firestore listener then
 *      picks them up and assigns the next driver.
 *
 * Safety guarantees:
 *   - All driver assignments use a runTransaction so two racing server
 *     instances cannot assign different drivers to the same order.
 *   - Accept/reject/complete transactions in orders.ts and firestore.ts are
 *     untouched; they guard against stale status independently.
 *   - Only orders that have dispatchTimeoutAt set are touched by the poller
 *     (backward-compatible with orders created before this module was added).
 *   - No FCM or accept/reject business logic is duplicated here.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminFirestore } from "./firebase-admin";
import { logger } from "./logger";

const DISPATCH_TIMEOUT_SECONDS = 5;
const POLL_INTERVAL_MS         = 30_000; // 30 s — was 2 s; keeps daily poll reads ≤ 2 880

// Statuses that mean "this order is in the pool, needs a driver".
const POOL_STATUSES = ["searching", "pending"] as const;

export async function startRoundRobinDispatcher(): Promise<void> {
  let db: Awaited<ReturnType<typeof adminFirestore>>;
  try {
    db = await adminFirestore();
  } catch (err) {
    logger.warn({ err }, "[RR dispatcher] Firebase Admin unavailable — skipping startup");
    return;
  }

  // ── Listener: orders that need a driver ─────────────────────────────────────
  // Firestore "in" queries are limited to 10 values — we only use 2 here.
  db.collection("orders")
    .where("status", "in", POOL_STATUSES)
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          // "added"    = order just entered the pool (new or returned after reject/timeout)
          // "modified" = rare; skip to avoid re-triggering after our own writes
          if (change.type !== "added") continue;

          const data = change.doc.data() as Record<string, unknown>;

          // Guard: if driverUid is already set, a concurrent instance claimed it.
          if (data["driverUid"]) continue;

          void assignNextDriver(db, change.doc.id, data);
        }
      },
      (err) => {
        logger.error({ err }, "[RR dispatcher] Pool listener error");
      },
    );

  // ── Poller: expire timed-out dispatched orders ───────────────────────────────
  setInterval(() => { void checkExpiredDispatches(db); }, POLL_INTERVAL_MS);

  logger.info(
    { timeoutSec: DISPATCH_TIMEOUT_SECONDS, pollIntervalMs: POLL_INTERVAL_MS },
    "[RR dispatcher] Running",
  );
}

// ─── Driver assignment ────────────────────────────────────────────────────────

async function assignNextDriver(
  db:      FirebaseFirestore.Firestore,
  orderId: string,
  data:    Record<string, unknown>,
): Promise<void> {
  const rejectedBy = Array.isArray(data["rejectedBy"])
    ? (data["rejectedBy"] as string[])
    : [];

  const lastUid = typeof data["lastDispatchedDriverUid"] === "string"
    ? data["lastDispatchedDriverUid"]
    : null;

  // ── 1. Find available drivers ───────────────────────────────────────────────
  let drivers: { uid: string }[] = [];
  try {
    const snap = await db.collection("drivers")
      .where("isOnline", "==", true)
      .get();

    const now = Date.now();
    drivers = snap.docs
      .map((d) => {
        const dd = d.data() as Record<string, unknown>;
        const expiry = typeof dd["subscriptionExpiresAt"] === "number"
          ? dd["subscriptionExpiresAt"]
          : 0;
        return { uid: d.id, expiry };
      })
      // Only drivers with a valid active subscription (expiry in the future).
      // Drivers without subscriptionExpiresAt (legacy / test drivers) are allowed through.
      .filter((d) => d.expiry === 0 || d.expiry > now)
      .filter((d) => !rejectedBy.includes(d.uid))
      .map((d) => ({ uid: d.uid }));
  } catch (err) {
    logger.error({ err, orderId }, "[RR dispatcher] Failed to query drivers");
    return;
  }

  if (drivers.length === 0) {
    // All online drivers have rejected this order in this cycle.
    // Reset rejectedBy so the cycle restarts from scratch.
    if (rejectedBy.length > 0) {
      try {
        await db.doc(`orders/${orderId}`).update({
          rejectedBy: [],
          updatedAt:  FieldValue.serverTimestamp(),
        });
        logger.info({ orderId }, "[RR dispatcher] All drivers exhausted — resetting rejection list");
      } catch (err) {
        logger.warn({ err, orderId }, "[RR dispatcher] Failed to reset rejectedBy");
      }
    }
    return;
  }

  // ── 2. Pick next driver in round-robin order ──────────────────────────────
  // Sort by UID for a stable ordering across server restarts and instances.
  drivers.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

  let startIdx = 0;
  if (lastUid) {
    const pos = drivers.findIndex((d) => d.uid === lastUid);
    if (pos !== -1) startIdx = (pos + 1) % drivers.length;
  }

  const chosen = drivers[startIdx]!;

  // ── 3. Atomic assignment ──────────────────────────────────────────────────
  try {
    const orderRef = db.doc(`orders/${orderId}`);
    let assigned = false;

    await db.runTransaction(async (tx) => {
      assigned = false;
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;

      const d = snap.data() as Record<string, unknown>;

      // Bail if another instance already assigned a driver or order was accepted/cancelled.
      if (!POOL_STATUSES.includes(d["status"] as typeof POOL_STATUSES[number])) return;
      if (d["driverUid"]) return;

      const timeoutAt = new Date(Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000);

      tx.update(orderRef, {
        status:                  "dispatched",
        driverUid:               chosen.uid,
        dispatchedAt:            FieldValue.serverTimestamp(),
        dispatchedToDriverAt:    FieldValue.serverTimestamp(),
        dispatchTimeoutAt:       timeoutAt,
        lastDispatchedDriverUid: chosen.uid,
        updatedAt:               FieldValue.serverTimestamp(),
        // Clear FCM guard fields so fcm-dispatcher.ts re-fires for the new driver.
        fcmDispatchedAt:         FieldValue.delete(),
        fcmDispatchClaimedAt:    FieldValue.delete(),
        fcmDispatchClaimedBy:    FieldValue.delete(),
        fcmMessageId:            FieldValue.delete(),
      });

      assigned = true;
    });

    if (assigned) {
      logger.info({ orderId, driverUid: chosen.uid, timeoutSec: DISPATCH_TIMEOUT_SECONDS },
        "[RR dispatcher] Order assigned to driver");
    }
  } catch (err) {
    logger.error({ err, orderId, driverUid: chosen.uid }, "[RR dispatcher] Assignment transaction failed");
  }
}

// ─── Timeout poller ───────────────────────────────────────────────────────────

async function checkExpiredDispatches(db: FirebaseFirestore.Firestore): Promise<void> {
  // Composite index required: orders — status ASC, dispatchTimeoutAt ASC
  //
  // The dispatchTimeoutAt range filter is pushed into Firestore so only
  // genuinely-expired docs are downloaded.  Previously all dispatched orders
  // were fetched and the expiry was checked in JS, costing one read per
  // dispatched order per poll cycle regardless of whether any had timed out.
  //
  // The JS-side expiry guard below is kept as a safety net (e.g. clock skew
  // between server instances) and does not affect normal-path behaviour.
  const now = new Date();
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await db.collection("orders")
      .where("status",          "==", "dispatched")
      .where("dispatchTimeoutAt", "<=", now)
      .get();
  } catch (err) {
    logger.warn({ err }, "[RR dispatcher] Timeout poll query failed");
    return;
  }

  for (const orderDoc of snap.docs) {
    const data = orderDoc.data() as Record<string, unknown>;
    const timeoutAt = data["dispatchTimeoutAt"];
    if (!timeoutAt) continue;

    // Safety guard: normalise to JS Date and re-verify expiry.
    const timeoutDate =
      timeoutAt instanceof Date
        ? timeoutAt
        : typeof (timeoutAt as { toDate?: () => Date }).toDate === "function"
          ? (timeoutAt as { toDate: () => Date }).toDate()
          : null;

    if (timeoutDate && timeoutDate <= now) {
      void returnToPool(db, orderDoc);
    }
  }
}

async function returnToPool(
  db:       FirebaseFirestore.Firestore,
  orderDoc: FirebaseFirestore.QueryDocumentSnapshot,
): Promise<void> {
  const orderId = orderDoc.id;

  try {
    const orderRef = db.doc(`orders/${orderId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;

      const d = snap.data() as Record<string, unknown>;

      // Only reset if still dispatched and the timeout has genuinely elapsed.
      if (d["status"] !== "dispatched") return;

      const timeoutAt = d["dispatchTimeoutAt"];
      if (timeoutAt && (timeoutAt as FirebaseFirestore.Timestamp).toDate() > new Date()) return;

      tx.update(orderRef, {
        status:               "searching",
        driverUid:            null,
        dispatchTimeoutAt:    FieldValue.delete(),
        // Clear FCM fields so the next assignment triggers a fresh FCM send.
        fcmDispatchedAt:      FieldValue.delete(),
        fcmDispatchClaimedAt: FieldValue.delete(),
        fcmDispatchClaimedBy: FieldValue.delete(),
        fcmMessageId:         FieldValue.delete(),
        updatedAt:            FieldValue.serverTimestamp(),
      });
    });

    logger.info({ orderId }, "[RR dispatcher] Driver timeout — order returned to pool");
  } catch (err) {
    logger.error({ err, orderId }, "[RR dispatcher] returnToPool transaction failed");
  }
}
