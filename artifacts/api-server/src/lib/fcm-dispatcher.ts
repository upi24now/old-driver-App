/**
 * FCM Order Dispatcher
 *
 * Attaches a Firestore listener on server startup.
 * When an order transitions to status="dispatched" and has a driverUid,
 * sends a high-priority FCM push notification to the driver's device.
 *
 * Duplicate prevention — atomic claim protocol:
 *
 *   Before sending FCM, this instance runs a Firestore transaction that:
 *     1. Reads the order document.
 *     2. Aborts (no-op commit) if fcmDispatchedAt OR fcmDispatchClaimedAt
 *        already exists — another instance already owns or completed this send.
 *     3. Otherwise writes fcmDispatchClaimedAt (server timestamp) and
 *        fcmDispatchClaimedBy (this instance's UUID).
 *
 *   Firestore's optimistic-concurrency retry ensures that if two instances
 *   race to claim the same order, exactly one transaction commits the write;
 *   the other re-reads, sees the claim, and exits.
 *
 *   After a successful FCM send: fcmDispatchedAt + fcmMessageId are written.
 *   After a failed FCM send: claim fields are cleared; fcmDispatchError and
 *   fcmDispatchErrorAt are written so the failure is visible in Firestore.
 *   (The onSnapshot listener only reacts to "added" events so there is no
 *   automatic retry — a human can inspect and re-trigger if needed.)
 *
 * Safety:
 *   - Only the assigned driver receives the notification (token looked up
 *     from drivers/{driverUid} — never sent broadcast).
 *   - Full fcmToken is never logged.
 *   - No order stage or accept/reject logic is touched.
 */

import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminFirestore, adminMessaging } from "./firebase-admin";
import { logger } from "./logger";

const CHANNEL_ORDERS = "incoming_orders_v2";

/**
 * Unique identifier for this server process instance.
 * Written to fcmDispatchClaimedBy so the owning instance is traceable in logs
 * and in Firestore.
 */
const INSTANCE_ID = randomUUID();

export async function startFcmDispatcher(): Promise<void> {
  let db: Awaited<ReturnType<typeof adminFirestore>>;
  try {
    db = await adminFirestore();
  } catch (err) {
    logger.warn({ err }, "[FCM dispatcher] Firebase Admin unavailable — skipping dispatcher startup");
    return;
  }

  const query = db
    .collection("orders")
    .where("status", "==", "dispatched");

  query.onSnapshot(
    (snapshot) => {
      // onSnapshot reports all existing matching docs as "added" on first
      // connect and only new/changed docs thereafter.  We process every
      // "added" change; the atomic claim transaction prevents duplicate sends.
      for (const change of snapshot.docChanges()) {
        if (change.type !== "added") continue;

        const doc  = change.doc;
        const data = doc.data() as Record<string, unknown>;

        // Fast-path skip: if either guard field already exists, no transaction needed.
        if (data["fcmDispatchedAt"] || data["fcmDispatchClaimedAt"]) continue;

        const orderId   = doc.id;
        const driverUid = typeof data["driverUid"] === "string" ? data["driverUid"] : null;

        if (!driverUid) {
          logger.warn({ orderId }, "[FCM dispatcher] Dispatched order has no driverUid — skipping");
          continue;
        }

        const orderPayload: OrderPayload = {
          customer:    typeof data["customerName"]  === "string" ? data["customerName"]  : "",
          pickup:      typeof data["pickup"]        === "string" ? data["pickup"]        : "",
          pickupCity:  typeof data["pickupCity"]    === "string" ? data["pickupCity"]    : "",
          drop:        typeof data["drop"]          === "string" ? data["drop"]          : "",
          dropCity:    typeof data["dropCity"]      === "string" ? data["dropCity"]      : "",
          earning:     typeof data["fareEstimate"]  === "number" ? String(data["fareEstimate"]) : "0",
          distanceKm:  typeof data["distanceKm"]   === "number" ? String(data["distanceKm"])   : "0",
          durationMin: typeof data["durationMin"]  === "number" ? String(data["durationMin"])  : "0",
        };

        // Fire-and-forget per order; errors are logged individually
        void sendOrderFcm(db, orderId, driverUid, orderPayload);
      }
    },
    (err) => {
      logger.error({ err }, "[FCM dispatcher] Firestore listener error");
    },
  );

  logger.info({ instanceId: INSTANCE_ID }, "[FCM dispatcher] Listening for dispatched orders");
}

type OrderPayload = {
  customer:    string;
  pickup:      string;
  pickupCity:  string;
  drop:        string;
  dropCity:    string;
  earning:     string;
  distanceKm:  string;
  durationMin: string;
};

/**
 * Atomically claim the FCM dispatch slot for this order.
 *
 * Uses a Firestore transaction so competing instances cannot both claim.
 * Firestore's optimistic-concurrency retry means only one instance commits the
 * claim write; all others re-read and see the existing claim on retry.
 *
 * Returns true  — this instance won the claim and must send FCM.
 * Returns false — already claimed or dispatched; this instance must skip.
 */
async function claimFcmDispatch(
  db: FirebaseFirestore.Firestore,
  orderId: string,
): Promise<boolean> {
  const orderRef = db.doc(`orders/${orderId}`);
  let alreadyClaimed = false;

  try {
    await db.runTransaction(async (tx) => {
      // Reset on every retry so the flag reflects the latest read.
      alreadyClaimed = false;

      const snap = await tx.get(orderRef);
      const data = snap.data() ?? {};

      // If either guard field exists, another instance already owns this order.
      // Return without writing — transaction commits as a no-op read.
      if (data["fcmDispatchedAt"] || data["fcmDispatchClaimedAt"]) {
        alreadyClaimed = true;
        return;
      }

      // Claim the order for this instance.
      tx.update(orderRef, {
        fcmDispatchClaimedAt: FieldValue.serverTimestamp(),
        fcmDispatchClaimedBy: INSTANCE_ID,
      });
    });
  } catch (err) {
    // Unexpected transaction failure (network, permission, etc.).
    // Treat as unclaimed so we don't silently swallow errors; the caller logs.
    logger.warn({ err, orderId }, "[FCM dispatcher] Claim transaction failed — skipping send");
    return false;
  }

  return !alreadyClaimed;
}

async function sendOrderFcm(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  driverUid: string,
  order: OrderPayload,
): Promise<void> {
  // ── 1. Atomically claim dispatch rights ───────────────────────────────────
  const claimed = await claimFcmDispatch(db, orderId);
  if (!claimed) {
    logger.info({ orderId, instanceId: INSTANCE_ID }, "[FCM dispatcher] Order already claimed or dispatched — skipping");
    return;
  }

  // ── 2. Read driver fcmToken ───────────────────────────────────────────────
  let fcmToken: string | null = null;
  try {
    const driverSnap = await db.doc(`drivers/${driverUid}`).get();
    const token = driverSnap.data()?.["fcmToken"];
    fcmToken = typeof token === "string" && token.length > 0 ? token : null;
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[FCM dispatcher] Failed to read driver fcmToken");
    await clearClaim(db, orderId, "Failed to read driver fcmToken");
    return;
  }

  if (!fcmToken) {
    logger.warn({ orderId, driverUid }, "[FCM dispatcher] Driver has no fcmToken — skipping push");
    await clearClaim(db, orderId, "Driver has no fcmToken");
    return;
  }

  // ── 3. Send FCM ───────────────────────────────────────────────────────────
  let messageId: string;
  try {
    const messaging = await adminMessaging();
    messageId = await messaging.send({
      token: fcmToken,
      notification: {
        title: "New Delivery Request",
        body:  "You have a new delivery request",
      },
      data: {
        type:        "incoming_order",
        orderId,
        driverUid,
        customer:    order.customer,
        pickup:      order.pickup,
        pickupCity:  order.pickupCity,
        drop:        order.drop,
        dropCity:    order.dropCity,
        earning:     order.earning,
        distanceKm:  order.distanceKm,
        durationMin: order.durationMin,
      },
      android: {
        priority: "high",
        notification: {
          channelId:  CHANNEL_ORDERS,
          sound:      "ringtone",
          visibility: "public",
          priority:   "max",
        },
      },
    });
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[FCM dispatcher] FCM send failed");
    // Clear claim so the failure is visible; record the error for diagnostics.
    await clearClaim(db, orderId, err instanceof Error ? err.message : "Unknown FCM send error");
    return;
  }

  logger.info(
    { orderId, driverUid, messageId, instanceId: INSTANCE_ID, tokenPrefix: fcmToken.substring(0, 10) + "..." },
    "[FCM dispatcher] FCM push sent",
  );

  // ── 4. Mark order as dispatched ───────────────────────────────────────────
  // Claim fields are intentionally left in place — they serve as a record of
  // which instance sent the push.  fcmDispatchedAt is the canonical "done" flag
  // checked by the fast-path guard on every new snapshot event.
  try {
    await db.doc(`orders/${orderId}`).update({
      fcmDispatchedAt: FieldValue.serverTimestamp(),
      fcmMessageId:    messageId,
    });
  } catch (err) {
    // Non-fatal: the claim is already written so duplicate sends are still
    // prevented.  The absence of fcmDispatchedAt only matters on a cold
    // server restart where the fast-path guard reads snapshot data; the claim
    // transaction provides the true safety net.
    logger.warn({ err, orderId }, "[FCM dispatcher] Failed to write fcmDispatchedAt after successful send");
  }
}

/**
 * Clear the dispatch claim and record a human-readable error reason.
 * Called when FCM cannot be sent after a successful claim, leaving the order
 * in a diagnosable state in Firestore without blocking future inspection.
 */
async function clearClaim(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  reason: string,
): Promise<void> {
  try {
    await db.doc(`orders/${orderId}`).update({
      fcmDispatchClaimedAt: FieldValue.delete(),
      fcmDispatchClaimedBy: FieldValue.delete(),
      fcmDispatchError:     reason,
      fcmDispatchErrorAt:   FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn({ err, orderId }, "[FCM dispatcher] Failed to clear claim after send error");
  }
}
