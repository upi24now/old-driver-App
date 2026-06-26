// === BEGIN driver session routes (surgical additive patch: GET /api/drivers/me, PATCH /api/drivers/me/fcm-token) ===
async function __dsRequireDriver(req, res) {
  const h = req.headers["authorization"] ?? "";
  if (!h.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "missing_token", message: "Missing or invalid Authorization header" });
    return null;
  }
  try {
    const decoded = await auth.verifyIdToken(h.slice(7).trim());
    return decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: "invalid_token", message: "Invalid or expired token" });
    return null;
  }
}
var __DS_BLOCKED = ["suspended", "blacklisted", "blocked"];
function __dsCompute(d) {
  if (d.account_status && __DS_BLOCKED.indexOf(d.account_status) !== -1) return { onboardingStep: "account_blocked", nextRoute: "/account-blocked" };
  if (!d.vehicle_id) return { onboardingStep: "vehicle_required", nextRoute: "/vehicle-selection" };
  if (!d.name || !d.city) return { onboardingStep: "profile_required", nextRoute: "/profile-setup" };
  if (!d.documents_submitted) return { onboardingStep: "documents_required", nextRoute: "/document-upload" };
  if (d.verification_status === "rejected") return { onboardingStep: "document_reupload_required", nextRoute: "/document-upload" };
  if (d.verification_status === "pending" || d.verification_status === "unsubmitted" || d.verification_status == null) return { onboardingStep: "verification_pending", nextRoute: "/verification-pending" };
  if (d.verification_status === "approved" || d.verification_status === "verified") return { onboardingStep: "dashboard_ready", nextRoute: "/(tabs)" };
  return { onboardingStep: "verification_pending", nextRoute: "/verification-pending" };
}
function __dsIso(v) { return v ? new Date(v).toISOString() : null; }
async function __dsFindDriver(uid) {
  let r = await pool.query("SELECT * FROM drivers WHERE uid = $1 LIMIT 1", [uid]);
  if (r.rows.length > 0) return r.rows[0];
  const digits = String(uid).replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  r = await pool.query(
    "SELECT * FROM drivers WHERE phone = $1 OR phone = $2 OR phone = $3 OR mobile_number = $1 OR mobile_number = $2 OR mobile_number = $3 LIMIT 1",
    [ten, uid, "+" + digits]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}
app.get("/api/drivers/me", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  try {
    const d = await __dsFindDriver(uid);
    if (!d) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }
    let documents = {};
    try {
      const dr = await pool.query("SELECT doc_type, url, status, uploaded_at, rejection_reason, rejected_at FROM driver_documents WHERE driver_uid = $1", [d.uid]);
      for (const row of dr.rows) {
        documents[row.doc_type] = {
          url: row.url ?? null,
          status: row.status ?? null,
          uploadedAt: __dsIso(row.uploaded_at),
          rejectionReason: row.rejection_reason ?? null,
          rejectedAt: __dsIso(row.rejected_at),
        };
      }
    } catch (docErr) { try { req.log.warn({ docErr }, "drivers/me additive: documents fetch failed (non-fatal)"); } catch {} }
    const step = __dsCompute(d);
    res.json({
      ok: true,
      onboardingStep: step.onboardingStep,
      nextRoute: step.nextRoute,
      driver: {
        uid: d.uid,
        phone: d.phone ?? d.mobile_number ?? null,
        name: d.name ?? d.driver_name ?? null,
        city: d.city ?? null,
        gender: d.gender ?? null,
        vehicleId: d.vehicle_id ?? null,
        vehicleName: d.vehicle_name ?? null,
        licenseNumber: d.license_number ?? d.licence_number ?? null,
        vehicleNumber: d.vehicle_number ?? null,
        accountStatus: d.account_status ?? null,
        suspendReason: d.suspend_reason ?? null,
        blacklistReason: d.block_reason ?? null,
        documentsSubmitted: d.documents_submitted ?? false,
        documentsSubmittedAt: __dsIso(d.documents_submitted_at),
        verificationStatus: d.verification_status ?? null,
        kycRejectionReason: d.rejection_reason ?? d.driver_visible_reason ?? null,
        rejectedDocuments: d.rejected_documents ?? null,
        backgroundSetupShown: false,
        permissionSetupVersion: 0,
        permissionSetupCompletedAt: null,
        onboardingFeeApplies: false,
        onboardingFeeStatus: d.registration_fee_paid ? "paid" : null,
        onboardingFeeAmount: d.registration_fee_amount != null ? Number(d.registration_fee_amount) : null,
        onboardingFeeCurrency: "INR",
        subscriptionPlan: null,
        subscriptionExpiresAt: null,
        todayDate: null,
        todayEarnings: null,
        tripsToday: null,
        rating: null,
        createdAt: __dsIso(d.created_at) ?? new Date(0).toISOString(),
        updatedAt: __dsIso(d.updated_at) ?? new Date(0).toISOString(),
        documents,
      },
    });
    try { req.log.info({ uid, onboardingStep: step.onboardingStep }, "drivers/me (additive)"); } catch {}
  } catch (err) {
    try { req.log.error({ err }, "drivers/me (additive) failed"); } catch {}
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to fetch driver profile." });
  }
});
app.patch("/api/drivers/me/fcm-token", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const fcmToken = req.body && req.body.fcmToken;
  if (typeof fcmToken !== "string" || !fcmToken.trim()) {
    res.status(400).json({ ok: false, error: "missing_token", message: "fcmToken is required." });
    return;
  }
  const tok = fcmToken.trim();
  try {
    let upd = await pool.query(
      "UPDATE drivers SET push_token = $1, push_token_type = COALESCE(push_token_type, 'fcm'), push_token_updated_at = NOW(), updated_at = NOW() WHERE uid = $2 RETURNING uid",
      [tok, uid]
    );
    if (upd.rows.length === 0) {
      const d = await __dsFindDriver(uid);
      if (d) {
        upd = await pool.query(
          "UPDATE drivers SET push_token = $1, push_token_type = COALESCE(push_token_type, 'fcm'), push_token_updated_at = NOW(), updated_at = NOW() WHERE uid = $2 RETURNING uid",
          [tok, d.uid]
        );
      }
    }
    if (upd.rows.length === 0) {
      try { req.log.warn({ uid }, "drivers/me/fcm-token (additive): no drivers row"); } catch {}
      res.json({ ok: true, saved: false });
      return;
    }
    try { req.log.info({ uid }, "drivers/me/fcm-token (additive) saved"); } catch {}
    res.json({ ok: true, saved: true });
  } catch (err) {
    try { req.log.error({ err }, "drivers/me/fcm-token (additive) failed"); } catch {}
    res.status(500).json({ ok: false, error: "server_error" });
  }
});
// === END driver session routes ===
