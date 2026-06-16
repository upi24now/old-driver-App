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
import { FieldValue } from "firebase-admin/firestore";

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
        accountStatus:        d["accountStatus"]  ?? null,
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
  const { reason, rejectedDocIds } = (req.body ?? {}) as {
    reason?: unknown;
    rejectedDocIds?: unknown;
  };

  req.log.info(
    { uid, body: req.body },
    "[kyc-reject] received request body",
  );

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  // Validate rejectedDocIds if provided
  const validDocIdSet = new Set<string>(DOC_IDS);
  const perDocReject: string[] | null =
    Array.isArray(rejectedDocIds) &&
    rejectedDocIds.length > 0 &&
    (rejectedDocIds as unknown[]).every(
      (id) => typeof id === "string" && validDocIdSet.has(id),
    )
      ? (rejectedDocIds as string[])
      : null;

  const reasonStr = typeof reason === "string" && reason.trim().length > 0
    ? reason.trim()
    : null;

  req.log.info(
    { uid, reasonStr, perDocReject },
    "[kyc-reject] validated — perDocReject and reason",
  );

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const data = snap.data() ?? {};
    const existing = (data["documents"] ?? {}) as Record<
      string,
      { url?: string | null; uri?: string | null; status?: string | null }
    >;

    req.log.info(
      {
        uid,
        existingDocKeys: Object.keys(existing),
        perDocReject,
        existingPanHasUrl: !!(existing["pan"]?.url ?? existing["pan"]?.uri),
      },
      "[kyc-reject] existing documents MAP snapshot",
    );

    const updates: Record<string, string | FieldValue | null> = {
      verificationStatus: "rejected",
    };

    // Always write top-level rejection reason (driver app reads kycRejectionReason)
    if (reasonStr) {
      updates["kycRejectionReason"] = reasonStr;
    }

    // Always write the top-level rejectedDocuments array so the driver app
    // fallback (document-upload.tsx) can seed per-doc rejected state even
    // when per-doc status writes are skipped below.
    if (perDocReject) {
      (updates as Record<string, unknown>)["rejectedDocuments"] = perDocReject;
    }

    if (perDocReject) {
      // Per-document reject: mark only the explicitly selected docs as rejected.
      const rejectSet = new Set(perDocReject);
      for (const docId of DOC_IDS) {
        if (!rejectSet.has(docId)) continue;
        const entry = existing[docId];
        const hasUrl = !!(entry?.url ?? entry?.uri);

        req.log.info(
          { uid, docId, hasUrl, entryStatus: entry?.status ?? "(absent)" },
          "[kyc-reject] per-doc evaluation",
        );

        // Write rejected status regardless of whether url exists so that
        // the rejectedDocuments array fallback in the driver app is consistent
        // with the per-doc MAP status.
        updates[`documents.${docId}.status`]     = "rejected";
        updates[`documents.${docId}.rejectedAt`] = FieldValue.serverTimestamp();
        if (reasonStr) {
          updates[`documents.${docId}.rejectionReason`] = reasonStr;
        }
      }
    } else {
      // Bulk reject: mark every uploaded doc as rejected.
      for (const docId of DOC_IDS) {
        const entry = existing[docId];
        if (!entry || !(entry.url ?? entry.uri)) continue;
        updates[`documents.${docId}.status`]     = "rejected";
        updates[`documents.${docId}.rejectedAt`] = FieldValue.serverTimestamp();
        if (reasonStr) {
          updates[`documents.${docId}.rejectionReason`] = reasonStr;
        }
      }
    }

    req.log.info(
      { uid, updateKeys: Object.keys(updates) },
      "[kyc-reject] writing updates to Firestore",
    );

    await ref.update(updates);

    req.log.info({ uid, reasonStr, perDocReject }, "kyc-admin: driver KYC rejected ✓");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: reject failed");
    res.status(500).json({ ok: false, error: "Failed to reject KYC." });
  }
});

// ─── POST /api/kyc/:uid/suspend ───────────────────────────────────────────────

/**
 * Suspends a driver account.
 * Sets accountStatus → "suspended", forces isOnline → false.
 * The driver app detects the change via its real-time doc listener and
 * immediately routes to /account-blocked.
 */
router.post("/kyc/:uid/suspend", requireAdminKey, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    await ref.update({
      accountStatus: "suspended",
      suspendedAt:   FieldValue.serverTimestamp(),
      isOnline:      false,
      onlineStatus:  "offline",
    });

    req.log.info({ uid }, "kyc-admin: driver suspended");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: suspend failed");
    res.status(500).json({ ok: false, error: "Failed to suspend driver." });
  }
});

// ─── POST /api/kyc/:uid/blacklist ─────────────────────────────────────────────

/**
 * Blacklists a driver account.
 * Sets accountStatus → "blacklisted", forces isOnline → false.
 * The driver app detects the change via its real-time doc listener and
 * immediately routes to /account-blocked.
 */
router.post("/kyc/:uid/blacklist", requireAdminKey, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    await ref.update({
      accountStatus: "blacklisted",
      blacklistedAt: FieldValue.serverTimestamp(),
      isOnline:      false,
      onlineStatus:  "offline",
    });

    req.log.info({ uid }, "kyc-admin: driver blacklisted");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: blacklist failed");
    res.status(500).json({ ok: false, error: "Failed to blacklist driver." });
  }
});

// ─── POST /api/kyc/:uid/unsuspend ─────────────────────────────────────────────

/**
 * Removes a suspension or blacklist from a driver account.
 * Sets accountStatus → "active". The driver must go online again manually.
 */
router.post("/kyc/:uid/unsuspend", requireAdminKey, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    await ref.update({
      accountStatus: "active",
      isOnline:      false,
      onlineStatus:  "offline",
    });

    req.log.info({ uid }, "kyc-admin: driver unsuspended / unblacklisted");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: unsuspend failed");
    res.status(500).json({ ok: false, error: "Failed to unsuspend driver." });
  }
});

export default router;
