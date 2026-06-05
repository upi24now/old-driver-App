/**
 * FCM Order Dispatcher
 *
 * Attaches a Firestore listener on server startup.
 * When an order transitions to status="dispatched" and has a driverUid,
 * sends a high-priority FCM push notification to the driver's device.
 *
 * Duplicate prevention:
 *   After a successful send, writes `fcmDispatchedAt` (server timestamp)
 *   to the order document.  Any order that already has this field is skipped.
 *   Firestore onSnapshot reports all currently-matching docs as "added" on
 *   first connect, so the field check also handles server restarts correctly.
 *
 * Safety:
 *   - Only the assigned driver receives the notification (token looked up
 *     from drivers/{driverUid} — never sent broadcast).
 *   - Full fcmToken is never logged.
 *   - No order stage or accept/reject logic is touched.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminFirestore, adminMessaging } from "./firebase-admin";
import { logger } from "./logger";

const CHANNEL_ORDERS = "incoming_orders_v2";

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
      // connect and only new/changed docs thereafter. We process every
      // "added" change; the fcmDispatchedAt guard prevents duplicate sends.
      for (const change of snapshot.docChanges()) {
        if (change.type !== "added") continue;

        const doc  = change.doc;
        const data = doc.data() as Record<string, unknown>;

        // Skip if FCM already dispatched for this order
        if (data["fcmDispatchedAt"]) continue;

        const orderId   = doc.id;
        const driverUid = typeof data["driverUid"] === "string" ? data["driverUid"] : null;

        if (!driverUid) {
          logger.warn({ orderId }, "[FCM dispatcher] Dispatched order has no driverUid — skipping");
          continue;
        }

        // Fire-and-forget per order; errors are logged individually
        void sendOrderFcm(db, orderId, driverUid);
      }
    },
    (err) => {
      logger.error({ err }, "[FCM dispatcher] Firestore listener error");
    },
  );

  logger.info("[FCM dispatcher] Listening for dispatched orders");
}

async function sendOrderFcm(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  driverUid: string,
): Promise<void> {
  // ── 1. Read driver fcmToken ───────────────────────────────────────────────
  let fcmToken: string | null = null;
  try {
    const driverSnap = await db.doc(`drivers/${driverUid}`).get();
    const token = driverSnap.data()?.["fcmToken"];
    fcmToken = typeof token === "string" && token.length > 0 ? token : null;
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[FCM dispatcher] Failed to read driver fcmToken");
    return;
  }

  if (!fcmToken) {
    logger.warn({ orderId, driverUid }, "[FCM dispatcher] Driver has no fcmToken — skipping push");
    return;
  }

  // ── 2. Send FCM ───────────────────────────────────────────────────────────
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
        type:      "incoming_order",
        orderId,
        driverUid,
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
    // Do NOT write fcmDispatchedAt — allow retry on next listener event
    logger.error(
      { err, orderId, driverUid },
      "[FCM dispatcher] FCM send failed",
    );
    return;
  }

  logger.info(
    { orderId, driverUid, messageId, tokenPrefix: fcmToken.substring(0, 10) + "..." },
    "[FCM dispatcher] FCM push sent",
  );

  // ── 3. Mark order to prevent duplicate sends ──────────────────────────────
  try {
    await db.doc(`orders/${orderId}`).update({
      fcmDispatchedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal — worst case is sending the notification again on restart
    logger.warn(
      { err, orderId },
      "[FCM dispatcher] Failed to write fcmDispatchedAt — may resend on restart",
    );
  }
}
