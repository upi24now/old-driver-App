import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── sse_events ─────────────────────────────────────────────────────────────────
//
// Durable realtime event tail for the Driver App SSE streams (Phase 5J-Tier-6).
// Replaces the Firestore onSnapshot listeners L1 (offers) and L2 (active order).
//
// Rows are written exclusively by an exception-safe AFTER INSERT/UPDATE trigger
// on the `orders` table (see api-server/src/lib/sse-trigger.ts). The trigger
// also issues pg_notify('sse_event', …) so the in-process SSE hub can push
// without polling. The bigserial `id` is the SSE event id used for the
// `Last-Event-ID` reconnect cursor.
//
// topic:
//   'offer' — a driver's set of active offers may have changed (driver_uid set)
//   'order' — a single order's status changed (order_id set)
//
// This is an append-only audit/tail; it is never read by the apps directly and
// can be pruned by age without affecting correctness (handlers always re-query
// current state, so the tail is only a wakeup + reconnect cursor mechanism).

export const sseEventsTable = pgTable(
  "sse_events",
  {
    id:        bigserial("id", { mode: "number" }).primaryKey(),
    topic:     text("topic").notNull(),          // 'offer' | 'order'
    driverUid: text("driver_uid"),               // set when topic = 'offer'
    orderId:   text("order_id"),                 // set when topic = 'order'
    status:    text("status"),                   // order status snapshot (topic = 'order')
    payload:   jsonb("payload"),                 // reserved for future use
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Tail scan: id > cursor filtered by driver (offer-stream)
    index("sse_events_driver_id_idx").on(table.driverUid, table.id),
    // Tail scan: id > cursor filtered by order (order-stream)
    index("sse_events_order_id_idx").on(table.orderId, table.id),
  ],
);

export const selectSseEventSchema = createSelectSchema(sseEventsTable);
export type SseEvent = typeof sseEventsTable.$inferSelect;
