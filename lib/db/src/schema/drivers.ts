import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── drivers ──────────────────────────────────────────────────────────────────
//
// One row per driver. Primary key is the Firebase Auth UID so every other
// table can reference it without a join on a separate id column.
//
// Fields are deliberately kept flat (no nested JSON) so Drizzle and
// Postgres can enforce types, constraints, and partial indexes.
// The `documents` Firestore MAP is normalised into the separate
// driver_documents table below.
//
// OUT OF SCOPE for this table (belong to later migration modules):
//   - subscription_*                    → drivers table (subscription module)
//   - latitude / longitude              → drivers table (live-tracking module)
//   - today_earnings / trips_today      → drivers table (wallet/stats module)

export const driversTable = pgTable(
  "drivers",
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    uid:   text("uid").primaryKey(),           // Firebase Auth UID
    phone: text("phone").unique().notNull(),   // E.164; set at first login

    // ── Profile ──────────────────────────────────────────────────────────────
    name:          text("name"),
    city:          text("city"),
    gender:        text("gender"),
    licenseNumber: text("license_number"),     // stored uppercased + trimmed
    vehicleNumber: text("vehicle_number"),     // stored uppercased + trimmed

    // ── Vehicle ──────────────────────────────────────────────────────────────
    vehicleId:   text("vehicle_id"),           // "bike" | "auto" | "truck"
    vehicleName: text("vehicle_name"),         // display name

    // ── KYC / verification ───────────────────────────────────────────────────
    documentsSubmitted:   boolean("documents_submitted").default(false),
    documentsSubmittedAt: timestamp("documents_submitted_at", { withTimezone: true }),
    // "unsubmitted" | "pending" | "approved" | "verified" | "rejected"
    verificationStatus:   text("verification_status").default("unsubmitted"),
    kycRejectionReason:   text("kyc_rejection_reason"),       // cleared on re-submit
    rejectedDocuments:    text("rejected_documents").array(),  // rejected docId strings

    // ── Account status ───────────────────────────────────────────────────────
    // "active" | "suspended" | "blacklisted" | "blocked"
    accountStatus:  text("account_status").default("active"),
    suspendReason:  text("suspend_reason"),
    blacklistReason: text("blacklist_reason"),
    suspendedAt:    timestamp("suspended_at",   { withTimezone: true }),
    blacklistedAt:  timestamp("blacklisted_at", { withTimezone: true }),

    // ── Onboarding fee ───────────────────────────────────────────────────────
    // Stamped at createDriverDoc() time; absent on pre-fee legacy drivers.
    onboardingFeeApplies:  boolean("onboarding_fee_applies").default(false),
    // "pending" | "paid"
    onboardingFeeStatus:   text("onboarding_fee_status"),
    onboardingFeeAmount:   integer("onboarding_fee_amount"),  // INR
    onboardingFeeCurrency: text("onboarding_fee_currency").default("INR"),
    onboardingFeePaidAt:   timestamp("onboarding_fee_paid_at", { withTimezone: true }),

    // Registration fee — canonical admin-panel fields written by verify-payment
    registrationFeePaid:     boolean("registration_fee_paid").default(false),
    registrationFeeAmount:   integer("registration_fee_amount"),  // INR
    registrationFeePaidAt:   timestamp("registration_fee_paid_at", { withTimezone: true }),

    // ── Background / permission setup ────────────────────────────────────────
    backgroundSetupShown:       boolean("background_setup_shown").default(false),
    permissionSetupVersion:     integer("permission_setup_version").default(0),
    permissionSetupCompletedAt: timestamp("permission_setup_completed_at", { withTimezone: true }),

    // ── Push / FCM (Phase 4A) ────────────────────────────────────────────────
    // Expo/FCM push token + last-write time. Firestore drivers/{uid}.fcmToken
    // remains the shadow store and is still what the FCM dispatcher reads.
    fcmToken:          text("fcm_token"),
    fcmTokenUpdatedAt: timestamp("fcm_token_updated_at", { withTimezone: true }),

    // ── Online status (Phase 4C) ─────────────────────────────────────────────
    // PG shadow of the driver's online/offline state. Firestore drivers/{uid}
    // (isOnline / onlineStatus / lastSeenAt) remains the source of truth; these
    // columns are mirrored from the PATCH /drivers/:uid/status route. Nothing
    // reads them yet (no dispatcher switch).
    isOnline:     boolean("is_online").default(false),
    onlineStatus: text("online_status"),   // "online" | "offline"
    lastSeenAt:   timestamp("last_seen_at", { withTimezone: true }),

    // ── Timestamps ───────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("drivers_verification_status_idx").on(table.verificationStatus),
    index("drivers_vehicle_id_idx").on(table.vehicleId),
  ],
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertDriverSchema = createInsertSchema(driversTable).omit({
  createdAt: true,
  updatedAt: true,
});

export const selectDriverSchema = createSelectSchema(driversTable);

export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type Driver       = typeof driversTable.$inferSelect;
