import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { ordersTable } from "./orders";

// ── dispatch_projections (Phase 5H-BRIDGE-3) ──────────────────────────────────
//
// Durable transactional OUTBOX for the PG → Firestore projector.
//
// Design: "PG decides → project result to Firestore". When (and only when) the
// PG dispatcher commits an authoritative write (assign / return-to-pool), it
// enqueues a row here INSIDE the same database transaction. A separate projector
// worker (pg-firestore-projector.ts) drains pending rows in FIFO order and
// applies the decision to the Firestore order doc the existing Driver App,
// Customer App, and Firestore FCM dispatcher already read — WITHOUT changing any
// app or FCM infrastructure.
//
// Because the enqueue is part of the write transaction, a projection can never
// be lost (it commits atomically with the state change) and can never leak
// (nothing is enqueued unless the gated PG write actually commits).
//
// Event types:
//   assignment — PG assigned a driver; project status=dispatched + offer set,
//                clearing the Firestore FCM claim fields so the existing
//                Firestore FCM dispatcher claims + sends unchanged.
//   timeout    — PG returned an expired dispatch to the pool; project
//                status=searching, driver cleared.
//   offer_removal — (Phase 5J-Tier-9B) a driver rejected/timed out an offer;
//                project arrayRemove(driverUid) on Firestore activeOfferDriverUids.
//                Status is left untouched (no resurrection) and the FCM guard
//                fields are NOT cleared (never re-triggers the FCM dispatcher).
// (The PG FCM claim is intentionally NOT projected — doing so would pre-claim
//  the order and block the authoritative Firestore FCM dispatcher. See the
//  projector for the documented decision.)
//
// Lifecycle:
//   pending   — awaiting projection (or awaiting retry after a transient failure)
//   projected — successfully applied to Firestore (or safely skipped because the
//               Firestore doc had already moved on — idempotent no-op)
//   failed    — exhausted max attempts; left for inspection, never auto-retried
//
// Idempotency / ordering:
//   - id is a bigserial so rows have a total FIFO order; the worker processes
//     ASC by id, serially, preserving per-order ordering.
//   - The payload captures the deterministic target state at enqueue time, so
//     re-applying a row is harmless (at-least-once + idempotent = effectively
//     once). available_at drives exponential backoff between retries.

export interface DispatchProjectionPayload {
  /** Driver assigned (assignment events). */
  driverUid?: string;
  /** Epoch ms of the PG dispatch decision (assignment events). */
  dispatchedAtMs?: number;
  /** Epoch ms when the dispatch expires (assignment events). */
  dispatchTimeoutAtMs?: number;
  /** Phase-2 authoritative offer target set (assignment events). */
  activeOfferDriverUids?: string[];
}

export const dispatchProjectionsTable = pgTable(
  "dispatch_projections",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),

    // assignment | timeout
    eventType: text("event_type").notNull(),

    // Deterministic target state captured at enqueue time.
    payload: jsonb("payload").$type<DispatchProjectionPayload>().notNull(),

    // pending | projected | failed
    status: text("status").notNull().default("pending"),

    attempts:  integer("attempts").notNull().default(0),
    lastError: text("last_error"),

    // Backoff gate — a pending row is only eligible when available_at <= now().
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),

    createdAt:   timestamp("created_at",   { withTimezone: true }).defaultNow().notNull(),
    updatedAt:   timestamp("updated_at",   { withTimezone: true }).defaultNow().notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }),
  },
  (table) => [
    // Worker drain query: pending rows due for projection, in FIFO order.
    index("dispatch_projections_due_idx").on(table.status, table.availableAt, table.id),

    // All projections for an order — diagnostics / ordering inspection.
    index("dispatch_projections_order_id_idx").on(table.orderId),
  ],
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertDispatchProjectionSchema = createInsertSchema(dispatchProjectionsTable).omit({
  id:        true,
  createdAt: true,
  updatedAt: true,
});

export const selectDispatchProjectionSchema = createSelectSchema(dispatchProjectionsTable);

export type InsertDispatchProjection = z.infer<typeof insertDispatchProjectionSchema>;
export type DispatchProjection       = typeof dispatchProjectionsTable.$inferSelect;
