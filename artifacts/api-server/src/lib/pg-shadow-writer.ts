/**
 * PG Shadow Writer — Phase 1B
 *
 * Listens to Firestore order status changes that are initiated by the mobile
 * (accept, delivery stage progressions) and mirrors them into PostgreSQL.
 *
 * This module is entirely additive — it never reads from PG and never
 * influences the Firestore write path.  All errors are swallowed after
 * logging; a PG write failure never blocks or alters dispatch behaviour.
 *
 * Shadow write tags (searchable in logs):
 *   [PG_SHADOW_ACCEPT]    — order accepted by driver (driver_assigned)
 *   [PG_SHADOW_STATUS]    — delivery stage transition (to_pickup … at_drop)
 *   [PG_INGRESS_POOL]     — Phase 5H-BRIDGE-1: new/returned pool order mirrored
 *   [PG_INGRESS_CANCELLED]— Phase 5H-BRIDGE-1: cancelled order removed from pool
 *
 * Dispatch-initiated shadow tags are emitted from round-robin-dispatcher.ts:
 *   [PG_SHADOW_OFFER]   — offer row created
 *   [PG_SHADOW_TIMEOUT] — offer timed out, order returned to pool
 *   [PG_SHADOW_REJECT]  — offer rejected by driver
 *   [PG_SHADOW_STATUS]  — dispatched / searching status mirrors
 *
 * Delivered status is mirrored directly from the POST /complete route.
 *
 * ── Phase 5H-BRIDGE-1: Firestore → PG order ingress ──────────────────────────
 * Listeners 4 and 5 give PostgreSQL the LIVE dispatch pool so a future
 * PG-authoritative dispatcher has orders to act on. Before this phase the only
 * path that created an orders row was the round-robin dispatcher AFTER it had
 * already assigned a driver (status="dispatched") — so a brand-new "searching"
 * order with driver_uid IS NULL never reached PG, leaving the PG dispatcher's
 * pool query (status IN (searching,pending) AND driver_uid IS NULL) permanently
 * empty for fresh orders. These listeners are entirely additive, never read PG,
 * never write Firestore, never send FCM, and never alter dispatch behaviour.
 * Firestore stays fully authoritative.
 */

import { adminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { resolveDispatchSource } from "./dispatch-source";
import {
  pgShadowCancelOrder,
  pgShadowMarkAccept,
  pgShadowSetStatus,
  pgUpsertOrder,
  pgUpsertOrderOtp,
} from "./order-pg-service";

// Statuses that mean "this order is in the pool, awaiting a driver".
// Mirrors POOL_STATUSES in round-robin-dispatcher.ts / pg-dispatcher.ts.
const POOL_STATUSES = ["searching", "pending"] as const;

// Delivery stages that the mobile transitions through after accept.
// "delivered" is excluded — it is mirrored from POST /complete server-side.
const DELIVERY_STAGE_STATUSES = ["to_pickup", "at_pickup", "to_drop", "at_drop"] as const;
type DeliveryStage = typeof DELIVERY_STAGE_STATUSES[number];

/**
 * Bounded retry around pgUpsertOrderOtp.
 *
 * The OTP lives in a private subcollection ("orders/{id}/private/otp") whose
 * Firestore "added" event can race ahead of the parent order mirror, producing a
 * transient FK violation (order_otps.order_id → orders.id). Retrying a few times
 * lets the parent row land first. Mirrors createOfferWithRetry in fcm-dispatcher.
 * Only retries the FK-race reason; a hard error stops immediately. Never throws.
 */
async function upsertOtpWithRetry(
  orderId:  string,
  value:    string,
  attempts = 5,
  delayMs  = 250,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await pgUpsertOrderOtp(orderId, value);
    if (res.ok) return true;
    if (res.reason !== "fk_missing_parent") return false;
    if (attempt < attempts) {
      logger.warn({ orderId, attempt }, "[PG_SHADOW_OTP_RETRY]");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

export async function startPgShadowWriter(): Promise<void> {
  let db: Awaited<ReturnType<typeof adminFirestore>>;
  try {
    db = await adminFirestore();
  } catch (err) {
    logger.warn({ err }, "[PG shadow writer] Firebase Admin unavailable — skipping startup");
    return;
  }

  // ── Listener 1: driver_assigned (mobile accept) ───────────────────────────
  // Fires when a driver accepts the order on their device, which transitions
  // the Firestore order from "dispatched" to "driver_assigned".
  db.collection("orders")
    .where("status", "==", "driver_assigned")
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;

          const orderId = change.doc.id;
          const data    = change.doc.data() as Record<string, unknown>;

          const driverUid  = typeof data["driverUid"]  === "string" ? data["driverUid"]  : null;
          const driverName = typeof data["driverName"] === "string" ? data["driverName"] : null;

          if (!driverUid) {
            logger.warn({ orderId }, "[PG_SHADOW_ACCEPT] driver_assigned doc missing driverUid — skipping");
            continue;
          }

          void (async () => {
            await pgShadowMarkAccept(orderId, driverUid, driverName);
            logger.info({ orderId, driverUid }, "[PG_SHADOW_ACCEPT]");
          })().catch((e) =>
            logger.error({ err: e, orderId, driverUid }, "[PG_SHADOW_ACCEPT] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] driver_assigned listener error");
      },
    );

  // ── Listener 2: delivery stage transitions ────────────────────────────────
  // Covers to_pickup, at_pickup, to_drop, at_drop — each triggered by the
  // driver tapping a stage button in active-delivery.tsx.
  // "delivered" is handled server-side in POST /complete.
  db.collection("orders")
    .where("status", "in", [...DELIVERY_STAGE_STATUSES])
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;

          const orderId = change.doc.id;
          const data    = change.doc.data() as Record<string, unknown>;
          const status  = data["status"] as DeliveryStage;

          void (async () => {
            await pgShadowSetStatus(orderId, status);
            logger.info({ orderId, status }, "[PG_SHADOW_STATUS]");
          })().catch((e) =>
            logger.error({ err: e, orderId, status }, "[PG_SHADOW_STATUS] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] delivery stage listener error");
      },
    );

  // ── Listener 3: OTP shadow writer ─────────────────────────────────────────
  // Mirrors orders/{orderId}/private/otp into the order_otps PG table.
  //
  // Uses a collection group query on "private" so a single listener covers
  // the OTP subcollection across all orders.  Only documents named "otp"
  // are processed; any other private subdocs (if added later) are skipped.
  //
  // The INSERT into order_otps carries a FK to orders.id, so if the order
  // row does not yet exist in PG when the OTP arrives, the write will fail
  // and be logged — this is expected for orders created before dispatch.
  db.collectionGroup("private")
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added" && change.type !== "modified") continue;

          // Only the "otp" document within the private subcollection
          if (change.doc.id !== "otp") continue;

          // Path shape: "orders/{orderId}/private/otp"
          const parts = change.doc.ref.path.split("/");
          if (parts.length !== 4 || parts[0] !== "orders") continue;

          const orderId = parts[1]!;
          const docData = change.doc.data() as Record<string, unknown>;
          const value   = typeof docData["value"] === "string"
            ? docData["value"]
            : typeof docData["value"] === "number"
            ? String(docData["value"])
            : null;

          if (!value) {
            logger.warn({ orderId }, "[PG_SHADOW_OTP] missing value field — skipping");
            continue;
          }

          void (async () => {
            const ok = await upsertOtpWithRetry(orderId, value);
            if (ok) {
              logger.info({ orderId }, "[PG_SHADOW_OTP]");
            } else {
              logger.error(
                { orderId },
                "[PG_SHADOW_OTP] gave up after retries — parent orders row never mirrored",
              );
            }
          })().catch((e) =>
            logger.error({ err: e, orderId }, "[PG_SHADOW_OTP] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] OTP listener error");
      },
    );

  // ── Listener 4: pool ingress (Phase 5H-BRIDGE-1) ──────────────────────────
  // Mirror new and returned-to-pool orders into PG the moment they enter the
  // "searching"/"pending" pool — BEFORE any dispatch — so the PG dispatcher has
  // a live pool to act on. A doc enters this filtered query (an "added" change)
  // both when the customer first creates it and when returnToPool resets a timed
  // out dispatch back to "searching". pgUpsertOrder is idempotent: a fresh INSERT
  // for new orders, an UPDATE of dispatch-cycle fields for ones already mirrored.
  db.collection("orders")
    .where("status", "in", [...POOL_STATUSES])
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;

          const orderId = change.doc.id;
          const data    = change.doc.data() as Record<string, unknown>;
          const status  = typeof data["status"] === "string" ? data["status"] : null;

          void (async () => {
            // Mirror the order's own pool status as-is, but guard against
            // resurrecting a claimed/terminal order: a delayed/replayed pool
            // "added" event must never overwrite a row that has progressed past
            // the pool (driver_assigned … delivered) or been cancelled.
            //
            // Phase 5H-BRIDGE-3 (mode-aware guard): in pg-authoritative mode the
            // PG dispatcher owns the dispatched→searching transition (it returns
            // to pool in PG and projects outward), so a Firestore pool "added"
            // event must NEVER regress a PG-authoritative "dispatched" row — narrow
            // the guard to [searching, pending]. In firestore mode the
            // returnToPool originates in Firestore and MUST mirror back, so keep
            // "dispatched" in the set (the default).
            const guardStatuses = resolveDispatchSource().value === "pg"
              ? ["searching", "pending"]
              : ["searching", "pending", "dispatched"];
            await pgUpsertOrder(orderId, data, { guardRegression: true, guardStatuses });
            logger.info({ orderId, status }, "[PG_INGRESS_POOL]");
          })().catch((e) =>
            logger.error({ err: e, orderId, status }, "[PG_INGRESS_POOL] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] pool ingress listener error");
      },
    );

  // ── Listener 5: cancellation ingress (Phase 5H-BRIDGE-1/2) ────────────────
  // Mirror cancellations so a cancelled order is removed from PG's dispatch
  // pool. Customers/system may cancel while the order is still "searching"
  // (before any dispatch), a transition no existing listener covered.
  //
  // Phase 5H-BRIDGE-2 (cancel-vs-pool race fix): uses pgShadowCancelOrder
  // (UPSERT), not pgShadowSetStatus (UPDATE-only). The old UPDATE no-opped when
  // the cancel was processed before the order's first pool ingress, leaving the
  // row to be later INSERTed as "searching" by a delayed pool event — a
  // cancelled order resurrected into the pool. The upsert INSERTs a terminal
  // cancelled row if missing, so the order can never re-enter the pool, and the
  // guarded pool ingress (Listener 4) skips any terminal row on conflict.
  db.collection("orders")
    .where("status", "==", "cancelled")
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;

          const orderId = change.doc.id;

          void (async () => {
            await pgShadowCancelOrder(orderId);
            logger.info({ orderId }, "[PG_INGRESS_CANCELLED]");
          })().catch((e) =>
            logger.error({ err: e, orderId }, "[PG_INGRESS_CANCELLED] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] cancellation ingress listener error");
      },
    );

  // ── Listener 6: dispatch-cycle mirror (Phase 5H-BRIDGE-2) ─────────────────
  // The offer set lives at status="dispatched" (fcm-dispatcher.ts and
  // pg-claim-shadow.ts both key off status==="dispatched" + activeOfferDriverUids).
  // A driver reject / timeout is a mobile-initiated `arrayRemove(driverUid)` on
  // activeOfferDriverUids that leaves status unchanged — a "modified" event no
  // other listener captured, so PG's active_offer_driver_uids (read by the claim
  // shadow validator) drifted from Firestore. This listener mirrors those in-place
  // dispatch-cycle field changes while an order is dispatched.
  //
  // Only "modified" is handled: "added" (status→dispatched) is already mirrored
  // by the dispatcher's own pgUpsertOrder, and "removed" (left "dispatched", e.g.
  // accept→driver_assigned or cancel) is handled by the accept/cancel listeners.
  // guardRegression keeps a stale event from resurrecting a claimed/terminal row;
  // mirrorOfferSet writes the active_offer_driver_uids column.
  db.collection("orders")
    .where("status", "==", "dispatched")
    .onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "modified") continue;

          const orderId = change.doc.id;
          const data    = change.doc.data() as Record<string, unknown>;
          const offerSize = Array.isArray(data["activeOfferDriverUids"])
            ? (data["activeOfferDriverUids"] as unknown[]).length
            : null;

          void (async () => {
            await pgUpsertOrder(orderId, data, {
              guardRegression:          true,
              mirrorOfferSet:           true,
              synthesizeDispatchWindow: true,
            });
            logger.info({ orderId, offerSize }, "[PG_INGRESS_CYCLE]");
          })().catch((e) =>
            logger.error({ err: e, orderId }, "[PG_INGRESS_CYCLE] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] dispatch-cycle listener error");
      },
    );

  logger.info(
    "[PG shadow writer] Running — listening for driver_assigned, delivery stages, OTP, pool ingress, cancellations, and dispatch-cycle changes",
  );
}
