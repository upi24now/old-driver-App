import {
  pgTable,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── auth_otps ──────────────────────────────────────────────────────────────────
//
// PostgreSQL-backed OTP store for the driver login flow.
// Replaces the in-process Map<string, OtpEntry> so OTPs survive server
// restarts and work correctly across autoscale instances.
//
// Design:
//   - phone is the primary key — only one active OTP per phone number.
//   - INSERT ... ON CONFLICT (phone) DO UPDATE replaces the old OTP on resend.
//   - consumed_at is set (and otp cleared) when the OTP is successfully verified.
//   - Server-side cleanup: rows are expired when expires_at < NOW(), and
//     consumed rows are never used again (consumed_at IS NOT NULL check).
//   - No bcrypt — 6-digit random OTPs stored as plain text. The 5-minute TTL
//     and attempt limit make brute-force impractical over the network.
//   - TEST_OTP_PHONES bypass never touches this table.

export const authOtpsTable = pgTable("auth_otps", {
  phone: text("phone").primaryKey(),

  otp: text("otp").notNull(),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  attempts: integer("attempts").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const insertAuthOtpSchema = createInsertSchema(authOtpsTable).omit({
  createdAt: true,
});

export const selectAuthOtpSchema = createSelectSchema(authOtpsTable);

export type InsertAuthOtp = z.infer<typeof insertAuthOtpSchema>;
export type AuthOtp       = typeof authOtpsTable.$inferSelect;
