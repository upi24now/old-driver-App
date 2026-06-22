import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── driver_wallets ─────────────────────────────────────────────────────────────
//
// One row per driver.  Primary key is the Firebase Auth UID (same as
// driversTable) so reads are a direct PK lookup — no join needed.
//
// All monetary columns are NUMERIC(12,2) so arithmetic stays exact.
//
// Fields:
//   balance             — current spendable balance (earnings minus payouts)
//   total_earnings      — sum of all credited order earnings (never decremented)
//   total_paid          — sum of all processed payout amounts
//   completed_deliveries — count of orders that produced a credit entry
//
// Invariants:
//   balance ≈ total_earnings − total_paid  (enforced by service-layer atomics)
//   completed_deliveries == count(wallet_transactions WHERE type='credit')

export const driverWalletsTable = pgTable("driver_wallets", {
  driverUid:           text("driver_uid").primaryKey(),

  balance:             numeric("balance",              { precision: 12, scale: 2 })
                         .notNull().default("0"),
  totalEarnings:       numeric("total_earnings",       { precision: 12, scale: 2 })
                         .notNull().default("0"),
  totalPaid:           numeric("total_paid",           { precision: 12, scale: 2 })
                         .notNull().default("0"),
  completedDeliveries: integer("completed_deliveries")
                         .notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── wallet_transactions ────────────────────────────────────────────────────────
//
// Immutable ledger of wallet movements.  One row per credit, payout debit, or
// manual adjustment.
//
// type values:
//   "credit"     — order earning credited after delivery
//   "payout"     — driver cash-out debit (mirrors processed payout_request)
//   "adjustment" — manual admin correction
//
// status values:
//   "completed"  — the movement is settled (default for all sync operations)
//   "pending"    — reserved for async flows (e.g. UPI transfer in-flight)
//   "failed"     — movement was attempted but reversed

export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    driverUid:   text("driver_uid").notNull(),
    orderId:     text("order_id"),
    type:        text("type").notNull(),
    amount:      numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status:      text("status").notNull().default("completed"),
    description: text("description"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wallet_transactions_driver_uid_idx").on(t.driverUid),
    index("wallet_transactions_created_at_idx").on(t.createdAt),
  ],
);

// ── payout_requests ────────────────────────────────────────────────────────────
//
// Driver-initiated cash-out requests.  Status lifecycle:
//   pending → processed  (admin approves, wallet debited atomically)
//   pending → rejected   (admin rejects, no wallet change)
//
// processed_at is set when an admin calls pgMarkPayoutProcessed.
// note is an optional admin-visible memo.

export const payoutRequestsTable = pgTable(
  "payout_requests",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    driverUid:   text("driver_uid").notNull(),
    amount:      numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status:      text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    note:        text("note"),
  },
  (t) => [
    index("payout_requests_driver_uid_idx").on(t.driverUid),
    index("payout_requests_status_idx").on(t.status),
  ],
);

// ── Zod schemas + TypeScript types ─────────────────────────────────────────────

export const insertDriverWalletSchema    = createInsertSchema(driverWalletsTable).omit({ createdAt: true, updatedAt: true });
export const selectDriverWalletSchema    = createSelectSchema(driverWalletsTable);

export const insertWalletTransactionSchema = createInsertSchema(walletTransactionsTable).omit({ id: true, createdAt: true });
export const selectWalletTransactionSchema = createSelectSchema(walletTransactionsTable);

export const insertPayoutRequestSchema   = createInsertSchema(payoutRequestsTable).omit({ id: true, requestedAt: true, processedAt: true });
export const selectPayoutRequestSchema   = createSelectSchema(payoutRequestsTable);

export type DriverWallet        = typeof driverWalletsTable.$inferSelect;
export type WalletTransaction   = typeof walletTransactionsTable.$inferSelect;
export type PayoutRequest       = typeof payoutRequestsTable.$inferSelect;

export type InsertDriverWallet      = z.infer<typeof insertDriverWalletSchema>;
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type InsertPayoutRequest     = z.infer<typeof insertPayoutRequestSchema>;
