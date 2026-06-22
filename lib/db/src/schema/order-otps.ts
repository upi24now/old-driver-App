import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { ordersTable } from "./orders";

// ── order_otps ────────────────────────────────────────────────────────────────
//
// Server-only delivery OTP store.
// Replaces the Firestore `orders/{id}/private/otp` subcollection.
//
// Security model:
//   - Never returned to any client endpoint.
//   - Read only inside the POST /api/orders/:orderId/complete handler.
//   - Written by the customer app flow (or admin API) when the order is created.
//   - CASCADE delete ensures no orphaned OTPs remain when the order is removed.
//
// The OTP value is stored as plain text (4-digit numeric string).
// It is functionally equivalent to the Firestore `private/otp { value }` doc:
//   - Immutable after creation (no UPDATE; re-creation requires DELETE + INSERT).
//   - Inaccessible to any mobile client (server reads only via Drizzle, never
//     exposed through any API route as a response field).
//
// Migration compatibility:
//   POST /complete will read from this table first, then fall back to the
//   Firestore `orders/{id}/private/otp` subcollection for orders created
//   before this migration. Once all active orders have migrated, the
//   Firestore fallback read can be removed.

export const orderOtpsTable = pgTable(
  "order_otps",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => ordersTable.id, { onDelete: "cascade" }),

    // 4-digit numeric OTP — stored as string, never returned to clients
    value: text("value").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertOrderOtpSchema = createInsertSchema(orderOtpsTable).omit({
  createdAt: true,
});

export const selectOrderOtpSchema = createSelectSchema(orderOtpsTable);

export type InsertOrderOtp = z.infer<typeof insertOrderOtpSchema>;
export type OrderOtp       = typeof orderOtpsTable.$inferSelect;
