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
 *   POST /api/kyc/:uid/reject      — reject a driver's KYC
 *   POST /api/kyc/:uid/suspend     — suspend a driver account
 *   POST /api/kyc/:uid/blacklist   — blacklist a driver account
 *   POST /api/kyc/:uid/unsuspend   — restore a suspended / blacklisted account
 *
 * ── Authority model ───────────────────────────────────────────────────────────
 *
 * PostgreSQL is AUTHORITATIVE for approve and reject.
 *   • PG writes are awaited before the HTTP response is sent.
 *   • Firestore writes are fire-and-forget after the response (admin panel mirror).
 *   • The mobile app reads GET /api/drivers/me and GET /api/drivers/verification-status
 *     from PG only — it does not need Firestore to be current.
 *
 * Suspend / blacklist / unsuspend still write Firestore authoritatively
 * because isOnline must be toggled there (no PG equivalent yet).
 */

import { Router } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminJwt } from "../lib/require-admin-jwt";
import { db, driversTable, driverDocumentsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull, sql, desc } from "drizzle-orm";
import type { Logger } from "pino";

const router = Router();

const DOC_IDS = [
  "selfie",
  "aadhaarFront", "aadhaarBack",
  "pan",
  "licenseFront", "licenseBack",
  "rcFront",      "rcBack",
  // legacy aliases
  "aadhaar", "license", "rc", "insurance",
] as const;

// ─── GET /api/kyc/drivers ─────────────────────────────────────────────────────
//
// READ PATH: PostgreSQL (authoritative). Replaces the previous Firestore-only
// read, which missed any driver whose documents were submitted via the
// PG-primary POST /api/drivers/documents route (no Firestore mirror existed).
//
// Response shape is identical to the previous Firestore version so the admin
// panel requires no changes.

router.get("/kyc/drivers", requireAdminJwt, async (req, res) => {
  const statusFilter = req.query["status"];

  try {
    const whereClause =
      typeof statusFilter === "string" && statusFilter.length > 0
        ? and(
            eq(driversTable.documentsSubmitted, true),
            eq(driversTable.verificationStatus, statusFilter),
          )
        : eq(driversTable.documentsSubmitted, true);

    const driverRows = await db
      .select()
      .from(driversTable)
      .where(whereClause)
      .orderBy(desc(driversTable.documentsSubmittedAt));

    const uids = driverRows.map((d) => d.uid);
    const docRows =
      uids.length > 0
        ? await db
            .select()
            .from(driverDocumentsTable)
            .where(inArray(driverDocumentsTable.driverUid, uids))
        : [];

    const docsByUid: Record<string, Record<string, unknown>> = {};
    for (const doc of docRows) {
      if (!docsByUid[doc.driverUid]) docsByUid[doc.driverUid] = {};
      docsByUid[doc.driverUid]![doc.docType] = {
        url:                doc.url               ?? null,
        status:             doc.status            ?? null,
        uploadedAt:         doc.uploadedAt        ? doc.uploadedAt.toISOString() : null,
        rejectionReason:    doc.rejectionReason   ?? null,
        documentNumber:     doc.documentNumber    ?? null,
        documentNumberType: doc.documentNumberType ?? null,
      };
    }

    const drivers = driverRows.map((d) => ({
      uid:                  d.uid,
      name:                 d.name              ?? null,
      phone:                d.phone             ?? null,
      city:                 d.city              ?? null,
      vehicleId:            d.vehicleId         ?? null,
      vehicleName:          d.vehicleName       ?? null,
      vehicleNumber:        d.vehicleNumber     ?? null,
      licenseNumber:        d.licenseNumber     ?? null,
      verificationStatus:   d.verificationStatus ?? "pending",
      accountStatus:        d.accountStatus     ?? null,
      documentsSubmittedAt: d.documentsSubmittedAt
        ? d.documentsSubmittedAt.toISOString()
        : null,
      documents:            docsByUid[d.uid]    ?? {},
    }));

    req.log.info({ count: drivers.length, statusFilter }, "kyc-admin: listed drivers");
    res.json({ ok: true, drivers });
  } catch (err) {
    req.log.error({ err }, "kyc-admin: GET /kyc/drivers failed");
    res.status(500).json({ ok: false, error: "Failed to fetch drivers." });
  }
});

// ─── POST /api/kyc/:uid/approve ───────────────────────────────────────────────
//
// ── Authority: PostgreSQL ──────────────────────────────────────────────────────
//
// PG writes (AWAITED before response):
//   1. UPSERT drivers: verification_status = "approved"
//      Uses INSERT … ON CONFLICT DO UPDATE so pre-migration drivers (no PG row)
//      also get their approval written.
//   2. UPDATE driver_documents SET status = "approved"
//      WHERE driver_uid = uid AND url IS NOT NULL
//
// Firestore write (fire-and-forget after response):
//   drivers/{uid}: verificationStatus = "approved", documents.*.status = "approved"
//   Admin panel reads Firestore; mobile app reads PG GET /me.

router.post("/kyc/:uid/approve", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  // ── PostgreSQL writes (AUTHORITATIVE — no Firestore read required) ─────────
  //
  // Firestore dependency was removed from this path. V2 drivers may not have
  // a Firestore doc at all; requiring it blocked PG approval for those drivers.
  // Phone is read from PG (fast, local). If no PG row yet, uid-derived placeholder.
  try {
    // Read existing phone from PG (fast local query, avoids Firestore round-trip).
    const existingRows = await db
      .select({ phone: driversTable.phone })
      .from(driversTable)
      .where(eq(driversTable.uid, uid))
      .limit(1);

    const phone = existingRows[0]?.phone ?? (uid.startsWith("91") ? uid.slice(2) : uid);

    // 1. UPSERT drivers row — handles both pre-migration (no PG row) and V2 drivers.
    await db
      .insert(driversTable)
      .values({ uid, phone, verificationStatus: "approved" })
      .onConflictDoUpdate({
        target: driversTable.uid,
        set: {
          verificationStatus: "approved",
          updatedAt:          sql`NOW()`,
        },
      });

    // 2. UPDATE driver_documents — only rows that have a URL (valid uploads).
    await db
      .update(driverDocumentsTable)
      .set({ status: "approved" })
      .where(
        and(
          eq(driverDocumentsTable.driverUid, uid),
          isNotNull(driverDocumentsTable.url),
        ),
      );

    req.log.info({ uid }, "kyc-admin: PG approve — drivers upserted + documents approved (authoritative)");
  } catch (pgErr) {
    req.log.error({ pgErr, uid }, "kyc-admin: PG approve failed");
    res.status(500).json({ ok: false, error: "Failed to approve KYC." });
    return;
  }

  // ── Response ──────────────────────────────────────────────────────────────
  res.json({ ok: true });

  // ── Firestore mirror (fire-and-forget — admin panel list view) ────────────
  void (async () => {
    try {
      const fsDb = await adminFirestore();
      const ref  = fsDb.collection("drivers").doc(uid);
      const snap = await ref.get();

      const updates: Record<string, string | typeof FieldValue> = {
        verificationStatus: "approved",
      };

      if (snap.exists) {
        const existing = ((snap.data() ?? {})["documents"] ?? {}) as Record<
          string,
          { url?: string | null; uri?: string | null } | undefined
        >;
        for (const docId of DOC_IDS) {
          const entry = existing[docId];
          if (entry && (entry.url ?? entry.uri)) {
            updates[`documents.${docId}.status`] = "approved";
          }
        }
        await ref.update(updates);
      } else {
        // V2 driver — no Firestore doc yet. Create minimal mirror so admin panel
        // list reflects the correct status without a full document.
        await ref.set({ verificationStatus: "approved" }, { merge: true });
      }
      req.log.info({ uid }, "kyc-admin: Firestore approve mirror updated");
    } catch (fsErr) {
      req.log.error({ fsErr, uid }, "kyc-admin: Firestore approve mirror failed — PG remains authoritative");
    }
  })();
});

// ─── POST /api/kyc/:uid/reject ────────────────────────────────────────────────
//
// ── Authority: PostgreSQL ──────────────────────────────────────────────────────
//
// PG writes (AWAITED before response):
//   1. UPDATE drivers SET
//        verification_status  = "rejected"
//        kyc_rejection_reason = reason (if provided)
//        rejected_documents   = perDocReject[] (if provided)
//        updated_at           = now
//      WHERE uid = uid
//      (0 rows if no PG row — old driver; logged as warning, not fatal)
//   2. UPDATE driver_documents SET
//        status           = "rejected"
//        rejection_reason = reason (if provided)
//        rejected_at      = now
//      WHERE driver_uid = uid AND doc_type IN (rejectedDocTypes)
//      Only the rejected docs are updated; approved/pending docs are untouched.
//
// Firestore write (fire-and-forget after response):
//   drivers/{uid}: verificationStatus, kycRejectionReason, rejectedDocuments,
//                  documents.*.status/rejectedAt/rejectionReason

router.post("/kyc/:uid/reject", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;
  const { reason, rejectedDocIds } = (req.body ?? {}) as {
    reason?: unknown;
    rejectedDocIds?: unknown;
  };

  req.log.info({ uid, body: req.body }, "[kyc-reject] received request body");

  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

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

  req.log.info({ uid, reasonStr, perDocReject }, "[kyc-reject] validated");

  // ── Firestore read (existence check + doc list for bulk-reject + mirror) ──
  let firestoreData: Record<string, unknown> = {};
  try {
    const fsDb = await adminFirestore();
    const snap = await fsDb.collection("drivers").doc(uid).get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }
    firestoreData = snap.data() ?? {};
  } catch (fsReadErr) {
    req.log.error({ fsReadErr, uid }, "kyc-admin reject: Firestore read failed");
    res.status(500).json({ ok: false, error: "Failed to read driver record." });
    return;
  }

  // Determine which doc types to mark rejected
  const existing = (firestoreData["documents"] ?? {}) as Record<
    string,
    { url?: string | null; uri?: string | null; status?: string | null }
  >;

  const rejectedDocTypes: string[] = perDocReject
    ? perDocReject
    : (DOC_IDS as readonly string[]).filter((docId) => {
        const entry = existing[docId];
        return !!(entry && (entry.url ?? entry.uri));
      });

  // ── PostgreSQL writes (AUTHORITATIVE) ─────────────────────────────────────
  try {
    const now = new Date();

    // 1. UPDATE drivers row
    const driverPatch: Parameters<typeof db.update>[0] extends typeof driversTable
      ? never
      : Record<string, unknown> = {
        verificationStatus: "rejected",
        updatedAt:          now,
      };
    if (reasonStr)    driverPatch["kycRejectionReason"] = reasonStr;
    if (perDocReject) driverPatch["rejectedDocuments"]  = perDocReject;

    const driverResult = await db
      .update(driversTable)
      .set(driverPatch as Partial<typeof driversTable.$inferInsert>)
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (driverResult.length === 0) {
      req.log.warn({ uid }, "kyc-admin reject: no PG row — old driver, Firestore mirror still applied");
    } else {
      req.log.info({ uid, reasonStr, perDocReject }, "kyc-admin: PG drivers row updated (authoritative)");
    }

    // 2. UPDATE only the rejected document rows; leave others intact.
    if (rejectedDocTypes.length > 0) {
      const docPatch: Partial<typeof driverDocumentsTable.$inferInsert> = {
        status:    "rejected",
        rejectedAt: now,
      };
      if (reasonStr) docPatch.rejectionReason = reasonStr;

      await db
        .update(driverDocumentsTable)
        .set(docPatch)
        .where(
          and(
            eq(driverDocumentsTable.driverUid, uid),
            inArray(driverDocumentsTable.docType, rejectedDocTypes),
          ),
        );

      req.log.info({ uid, rejectedDocTypes }, "kyc-admin: PG driver_documents updated (authoritative)");
    }
  } catch (pgErr) {
    req.log.error({ pgErr, uid }, "kyc-admin: PG reject writes failed");
    res.status(500).json({ ok: false, error: "Failed to reject KYC." });
    return;
  }

  // ── Response ──────────────────────────────────────────────────────────────
  res.json({ ok: true });

  // ── Firestore mirror (fire-and-forget — admin panel) ─────────────────────
  void (async () => {
    try {
      const fsDb = await adminFirestore();
      const ref  = fsDb.collection("drivers").doc(uid);

      const updates: Record<string, unknown> = {
        verificationStatus: "rejected",
      };
      if (reasonStr)    updates["kycRejectionReason"]   = reasonStr;
      if (perDocReject) updates["rejectedDocuments"]    = perDocReject;

      if (perDocReject) {
        const rejectSet = new Set(perDocReject);
        for (const docId of DOC_IDS) {
          if (!rejectSet.has(docId)) continue;
          updates[`documents.${docId}.status`]     = "rejected";
          updates[`documents.${docId}.rejectedAt`] = FieldValue.serverTimestamp();
          if (reasonStr) updates[`documents.${docId}.rejectionReason`] = reasonStr;
        }
      } else {
        for (const docId of DOC_IDS) {
          const entry = existing[docId];
          if (!entry || !(entry.url ?? entry.uri)) continue;
          updates[`documents.${docId}.status`]     = "rejected";
          updates[`documents.${docId}.rejectedAt`] = FieldValue.serverTimestamp();
          if (reasonStr) updates[`documents.${docId}.rejectionReason`] = reasonStr;
        }
      }

      await ref.update(updates);
      req.log.info({ uid, reasonStr, perDocReject }, "kyc-admin: Firestore reject mirror updated");
    } catch (fsErr) {
      req.log.error({ fsErr, uid }, "kyc-admin: Firestore reject mirror failed — PG remains authoritative");
    }
  })();
});

// ─── POST /api/kyc/:uid/suspend ───────────────────────────────────────────────
//
// Firestore authoritative (isOnline must be set there; no PG equivalent yet).
// PG is mirrored fire-and-forget.

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

    await ref.update(update);
    req.log.info({ uid, reason }, "kyc-admin: driver suspended");
    res.json({ ok: true });

    void (async () => {
      try {
        await db
          .update(driversTable)
          .set({
            accountStatus: "suspended",
            suspendReason: reason ?? null,
            suspendedAt:   new Date(),
            updatedAt:     new Date(),
          })
          .where(eq(driversTable.uid, uid));
        req.log.info({ uid }, "kyc-admin: PG suspend mirror updated");
      } catch (pgErr) {
        req.log.error({ pgErr, uid }, "kyc-admin: PG suspend mirror failed");
      }
    })();
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: suspend failed");
    res.status(500).json({ ok: false, error: "Failed to suspend driver." });
  }
});

// ─── POST /api/kyc/:uid/blacklist ─────────────────────────────────────────────

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

    await ref.update(update);
    req.log.info({ uid, reason }, "kyc-admin: driver blacklisted");
    res.json({ ok: true });

    void (async () => {
      try {
        await db
          .update(driversTable)
          .set({
            accountStatus:  "blacklisted",
            blacklistReason: reason ?? null,
            blacklistedAt:  new Date(),
            updatedAt:      new Date(),
          })
          .where(eq(driversTable.uid, uid));
        req.log.info({ uid }, "kyc-admin: PG blacklist mirror updated");
      } catch (pgErr) {
        req.log.error({ pgErr, uid }, "kyc-admin: PG blacklist mirror failed");
      }
    })();
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: blacklist failed");
    res.status(500).json({ ok: false, error: "Failed to blacklist driver." });
  }
});

// ─── POST /api/kyc/:uid/unsuspend ─────────────────────────────────────────────

router.post("/kyc/:uid/unsuspend", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const fsDb = await adminFirestore();
    const ref  = fsDb.collection("drivers").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }

    await ref.update({
      accountStatus: "active",
      isOnline:      false,
      onlineStatus:  "offline",
    });
    req.log.info({ uid }, "kyc-admin: driver unsuspended / unblacklisted");
    res.json({ ok: true });

    void (async () => {
      try {
        await db
          .update(driversTable)
          .set({
            accountStatus: "active",
            suspendReason: null,
            updatedAt:     new Date(),
          })
          .where(eq(driversTable.uid, uid));
        req.log.info({ uid }, "kyc-admin: PG unsuspend mirror updated");
      } catch (pgErr) {
        req.log.error({ pgErr, uid }, "kyc-admin: PG unsuspend mirror failed");
      }
    })();
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: unsuspend failed");
    res.status(500).json({ ok: false, error: "Failed to unsuspend driver." });
  }
});

// ─── POST /api/kyc/:uid/waive-fee ─────────────────────────────────────────────
//
// Clears the onboarding fee barrier for a driver by setting
// onboarding_fee_applies = false. Used by admin to exempt a driver from the
// onboarding fee without requiring a payment (e.g. test accounts, manual waivers).
//
// PG write (AWAITED):
//   drivers: onboarding_fee_applies = false, updated_at = NOW()
//
// No Firestore projection — fee state is PG-only.

router.post("/kyc/:uid/waive-fee", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) { res.status(400).json({ ok: false, error: "uid is required." }); return; }

  try {
    const result = await db
      .update(driversTable)
      .set({ onboardingFeeApplies: false, updatedAt: new Date() })
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (result.length === 0) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    req.log.info({ uid }, "kyc-admin: onboarding fee waived");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "kyc-admin: waive-fee failed");
    res.status(500).json({ ok: false, error: "Failed to waive onboarding fee." });
  }
});

export default router;
