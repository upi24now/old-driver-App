/**
 * driver-profile.ts
 *
 * Driver self-service routes backed by PostgreSQL.
 * PostgreSQL is the authoritative source for all data in this module.
 *
 * All routes require a valid Firebase ID token:
 *   Authorization: Bearer <Firebase ID token>
 *
 * Routes:
 *   GET    /api/drivers/me                  — full profile + onboardingStep/nextRoute
 *   PATCH  /api/drivers/profile             — name, city, gender, license, vehicle number
 *   PATCH  /api/drivers/vehicle             — vehicle_id, vehicle_name
 *   POST   /api/drivers/documents           — upsert document URLs + document numbers
 *   GET    /api/drivers/verification-status — KYC status + documents map + onboardingStep/nextRoute
 *   PATCH  /api/drivers/background-setup    — background / permission setup flags
 *
 * Document number storage:
 *   The V2 upload flow passes a documentNumbers map alongside document URLs.
 *   Numbers are stored on the primary document row for each type:
 *     "aadhaar"  → aadhaarFront row  (documentNumberType = "aadhaar")
 *     "pan"      → pan row           (documentNumberType = "pan")
 *     "license"  → licenseFront row  (documentNumberType = "license")
 *     "rc"       → rcFront row       (documentNumberType = "rc")
 *   Back-side rows do not carry a number.
 *   documentNumbers is optional — V1 submissions without numbers remain valid.
 */

import { Router } from "express";
import { requireAuth } from "../lib/require-auth";
import { db, driversTable, driverDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// Document types that the KYC flow accepts.
const ALLOWED_DOC_TYPES = new Set([
  "selfie",
  "aadhaarFront", "aadhaarBack",
  "pan",
  "licenseFront", "licenseBack",
  "rcFront", "rcBack",
]);

// Maps a documentNumberType to the primary docType row that carries the number.
const DOC_NUMBER_TYPE_TO_DOC_TYPE: Record<string, string> = {
  aadhaar: "aadhaarFront",
  pan:     "pan",
  license: "licenseFront",
  rc:      "rcFront",
};

// Valid documentNumberType values
const VALID_DOC_NUMBER_TYPES = new Set(Object.keys(DOC_NUMBER_TYPE_TO_DOC_TYPE));

// ─── Onboarding step computation ─────────────────────────────────────────────
//
// Single source of truth for server-authoritative onboarding routing.
// Mobile V2 reads nextRoute from GET /me (or /verification-status) and calls
// router.replace(nextRoute) — no client-side logic required.
//
// Priority order (first matching condition wins):
//   1. account_blocked         — account suspended/blacklisted/blocked
//   2. background_setup_required — permission setup not completed at current version
//   3. vehicle_required        — no vehicle selected
//   4. profile_required        — name or city missing
//   5. documents_required      — documents not yet submitted
//   6. fee_required            — onboarding fee applies and unpaid
//   7. document_reupload_required — KYC rejected; driver must re-upload
//   8. verification_pending    — awaiting admin review
//   9. dashboard_ready         — fully approved; route to main app

// Must be incremented whenever the permission setup flow changes in a way that
// requires drivers to re-complete it. Mirrors PERMISSION_SETUP_VERSION in
// artifacts/mobile/utils/firestore.ts.
const REQUIRED_PERMISSION_VERSION = 6;

// Account statuses that lock the driver out of the app.
const BLOCKED_STATUSES = new Set(["suspended", "blacklisted", "blocked"]);

export type OnboardingStep =
  | "login_required"
  | "background_setup_required"
  | "vehicle_required"
  | "profile_required"
  | "documents_required"
  | "fee_required"
  | "document_reupload_required"
  | "verification_pending"
  | "dashboard_ready"
  | "account_blocked";

export type OnboardingRoute =
  | "/login"
  | "/background-setup"
  | "/vehicle-selection"
  | "/profile-setup"
  | "/document-upload"
  | "/onboarding-fee"
  | "/verification-pending"
  | "/(tabs)"
  | "/account-blocked";

type OnboardingStepResult = {
  onboardingStep: OnboardingStep;
  nextRoute:      OnboardingRoute;
};

/**
 * Derives the driver's current onboarding step and mobile next route purely
 * from PostgreSQL state. No Firestore reads, no local cache.
 *
 * Called after every SELECT on the drivers row so the response always reflects
 * the current database state.
 *
 * Priority order (first matching condition wins):
 *   1. account_blocked              — suspended/blacklisted/blocked
 *   2. vehicle_required             — no vehicle chosen yet
 *   3. profile_required             — name or city missing
 *   4. documents_required           — documents not yet submitted
 *   5. fee_required                 — onboarding fee unpaid
 *   6. document_reupload_required   — KYC rejected
 *   7. verification_pending         — awaiting admin review
 *   8. background_setup_required    — approved but permission setup incomplete
 *   9. dashboard_ready              — approved + permission setup complete
 *
 * Background setup intentionally sits AFTER the full signup funnel so that
 * fresh drivers flow straight through Phone → Vehicle → Profile → Documents →
 * Fee → Pending without hitting the permission gate mid-funnel. The gate only
 * fires once the driver is approved and ready to take their first order.
 */
function computeOnboardingStep(driver: {
  accountStatus:          string | null | undefined;
  backgroundSetupShown:   boolean | null | undefined;
  permissionSetupVersion: number | null | undefined;
  vehicleId:              string | null | undefined;
  name:                   string | null | undefined;
  city:                   string | null | undefined;
  documentsSubmitted:     boolean | null | undefined;
  onboardingFeeApplies:   boolean | null | undefined;
  onboardingFeeStatus:    string | null | undefined;
  verificationStatus:     string | null | undefined;
}): OnboardingStepResult {
  // 1. Account blocked — highest priority; driver cannot proceed regardless of
  //    onboarding progress.
  if (driver.accountStatus && BLOCKED_STATUSES.has(driver.accountStatus)) {
    return { onboardingStep: "account_blocked", nextRoute: "/account-blocked" };
  }

  // 2. Vehicle selection — no vehicleId means the driver never chose a vehicle.
  if (!driver.vehicleId) {
    return { onboardingStep: "vehicle_required", nextRoute: "/vehicle-selection" };
  }

  // 3. Profile — name and city are the minimum required profile fields.
  if (!driver.name || !driver.city) {
    return { onboardingStep: "profile_required", nextRoute: "/profile-setup" };
  }

  // 4. Documents — driver has not yet submitted KYC documents.
  if (!driver.documentsSubmitted) {
    return { onboardingStep: "documents_required", nextRoute: "/document-upload" };
  }

  // 5. Onboarding fee — applies only to new signup drivers; skipped for existing
  //    drivers where onboardingFeeApplies is false.
  if (driver.onboardingFeeApplies && driver.onboardingFeeStatus !== "paid") {
    return { onboardingStep: "fee_required", nextRoute: "/onboarding-fee" };
  }

  // 6. Document reupload — admin rejected the submission; driver must fix and resubmit.
  if (driver.verificationStatus === "rejected") {
    return { onboardingStep: "document_reupload_required", nextRoute: "/document-upload" };
  }

  // 7. Verification pending — documents submitted and under review (or default
  //    "unsubmitted" state that can arise from a partial migration).
  if (
    driver.verificationStatus === "pending"     ||
    driver.verificationStatus === "unsubmitted" ||
    driver.verificationStatus === null          ||
    driver.verificationStatus === undefined
  ) {
    return { onboardingStep: "verification_pending", nextRoute: "/verification-pending" };
  }

  // Steps 8–9 only reached when verificationStatus is "approved" or "verified".

  // 8. Background / permission setup — checked only after KYC approval so that
  //    the permission gate never interrupts the signup funnel mid-flow.
  const permVersion = driver.permissionSetupVersion ?? 0;
  if (!driver.backgroundSetupShown || permVersion < REQUIRED_PERMISSION_VERSION) {
    return { onboardingStep: "background_setup_required", nextRoute: "/background-setup" };
  }

  // 9. Dashboard ready — KYC approved and permission setup complete.
  if (
    driver.verificationStatus === "approved" ||
    driver.verificationStatus === "verified"
  ) {
    return { onboardingStep: "dashboard_ready", nextRoute: "/(tabs)" };
  }

  // Fallback: unknown verificationStatus value; treat as still pending to avoid
  // routing a driver into the main app with an unexpected state.
  return { onboardingStep: "verification_pending", nextRoute: "/verification-pending" };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

type DocEntry = {
  url:                string | null;
  status:             string | null;
  uploadedAt:         string | null;
  rejectionReason:    string | null;
  rejectedAt:         string | null;
  documentNumber:     string | null;
  documentNumberType: string | null;
};

/**
 * Builds the documents map returned to the mobile app:
 *   { [docType]: { url, status, uploadedAt, rejectionReason, rejectedAt,
 *                  documentNumber, documentNumberType } }
 */
function buildDocumentsMap(
  rows: typeof driverDocumentsTable.$inferSelect[],
): Record<string, DocEntry> {
  const map: Record<string, DocEntry> = {};
  for (const row of rows) {
    map[row.docType] = {
      url:                row.url             ?? null,
      status:             row.status          ?? null,
      uploadedAt:         row.uploadedAt      ? row.uploadedAt.toISOString() : null,
      rejectionReason:    row.rejectionReason ?? null,
      rejectedAt:         row.rejectedAt      ? row.rejectedAt.toISOString() : null,
      documentNumber:     row.documentNumber     ?? null,
      documentNumberType: row.documentNumberType ?? null,
    };
  }
  return map;
}

// ─── GET /api/drivers/me ──────────────────────────────────────────────────────

/**
 * Returns the full driver profile from PostgreSQL plus server-computed
 * onboardingStep and nextRoute so mobile V2 can route without local logic.
 *
 * Response 200:
 * {
 *   ok: true,
 *   onboardingStep: OnboardingStep,
 *   nextRoute:      OnboardingRoute,
 *   driver: {
 *     uid, phone, name, city, gender,
 *     vehicleId, vehicleName, licenseNumber, vehicleNumber,
 *     accountStatus, suspendReason, blacklistReason,
 *     documentsSubmitted, documentsSubmittedAt,
 *     verificationStatus, kycRejectionReason, rejectedDocuments,
 *     backgroundSetupShown, permissionSetupVersion, permissionSetupCompletedAt,
 *     onboardingFeeApplies, onboardingFeeStatus, onboardingFeeAmount, onboardingFeeCurrency,
 *     createdAt, updatedAt,
 *     documents: {
 *       [docType]: {
 *         url, status, uploadedAt, rejectionReason, rejectedAt,
 *         documentNumber, documentNumberType
 *       }
 *     }
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

    const { onboardingStep, nextRoute } = computeOnboardingStep(driver);

    res.json({
      ok:            true,
      onboardingStep,
      nextRoute,
      driver: {
        uid:                        driver.uid,
        phone:                      driver.phone,
        name:                       driver.name                       ?? null,
        city:                       driver.city                       ?? null,
        gender:                     driver.gender                     ?? null,
        vehicleId:                  driver.vehicleId                  ?? null,
        vehicleName:                driver.vehicleName                ?? null,
        licenseNumber:              driver.licenseNumber              ?? null,
        vehicleNumber:              driver.vehicleNumber              ?? null,
        accountStatus:              driver.accountStatus              ?? null,
        suspendReason:              driver.suspendReason              ?? null,
        blacklistReason:            driver.blacklistReason            ?? null,
        documentsSubmitted:         driver.documentsSubmitted         ?? false,
        documentsSubmittedAt:       driver.documentsSubmittedAt
          ? driver.documentsSubmittedAt.toISOString() : null,
        verificationStatus:         driver.verificationStatus         ?? null,
        kycRejectionReason:         driver.kycRejectionReason         ?? null,
        rejectedDocuments:          driver.rejectedDocuments          ?? null,
        backgroundSetupShown:       driver.backgroundSetupShown       ?? false,
        permissionSetupVersion:     driver.permissionSetupVersion     ?? 0,
        permissionSetupCompletedAt: driver.permissionSetupCompletedAt
          ? driver.permissionSetupCompletedAt.toISOString() : null,
        onboardingFeeApplies:       driver.onboardingFeeApplies       ?? false,
        onboardingFeeStatus:        driver.onboardingFeeStatus        ?? null,
        onboardingFeeAmount:        driver.onboardingFeeAmount        ?? null,
        onboardingFeeCurrency:      driver.onboardingFeeCurrency      ?? null,
        createdAt:                  driver.createdAt.toISOString(),
        updatedAt:                  driver.updatedAt.toISOString(),
        documents:                  buildDocumentsMap(docRows),
      },
    });

    req.log.info({ uid, onboardingStep }, "driver-profile: GET /drivers/me");
  } catch (err) {
    req.log.error({ err, uid }, "driver-profile: GET /drivers/me failed");
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to fetch driver profile." });
  }
});

// ─── PATCH /api/drivers/profile ───────────────────────────────────────────────

/**
 * Updates profile fields. licenseNumber / vehicleNumber are stored uppercased.
 *
 * Body (all optional): { name?, city?, gender?, licenseNumber?, vehicleNumber? }
 * Response 200: { ok: true }
 * Response 400: { ok: false, error: "no_fields" }
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

  if (typeof body.name          === "string") patch.name          = body.name.trim()                        || null;
  if (typeof body.city          === "string") patch.city          = body.city.trim()                        || null;
  if (typeof body.gender        === "string") patch.gender        = body.gender.trim()                      || null;
  if (typeof body.licenseNumber === "string") patch.licenseNumber = body.licenseNumber.trim().toUpperCase() || null;
  if (typeof body.vehicleNumber === "string") patch.vehicleNumber = body.vehicleNumber.trim().toUpperCase() || null;

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
 * Body (all optional): { vehicleId?, vehicleName? }
 * Response 200: { ok: true }
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
 * Upserts document URL entries into driver_documents. Optionally stores
 * document numbers (aadhaar, pan, license, rc) on the primary doc rows.
 *
 * Marks the driver as having submitted KYC and sets verification_status → "pending".
 * Clears prior rejection state (kyc_rejection_reason, rejected_documents, per-doc
 * rejection_reason / rejected_at) on re-submission.
 *
 * Body:
 *   {
 *     documents:       { [docType]: string }     — docType → public VPS URL
 *     documentNumbers: { [numberType]: string }  — optional; "aadhaar"|"pan"|"license"|"rc" → number
 *   }
 *
 * documentNumbers mapping:
 *   "aadhaar" → aadhaarFront row   (documentNumberType = "aadhaar")
 *   "pan"     → pan row            (documentNumberType = "pan")
 *   "license" → licenseFront row   (documentNumberType = "license")
 *   "rc"      → rcFront row        (documentNumberType = "rc")
 *
 * Response 200: { ok: true, count: number }
 * Response 400: { ok: false, error: "invalid_body" | "no_valid_docs" }
 * Response 409: { ok: false, error: "driver_not_in_pg" }
 */
router.post("/drivers/documents", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as {
    documents?:       unknown;
    documentNumbers?: unknown;
  };

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

  const rawDocs = body.documents as Record<string, unknown>;
  const validEntries: { docType: string; url: string }[] = [];

  for (const [docType, url] of Object.entries(rawDocs)) {
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

  // Parse documentNumbers — optional, V2 upload flow only
  const rawNumbers: Record<string, string> = {};
  if (
    body.documentNumbers &&
    typeof body.documentNumbers === "object" &&
    !Array.isArray(body.documentNumbers)
  ) {
    for (const [numType, numVal] of Object.entries(body.documentNumbers as Record<string, unknown>)) {
      if (!VALID_DOC_NUMBER_TYPES.has(numType)) continue;
      if (typeof numVal !== "string" || !numVal.trim()) continue;
      rawNumbers[numType] = numVal.trim();
    }
  }

  // Build a per-docType lookup: docType → { documentNumber, documentNumberType }
  // e.g. "aadhaarFront" → { documentNumber: "1234 5678 9012", documentNumberType: "aadhaar" }
  const docNumberByDocType: Record<string, { documentNumber: string; documentNumberType: string }> = {};
  for (const [numType, numVal] of Object.entries(rawNumbers)) {
    const primaryDocType = DOC_NUMBER_TYPE_TO_DOC_TYPE[numType];
    if (primaryDocType) {
      docNumberByDocType[primaryDocType] = { documentNumber: numVal, documentNumberType: numType };
    }
  }

  try {
    const now = new Date();

    for (const { docType, url } of validEntries) {
      const numFields = docNumberByDocType[docType];

      const insertValues: typeof driverDocumentsTable.$inferInsert = {
        driverUid:  uid,
        docType,
        url,
        status:     "pending",
        uploadedAt: now,
        ...(numFields && {
          documentNumber:     numFields.documentNumber,
          documentNumberType: numFields.documentNumberType,
        }),
      };

      const conflictSet: Partial<typeof driverDocumentsTable.$inferInsert> = {
        url,
        status:          "pending",
        uploadedAt:      now,
        rejectionReason: null,
        rejectedAt:      null,
      };
      // Only update document number if caller supplied it for this doc type
      if (numFields) {
        conflictSet.documentNumber     = numFields.documentNumber;
        conflictSet.documentNumberType = numFields.documentNumberType;
      }

      await db
        .insert(driverDocumentsTable)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [driverDocumentsTable.driverUid, driverDocumentsTable.docType],
          set:    conflictSet,
        });
    }

    // Mark driver as submitted — clears prior rejection state.
    await db
      .update(driversTable)
      .set({
        documentsSubmitted:   true,
        documentsSubmittedAt: now,
        verificationStatus:   "pending",
        kycRejectionReason:   null,
        rejectedDocuments:    null,
        updatedAt:            now,
      })
      .where(eq(driversTable.uid, uid));

    req.log.info(
      { uid, count: validEntries.length, documentNumberTypes: Object.keys(rawNumbers) },
      "driver-profile: POST /drivers/documents",
    );
    res.json({ ok: true, count: validEntries.length });
  } catch (err: unknown) {
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
 * Returns KYC status + per-document map including document numbers, plus
 * server-computed onboardingStep/nextRoute for the verification-pending screen
 * to determine when to route to /(tabs) after admin approval.
 *
 * Response 200:
 * {
 *   ok: true,
 *   onboardingStep:      OnboardingStep,
 *   nextRoute:           OnboardingRoute,
 *   verificationStatus:  string | null,
 *   documentsSubmitted:  boolean,
 *   kycRejectionReason:  string | null,
 *   rejectedDocuments:   string[] | null,
 *   documents: {
 *     [docType]: {
 *       url, status, uploadedAt, rejectionReason, rejectedAt,
 *       documentNumber, documentNumberType
 *     }
 *   }
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
        accountStatus:          driversTable.accountStatus,
        backgroundSetupShown:   driversTable.backgroundSetupShown,
        permissionSetupVersion: driversTable.permissionSetupVersion,
        vehicleId:              driversTable.vehicleId,
        name:                   driversTable.name,
        city:                   driversTable.city,
        documentsSubmitted:     driversTable.documentsSubmitted,
        onboardingFeeApplies:   driversTable.onboardingFeeApplies,
        onboardingFeeStatus:    driversTable.onboardingFeeStatus,
        verificationStatus:     driversTable.verificationStatus,
        kycRejectionReason:     driversTable.kycRejectionReason,
        rejectedDocuments:      driversTable.rejectedDocuments,
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

    const { onboardingStep, nextRoute } = computeOnboardingStep(driver);

    req.log.info({ uid, onboardingStep }, "driver-profile: GET /drivers/verification-status");
    res.json({
      ok:                  true,
      onboardingStep,
      nextRoute,
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
 * Records that the driver completed the background / permission setup flow.
 *
 * Body (all optional):
 *   {
 *     backgroundSetupShown?:       boolean
 *     permissionSetupVersion?:     number
 *     permissionSetupCompletedAt?: string  (ISO 8601)
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
