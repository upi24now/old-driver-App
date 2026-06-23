/**
 * SSE hub (Phase 5J-Tier-6).
 *
 * A single process-wide LISTEN connection receives pg_notify('sse_event', …)
 * messages emitted by the orders trigger (see sse-trigger.ts) and re-broadcasts
 * them on an in-process EventEmitter. Each open SSE response subscribes and
 * filters for the events relevant to it (its driver uid or order id), then
 * re-queries current state and pushes a fresh snapshot.
 *
 * Why re-query instead of pushing the notify payload: the apps relied on
 * Firestore onSnapshot semantics where every callback delivered the *current*
 * document state. Re-querying makes every push self-healing and makes reconnect
 * (replay-from-cursor) trivially correct — the client always converges on the
 * true current state regardless of missed notifies.
 */

import { EventEmitter } from "node:events";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// Minimal structural type for the dedicated LISTEN connection. Declared locally
// because the `pg` package is only a transitive dependency (via @workspace/db)
// and is not directly resolvable for a type-only import here.
interface DedicatedClient {
  on(event: "notification", cb: (msg: { payload?: string | null }) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  query(sql: string): Promise<unknown>;
  release(err?: Error | boolean): void;
}

export type SseNotify =
  | { t: "offer"; d: string; i: number }
  | { t: "order"; o: string; i: number };

const emitter = new EventEmitter();
// Each SSE connection registers one listener; allow plenty of concurrent drivers.
emitter.setMaxListeners(0);

let listenClient: DedicatedClient | null = null;
let starting = false;

/**
 * Open (or re-open) the dedicated LISTEN connection. Idempotent. On connection
 * error the client is dropped and a reconnect is scheduled; SSE handlers keep
 * working via their heartbeat-time cursor catch-up in the meantime.
 */
export async function startSseHub(): Promise<void> {
  if (listenClient || starting) return;
  starting = true;
  try {
    const client = (await pool.connect()) as unknown as DedicatedClient;
    listenClient = client;

    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as SseNotify;
        emitter.emit("sse", parsed);
      } catch (err) {
        logger.warn({ err, payload: msg.payload }, "[SSE_HUB] bad notify payload");
      }
    });

    client.on("error", (err) => {
      logger.error({ err }, "[SSE_HUB] listen client error; reconnecting");
      try { client.release(err); } catch { /* already released */ }
      if (listenClient === client) listenClient = null;
      scheduleReconnect();
    });

    await client.query("LISTEN sse_event");
    logger.info("[SSE_HUB] listening on sse_event channel");
  } catch (err) {
    logger.error({ err }, "[SSE_HUB] failed to start; will retry");
    listenClient = null;
    scheduleReconnect();
  } finally {
    starting = false;
  }
}

function scheduleReconnect(): void {
  setTimeout(() => { void startSseHub(); }, 3000);
}

/** Subscribe to broadcast notifications. Returns an unsubscribe function. */
export function onSseNotify(handler: (n: SseNotify) => void): () => void {
  emitter.on("sse", handler);
  return () => emitter.off("sse", handler);
}

/** Current max sse_events id, used as the initial reconnect cursor. */
export async function currentEventCursor(): Promise<number> {
  const { rows } = await pool.query<{ max: string | null }>(
    "SELECT MAX(id)::bigint AS max FROM sse_events",
  );
  return rows[0]?.max ? Number(rows[0].max) : 0;
}

/**
 * Return the max sse_events id strictly greater than `cursor` that matches the
 * given filter, or null when none. Used by the heartbeat catch-up to detect
 * missed notifies (NOTIFY is best-effort) and force a re-emit.
 */
export async function nextMatchingCursor(
  cursor: number,
  filter: { topic: "offer"; driverUid: string } | { topic: "order"; orderId: string },
): Promise<number | null> {
  const where =
    filter.topic === "offer"
      ? { sql: "topic = 'offer' AND driver_uid = $2", param: filter.driverUid }
      : { sql: "topic = 'order' AND order_id = $2", param: filter.orderId };

  const { rows } = await pool.query<{ max: string | null }>(
    `SELECT MAX(id)::bigint AS max FROM sse_events WHERE id > $1 AND ${where.sql}`,
    [cursor, where.param],
  );
  return rows[0]?.max ? Number(rows[0].max) : null;
}

// ── SSE response helpers ──────────────────────────────────────────────────────

import type { Response } from "express";

/** Write the SSE response headers and flush them so the client connects. */
export function writeSseHeaders(res: Response): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering so events flush immediately through the reverse proxy.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/** Write a single SSE data frame with an event id (the reconnect cursor). */
export function writeSseEvent(res: Response, id: number, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Write a heartbeat comment frame to keep the connection alive. */
export function writeSseHeartbeat(res: Response): void {
  res.write(`: ping\n\n`);
}
