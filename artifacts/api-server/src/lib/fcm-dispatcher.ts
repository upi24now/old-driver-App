/**
 * FCM Order Dispatcher
 *
 * Attaches a Firestore listener on server startup.
 * Sends a high-priority FCM push to every driver targeted by an order.
 *
 * Supports two dispatch models:
 *
 *   Phase 1 — round-robin / assigned driver:
 *     Order has driverUid: string.  Sends to that single driver.
 *
 *   Phase 2 — broadcast offer:
 *     Order has activeOfferDriverUids: string[].  Sends to every UID in the
 *     array.  driverUid is absent until a driver accepts — the dispatcher
 *     reads activeOfferDriverUids first and falls back to driverUid.
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
 *   After all sends complete:
 *     - fcmDispatchedAt is always written (canonical "done" flag).
 *     - Phase 1: fcmMessageId (string) written for backward compatibility.
 *     - Phase 2: fcmMessageIds (Record<uid,messageId>) written for successes.
 *     - Any per-UID failures write fcmDispatchErrors (Record<uid,reason>).
 *   If every UID fails: claim fields are cleared; fcmDispatchError is written.
 *
 * Safety:
 *   - Only drivers in activeOfferDriverUids (or driverUid) receive a push.
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

        const orderId = doc.id;

        // ── Resolve target UIDs ──────────────────────────────────────────────
        // Phase 2: activeOfferDriverUids is authoritative when present.
        // Phase 1: fall back to the single driverUid string.
        const rawOfferUids = data["activeOfferDriverUids"];
        const targetUids: string[] = Array.isArray(rawOfferUids)
          ? (rawOfferUids as unknown[]).filter((u): u is string => typeof u === "string")
          : typeof data["driverUid"] === "string"
            ? [data["driverUid"] as string]
            : [];

        if (targetUids.length === 0) {
          logger.warn({ orderId }, "[FCM dispatcher] Dispatched order has no target UIDs — skipping");
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

        // Fire-and-forget per order; errors are logged and written individually.
        void sendOrderFcm(db, orderId, targetUids, orderPayload);
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

type SendResult = { uid: string; messageId: string } | { uid: string; error: string };

async function sendOrderFcm(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  targetUids: string[],
  order: OrderPayload,
): Promise<void> {
  // ── 1. Atomically claim dispatch rights ───────────────────────────────────
  const claimed = await claimFcmDispatch(db, orderId);
  if (!claimed) {
    logger.info({ orderId, instanceId: INSTANCE_ID }, "[FCM dispatcher] Order already claimed or dispatched — skipping");
    return;
  }

  const notifBody = order.earning !== "0" && order.distanceKm !== "0"
    ? `₹${order.earning} • ${order.distanceKm} km — ${order.customer || "New order"}`
    : order.customer || "You have a new delivery request";

  // ── 2. Send to each target UID independently ─────────────────────────────
  //
  // Token routing (detected by prefix):
  //   ExponentPushToken[...] → Expo push relay  (Expo Go + dev/prod builds)
  //   raw FCM token          → Firebase Admin SDK (future direct-FCM prod builds)
  //
  // WHY TWO PATHS:
  //   getDevicePushTokenAsync() in Expo Go returns a token minted by Expo's own
  //   Firebase sender ID, not the app's project, causing "SenderId mismatch".
  //   Expo push tokens (getExpoPushTokenAsync) are always relayed by Expo's
  //   servers using Expo's credentials, so they always match regardless of
  //   which Firebase project the app belongs to.

  // Lazy Firebase Admin Messaging — only initialised if a raw FCM token is
  // encountered.  Expo push token sends never touch the Admin SDK.
  let _messaging: Awaited<ReturnType<typeof adminMessaging>> | null = null;
  const getAdminMessaging = async () => {
    if (!_messaging) _messaging = await adminMessaging();
    return _messaging;
  };

  const results: SendResult[] = [];

  for (const driverUid of targetUids) {
    // Read the driver's push token.
    let fcmToken: string | null = null;
    try {
      const driverSnap = await db.doc(`drivers/${driverUid}`).get();
      const token = driverSnap.data()?.["fcmToken"];
      fcmToken = typeof token === "string" && token.length > 0 ? token : null;
    } catch (err) {
      logger.error({ err, orderId, driverUid }, "[FCM dispatcher] Failed to read driver fcmToken");
      results.push({ uid: driverUid, error: "Failed to read fcmToken" });
      continue;
    }

    if (!fcmToken) {
      logger.warn({ orderId, driverUid }, "[FCM dispatcher] Driver has no fcmToken — skipping push");
      results.push({ uid: driverUid, error: "No fcmToken" });
      continue;
    }

    // Send the push — route by token type.
    try {
      let messageId: string;

      if (fcmToken.startsWith("ExponentPushToken[")) {
        // ── Expo push relay ────────────────────────────────────────────────
        // Works universally: Expo Go, dev builds, and production APK.
        // Expo's servers relay the notification to the device via FCM using
        // Expo's own sender credentials, so there is never a sender mismatch.
        type ExpoTicket = { status: string; id?: string; message?: string; details?: unknown };
        const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
          method:  "POST",
          headers: {
            "Content-Type":    "application/json",
            "Accept":          "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify({
            to:       fcmToken,
            title:    "🛵 New Delivery Request",
            body:     notifBody,
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
            channelId: CHANNEL_ORDERS,
            sound:     "ringtone",
            priority:  "high",
            ttl:       30,
          }),
        });

        const expoJson = (await expoRes.json()) as { data?: ExpoTicket; errors?: unknown[] };
        const ticket   = expoJson.data;

        if (!ticket || ticket.status !== "ok") {
          throw new Error(
            `Expo push error: ${ticket?.message ?? JSON.stringify(expoJson)}`,
          );
        }
        messageId = ticket.id ?? "expo-ok";

      } else {
        // ── Firebase Admin SDK (raw FCM device token) ──────────────────────
        // Used when the app registers via getDevicePushTokenAsync() from a
        // production APK with a correctly baked-in google-services.json.
        const messaging = await getAdminMessaging();
        messageId = await messaging.send({
          token: fcmToken,
          notification: {
            title: "🛵 New Delivery Request",
            body:  notifBody,
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
              channelId:            CHANNEL_ORDERS,
              sound:                "ringtone",
              visibility:           "public",
              priority:             "max",
              // Vibration pattern (ms): 0 delay, 1200 on, 200 off × 2, 500 tail.
              // This fires once at notification delivery — the JS-layer
              // Vibration.vibrate(pattern, true) loop takes over when the
              // foreground screen mounts (ride-request / lock-alert).
              vibrateTimingsMillis: [0, 1200, 200, 1200, 200, 1200, 500],
              defaultVibrateTimings: false,
            },
          },
        });
      }

      logger.info(
        { orderId, driverUid, messageId, instanceId: INSTANCE_ID, tokenPrefix: fcmToken.substring(0, 10) + "..." },
        "[FCM dispatcher] push sent",
      );
      results.push({ uid: driverUid, messageId });
    } catch (err) {
      logger.error({ err, orderId, driverUid }, "[FCM dispatcher] FCM send failed");
      results.push({ uid: driverUid, error: err instanceof Error ? err.message : "Unknown FCM send error" });
    }
  }

  // ── 4. Write results back to Firestore ───────────────────────────────────
  const successes = results.filter((r): r is { uid: string; messageId: string } => "messageId" in r);
  const failures  = results.filter((r): r is { uid: string; error: string }     => "error"     in r);

  // If every UID failed, clear the claim so the order is diagnosable and a
  // cold-restart of the server would re-attempt (claim is gone).
  if (successes.length === 0) {
    const reason = failures.map((f) => `${f.uid}: ${f.error}`).join("; ");
    logger.warn({ orderId, reason }, "[FCM dispatcher] All FCM sends failed — clearing claim");
    await clearClaim(db, orderId, reason);
    return;
  }

  // Build the update payload.
  // Phase 1 (single driver): write fcmMessageId (string) for backward compat.
  // Phase 2 (multiple drivers): write fcmMessageIds (Record<uid,messageId>).
  const updateData: Record<string, unknown> = {
    fcmDispatchedAt: FieldValue.serverTimestamp(),
  };

  if (targetUids.length === 1 && successes.length === 1) {
    updateData["fcmMessageId"] = successes[0].messageId;
  } else {
    updateData["fcmMessageIds"] = Object.fromEntries(successes.map((s) => [s.uid, s.messageId]));
  }

  if (failures.length > 0) {
    updateData["fcmDispatchErrors"] = Object.fromEntries(failures.map((f) => [f.uid, f.error]));
  }

  try {
    await db.doc(`orders/${orderId}`).update(updateData);
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
