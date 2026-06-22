import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { driversTable } from "./drivers";

// ── orders ────────────────────────────────────────────────────────────────────
//
// One row per customer delivery order.
// Primary key is the Firestore document ID (string) so rows can be written
// during dual-write migration without generating a new surrogate key.
//
// Status lifecycle (mirrors Firestore):
//   searching → pending → dispatched → driver_assigned
//   → to_pickup → at_pickup → to_drop → at_drop → delivered
//   (or cancelled at any pre-delivered stage)
//
// Dispatch fields (dispatcher writes, mobile reads):
//   rejected_by[]        — UIDs who rejected this dispatch cycle
//   last_dispatched_uid  — round-robin cursor (UID of last assigned driver)
//   dispatch_timeout_at  — when the current dispatch expires (now + 60 s)
//
// Location fields (mobile writes, customer app reads):
//   driver_lat/lng/location_updated_at — live GPS position during active delivery
//
// OTP is stored separately in order_otps (server-only, never client-readable).
//
// FCM fields:
//   fcm_dispatched_at — migration guard sentinel, keeps FCM idempotency during
//                       the dual-write period; can be dropped post-migration.

export const ordersTable = pgTable(
  "orders",
  {
    // ── Identity ───────────────────────────────────────────────────────────────
    id: text("id").primaryKey(),   // Firestore doc ID preserved as-is

    // ── Status machine ─────────────────────────────────────────────────────────
    // searching | pending | dispatched | driver_assigned |
    // to_pickup | at_pickup | to_drop | at_drop | delivered | cancelled
    status: text("status").notNull(),

    // ── Customer info (written by customer app) ────────────────────────────────
    customerName:  text("customer_name"),
    customerPhone: text("customer_phone"),

    // ── Route ─────────────────────────────────────────────────────────────────
    pickup:      text("pickup"),
    pickupCity:  text("pickup_city"),
    drop:        text("drop"),
    dropCity:    text("drop_city"),
    distanceKm:  numeric("distance_km",  { precision: 8,  scale: 2 }),
    durationMin: integer("duration_min"),

    // ── Fare ──────────────────────────────────────────────────────────────────
    fareEstimate:    numeric("fare_estimate",    { precision: 10, scale: 2 }),
    paymentMode:     text("payment_mode"),        // Cash | UPI | Card
    surge:           boolean("surge").default(false),
    surgeMultiplier: numeric("surge_multiplier", { precision: 4,  scale: 2 }).default("1"),

    // ── Parcel ────────────────────────────────────────────────────────────────
    parcelType:   text("parcel_type"),
    parcelEmoji:  text("parcel_emoji"),
    parcelWeight: text("parcel_weight"),

    // ── Assigned driver ────────────────────────────────────────────────────────
    driverUid:    text("driver_uid").references(() => driversTable.uid),
    driverName:   text("driver_name"),
    driverRating: text("driver_rating"),
    driverTrips:  integer("driver_trips"),

    // ── Dispatch cycle state ───────────────────────────────────────────────────
    rejectedBy:         text("rejected_by").array().default([]),
    lastDispatchedUid:  text("last_dispatched_uid"),
    dispatchTimeoutAt:  timestamp("dispatch_timeout_at", { withTimezone: true }),

    // ── Timestamps ────────────────────────────────────────────────────────────
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    acceptedAt:   timestamp("accepted_at",   { withTimezone: true }),
    toPickupAt:   timestamp("to_pickup_at",  { withTimezone: true }),
    atPickupAt:   timestamp("at_pickup_at",  { withTimezone: true }),
    toDropAt:     timestamp("to_drop_at",    { withTimezone: true }),
    atDropAt:     timestamp("at_drop_at",    { withTimezone: true }),
    deliveredAt:  timestamp("delivered_at",  { withTimezone: true }),
    cancelledAt:  timestamp("cancelled_at",  { withTimezone: true }),

    // ── Live driver location (written during active delivery) ──────────────────
    driverLat:           numeric("driver_lat",            { precision: 10, scale: 8 }),
    driverLng:           numeric("driver_lng",            { precision: 11, scale: 8 }),
    locationUpdatedAt:   timestamp("location_updated_at", { withTimezone: true }),
    locationAccuracy:    numeric("location_accuracy",     { precision: 7,  scale: 2 }),

    // ── Driver-initiated cancellation ──────────────────────────────────────────
    driverCancelReason:  text("driver_cancel_reason"),
    driverCancelledBy:   text("driver_cancelled_by"),
    driverCancelledAt:   timestamp("driver_cancelled_at", { withTimezone: true }),

    // ── FCM migration guard ────────────────────────────────────────────────────
    // Written during dual-write phase to track FCM send completion.
    // Can be dropped once Firestore FCM dispatcher is fully replaced.
    fcmDispatchedAt: timestamp("fcm_dispatched_at", { withTimezone: true }),

    // ── Record timestamps ──────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Dispatcher: orders needing a driver
    index("orders_status_idx").on(table.status),

    // Timeout poller: find expired dispatched orders efficiently
    index("orders_dispatched_timeout_idx").on(table.status, table.dispatchTimeoutAt),

    // Active order restore: all in-progress orders for a driver
    index("orders_driver_uid_status_idx").on(table.driverUid, table.status),

    // Customer lookup (future admin / customer app queries)
    index("orders_created_at_idx").on(table.createdAt),
  ],
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export const selectOrderSchema = createSelectSchema(ordersTable);

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order       = typeof ordersTable.$inferSelect;
