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
import { resolveDispatchSource } from "./dispatch-source";
import {
  pgCreateOffer,
  pgRejectOffer,
  pgShadowSetStatus,
  pgTimeoutOffer,
  pgUpsertOrder,
  pgUpsertOrderOtp,
} from "./order-pg-service";
import {
  pgShadowCompareDispatch,
  pgShadowCompareTimeout,
} from "./pg-dispatch-shadow";
import { pgShadowCompareAssignment } from "./pg-assign-shadow";
import { pgTimeoutShadowValidate } from "./pg-timeout-shadow";

const DISPATCH_TIMEOUT_SECONDS = 60;
const POLL_INTERVAL_MS         = 30_000; // 30 s — was 2 s; keeps daily poll reads ≤ 2 880

// ── Idle guard ───────────────────────────────────────────────────────────────
// After a successful dispatch, checkExpiredDispatches must keep polling until
// the order is either accepted or its timeout elapses.  The longest that can
// take is DISPATCH_TIMEOUT_SECONDS + one POLL_INTERVAL_MS (the poller fires up
// to one full interval after the deadline).  Once that window passes with no
// new dispatch, further polls are skipped — there is nothing to expire.
//
// Initialised to Date.now() so the first poll after a server restart always
// runs, covering any orders dispatched by a previous instance.
const IDLE_GUARD_MS = DISPATCH_TIMEOUT_SECONDS * 1000 + POLL_INTERVAL_MS; // 90 s at defaults
let lastDispatchAt: number = Date.now();

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
  // Phase 5H-CUTOVER: when PG is the dispatch authority, the PG dispatcher owns
  // all assignment decisions and projects them to Firestore via the projector.
  // The RR dispatcher must NOT write Firestore assignments in pg mode — dual
  // writers would race and corrupt single-authority semantics. FCM dispatcher
  // and shadow-writer listeners remain unaffected (only this write path is gated).
  if (resolveDispatchSource().value === "pg") {
    logger.info({ orderId }, "[RR dispatcher] pg mode — skipping Firestore assignment (PG authority)");
    return;
  }

  const rejectedBy = Array.isArray(data["rejectedBy"])
    ? (data["rejectedBy"] as string[])
    : [];

  const lastUid = typeof data["lastDispatchedDriverUid"] === "string"
    ? data["lastDispatchedDriverUid"]
    : null;

  // ── 1. Find available drivers ───────────────────────────────────────────────
  let drivers: {
    uid:    string;
    name:   string | null;
    rating: string | null;
    trips:  number | null;
  }[] = [];
  // Captured for the read-only PG dispatch shadow comparison (Phase 5B).
  let fsOnlineCount = 0;
  try {
    const snap = await db.collection("drivers")
      .where("isOnline", "==", true)
      .get();

    fsOnlineCount = snap.docs.length;
    const now = Date.now();
    drivers = snap.docs
      .map((d) => {
        const dd = d.data() as Record<string, unknown>;
        const expiry = typeof dd["subscriptionExpiresAt"] === "number"
          ? dd["subscriptionExpiresAt"]
          : 0;
        const name   = typeof dd["name"]   === "string" ? dd["name"]   : null;
        const rating = typeof dd["rating"] === "number"
          ? String(dd["rating"])
          : typeof dd["rating"] === "string"
          ? dd["rating"]
          : null;
        const trips  = typeof dd["tripsTotal"] === "number"
          ? dd["tripsTotal"]
          : typeof dd["trips"] === "number"
          ? dd["trips"]
          : null;
        return { uid: d.id, expiry, name, rating, trips };
      })
      // Only drivers with a valid active subscription (expiry in the future).
      // Drivers without subscriptionExpiresAt (legacy / test drivers) are allowed through.
      .filter((d) => d.expiry === 0 || d.expiry > now)
      .filter((d) => !rejectedBy.includes(d.uid))
      .map((d) => ({ uid: d.uid, name: d.name, rating: d.rating, trips: d.trips }));
  } catch (err) {
    logger.error({ err, orderId }, "[RR dispatcher] Failed to query drivers");
    return;
  }

  if (drivers.length === 0) {
    // All online drivers have rejected this order in this cycle (or no drivers online).
    const reason = rejectedBy.length > 0
      ? `all ${rejectedBy.length} online driver(s) already rejected this order`
      : "no online drivers found";
    logger.warn({ orderId, reason, rejectedBy }, "[RR dispatcher] No eligible driver — cannot assign");

    // Reset rejectedBy so the cycle restarts from scratch.
    if (rejectedBy.length > 0) {
      try {
        await db.doc(`orders/${orderId}`).update({
          rejectedBy: [],
          updatedAt:  FieldValue.serverTimestamp(),
        });
        logger.info({ orderId }, "[RR dispatcher] All drivers exhausted — resetting rejection list");

        // ── PG shadow: mark every driver in the cycle as rejected ─────────────
        const cycleDrivers = [...rejectedBy]; // snapshot before reset
        void (async () => {
          for (const uid of cycleDrivers) {
            const r = await pgRejectOffer(orderId, uid);
            logger.info({ orderId, driverUid: uid, ok: r.ok }, "[PG_SHADOW_REJECT]");
          }
        })().catch((e) =>
          logger.error({ err: e, orderId }, "[PG_SHADOW_REJECT] cycle shadow write error — continuing"),
        );
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
    // Captured for the read-only PG assignment shadow comparison (Phase 5C-A).
    let fsTimeoutAt: Date | null = null;

    await db.runTransaction(async (tx) => {
      assigned = false;
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;

      const d = snap.data() as Record<string, unknown>;

      // Bail if another instance already assigned a driver or order was accepted/cancelled.
      if (!POOL_STATUSES.includes(d["status"] as typeof POOL_STATUSES[number])) return;
      if (d["driverUid"]) return;

      const timeoutAt = new Date(Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000);
      fsTimeoutAt = timeoutAt;

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
      lastDispatchAt = Date.now(); // extend the idle-guard window
      logger.info({ orderId, driverUid: chosen.uid, timeoutSec: DISPATCH_TIMEOUT_SECONDS },
        "[RR dispatcher] Order assigned to driver");

      // ── PG dispatch SHADOW comparison (READ-ONLY; never throw) ────────────────
      // Recomputes the decision from PG and logs MATCH/DIFF/ERROR. Cannot modify
      // Firestore, order state, FCM, or assignments. Uses the pre-dispatch
      // round-robin cursor (lastUid) captured before this transaction advanced it.
      void pgShadowCompareDispatch(orderId, {
        firestoreDriver: chosen.uid,
        pool:            drivers.map((d) => d.uid),
        rejectedBy,
        lastUid,
        onlineCount:     fsOnlineCount,
      });

      // ── PG ASSIGNMENT shadow validation (READ-ONLY; never throw) ─────────────
      // Reproduces the guarded PG assignment logic a future PG dispatcher would
      // run and compares the resulting assignment (driver, rejected, cursor,
      // status, timeout) against this Firestore assignment. Cannot modify
      // Firestore, order state, FCM, or assignments.
      void pgShadowCompareAssignment(orderId, {
        orderId,
        driverUid:   chosen.uid,
        rejectedBy,
        cursor:      chosen.uid, // Firestore set lastDispatchedDriverUid = chosen.uid
        status:      "dispatched",
        timeoutAtMs: (fsTimeoutAt ?? new Date()).getTime(),
        lastUid,
        onlineCount: fsOnlineCount,
      });

      // ── PG shadow writes (non-blocking; never throw) ─────────────────────────
      const timeoutAt = new Date(Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000);
      void (async () => {
        // Mirror the order row into PG — override driver fields with the assigned
        // driver (pre-dispatch snapshot has driverUid: null; chosen has the real uid).
        await pgUpsertOrder(
          orderId,
          {
            ...data,
            driverUid:    chosen.uid,
            driverName:   chosen.name,
            driverRating: chosen.rating,
            driverTrips:  chosen.trips,
          },
          { overrideStatus: "dispatched" },
        );
        logger.info(
          { orderId, driverUid: chosen.uid, driverName: chosen.name },
          "[PG_SHADOW_DRIVER] dispatched",
        );

        // Proactively mirror the OTP from Firestore now that the orders row
        // exists in PG.  Customer apps write the OTP at order creation — before
        // dispatch — so the collectionGroup listener in pg-shadow-writer.ts
        // fires while the orders FK row is still absent and fails.  We fetch
        // it here immediately after pgUpsertOrder ensures the parent row is
        // present, giving us a guaranteed write window.
        const otpSnap = await db.doc(`orders/${orderId}/private/otp`).get();
        if (otpSnap.exists) {
          const od    = otpSnap.data() as Record<string, unknown>;
          const otpVal = typeof od["value"] === "string"
            ? od["value"]
            : typeof od["value"] === "number"
            ? String(od["value"])
            : null;
          if (otpVal) {
            await pgUpsertOrderOtp(orderId, otpVal);
            logger.info({ orderId }, "[PG_SHADOW_OTP] fetched at dispatch");
          } else {
            logger.warn({ orderId }, "[PG_SHADOW_OTP] private/otp exists but value field missing");
          }
        }

        // Create the offer row for this driver.
        const offerResult = await pgCreateOffer(orderId, chosen.uid, timeoutAt);
        if (offerResult.ok) {
          logger.info({ orderId, driverUid: chosen.uid }, "[PG_SHADOW_OFFER]");
        } else {
          logger.warn({ orderId, driverUid: chosen.uid, reason: offerResult.reason },
            "[PG_SHADOW_OFFER] create returned non-ok (non-blocking)");
        }
      })().catch((e) =>
        logger.error({ err: e, orderId, driverUid: chosen.uid },
          "[PG_SHADOW] dispatch shadow write error — continuing"),
      );
    }
  } catch (err) {
    logger.error({ err, orderId, driverUid: chosen.uid }, "[RR dispatcher] Assignment transaction failed");
  }
}

// ─── Timeout poller ───────────────────────────────────────────────────────────

async function checkExpiredDispatches(db: FirebaseFirestore.Firestore): Promise<void> {
  // ── Idle guard ─────────────────────────────────────────────────────────────
  // Skip the Firestore query when no dispatched orders can still be awaiting
  // their timeout.  IDLE_GUARD_MS covers the full dispatch window plus one
  // extra poll interval so no expiry is ever missed.
  if (Date.now() - lastDispatchAt > IDLE_GUARD_MS) {
    return;
  }

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

  // Phase 5H-CUTOVER: when PG is the dispatch authority, the PG dispatcher owns
  // return-to-pool via pgReturnOrderToPool + the outbox projector. The RR
  // dispatcher must not also write Firestore timeouts or it becomes a second
  // authority. FCM dispatcher and shadow listeners remain unaffected.
  if (resolveDispatchSource().value === "pg") {
    logger.info({ orderId }, "[RR dispatcher] pg mode — skipping Firestore timeout (PG authority)");
    return;
  }

  let timedOutDriverUid: string | null = null; // captured inside tx before reset
  let fsTimeoutAtMs: number | null = null;     // dispatchTimeoutAt before delete

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

      // Capture the driver UID + timeout value before we null/delete them.
      timedOutDriverUid = typeof d["driverUid"] === "string" ? d["driverUid"] : null;
      fsTimeoutAtMs = timeoutAt
        ? (timeoutAt as FirebaseFirestore.Timestamp).toDate().getTime()
        : null;

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

    logger.info({ orderId, timedOutDriverUid }, "[RR dispatcher] Driver timeout — order returned to pool");

    // ── PG timeout SHADOW comparison (READ-ONLY; never throw) ─────────────────
    void pgShadowCompareTimeout(orderId, timedOutDriverUid);

    // ── Phase 5C-B: PG timeout LOGIC validator (READ-ONLY; never throw) ───────
    // Reproduces the guarded PG timeout decision and compares it against this
    // authoritative Firestore timeout. Read-only; cannot modify orders/offers,
    // send FCM, return to pool, or affect dispatcher behaviour.
    if (timedOutDriverUid && fsTimeoutAtMs !== null) {
      // fsTimeoutAtMs is the authoritative Firestore dispatchTimeoutAt captured
      // inside the transaction. No now() fallback: without it there is nothing
      // authoritative to compare, so we skip rather than fabricate a deadline.
      void pgTimeoutShadowValidate(orderId, {
        orderId,
        driverUid:           timedOutDriverUid,
        dispatchTimeoutAtMs: fsTimeoutAtMs,
        eligible:            true,  // Firestore decided the dispatch elapsed
        returnedToPool:      true,  // Firestore reset the order to "searching"
      });
    } else if (timedOutDriverUid) {
      logger.warn(
        { orderId, driverUid: timedOutDriverUid },
        "[PG_TIMEOUT_ERROR] missing FS dispatchTimeoutAt — skipping shadow validation",
      );
    }

    // ── PG shadow writes (non-blocking; never throw) ─────────────────────────
    void (async () => {
      if (timedOutDriverUid) {
        const r = await pgTimeoutOffer(orderId, timedOutDriverUid);
        logger.info({ orderId, driverUid: timedOutDriverUid, ok: r.ok }, "[PG_SHADOW_TIMEOUT]");
      }
      await pgShadowSetStatus(orderId, "searching");
      logger.info({ orderId }, "[PG_SHADOW_STATUS] searching (timeout)");
    })().catch((e) =>
      logger.error({ err: e, orderId }, "[PG_SHADOW] returnToPool shadow write error — continuing"),
    );
  } catch (err) {
    logger.error({ err, orderId }, "[RR dispatcher] returnToPool transaction failed");
  }
}
