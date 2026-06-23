import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── support_tickets ────────────────────────────────────────────────────────────
//
// One row per driver support request. `from_field` captures who opened the
// ticket ("driver" for all driver-app tickets). `status` lifecycle:
//   open → in_progress → resolved → closed
//
// `last_message` is a 120-char preview of the most recent message; kept denorm
// so the ticket list does not require a messages JOIN.
//
// `updated_at` is bumped on every message append; used for ordering the list.

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    driverUid:   text("driver_uid").notNull(),
    subject:     text("subject").notNull(),
    category:    text("category").notNull(),
    priority:    text("priority").notNull().default("normal"),
    fromField:   text("from_field").notNull().default("driver"),
    userName:    text("user_name"),
    userPhone:   text("user_phone"),
    orderId:     text("order_id"),
    status:      text("status").notNull().default("open"),
    lastMessage: text("last_message"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_tickets_driver_uid_idx").on(t.driverUid),
    index("support_tickets_updated_at_idx").on(t.updatedAt),
  ],
);

// ── support_messages ───────────────────────────────────────────────────────────
//
// Each row is a single message in a ticket thread.
//
// `from_field` mirrors the Firestore "from" field: "user" (driver) or "support"
// (admin/agent). Stored as `from_field` in PG to avoid the SQL FROM keyword.
// The API response still returns the key as `from` to preserve the mobile
// client's existing contract.

export const supportMessagesTable = pgTable(
  "support_messages",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    ticketId:  uuid("ticket_id").notNull().references(() => supportTicketsTable.id),
    fromField: text("from_field").notNull().default("user"),
    senderUid: text("sender_uid").notNull(),
    text:      text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_messages_ticket_id_idx").on(t.ticketId),
    index("support_messages_created_at_idx").on(t.createdAt),
  ],
);

// ── Zod schemas + TypeScript types ─────────────────────────────────────────────

export const insertSupportTicketSchema  = createInsertSchema(supportTicketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectSupportTicketSchema  = createSelectSchema(supportTicketsTable);

export const insertSupportMessageSchema = createInsertSchema(supportMessagesTable).omit({ id: true, createdAt: true });
export const selectSupportMessageSchema = createSelectSchema(supportMessagesTable);

export type SupportTicket        = typeof supportTicketsTable.$inferSelect;
export type SupportMessage       = typeof supportMessagesTable.$inferSelect;
export type InsertSupportTicket  = z.infer<typeof insertSupportTicketSchema>;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
