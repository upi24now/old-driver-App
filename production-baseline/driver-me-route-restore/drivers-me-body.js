// ─── GET /api/drivers/me (driver self-profile) ────────────────────────────────
//
// Restores the driver's own profile endpoint. The base bundle's drivers router
// has NO "/me" route, so GET /api/drivers/me fell through to
//   router.get("/:uid", adminAuth, ...)   (with :uid = "me")
// which requires an admin claim and therefore returned 403 for a normal driver
// token. This top-level route is registered BEFORE app.use("/api", routes_default)
// so it matches first and the admin-gated /:uid route is never reached.
//
// Auth: same Firebase token produced by /api/auth/verify-pin (custom token,
// uid = "91" + phone). auth.verifyIdToken(token) -> decoded.uid is the driver uid.
// Read is PostgreSQL-authoritative (drivers + driver_documents by uid). Response
// shape matches the mobile app's PgDriverProfile contract exactly.
app.get("/api/drivers/me", async (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "missing or malformed token" });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "empty token" });
    return;
  }

  let uid;
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
  } catch (e) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "invalid or expired token" });
    return;
  }

  try {
    const dRes = await pool.query("SELECT * FROM drivers WHERE uid = $1 LIMIT 1", [uid]);
    if (!dRes.rows || dRes.rows.length === 0) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }
    const d = dRes.rows[0];

    const docRes = await pool.query("SELECT * FROM driver_documents WHERE driver_uid = $1", [uid]);
    const toIso = function (v) { return v ? new Date(v).toISOString() : null; };

    const documents = {};
    for (const row of (docRes.rows || [])) {
      documents[row.doc_type] = {
        url:                row.url                  != null ? row.url : null,
        status:             row.status               != null ? row.status : null,
        uploadedAt:         toIso(row.uploaded_at),
        rejectionReason:    row.rejection_reason     != null ? row.rejection_reason : null,
        rejectedAt:         toIso(row.rejected_at),
        documentNumber:     row.document_number      != null ? row.document_number : null,
        documentNumberType: row.document_number_type != null ? row.document_number_type : null,
      };
    }

    // ── Server-authoritative onboarding routing (mirrors driver-profile.ts) ──
    const BLOCKED_STATUSES = { suspended: 1, blacklisted: 1, blocked: 1 };
    const verificationStatus = d.verification_status;
    let onboardingStep;
    let nextRoute;
    if (d.account_status && BLOCKED_STATUSES[d.account_status]) {
      onboardingStep = "account_blocked";            nextRoute = "/account-blocked";
    } else if (!d.vehicle_id) {
      onboardingStep = "vehicle_required";           nextRoute = "/vehicle-selection";
    } else if (!d.name || !d.city) {
      onboardingStep = "profile_required";           nextRoute = "/profile-setup";
    } else if (!d.documents_submitted) {
      onboardingStep = "documents_required";         nextRoute = "/document-upload";
    } else if (d.onboarding_fee_applies && d.onboarding_fee_status !== "paid") {
      onboardingStep = "fee_required";               nextRoute = "/onboarding-fee";
    } else if (verificationStatus === "rejected") {
      onboardingStep = "document_reupload_required"; nextRoute = "/document-upload";
    } else if (
      verificationStatus === "pending" ||
      verificationStatus === "unsubmitted" ||
      verificationStatus === null ||
      verificationStatus === undefined
    ) {
      onboardingStep = "verification_pending";       nextRoute = "/verification-pending";
    } else if (verificationStatus === "approved" || verificationStatus === "verified") {
      onboardingStep = "dashboard_ready";            nextRoute = "/(tabs)";
    } else {
      onboardingStep = "verification_pending";       nextRoute = "/verification-pending";
    }

    res.json({
      ok: true,
      onboardingStep,
      nextRoute,
      driver: {
        uid:                        d.uid,
        phone:                      d.phone,
        name:                       d.name                  != null ? d.name : null,
        city:                       d.city                  != null ? d.city : null,
        gender:                     d.gender                != null ? d.gender : null,
        vehicleId:                  d.vehicle_id            != null ? d.vehicle_id : null,
        vehicleName:                d.vehicle_name          != null ? d.vehicle_name : null,
        licenseNumber:              d.license_number        != null ? d.license_number : null,
        vehicleNumber:              d.vehicle_number        != null ? d.vehicle_number : null,
        accountStatus:              d.account_status        != null ? d.account_status : null,
        suspendReason:              d.suspend_reason        != null ? d.suspend_reason : null,
        blacklistReason:            d.blacklist_reason      != null ? d.blacklist_reason : null,
        documentsSubmitted:         d.documents_submitted   != null ? d.documents_submitted : false,
        documentsSubmittedAt:       toIso(d.documents_submitted_at),
        verificationStatus:         verificationStatus      != null ? verificationStatus : null,
        kycRejectionReason:         d.kyc_rejection_reason  != null ? d.kyc_rejection_reason : null,
        rejectedDocuments:          d.rejected_documents    != null ? d.rejected_documents : null,
        backgroundSetupShown:       d.background_setup_shown != null ? d.background_setup_shown : false,
        permissionSetupVersion:     d.permission_setup_version != null ? d.permission_setup_version : 0,
        permissionSetupCompletedAt: toIso(d.permission_setup_completed_at),
        onboardingFeeApplies:       d.onboarding_fee_applies != null ? d.onboarding_fee_applies : false,
        onboardingFeeStatus:        d.onboarding_fee_status != null ? d.onboarding_fee_status : null,
        onboardingFeeAmount:        d.onboarding_fee_amount != null ? d.onboarding_fee_amount : null,
        onboardingFeeCurrency:      d.onboarding_fee_currency != null ? d.onboarding_fee_currency : null,
        subscriptionPlan:           d.subscription_plan     != null ? d.subscription_plan : null,
        subscriptionExpiresAt:      d.subscription_expires_at ? new Date(d.subscription_expires_at).getTime() : null,
        todayDate:                  d.today_date            != null ? d.today_date : null,
        todayEarnings:              d.today_earnings         != null ? d.today_earnings : null,
        tripsToday:                 d.trips_today            != null ? d.trips_today : null,
        rating:                     d.rating                 != null ? d.rating : null,
        createdAt:                  toIso(d.created_at),
        updatedAt:                  toIso(d.updated_at),
        documents: documents,
      },
    });

    try { req.log.info({ uid: uid, onboardingStep: onboardingStep }, "[ME_PATCH] GET /drivers/me"); } catch (e) {}
  } catch (err) {
    try { req.log.error({ err: err, uid: uid }, "[ME_PATCH] GET /drivers/me failed"); } catch (e) {}
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to fetch driver profile." });
  }
});
