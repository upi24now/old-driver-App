import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { ordersTable } from "./orders";

// ── order_offers ──────────────────────────────────────────────────────────────
//
// One row per (order, driver) offer pair.
// Replaces the Firestore `activeOfferDriverUids[]` array on the order document.
//
// Lifecycle:
//   pending   — offer sent to driver, awaiting response
//   accepted  — this driver claimed the order (only one row per order reaches this)
//   rejected  — driver explicitly rejected; excluded from this dispatch cycle
//   timed_out — driver ignored the offer; NOT added to rejectedBy, may be re-offered
//
// The UNIQUE constraint on (order_id, driver_uid) prevents duplicate offers and
// enables safe upsert semantics during the dual-write migration period.
//
// Atomic accept pattern (prevents double-assignment):
//   UPDATE order_offers
//     SET status = 'accepted', responded_at = now()
//     WHERE order_id = ? AND driver_uid = ? AND status = 'pending'
//       AND (expires_at IS NULL OR expires_at > now())
//   → 0 rows updated  = already claimed, expired, or offer doesn't exist
//   → 1 row updated   = this driver won the race; proceed to update orders row

export const orderOffersTable = pgTable(
  "order_offers",
  {
    id:       bigserial("id", { mode: "bigint" }).primaryKey(),
    orderId:  text("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    // No FK reference to driversTable — driver rows may not exist in PG yet
    // during the dual-write shadow migration period (Phase 1B).
    driverUid: text("driver_uid").notNull(),

    // pending | accepted | rejected | timed_out
    status: text("status").notNull().default("pending"),

    offeredAt:   timestamp("offered_at",   { withTimezone: true }).defaultNow().notNull(),
    expiresAt:   timestamp("expires_at",   { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    // Offer lookup by driver — primary query path for GET /api/orders/offer
    index("order_offers_driver_status_idx").on(table.driverUid, table.status),

    // All offers for an order — used by dispatcher and admin
    index("order_offers_order_id_idx").on(table.orderId),

    // Expiry sweep — find stale pending offers
    index("order_offers_expires_at_idx").on(table.expiresAt),

    // Prevent duplicate offers for the same (order, driver) pair
    unique("order_offers_order_driver_uniq").on(table.orderId, table.driverUid),
  ],
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertOrderOfferSchema = createInsertSchema(orderOffersTable).omit({
  id:        true,
  offeredAt: true,
});

export const selectOrderOfferSchema = createSelectSchema(orderOffersTable);

export type InsertOrderOffer = z.infer<typeof insertOrderOfferSchema>;
export type OrderOffer       = typeof orderOffersTable.$inferSelect;
