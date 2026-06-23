/**
 * Server-Sent Events routes (Phase 5J-Tier-6).
 *
 * Replace the Driver App's two Firestore onSnapshot listeners:
 *   • GET /api/drivers/me/offer-stream  — replaces L1 listenToAllDispatchedOrders
 *   • GET /api/orders/:orderId/stream   — replaces L2 listenToActiveOrder
 *
 * Both stream PG-backed state. Authority, FCM, the customer app, and the PG
 * dispatcher are untouched — these are read-only realtime projections of the
 * `orders` table driven by the sse_events trigger + LISTEN/NOTIFY hub.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/require-auth";
import { pgGetOffersForDriver, pgGetOrder } from "../lib/order-pg-service";
import { pgOrderToOrderDoc } from "../lib/sse-order-map";
import {
  onSseNotify,
  currentEventCursor,
  nextMatchingCursor,
  writeSseHeaders,
  writeSseEvent,
  writeSseHeartbeat,
  type SseNotify,
} from "../lib/sse-hub";

const router: IRouter = Router();

const HEARTBEAT_MS = 20_000;

/** Parse a numeric Last-Event-ID header, or null when absent/invalid. */
function lastEventId(req: Request): number | null {
  const raw = req.headers["last-event-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (!val) return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── GET /api/drivers/me/offer-stream (replaces L1) ───────────────────────────
router.get("/drivers/me/offer-stream", async (req: Request, res: Response) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  writeSseHeaders(res);

  // Reconnect cursor: resume from Last-Event-ID, else start at the current tail.
  let cursor = lastEventId(req) ?? (await currentEventCursor());

  const emitSnapshot = async (id: number) => {
    const orders = await pgGetOffersForDriver(uid);
    writeSseEvent(res, id, orders.map(pgOrderToOrderDoc));
  };

  // Always push current state on connect (self-healing reconnect).
  try {
    await emitSnapshot(cursor);
  } catch (err) {
    req.log.error({ err, uid }, "[SSE_OFFER] initial snapshot failed");
  }

  let busy = false;
  let pending = false;
  const refresh = async (id: number) => {
    cursor = Math.max(cursor, id);
    if (busy) { pending = true; return; }
    busy = true;
    try {
      await emitSnapshot(cursor);
    } catch (err) {
      req.log.error({ err, uid }, "[SSE_OFFER] refresh failed");
    } finally {
      busy = false;
      if (pending) { pending = false; void refresh(cursor); }
    }
  };

  const unsub = onSseNotify((n: SseNotify) => {
    if (n.t === "offer" && n.d === uid) void refresh(n.i);
  });

  // Heartbeat + NOTIFY-miss catch-up.
  const hb = setInterval(() => {
    writeSseHeartbeat(res);
    nextMatchingCursor(cursor, { topic: "offer", driverUid: uid })
      .then((next) => { if (next !== null) void refresh(next); })
      .catch(() => { /* transient; next heartbeat retries */ });
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(hb);
    unsub();
    res.end();
  });
});

// ── GET /api/orders/:orderId/stream (replaces L2) ────────────────────────────
router.get("/orders/:orderId/stream", async (req: Request, res: Response) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const orderId = String(req.params["orderId"]);
  writeSseHeaders(res);

  let cursor = lastEventId(req) ?? (await currentEventCursor());

  // Ownership is enforced per-emit: a driver only ever sees the status of an
  // order assigned to them; anything else (missing row, or owned by another
  // driver) is reported as null — the same "deleted/gone" signal L2 used.
  //
  // To avoid an activity side channel, notify-driven refreshes for an order the
  // caller does NOT own are SUPPRESSED entirely (no frame), so a non-owner
  // cannot infer that a foreign order exists or is changing by observing event
  // cadence. We still emit exactly once on initial connect (L2 parity), and we
  // emit one final null on an owner→non-owner transition (e.g. reassignment) so
  // a previously-owning client correctly converges to "gone".
  let wasOwner = false;
  const emitStatus = async (id: number, isInitial: boolean) => {
    const order = await pgGetOrder(orderId);
    const isOwner = !!order && order.driverUid === uid;
    if (isInitial || isOwner || wasOwner) {
      const status = isOwner && order ? order.status : null;
      writeSseEvent(res, id, { status });
    }
    wasOwner = isOwner;
  };

  try {
    await emitStatus(cursor, true);
  } catch (err) {
    req.log.error({ err, orderId, uid }, "[SSE_ORDER] initial snapshot failed");
  }

  let busy = false;
  let pending = false;
  const refresh = async (id: number) => {
    cursor = Math.max(cursor, id);
    if (busy) { pending = true; return; }
    busy = true;
    try {
      await emitStatus(cursor, false);
    } catch (err) {
      req.log.error({ err, orderId, uid }, "[SSE_ORDER] refresh failed");
    } finally {
      busy = false;
      if (pending) { pending = false; void refresh(cursor); }
    }
  };

  const unsub = onSseNotify((n: SseNotify) => {
    if (n.t === "order" && n.o === orderId) void refresh(n.i);
  });

  const hb = setInterval(() => {
    writeSseHeartbeat(res);
    nextMatchingCursor(cursor, { topic: "order", orderId })
      .then((next) => { if (next !== null) void refresh(next); })
      .catch(() => { /* transient; next heartbeat retries */ });
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(hb);
    unsub();
    res.end();
  });
});

export default router;
