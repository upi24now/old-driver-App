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
 *   [PG_SHADOW_ACCEPT]  — order accepted by driver (driver_assigned)
 *   [PG_SHADOW_STATUS]  — delivery stage transition (to_pickup … at_drop)
 *
 * Dispatch-initiated shadow tags are emitted from round-robin-dispatcher.ts:
 *   [PG_SHADOW_OFFER]   — offer row created
 *   [PG_SHADOW_TIMEOUT] — offer timed out, order returned to pool
 *   [PG_SHADOW_REJECT]  — offer rejected by driver
 *   [PG_SHADOW_STATUS]  — dispatched / searching status mirrors
 *
 * Delivered status is mirrored directly from the POST /complete route.
 */

import { adminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { pgShadowMarkAccept, pgShadowSetStatus, pgUpsertOrderOtp } from "./order-pg-service";

// Delivery stages that the mobile transitions through after accept.
// "delivered" is excluded — it is mirrored from POST /complete server-side.
const DELIVERY_STAGE_STATUSES = ["to_pickup", "at_pickup", "to_drop", "at_drop"] as const;
type DeliveryStage = typeof DELIVERY_STAGE_STATUSES[number];

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
            await pgUpsertOrderOtp(orderId, value);
            logger.info({ orderId }, "[PG_SHADOW_OTP]");
          })().catch((e) =>
            logger.error({ err: e, orderId }, "[PG_SHADOW_OTP] unexpected error — continuing"),
          );
        }
      },
      (err) => {
        logger.error({ err }, "[PG shadow writer] OTP listener error");
      },
    );

  logger.info("[PG shadow writer] Running — listening for driver_assigned, delivery stages, and OTP");
}
