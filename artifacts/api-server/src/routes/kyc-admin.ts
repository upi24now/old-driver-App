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
 *   POST /api/kyc/:uid/suspend     — suspend a driver account
 *   POST /api/kyc/:uid/blacklist   — blacklist a driver account
 *   POST /api/kyc/:uid/unsuspend   — restore a suspended / blacklisted account
 *
 * Firestore model (drivers/{uid}):
 *   verificationStatus  — "pending" | "approved" | "verified" | "rejected"
 *   documentsSubmitted  — boolean
 *   documents           — { [docId]: { uri?, status? } }
 *
 * ── Dual-write strategy ──────────────────────────────────────────────────────
 *
 * Firestore is the authoritative source of truth for all reads.
 * After every successful Firestore write, the same data is mirrored to
 * PostgreSQL (`drivers` and `driver_documents` tables) as a fire-and-forget
 * operation:
 *
 *   • PG write failures are logged but NEVER propagate to the HTTP response.
 *   • PG reads are NOT used anywhere in this module (Firestore only).
 *   • No API contract changes; no mobile or admin-panel changes.
 *
 * During this migration phase, drivers may not yet have a row in the `drivers`
 * PG table (bulk data migration is a separate step). In that case the UPDATE
 * is a no-op (0 rows affected) and a warning is logged. This is expected
 * behaviour and safe to ignore.
 */

import { Router } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminJwt } from "../lib/require-admin-jwt";
import { db, driversTable, driverDocumentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import type { Logger } from "pino";

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

// ─── PG mirror helpers ────────────────────────────────────────────────────────

/**
 * Mirrors a KYC status change to the `drivers` PostgreSQL row.
 * UPDATE-only — no INSERT. If the driver doesn't have a PG row yet
 * (pending bulk migration), rowCount will be 0 and a warning is logged.
 * Never throws.
 */
async function pgMirrorDriver(
  log: Logger,
  uid: string,
  label: string,
  values: Parameters<typeof db.update>[0] extends typeof driversTable
    ? never
    : Partial<typeof driversTable.$inferInsert>,
): Promise<void> {
  try {
    const result = await db
      .update(driversTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(driversTable.uid, uid));

    const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? null;
    if (rowCount === 0) {
      log.warn(
        { uid, label },
        "kyc-admin pg-mirror: driver row not found in PG (pending bulk migration) — skipped",
      );
    } else {
      log.info({ uid, label }, "kyc-admin pg-mirror: driver row updated");
    }
  } catch (pgErr) {
    log.error(
      { pgErr, uid, label },
      "kyc-admin pg-mirror: driver update failed — Firestore remains authoritative",
    );
  }
}

/**
 * Mirrors document-level status changes to `driver_documents`.
 * Skips the query if docTypes is empty. Never throws.
 */
async function pgMirrorDocuments(
  log: Logger,
  uid: string,
  label: string,
  docTypes: string[],
  values: Partial<typeof driverDocumentsTable.$inferInsert>,
): Promise<void> {
  if (docTypes.length === 0) return;
  try {
    await db
      .update(driverDocumentsTable)
      .set(values)
      .where(
        and(
          eq(driverDocumentsTable.driverUid, uid),
          inArray(driverDocumentsTable.docType, docTypes),
        ),
      );
    log.info({ uid, label, docTypes }, "kyc-admin pg-mirror: documents updated");
  } catch (pgErr) {
    log.error(
      { pgErr, uid, label, docTypes },
      "kyc-admin pg-mirror: documents update failed — Firestore remains authoritative",
    );
  }
}

// ─── GET /api/kyc/drivers ─────────────────────────────────────────────────────

/**
 * Returns all drivers who have submitted KYC documents.
 * Optionally filter by verificationStatus via ?status=pending|approved|rejected
 *
 * READ PATH: Firestore only. No PostgreSQL reads.
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
router.get("/kyc/drivers", requireAdminJwt, async (req, res) => {
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
router.post("/kyc/:uid/approve", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  try {
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const data     = snap.data() ?? {};
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

    // ── Firestore write (authoritative) ──────────────────────────────────────
    await ref.update(updates);
    req.log.info({ uid }, "kyc-admin: driver KYC approved");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    const approvedDocIds = (DOC_IDS as readonly string[]).filter((docId) => {
      const entry = existing[docId];
      return !!(entry && (entry.url ?? entry.uri));
    });

    void pgMirrorDriver(req.log, uid, "approve", {
      verificationStatus: "approved",
    });
    void pgMirrorDocuments(req.log, uid, "approve-docs", approvedDocIds, {
      status: "approved",
    });
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
router.post("/kyc/:uid/reject", requireAdminJwt, async (req, res) => {
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
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const data     = snap.data() ?? {};
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
        const entry  = existing[docId];
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

    // ── Firestore write (authoritative) ──────────────────────────────────────
    await ref.update(updates);
    req.log.info({ uid, reasonStr, perDocReject }, "kyc-admin: driver KYC rejected ✓");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    // Determine which doc types are being marked rejected (mirrors Firestore logic above)
    const rejectedDocTypes: string[] = perDocReject
      ? perDocReject                              // explicit per-doc list
      : (DOC_IDS as readonly string[]).filter(   // bulk: only docs with a URL
          (docId) => {
            const entry = existing[docId];
            return !!(entry && (entry.url ?? entry.uri));
          },
        );

    const now = new Date();
    void pgMirrorDriver(req.log, uid, "reject", {
      verificationStatus: "rejected",
      kycRejectionReason:  reasonStr ?? null,
      rejectedDocuments:   perDocReject ?? null,
    });
    void pgMirrorDocuments(req.log, uid, "reject-docs", rejectedDocTypes, {
      status:          "rejected",
      rejectionReason: reasonStr ?? null,
      rejectedAt:      now,
    });
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
router.post("/kyc/:uid/suspend", requireAdminJwt, async (req, res) => {
  const uid    = req.params["uid"] as string;
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim()
    : null;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    const update: Record<string, unknown> = {
      accountStatus: "suspended",
      suspendedAt:   FieldValue.serverTimestamp(),
      isOnline:      false,
      onlineStatus:  "offline",
    };
    if (reason) update["suspendReason"] = reason;

    // ── Firestore write (authoritative) ──────────────────────────────────────
    await ref.update(update);
    req.log.info({ uid, reason }, "kyc-admin: driver suspended");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    void pgMirrorDriver(req.log, uid, "suspend", {
      accountStatus: "suspended",
      suspendReason: reason ?? null,
      suspendedAt:   new Date(),
    });
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
router.post("/kyc/:uid/blacklist", requireAdminJwt, async (req, res) => {
  const uid    = req.params["uid"] as string;
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim()
    : null;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    const update: Record<string, unknown> = {
      accountStatus: "blacklisted",
      blacklistedAt: FieldValue.serverTimestamp(),
      isOnline:      false,
      onlineStatus:  "offline",
    };
    if (reason) update["blacklistReason"] = reason;

    // ── Firestore write (authoritative) ──────────────────────────────────────
    await ref.update(update);
    req.log.info({ uid, reason }, "kyc-admin: driver blacklisted");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    void pgMirrorDriver(req.log, uid, "blacklist", {
      accountStatus:  "blacklisted",
      blacklistReason: reason ?? null,
      blacklistedAt:  new Date(),
    });
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
router.post("/kyc/:uid/unsuspend", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    // ── Firestore write (authoritative) ──────────────────────────────────────
    await ref.update({
      accountStatus: "active",
      isOnline:      false,
      onlineStatus:  "offline",
    });
    req.log.info({ uid }, "kyc-admin: driver unsuspended / unblacklisted");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    // Clear suspendReason so stale values don't persist after reinstatement
    void pgMirrorDriver(req.log, uid, "unsuspend", {
      accountStatus: "active",
      suspendReason: null,
    });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: unsuspend failed");
    res.status(500).json({ ok: false, error: "Failed to unsuspend driver." });
  }
});

export default router;
