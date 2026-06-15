/**
 * kyc-admin.ts
 *
 * Admin-only KYC management routes. Authenticated via a static API key
 * set in the ADMIN_API_KEY environment variable.
 *
 * All requests must include:
 *   Authorization: Bearer <ADMIN_API_KEY>
 *
 * Routes:
 *   GET  /api/kyc/drivers          — list drivers with pending / rejected KYC
 *   POST /api/kyc/:uid/approve     — approve a driver's KYC
 *   POST /api/kyc/:uid/reject      — reject a driver's KYC (optional body: { reason })
 *
 * Firestore model (drivers/{uid}):
 *   verificationStatus  — "pending" | "approved" | "verified" | "rejected"
 *   documentsSubmitted  — boolean
 *   documents           — { [docId]: { uri?, status? } }
 */

import { Router } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import type { FieldValue } from "firebase-admin/firestore";

const router = Router();

const DOC_IDS = [
  "selfie",
  "aadhaarFront", "aadhaarBack",
  "pan",
  "licenseFront", "licenseBack",
  "rcFront",      "rcBack",
  // legacy aliases — present in docs submitted before the v2 field rename
  "aadhaar", "license", "rc", "insurance",
] as const;

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAdminKey(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  const adminKey = process.env["ADMIN_API_KEY"];

  if (!adminKey) {
    req.log.warn("ADMIN_API_KEY env var not set — admin routes disabled");
    res.status(503).json({ ok: false, error: "Admin routes not configured on this server." });
    return;
  }

  const authHeader  = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!bearerToken || bearerToken !== adminKey) {
    req.log.warn({ ip: req.ip }, "kyc-admin: unauthorized attempt");
    res.status(401).json({ ok: false, error: "Invalid or missing admin API key." });
    return;
  }

  next();
}

// ─── GET /api/kyc/drivers ─────────────────────────────────────────────────────

/**
 * Returns all drivers who have submitted KYC documents.
 * Optionally filter by verificationStatus via ?status=pending|approved|rejected
 *
 * Response 200:
 * {
 *   ok: true,
 *   drivers: Array<{
 *     uid:                string
 *     name?:              string
 *     phone:              string
 *     city?:              string
 *     vehicleId?:         string
 *     vehicleNumber?:     string
 *     licenseNumber?:     string
 *     verificationStatus: string
 *     documentsSubmittedAt: string | null   (ISO timestamp)
 *     documents: {
 *       [docId]: { uri?: string | null; status?: string | null }
 *     }
 *   }>
 * }
 */
router.get("/kyc/drivers", requireAdminKey, async (req, res) => {
  const statusFilter = req.query["status"];

  try {
    const db  = await adminFirestore();
    let q: FirebaseFirestore.Query = db.collection("drivers")
      .where("documentsSubmitted", "==", true);

    if (typeof statusFilter === "string" && statusFilter.length > 0) {
      q = q.where("verificationStatus", "==", statusFilter);
    }

    const snap = await q.orderBy("documentsSubmittedAt", "desc").get();

    const drivers = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        uid:                  doc.id,
        name:                 d["name"]           ?? null,
        phone:                d["phone"]          ?? null,
        city:                 d["city"]           ?? null,
        vehicleId:            d["vehicleId"]      ?? null,
        vehicleNumber:        d["vehicleNumber"]  ?? null,
        licenseNumber:        d["licenseNumber"]  ?? null,
        verificationStatus:   d["verificationStatus"] ?? "pending",
        documentsSubmittedAt: d["documentsSubmittedAt"]
          ? (d["documentsSubmittedAt"] as import("firebase-admin/firestore").Timestamp).toDate().toISOString()
          : null,
        documents:            d["documents"] ?? {},
      };
    });

    req.log.info({ count: drivers.length, statusFilter }, "kyc-admin: listed drivers");
    res.json({ ok: true, drivers });
  } catch (err) {
    req.log.error({ err }, "kyc-admin: GET /kyc/drivers failed");
    res.status(500).json({ ok: false, error: "Failed to fetch drivers." });
  }
});

// ─── POST /api/kyc/:uid/approve ───────────────────────────────────────────────

/**
 * Approves a driver's KYC.
 * Sets verificationStatus → "approved" on the driver doc.
 * Sets status → "approved" on every document entry that has a uri.
 *
 * Response 200: { ok: true }
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.post("/kyc/:uid/approve", requireAdminKey, async (req, res) => {
  const uid = req.params["uid"] as string;

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const data = snap.data() ?? {};
    const existing = (data["documents"] ?? {}) as Record<string, { url?: string | null; uri?: string | null; status?: string | null }>;

    const updates: Record<string, string | FieldValue> = {
      verificationStatus: "approved",
    };

    for (const docId of DOC_IDS) {
      const entry = existing[docId];
      // Accept both `url` (v2) and legacy `uri` field
      if (entry && (entry.url ?? entry.uri)) {
        updates[`documents.${docId}.status`] = "approved";
      }
    }

    await ref.update(updates);
    req.log.info({ uid }, "kyc-admin: driver KYC approved");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: approve failed");
    res.status(500).json({ ok: false, error: "Failed to approve KYC." });
  }
});

// ─── POST /api/kyc/:uid/reject ────────────────────────────────────────────────

/**
 * Rejects a driver's KYC.
 * Sets verificationStatus → "rejected" on the driver doc.
 * Sets status → "rejected" on every document entry that has a uri.
 * Optionally stores a rejection reason.
 *
 * Body (optional): { reason?: string }
 *
 * Response 200: { ok: true }
 * Response 404: { ok: false, error: "driver_not_found" }
 */
router.post("/kyc/:uid/reject", requireAdminKey, async (req, res) => {
  const uid = req.params["uid"] as string;
  const { reason } = (req.body ?? {}) as { reason?: unknown };

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const data = snap.data() ?? {};
    const existing = (data["documents"] ?? {}) as Record<string, { url?: string | null; uri?: string | null; status?: string | null }>;

    const updates: Record<string, string | FieldValue | null> = {
      verificationStatus: "rejected",
    };

    if (typeof reason === "string" && reason.trim().length > 0) {
      updates["kycRejectionReason"] = reason.trim();
    }

    for (const docId of DOC_IDS) {
      const entry = existing[docId];
      // Accept both `url` (v2) and legacy `uri` field
      if (entry && (entry.url ?? entry.uri)) {
        updates[`documents.${docId}.status`] = "rejected";
      }
    }

    await ref.update(updates);
    req.log.info({ uid, reason }, "kyc-admin: driver KYC rejected");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: reject failed");
    res.status(500).json({ ok: false, error: "Failed to reject KYC." });
  }
});

export default router;
