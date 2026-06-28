// === BEGIN [BCD-PG-STATUS] driver-plans status/current read-only routes (additive) ===
// PURPOSE: the deployed bundle has the PG-authoritative create-order/verify-payment guard
// but NO read route, so the mobile app's GET /api/driver-plans/status returns 404. The app
// turns 404 into null and KEEPS its last cached plan forever (never clears on expiry).
//
// This block adds ONLY two read-only routes, both reading PostgreSQL `driver_plans` ONLY:
//   GET /api/driver-plans/status   (and identical alias GET /api/driver-plans/current)
// Active ONLY when a live PG row exists (status='active' AND expires_at > NOW()). Otherwise
// { active:false, plan:null } so the app clears its cache. Firestore is NOT consulted.
//
// Reuses ONLY in-scope top-level bindings already present at this splice point:
//   app (L203779), auth (Firebase Admin, L199857), pool (pg Pool, L199755).
// Prefers the canonical driver gate __dsRequireDriver when present (keeps single-device
// session enforcement); `typeof` on an undeclared identifier is safe (returns "undefined").
// Touches NOTHING else: not create-order, verify-payment, onboarding-fee, Razorpay, delivery
// routes, OTP, MPIN, login, sessions, wallet, customer booking, or UI.
;(() => {
  try {
    const __psRequireDriver = async (req, res) => {
      // Prefer the canonical gate (session-aware) when available.
      if (typeof __dsRequireDriver === "function") {
        try { return await __dsRequireDriver(req, res); } catch (_e) { /* fall through to bearer verify */ }
      }
      try {
        const raw = req.headers["authorization"] || req.headers["Authorization"] || "";
        const hdr = Array.isArray(raw) ? raw[0] : raw;
        const m = /^Bearer\s+(.+)$/i.exec(hdr || "");
        if (!m) { res.status(401).json({ error: "unauthorized", message: "Missing bearer token." }); return null; }
        const decoded = await auth.verifyIdToken(m[1]);
        const uid = decoded && decoded.uid;
        if (!uid) { res.status(401).json({ error: "unauthorized", message: "Invalid token." }); return null; }
        return uid;
      } catch (_e) {
        res.status(401).json({ error: "unauthorized", message: "Invalid token." });
        return null;
      }
    };

    const __psHandler = async (req, res) => {
      const uid = await __psRequireDriver(req, res);
      if (!uid) return;
      try {
        const q = await pool.query(
          "SELECT plan_id, status, expires_at FROM driver_plans " +
          "WHERE driver_uid = $1 AND status = 'active' AND expires_at > now() " +
          "ORDER BY expires_at DESC LIMIT 1",
          [uid]
        );
        const row = q.rows && q.rows[0];
        if (!row) { res.json({ active: false, plan: null }); return; }
        const expiresIso = row.expires_at ? new Date(row.expires_at).toISOString() : null;
        res.json({
          active: true,
          plan: { id: row.plan_id, planId: row.plan_id, status: "active", expiresAt: expiresIso },
        });
      } catch (err) {
        try { req.log.error({ err, uid }, "[BCD-PG-STATUS] driver-plans/status failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to read plan status." });
      }
    };

    app.get("/api/driver-plans/status", __psHandler);
    app.get("/api/driver-plans/current", __psHandler);

    try { (typeof logger !== "undefined" ? logger : console).info({}, "[BCD-PG-STATUS] driver-plans status/current read-only routes registered (PG-only)"); } catch (_e) {}
  } catch (e) {
    try { (typeof logger !== "undefined" ? logger : console).error({ err: e }, "[BCD-PG-STATUS] failed to register (server continues)"); } catch (_e) {}
  }
})();
// === END [BCD-PG-STATUS] driver-plans status/current read-only routes ===
