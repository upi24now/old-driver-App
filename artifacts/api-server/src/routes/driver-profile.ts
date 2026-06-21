/**
 * driver-profile.ts
 *
 * Additive driver self-service routes backed by PostgreSQL.
 * These routes are NOT yet connected to the mobile app — they are being
 * built alongside the Firestore→PostgreSQL migration so the mobile can be
 * switched over in a single step when all modules are ready.
 *
 * All routes require a valid Firebase ID token:
 *   Authorization: Bearer <Firebase ID token>
 *
 * The verified UID is used as the driver's primary key (drivers.uid).
 *
 * Routes:
 *   GET    /api/drivers/me                  — full profile from PG
 *   PATCH  /api/drivers/profile             — name, city, gender, license, vehicle number
 *   PATCH  /api/drivers/vehicle             — vehicle_id, vehicle_name
 *   POST   /api/drivers/documents           — upsert document URLs; mark submission
 *   GET    /api/drivers/verification-status — KYC status + documents map
 *   PATCH  /api/drivers/background-setup    — background / permission setup flags
 *
 * Source of truth: Firestore (until full mobile cutover).
 * These routes do NOT touch Firestore.
 */

import { Router } from "express";
import { requireAuth } from "../lib/require-auth";
import { db, driversTable, driverDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// Document types that the KYC flow accepts.
// Must stay in sync with kyc-upload.ts ALLOWED_DOC_TYPES.
const ALLOWED_DOC_TYPES = new Set([
  "selfie",
  "aadhaarFront", "aadhaarBack",
  "pan",
  "licenseFront", "licenseBack",
  "rcFront", "rcBack",
]);

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Builds the `documents` map that the mobile DriverDoc shape expects:
 *   { [docType]: { url, status, uploadedAt, rejectionReason, rejectedAt } }
 */
function buildDocumentsMap(
  rows: typeof driverDocumentsTable.$inferSelect[],
): Record<string, {
  url:             string | null;
  status:          string | null;
  uploadedAt:      string | null;
  rejectionReason: string | null;
  rejectedAt:      string | null;
}> {
  const map: ReturnType<typeof buildDocumentsMap> = {};
  for (const row of rows) {
    map[row.docType] = {
      url:             row.url             ?? null,
      status:          row.status          ?? null,
      uploadedAt:      row.uploadedAt      ? row.uploadedAt.toISOString() : null,
      rejectionReason: row.rejectionReason ?? null,
      rejectedAt:      row.rejectedAt      ? row.rejectedAt.toISOString() : null,
    };
  }
  return map;
}

// ─── GET /api/drivers/me ──────────────────────────────────────────────────────

/**
 * Returns the full driver profile from PostgreSQL, including a `documents`
 * map compatible with the mobile DriverDoc shape.
 *
 * Fields that have not yet been migrated to PostgreSQL (isOnline, subscription,
 * todayEarnings, etc.) are absent from this response — the mobile app continues
 * reading those from Firestore until full cutover.
 *
 * Response 200:
 * {
 *   ok: true,
 *   driver: {
 *     uid, phone, name, city, gender,
 *     vehicleId, vehicleName, licenseNumber, vehicleNumber,
 *     accountStatus, suspendReason, blacklistReason,
 *     documentsSubmitted, documentsSubmittedAt,
 *     verificationStatus, kycRejectionReason, rejectedDocuments,
 *     backgroundSetupShown, permissionSetupVersion, permissionSetupCompletedAt,
 *     onboardingFeeApplies, onboardingFeeStatus, onboardingFeeAmount, onboardingFeeCurrency,
 *     createdAt, updatedAt,
 *     documents: { [docType]: { url, status, uploadedAt, rejectionReason, rejectedAt } }
 *   }
 * }
 *
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.get("/drivers/me", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  try {
    const [driver] = await db
      .select()
      .from(driversTable)
      .where(eq(driversTable.uid, uid))
      .limit(1);

    if (!driver) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const docRows = await db
      .select()
      .from(driverDocumentsTable)
      .where(eq(driverDocumentsTable.driverUid, uid));

    res.json({
      ok: true,
      driver: {
        uid:                       driver.uid,
        phone:                     driver.phone,
        name:                      driver.name                      ?? null,
        city:                      driver.city                      ?? null,
        gender:                    driver.gender                    ?? null,
        vehicleId:                 driver.vehicleId                 ?? null,
        vehicleName:               driver.vehicleName               ?? null,
        licenseNumber:             driver.licenseNumber             ?? null,
        vehicleNumber:             driver.vehicleNumber             ?? null,
        accountStatus:             driver.accountStatus             ?? null,
        suspendReason:             driver.suspendReason             ?? null,
        blacklistReason:           driver.blacklistReason           ?? null,
        documentsSubmitted:        driver.documentsSubmitted        ?? false,
        documentsSubmittedAt:      driver.documentsSubmittedAt      ? driver.documentsSubmittedAt.toISOString() : null,
        verificationStatus:        driver.verificationStatus        ?? null,
        kycRejectionReason:        driver.kycRejectionReason        ?? null,
        rejectedDocuments:         driver.rejectedDocuments         ?? null,
        backgroundSetupShown:      driver.backgroundSetupShown      ?? false,
        permissionSetupVersion:    driver.permissionSetupVersion    ?? 0,
        permissionSetupCompletedAt: driver.permissionSetupCompletedAt
          ? driver.permissionSetupCompletedAt.toISOString()
          : null,
        onboardingFeeApplies:      driver.onboardingFeeApplies      ?? false,
        onboardingFeeStatus:       driver.onboardingFeeStatus       ?? null,
        onboardingFeeAmount:       driver.onboardingFeeAmount       ?? null,
        onboardingFeeCurrency:     driver.onboardingFeeCurrency     ?? null,
        createdAt:                 driver.createdAt.toISOString(),
        updatedAt:                 driver.updatedAt.toISOString(),
        documents:                 buildDocumentsMap(docRows),
      },
    });

    req.log.info({ uid }, "driver-profile: GET /drivers/me");
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: GET /drivers/me failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to fetch driver profile." });
  }
});

// ─── PATCH /api/drivers/profile ───────────────────────────────────────────────

/**
 * Updates the driver's profile fields.
 * licenseNumber and vehicleNumber are trimmed and uppercased before storage.
 * Returns 404 if the driver has no PostgreSQL row yet.
 *
 * Body (all optional):
 *   { name?, city?, gender?, licenseNumber?, vehicleNumber? }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false, error: "no_fields", message: "..." }
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.patch("/drivers/profile", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as {
    name?:          unknown;
    city?:          unknown;
    gender?:        unknown;
    licenseNumber?: unknown;
    vehicleNumber?: unknown;
  };

  const patch: Partial<typeof driversTable.$inferInsert> = {};

  if (typeof body.name          === "string") patch.name          = body.name.trim()                              || null;
  if (typeof body.city          === "string") patch.city          = body.city.trim()                              || null;
  if (typeof body.gender        === "string") patch.gender        = body.gender.trim()                            || null;
  if (typeof body.licenseNumber === "string") patch.licenseNumber = body.licenseNumber.trim().toUpperCase()       || null;
  if (typeof body.vehicleNumber === "string") patch.vehicleNumber = body.vehicleNumber.trim().toUpperCase()       || null;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, error: "no_fields", message: "At least one field is required." });
    return;
  }

  patch.updatedAt = new Date();

  try {
    const rows = await db
      .update(driversTable)
      .set(patch)
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    req.log.info({ uid, fields: Object.keys(patch) }, "driver-profile: PATCH /drivers/profile");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: PATCH /drivers/profile failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to update profile." });
  }
});

// ─── PATCH /api/drivers/vehicle ───────────────────────────────────────────────

/**
 * Updates the driver's vehicle selection.
 *
 * Body (all optional):
 *   { vehicleId?, vehicleName? }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false, error: "no_fields", message: "..." }
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.patch("/drivers/vehicle", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as {
    vehicleId?:   unknown;
    vehicleName?: unknown;
  };

  const patch: Partial<typeof driversTable.$inferInsert> = {};

  if (typeof body.vehicleId   === "string") patch.vehicleId   = body.vehicleId.trim()   || null;
  if (typeof body.vehicleName === "string") patch.vehicleName = body.vehicleName.trim() || null;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, error: "no_fields", message: "vehicleId or vehicleName is required." });
    return;
  }

  patch.updatedAt = new Date();

  try {
    const rows = await db
      .update(driversTable)
      .set(patch)
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    req.log.info({ uid, patch }, "driver-profile: PATCH /drivers/vehicle");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: PATCH /drivers/vehicle failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to update vehicle." });
  }
});

// ─── POST /api/drivers/documents ─────────────────────────────────────────────

/**
 * Upserts document URL entries into driver_documents and marks the driver as
 * having submitted KYC. Setting verification_status → "pending" signals that
 * an admin review is required.
 *
 * Existing rejection state (kyc_rejection_reason, rejected_documents, and
 * per-doc rejection_reason / rejected_at) is cleared on re-submission so the
 * driver starts fresh.
 *
 * Requires the driver to have an existing row in the `drivers` table
 * (created during registration or bulk migration). Returns 409 if the
 * foreign-key constraint fires (driver not yet in PostgreSQL).
 *
 * Body:
 *   { documents: { [docType]: string } }  — map of docType → public VPS URL
 *   Unknown or disallowed docTypes are silently skipped.
 *
 * Response 200: { ok: true, count: number }
 * Response 400: { ok: false, error: "invalid_body" | "no_valid_docs" }
 * Response 409: { ok: false, error: "driver_not_in_pg" }
 */
router.post("/drivers/documents", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as { documents?: unknown };

  if (
    !body.documents ||
    typeof body.documents !== "object" ||
    Array.isArray(body.documents)
  ) {
    res.status(400).json({
      ok:      false,
      error:   "invalid_body",
      message: "Body must contain a 'documents' object mapping docType → URL string.",
    });
    return;
  }

  const raw = body.documents as Record<string, unknown>;
  const validEntries: { docType: string; url: string }[] = [];

  for (const [docType, url] of Object.entries(raw)) {
    if (!ALLOWED_DOC_TYPES.has(docType)) continue;
    if (typeof url !== "string" || !url.trim()) continue;
    validEntries.push({ docType, url: url.trim() });
  }

  if (validEntries.length === 0) {
    res.status(400).json({
      ok:      false,
      error:   "no_valid_docs",
      message: `No valid document entries. Allowed types: ${[...ALLOWED_DOC_TYPES].join(", ")}.`,
    });
    return;
  }

  try {
    const now = new Date();

    // Upsert each document — ON CONFLICT (driver_uid, doc_type) DO UPDATE
    // Clears prior rejection state on re-submission.
    for (const { docType, url } of validEntries) {
      await db
        .insert(driverDocumentsTable)
        .values({
          driverUid:  uid,
          docType,
          url,
          status:     "pending",
          uploadedAt: now,
        })
        .onConflictDoUpdate({
          target: [driverDocumentsTable.driverUid, driverDocumentsTable.docType],
          set: {
            url,
            status:          "pending",
            uploadedAt:      now,
            rejectionReason: null,
            rejectedAt:      null,
          },
        });
    }

    // Mark driver as submitted — clears any prior rejection reason/doc list.
    await db
      .update(driversTable)
      .set({
        documentsSubmitted:  true,
        documentsSubmittedAt: now,
        verificationStatus:  "pending",
        kycRejectionReason:  null,
        rejectedDocuments:   null,
        updatedAt:           now,
      })
      .where(eq(driversTable.uid, uid));

    req.log.info({ uid, count: validEntries.length }, "driver-profile: POST /drivers/documents");
    res.json({ ok: true, count: validEntries.length });
  } catch (err: unknown) {
    // FK violation: drivers row doesn't exist in PostgreSQL yet.
    // Drizzle wraps PG errors in _DrizzleQueryError so the PG code lives on
    // err.cause.code, not err.code directly.
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === "23503" || pgErr?.cause?.code === "23503") {
      req.log.warn({ uid }, "driver-profile: FK violation — driver not yet in PG");
      res.status(409).json({
        ok:      false,
        error:   "driver_not_in_pg",
        message: "Driver profile must be created in PostgreSQL before submitting documents.",
      });
      return;
    }
    req.log.error({ err, uid }, "driver-profile: POST /drivers/documents failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to save documents." });
  }
});

// ─── GET /api/drivers/verification-status ────────────────────────────────────

/**
 * Returns the driver's KYC status plus a per-document status map.
 * Designed for the mobile document-upload and KYC-status screens.
 *
 * Response 200:
 * {
 *   ok: true,
 *   verificationStatus:  string | null,
 *   documentsSubmitted:  boolean,
 *   kycRejectionReason:  string | null,
 *   rejectedDocuments:   string[] | null,
 *   documents: { [docType]: { url, status, uploadedAt, rejectionReason, rejectedAt } }
 * }
 *
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.get("/drivers/verification-status", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  try {
    const [driver] = await db
      .select({
        verificationStatus:  driversTable.verificationStatus,
        documentsSubmitted:  driversTable.documentsSubmitted,
        kycRejectionReason:  driversTable.kycRejectionReason,
        rejectedDocuments:   driversTable.rejectedDocuments,
      })
      .from(driversTable)
      .where(eq(driversTable.uid, uid))
      .limit(1);

    if (!driver) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const docRows = await db
      .select()
      .from(driverDocumentsTable)
      .where(eq(driverDocumentsTable.driverUid, uid));

    req.log.info({ uid }, "driver-profile: GET /drivers/verification-status");
    res.json({
      ok:                  true,
      verificationStatus:  driver.verificationStatus  ?? null,
      documentsSubmitted:  driver.documentsSubmitted   ?? false,
      kycRejectionReason:  driver.kycRejectionReason  ?? null,
      rejectedDocuments:   driver.rejectedDocuments    ?? null,
      documents:           buildDocumentsMap(docRows),
    });
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: GET /drivers/verification-status failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to fetch verification status." });
  }
});

// ─── PATCH /api/drivers/background-setup ─────────────────────────────────────

/**
 * Records that the driver has completed the background / permission setup flow.
 * The mobile calls this after the driver grants battery-optimisation and
 * notification permissions.
 *
 * Body (all optional):
 *   {
 *     backgroundSetupShown?:       boolean
 *     permissionSetupVersion?:     number   (integer)
 *     permissionSetupCompletedAt?: string   (ISO 8601)
 *   }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false, error: "no_fields" | "invalid_body" }
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.patch("/drivers/background-setup", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as {
    backgroundSetupShown?:       unknown;
    permissionSetupVersion?:     unknown;
    permissionSetupCompletedAt?: unknown;
  };

  const patch: Partial<typeof driversTable.$inferInsert> = {};

  if (typeof body.backgroundSetupShown === "boolean") {
    patch.backgroundSetupShown = body.backgroundSetupShown;
  }

  if (body.permissionSetupVersion !== undefined) {
    const v = Number(body.permissionSetupVersion);
    if (!Number.isInteger(v) || v < 0) {
      res.status(400).json({
        ok: false, error: "invalid_body",
        message: "permissionSetupVersion must be a non-negative integer.",
      });
      return;
    }
    patch.permissionSetupVersion = v;
  }

  if (body.permissionSetupCompletedAt !== undefined) {
    const d = new Date(body.permissionSetupCompletedAt as string);
    if (isNaN(d.getTime())) {
      res.status(400).json({
        ok: false, error: "invalid_body",
        message: "permissionSetupCompletedAt must be a valid ISO 8601 date string.",
      });
      return;
    }
    patch.permissionSetupCompletedAt = d;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({
      ok: false, error: "no_fields",
      message: "At least one field is required: backgroundSetupShown, permissionSetupVersion, permissionSetupCompletedAt.",
    });
    return;
  }

  patch.updatedAt = new Date();

  try {
    const rows = await db
      .update(driversTable)
      .set(patch)
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    req.log.info({ uid, fields: Object.keys(patch) }, "driver-profile: PATCH /drivers/background-setup");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: PATCH /drivers/background-setup failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to update background setup." });
  }
});

export default router;
