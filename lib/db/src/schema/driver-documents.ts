import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { driversTable } from "./drivers";

// ── driver_documents ─────────────────────────────────────────────────────────
//
// Normalised replacement for the Firestore `documents` nested MAP field on
// drivers/{uid}.  One row per (driver_uid, doc_type) pair.
//
// doc_type values (mirrors ALLOWED_DOC_TYPES in kyc-upload.ts):
//   selfie | aadhaarFront | aadhaarBack | pan |
//   licenseFront | licenseBack | rcFront | rcBack
//
// Legacy aliases (aadhaar, license, rc, insurance) may appear in migrated
// rows but new submissions always use the canonical names above.
//
// The UNIQUE constraint on (driver_uid, doc_type) enables upsert semantics:
//   INSERT … ON CONFLICT (driver_uid, doc_type) DO UPDATE SET …
// so re-submitting a document overwrites the old row cleanly.
//
// document_number / document_number_type
// ─────────────────────────────────────
// Human-readable document numbers extracted from the physical document:
//   document_number_type  "aadhaar" | "pan" | "license" | "rc"
//   document_number       the raw number string (e.g. "1234 5678 9012")
//
// Stored on the primary document row for that type:
//   aadhaar  → aadhaarFront row
//   pan      → pan row
//   license  → licenseFront row
//   rc       → rcFront row
//
// Back-side rows (aadhaarBack, licenseBack, rcBack) do not carry a number.
// Null when the driver app has not yet been updated to V2 upload flow.

export const driverDocumentsTable = pgTable(
  "driver_documents",
  {
    id:        serial("id").primaryKey(),
    driverUid: text("driver_uid")
      .notNull()
      .references(() => driversTable.uid, { onDelete: "cascade" }),

    // "selfie" | "aadhaarFront" | "aadhaarBack" | "pan" |
    // "licenseFront" | "licenseBack" | "rcFront" | "rcBack"
    docType: text("doc_type").notNull(),

    // VPS public URL — https://api.bikecourierservice.com/uploads/kyc/{uid}/{docType}.jpg
    url: text("url"),

    // "pending" | "approved" | "rejected"
    status: text("status").default("pending"),

    // Document number fields (V2 upload flow — null for legacy V1 submissions)
    // Type tells the admin/validation what kind of ID number this is.
    documentNumber:     text("document_number"),
    documentNumberType: text("document_number_type"),

    // Timestamps
    uploadedAt:      timestamp("uploaded_at",  { withTimezone: true }).defaultNow(),
    rejectionReason: text("rejection_reason"),
    rejectedAt:      timestamp("rejected_at",  { withTimezone: true }),
  },
  (table) => [
    // Primary lookup: all documents for a driver
    index("driver_documents_driver_uid_idx").on(table.driverUid),

    // Lookup by document type across all drivers (admin filtering)
    index("driver_documents_doc_type_idx").on(table.docType),

    // Enforces one row per document type per driver; enables ON CONFLICT upsert
    unique("driver_documents_driver_uid_doc_type_uniq").on(table.driverUid, table.docType),
  ],
);

// ── Zod schemas + TypeScript types ───────────────────────────────────────────

export const insertDriverDocumentSchema = createInsertSchema(driverDocumentsTable).omit({
  id:         true,
  uploadedAt: true,
});

export const selectDriverDocumentSchema = createSelectSchema(driverDocumentsTable);

export type InsertDriverDocument = z.infer<typeof insertDriverDocumentSchema>;
export type DriverDocument       = typeof driverDocumentsTable.$inferSelect;
