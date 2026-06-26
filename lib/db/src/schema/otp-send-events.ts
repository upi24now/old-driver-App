import {
  pgTable,
  text,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── otp_send_events ──────────────────────────────────────────────────────────
//
// Append-only log of OTP-send attempts, used to rate-limit OTP requests to
// at most 3 per rolling 24 hours per phone number.
//
// Design:
//   - One row is inserted on every accepted POST /api/auth/send-otp.
//   - The limiter counts rows where sent_at > now() - interval '24 hours'.
//   - Append-only + a (phone, sent_at) index makes the count query cheap and
//     the writer naturally concurrency-safe (no read-modify-write race).
//   - TEST_OTP_PHONES bypass never touches this table.
//   - Old rows can be pruned opportunistically (sent_at < now() - 24h); they
//     never affect the rolling-window count.

export const otpSendEventsTable = pgTable(
  "otp_send_events",
  {
    id: serial("id").primaryKey(),

    phone: text("phone").notNull(),

    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_send_events_phone_sent_at_idx").on(table.phone, table.sentAt),
  ],
);

export const insertOtpSendEventSchema = createInsertSchema(otpSendEventsTable).omit({
  id: true,
});

export const selectOtpSendEventSchema = createSelectSchema(otpSendEventsTable);

export type InsertOtpSendEvent = z.infer<typeof insertOtpSendEventSchema>;
export type OtpSendEvent       = typeof otpSendEventsTable.$inferSelect;
