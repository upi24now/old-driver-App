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
import { eq } from "drizzle-orm";
import { db as pgDb, driversTable } from "@workspace/db";
import { adminFirestore, adminMessaging } from "./firebase-admin";
import { logger } from "./logger";
import { pgClaimShadowValidate } from "./pg-claim-shadow";
import { pgCreateOffer, pgUpsertOrder } from "./order-pg-service";

/**
 * Create a PG offer row, retrying on transient failure.
 *
 * The offer row carries a FK to orders.id (order_offers_order_id_orders_id_fk).
 * The parent orders row is mirrored into PG by an independent, Firestore-event-
 * driven path (pg-shadow-writer → pgUpsertOrder).  Even after we proactively
 * ensure the orders row here, a bounded retry guards against the parent INSERT
 * not yet being visible to this connection.  pgCreateOffer never throws — it
 * returns { ok:false } on error — so we inspect the result, not exceptions.
 */
async function createOfferWithRetry(
  orderId:   string,
  driverUid: string,
  attempts = 5,
  delayMs  = 250,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await pgCreateOffer(orderId, driverUid);
    if (res.ok) return true;
    if (attempt < attempts) {
      logger.warn({ orderId, driverUid, attempt }, "[PG OFFER CREATE RETRY]");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

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

        // Fast-path: the order is ALREADY claimed/dispatched (e.g. the external
        // Firestore-side dispatcher won the claim before our snapshot arrived).
        // Do NOT send a duplicate FCM — but still mirror the dispatch state into
        // PG so the driver's in-app SSE popup + Accept work. This is the common
        // production state; without it PG stays empty and the popup never shows.
        if (data["fcmDispatchedAt"] || data["fcmDispatchClaimedAt"]) {
          void mirrorClaimedOrderToPg(orderId, targetUids, data);
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
        // `data` (raw Firestore order) is forwarded so the dispatch path can
        // ensure the parent PG orders row exists before creating offer rows.
        void sendOrderFcm(db, orderId, targetUids, orderPayload, data);
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
 * Returns "won"             — this instance won the claim and must send FCM.
 * Returns "already_claimed"  — another dispatch owner (e.g. the external
 *                              Firestore-side dispatcher) already set
 *                              fcmDispatchedAt / fcmDispatchClaimedAt. This
 *                              instance must NOT send a duplicate FCM, but it
 *                              must still mirror the dispatch state into PG.
 * Returns "error"            — claim transaction failed; skip entirely (state
 *                              unknown, so do not mirror).
 */
type FcmClaimResult = "won" | "already_claimed" | "error";

async function claimFcmDispatch(
  db: FirebaseFirestore.Firestore,
  orderId: string,
): Promise<FcmClaimResult> {
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
    return "error";
  }

  return alreadyClaimed ? "already_claimed" : "won";
}

type SendResult = { uid: string; messageId: string } | { uid: string; error: string };

/**
 * Resolve a driver's push token from PostgreSQL (drivers.fcm_token).
 *
 * Lookup:
 *   1. PostgreSQL drivers.fcm_token. If present and non-empty → [PG_FCM_TOKEN_HIT].
 *   2. No usable token (empty, no row, OR PG read error) → [PG_FCM_TOKEN_MISS],
 *      return null.
 *
 * PostgreSQL is the SINGLE source of truth for push tokens — there is no
 * Firestore fallback. Firebase is used only to SEND the message, never to look
 * the token up. A PG read error is logged and treated as a miss (no push), and
 * the full token is never logged (only a short prefix).
 */
async function resolveDriverFcmToken(
  driverUid: string,
  orderId: string,
): Promise<string | null> {
  try {
    const rows = await pgDb
      .select({ fcmToken: driversTable.fcmToken })
      .from(driversTable)
      .where(eq(driversTable.uid, driverUid))
      .limit(1);

    const pgToken = rows[0]?.fcmToken;
    if (typeof pgToken === "string" && pgToken.length > 0) {
      logger.info(
        { orderId, driverUid, tokenPrefix: pgToken.substring(0, 10) + "..." },
        "[PG_FCM_TOKEN_HIT]",
      );
      return pgToken;
    }
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[FCM dispatcher] PG fcm_token read failed");
  }

  logger.warn({ orderId, driverUid }, "[PG_FCM_TOKEN_MISS]");
  return null;
}

/**
 * Mirror an externally-dispatched Firestore order into PG WITHOUT sending FCM.
 *
 * Production runs a SECOND, external Firestore-side dispatcher that claims and
 * dispatches the order first — setting the Firestore offer fields and
 * fcmDispatchedAt / fcmDispatchClaimedAt. When that owner wins the claim, this
 * server must NOT send a duplicate push.  But the driver's in-app ride popup
 * (SSE GET /api/drivers/me/offer-stream) and Accept both read PostgreSQL:
 *   active_offer_driver_uids @> [uid] AND status='dispatched'
 *     AND dispatch_timeout_at > now()  +  an order_offers row.
 * If we just skip, Firestore has the offer but PG is empty → SSE returns [] →
 * the driver never sees the popup and Accept fails with not_in_offer.
 *
 * So on an already-claimed order we mirror the dispatch state into PG exactly as
 * the claim-winning path does (minus the FCM send):
 *   - pgUpsertOrder(..., { mirrorOfferSet:true, guardRegression:true }) →
 *     active_offer_driver_uids + dispatched_at + dispatch_timeout_at
 *   - one pending order_offers row per Firestore activeOfferDriverUid
 *
 * Idempotent and safe to replay: pgUpsertOrder is guarded against regressing a
 * claimed/terminal row, and pgCreateOffer is ON CONFLICT DO NOTHING.
 */
async function mirrorClaimedOrderToPg(
  orderId: string,
  targetUids: string[],
  orderData: Record<string, unknown>,
): Promise<void> {
  logger.info({ orderId, targetCount: targetUids.length }, "[FCM CLAIM SKIP MIRROR START]");

  // 1. Mirror the parent order row — active_offer_driver_uids + dispatch window.
  try {
    await pgUpsertOrder(orderId, orderData, {
      guardRegression:          true,
      mirrorOfferSet:           true,
      synthesizeDispatchWindow: true,
    });
  } catch (err) {
    // pgUpsertOrder is non-throwing; guard the await defensively.
    logger.error({ err, orderId }, "[FCM CLAIM SKIP MIRROR] parent upsert failed");
  }

  // 2. Ensure a pending offer row exists for every Firestore offer target.
  await Promise.all(
    targetUids.map(async (uid) => {
      const ok = await createOfferWithRetry(orderId, uid);
      logger.info({ orderId, uid, ok }, "[FCM CLAIM SKIP MIRROR OFFER]");
    }),
  );

  logger.info({ orderId }, "[FCM CLAIM SKIP MIRROR DONE]");
}

async function sendOrderFcm(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  targetUids: string[],
  order: OrderPayload,
  orderData: Record<string, unknown>,
): Promise<void> {
  // ── 1. Atomically claim dispatch rights ───────────────────────────────────
  const claim = await claimFcmDispatch(db, orderId);
  if (claim !== "won") {
    if (claim === "already_claimed") {
      // Another dispatch owner (the external Firestore-side dispatcher) already
      // claimed/dispatched this order. Do NOT send a duplicate FCM — but DO
      // mirror the dispatch state into PG so the driver's SSE popup + Accept work.
      logger.info(
        { orderId, instanceId: INSTANCE_ID },
        "[FCM dispatcher] Order already claimed or dispatched — mirroring to PG, no FCM",
      );
      await mirrorClaimedOrderToPg(orderId, targetUids, orderData);
    } else {
      // claim === "error": transaction failed, state unknown — skip entirely.
      logger.info({ orderId, instanceId: INSTANCE_ID }, "[FCM dispatcher] Claim failed — skipping");
    }
    return;
  }
  // Claim moment, captured for the read-only PG claim shadow validator below.
  const claimedAtMs = Date.now();

  // ── 1a. Ensure the parent PG orders row exists ──────────────────────────────
  // RACE FIX: the order_offers row carries a FK to orders.id.  The orders row is
  // mirrored into PG by pg-shadow-writer on its OWN Firestore event, which races
  // this dispatch path.  Previously pgCreateOffer could run before that mirror
  // committed → FK violation (order_offers_order_id_orders_id_fk) → the error was
  // swallowed → no offer row → driver Accept returned not_in_offer.  We now
  // proactively upsert the parent row here so offer creation cannot lose the race.
  // pgUpsertOrder is idempotent and guarded against regressing a claimed/terminal
  // row, so a concurrent shadow-writer upsert is harmless.
  //
  // mirrorOfferSet:true also mirrors activeOfferDriverUids into PG here, and the
  // upsert stamps dispatchedAt + dispatchTimeoutAt from the dispatched doc. Without
  // this the PG offer columns stayed empty/NULL (the shadow-writer only mirrors the
  // pool→searching state, never the dispatched transition), so the SSE offer-stream
  // query (active_offer_driver_uids @> [uid] AND status='dispatched' AND
  // dispatch_timeout_at > now()) returned [] and the in-app ride popup never appeared
  // even though FCM was delivered. The dispatched doc is the dispatch trigger, so it
  // always carries activeOfferDriverUids + the dispatch window at this point.
  logger.info({ orderId }, "[ORDER PG CREATED]");
  try {
    await pgUpsertOrder(orderId, orderData, { guardRegression: true, mirrorOfferSet: true });
    logger.info({ orderId }, "[ORDER PG COMMITTED]");
  } catch (err) {
    // pgUpsertOrder is non-throwing, but guard the await defensively.
    logger.error({ err, orderId }, "[ORDER PG COMMITTED] ensure-parent-row failed");
  }

  // ── 1b. Create PG offer rows (gated — FCM depends on these) ──────────────────
  // The accept endpoint (POST /orders/:orderId/accept) requires a row in the
  // order_offers table for the accepting driver.  In Firestore-dispatch mode the
  // round-robin PG dispatcher never runs, so no offer rows are created — we
  // create them here, once, in the single instance that won the FCM claim.
  // pgCreateOffer is idempotent (ON CONFLICT DO NOTHING) so replays are safe.
  //
  // CRITICAL: a driver is only added to the FCM target list AFTER its offer row
  // is confirmed to exist.  We never notify a driver who cannot accept.
  const offerReadyUids: string[] = [];
  await Promise.all(
    targetUids.map(async (uid) => {
      logger.info({ orderId, uid }, "[PG OFFER CREATE START]");
      const ok = await createOfferWithRetry(orderId, uid);
      if (ok) {
        offerReadyUids.push(uid);
        logger.info({ orderId, uid }, "[PG OFFER CREATE SUCCESS]");
      } else {
        logger.error({ orderId, uid }, "[PG OFFER CREATE FAIL]");
      }
    }),
  );

  if (offerReadyUids.length === 0) {
    // No offer row could be created for any target — sending FCM would only
    // produce another not_in_offer on Accept.  Clear the claim so a cold restart
    // can re-attempt, and stop here (no FCM is sent without a valid offer row).
    logger.warn({ orderId }, "[FCM dispatcher] No offer rows created — suppressing FCM and clearing claim");
    await clearClaim(db, orderId, "no offer rows created");
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

  // Only drivers with a confirmed offer row are notified (see offerReadyUids).
  for (const driverUid of offerReadyUids) {
    logger.info({ orderId, driverUid }, "[FCM SEND START]");
    // Read the driver's push token from PostgreSQL (single source of truth).
    const fcmToken = await resolveDriverFcmToken(driverUid, orderId);

    if (!fcmToken) {
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
        "[FCM SEND SUCCESS]",
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

  // ── Phase 5C-C: read-only PG claim shadow validation (additive) ──────────────
  // Fire-and-forget, never throws, never writes/sends — purely compares the
  // Firestore claim/send decision against the reproduced PG claim logic and logs
  // the verdict. Does NOT affect the claim, the send, or the dispatcher.
  const successById = new Map(successes.map((s) => [s.uid, s.messageId]));
  for (const driverUid of targetUids) {
    const messageId = successById.get(driverUid) ?? null;
    // Token resolved iff the send did not fail with the "No fcmToken" sentinel.
    const tokenPresent = !failures.some((f) => f.uid === driverUid && f.error === "No fcmToken");
    void pgClaimShadowValidate(orderId, {
      orderId,
      claimed:               true,
      claimedBy:             INSTANCE_ID,
      claimedAtMs,
      messageId,
      activeOfferDriverUids: targetUids,
      targetDriverUid:       driverUid,
      tokenPresent,
    });
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
