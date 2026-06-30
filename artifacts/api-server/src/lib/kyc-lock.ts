/**
 * kyc-lock.ts
 *
 * Single source of truth for the "documents locked after verification" rule.
 *
 * Once a driver is approved/verified, their KYC documents become read-only:
 * the driver may no longer upload, replace, delete, or re-upload any document.
 * This helper is the server-side enforcement used by the document write routes
 * (POST /api/kyc/upload and POST /api/drivers/documents) so the lock cannot be
 * bypassed by hitting the API directly.
 *
 * The check is authoritative against PostgreSQL `drivers.verification_status`.
 */

import { db, driversTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Statuses that mean the driver is fully verified and their docs are locked. */
const APPROVED_STATUSES = new Set(["approved", "verified"]);

/** Canonical 403 message returned to clients when documents are locked. */
export const DOCUMENTS_LOCKED_MESSAGE = "Documents are locked after verification.";

/**
 * Returns true when the given driver is approved/verified and therefore their
 * KYC documents must be treated as read-only.
 *
 * Returns false for unknown drivers and any non-approved status so the normal
 * upload flow for unverified drivers is never affected.
 */
export async function isDriverVerificationLocked(uid: string): Promise<boolean> {
  if (!uid) return false;
  const [row] = await db
    .select({ verificationStatus: driversTable.verificationStatus })
    .from(driversTable)
    .where(eq(driversTable.uid, uid))
    .limit(1);
  if (!row) return false;
  return APPROVED_STATUSES.has((row.verificationStatus ?? "").toLowerCase());
}
