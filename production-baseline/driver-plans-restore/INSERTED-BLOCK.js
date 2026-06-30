// ==== [BCD-PLANS-RESTORE] BEGIN driver-plans route restore (additive, PG-only) ====
// PURPOSE: the live VPS bundle (api-pkg/dist/production-api.js, PM2 bike-courier-api)
// was rebuilt WITHOUT the driver-plans router, so the Driver App's "Activate Plan"
// flow gets 404 "Not found". This block RE-REGISTERS only the driver-plans routes the
// app calls, spliced immediately AFTER the pino-http middleware so Express first-match-wins
// serves these handlers (and so they win even if a stale later block ever reappears).
//
// RESTORES EXACTLY 4 ROUTES (nothing else):
//   POST /api/driver-plans/create-order     (PG-authoritative one-active guard + Razorpay order)
//   POST /api/driver-plans/verify-payment   (HMAC verify + one-active activation tx, self-heal)
//   GET  /api/driver-plans/status           (read live PG driver_plans row)
//   GET  /api/driver-plans/current          (identical alias of /status)
//
// STORAGE: PostgreSQL `driver_plans` ONLY. The plan order and the active plan are the SAME
//   driver_plans row keyed by razorpay_order_id (status 'created' -> 'active'). There is NO
//   Firestore write of any kind in this build — the live bundle has no Firestore (db2 /
//   FieldValue) binding, so the previous best-effort mirror has been REMOVED. PG is the
//   single source of truth; the app already reads plan state from GET /status.
//
// BINDINGS — this block NEVER hard-references a Firestore binding. It reuses only:
//   app   (Express)        — the splice point's `app`.
//   pool  (pg Pool)        — required.
//   auth/verifyIdToken     — resolved defensively from whatever the bundle exposes
//                            (canonical __dsRequireDriver gate -> auth.verifyIdToken ->
//                             firebase-admin getAuth()/auth() -> require("firebase-admin")).
//   Razorpay constructor   — resolved defensively (import_razorpay.default ->
//                             require("razorpay")); node:crypto via require for HMAC.
//   Every external identifier is `typeof`-guarded so an undeclared binding never throws at
//   boot; each route registers inside a try/catch IIFE so a failure can never crash startup.
// TOUCHES NOTHING ELSE: not dispatch, orders, FCM, wallet, KYC/onboarding-fee, OTP, MPIN,
//   login, sessions, customer app, or any existing route path.
// === BEGIN [BCD-PG] driver-plans PostgreSQL-authoritative one-active guard (additive override) ===
// Re-registers POST /api/driver-plans/create-order and POST /api/driver-plans/verify-payment.
// `driver_plans` is the source of truth:
//   create-order : PG guard (status='active' AND expires_at>NOW()) -> 409, NO Razorpay, NO row.
//   verify-payment: HMAC verify -> ONE tx that cancels every OTHER active row then activates ONLY
//                   the paid row with strict expiry (daily +12h, weekly +7d, monthly +30d).
// No Firestore mirror is performed (this build has no Firestore binding); PG commit is final.
// Touches NOTHING else: not /status, /current, onboarding-fee, OTP, MPIN, login, sessions, wallet,
// orders, delivery routes, customer booking, Razorpay keys, or UI.
;(() => {
  try {
    const __pgCrypto = globalThis.require("node:crypto");
    const DAY_MS = 24 * 60 * 60 * 1000;
    // amountPaise = charged via Razorpay AND stored in driver_plans.amount.
    // ms = strict plan lifetime: daily is 12h (an INTEGER duration_days column cannot hold 0.5d,
    // so expiry is computed in JS, NOT via duration_days * INTERVAL '1 day').
    const __PG_PLANS = {
      daily:   { amountPaise: 300,   amountInr: 3,   durationDays: 1,  label: "Daily",   ms: 12 * 60 * 60 * 1000 },
      weekly:  { amountPaise: 1900,  amountInr: 19,  durationDays: 7,  label: "Weekly",  ms: 7 * DAY_MS },
      monthly: { amountPaise: 10000, amountInr: 100, durationDays: 30, label: "Monthly", ms: 30 * DAY_MS },
    };
    // Reverse map for server-authoritative self-heal (Razorpay-charged amount in paise -> plan).
    const __PG_AMOUNT_TO_PLAN = { "300": "daily", "1900": "weekly", "10000": "monthly" };
    // Single per-driver advisory-lock namespace shared by create-order AND verify-payment so the
    // whole money path for one driver is mutually exclusive.
    const __pgLockKey = (uid) => "dpa:" + uid;

    // Defensive Firebase Admin token verifier. Every candidate is typeof-guarded so an
    // undeclared identifier returns "undefined" instead of throwing; falls back to requiring
    // firebase-admin directly. This makes the block independent of the exact bundle binding name.
    async function __pgVerifyIdToken(idToken) {
      if (typeof auth !== "undefined" && auth && typeof auth.verifyIdToken === "function") {
        return await auth.verifyIdToken(idToken);
      }
      if (typeof getAuth === "function") {
        return await getAuth().verifyIdToken(idToken);
      }
      if (typeof import_auth !== "undefined" && import_auth && typeof import_auth.getAuth === "function") {
        const a = (typeof _app !== "undefined" && _app) ? import_auth.getAuth(_app) : import_auth.getAuth();
        return await a.verifyIdToken(idToken);
      }
      if (typeof admin !== "undefined" && admin && typeof admin.auth === "function") {
        return await admin.auth().verifyIdToken(idToken);
      }
      if (typeof import_app !== "undefined" && import_app && import_app.default && typeof import_app.default.auth === "function") {
        return await import_app.default.auth().verifyIdToken(idToken);
      }
      try {
        const fa = globalThis.require("firebase-admin");
        if (fa && typeof fa.auth === "function") return await fa.auth().verifyIdToken(idToken);
      } catch (_e) {}
      try {
        const faAuth = globalThis.require("firebase-admin/auth");
        if (faAuth && typeof faAuth.getAuth === "function") {
          const a = (typeof _app !== "undefined" && _app) ? faAuth.getAuth(_app) : faAuth.getAuth();
          return await a.verifyIdToken(idToken);
        }
      } catch (_e) {}
      throw new Error("no_admin_auth_binding");
    }

    // Defensive Razorpay constructor resolver: prefer the bundle's import_razorpay, else require it.
    const __getRazorpayCtor = () => {
      if (typeof import_razorpay !== "undefined" && import_razorpay) {
        if (typeof import_razorpay.default === "function") return import_razorpay.default;
        if (typeof import_razorpay === "function") return import_razorpay;
      }
      try { const R = globalThis.require("razorpay"); if (R) return (R.default || R); } catch (_e) {}
      return null;
    };

    async function __pgRequireDriver(req, res) {
      try { if (typeof __dsRequireDriver === "function") return await __dsRequireDriver(req, res); } catch (_e) {}
      try {
        const raw = req.headers["authorization"] || req.headers["Authorization"] || "";
        const hdr = Array.isArray(raw) ? raw[0] : raw;
        const m = /^Bearer\s+(.+)$/i.exec(hdr || "");
        if (!m) { res.status(401).json({ error: "unauthorized", message: "Missing bearer token." }); return null; }
        const decoded = await __pgVerifyIdToken(m[1]);
        const uid = decoded && decoded.uid;
        if (!uid) { res.status(401).json({ error: "unauthorized" }); return null; }
        return uid;
      } catch (_e) {
        res.status(401).json({ error: "unauthorized", message: "Invalid token." });
        return null;
      }
    }

    const __pgResolvePlan = (body) => {
      const key = body && (body.planType || body.planId || body.plan);
      if (key && Object.prototype.hasOwnProperty.call(__PG_PLANS, key)) {
        const p = __PG_PLANS[key];
        return { id: key, amountPaise: p.amountPaise, amountInr: p.amountInr, durationDays: p.durationDays, label: p.label, ms: p.ms };
      }
      return null;
    };

    // Guard read — EXACTLY the contract the operator specified.
    const __pgGetActivePlan = async (driverUid) => {
      const r = await pool.query(
        "SELECT plan_id, status, expires_at FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1",
        [driverUid]
      );
      return r.rows[0] || null;
    };

    // ---- POST /api/driver-plans/create-order --------------------------------------------------
    app.post("/api/driver-plans/create-order", async (req, res) => {
      const uid = await __pgRequireDriver(req, res);
      if (!uid) return;
      const body = req.body || {};
      const driverUid = (typeof body.driverUid === "string" && body.driverUid) ? body.driverUid : uid;
      if (driverUid !== uid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      const plan = __pgResolvePlan(body);
      if (!plan) { res.status(400).json({ error: "planType must be one of: daily, weekly, monthly" }); return; }

      // Per-driver advisory lock serialises check+create so concurrent taps cannot mint two orders.
      const lockKey = __pgLockKey(uid);
      const lockClient = await pool.connect();
      let locked = false;
      try {
        const lk = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok", [lockKey]);
        locked = !!(lk.rows && lk.rows[0] && lk.rows[0].ok === true);
        if (!locked) { res.status(409).json({ active: true, error: "A plan order is already being created." }); return; }

        // PG-AUTHORITATIVE GUARD: an active non-expired plan -> 409, NO Razorpay order, NO row write.
        const active = await __pgGetActivePlan(uid);
        if (active) {
          res.status(409).json({
            active: true,
            error: "Driver already has an active plan.",
            plan: {
              planId: active.plan_id,
              status: "active",
              expiresAt: active.expires_at ? new Date(active.expires_at).toISOString() : null,
            },
          });
          return;
        }

        const keyId = process.env["RAZORPAY_KEY_ID"];
        const keySecret = process.env["RAZORPAY_KEY_SECRET"];
        if (!keyId || !keySecret) { res.status(503).json({ error: "Payment service not configured" }); return; }

        const RazorpayCtor = __getRazorpayCtor();
        if (!RazorpayCtor) { res.status(503).json({ error: "Payment service not configured" }); return; }

        const receipt = (driverUid + "-" + plan.id + "-" + Date.now()).slice(0, 40);
        let order = null;
        try {
          const rzp = new RazorpayCtor({ key_id: keyId, key_secret: keySecret });
          order = await rzp.orders.create({ amount: plan.amountPaise, currency: "INR", receipt, notes: { driver_uid: uid, plan_id: plan.id } });
        } catch (rzpErr) {
          try { req.log.error({ err: rzpErr }, "[BCD-PG] create-order razorpay failed"); } catch (_e) {}
          res.status(502).json({ error: "Failed to create payment order" });
          return;
        }
        if (!order || !order.id) { res.status(502).json({ error: "Failed to create payment order" }); return; }

        // Persist the SELECTED plan against this razorpay_order_id as 'created' (active=false) so
        // verify-payment can resolve the exact paid row and never default to monthly.
        try {
          await lockClient.query(
            "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', false, $6, NOW())",
            [uid, plan.id, plan.label, plan.amountPaise, plan.durationDays, order.id]
          );
        } catch (insErr) {
          // Razorpay order already exists; verify-payment self-heals the row by razorpay_order_id.
          try { req.log.error({ err: insErr }, "[BCD-PG] create-order insert failed (verify-payment will self-heal)"); } catch (_e) {}
        }
        try { req.log.info({ uid, planId: plan.id, orderId: order.id }, "[BCD-PG] create-order ok"); } catch (_e) {}
        res.json({ razorpayOrderId: order.id, orderId: order.id, amount: order.amount, currency: order.currency || "INR", keyId: keyId, planId: plan.id });
      } catch (err) {
        try { req.log.error({ err }, "[BCD-PG] create-order failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to create plan order." });
      } finally {
        if (locked) { try { await lockClient.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } catch (_e) {} }
        lockClient.release();
      }
    });

    // ---- POST /api/driver-plans/verify-payment ------------------------------------------------
    app.post("/api/driver-plans/verify-payment", async (req, res) => {
      const uid = await __pgRequireDriver(req, res);
      if (!uid) return;
      const b = req.body || {};
      const razorpayOrderId = b.razorpayOrderId || b.razorpay_order_id;
      const razorpayPaymentId = b.razorpayPaymentId || b.razorpay_payment_id;
      const razorpaySignature = b.razorpaySignature || b.razorpay_signature;
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        res.status(400).json({ error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required" });
        return;
      }
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keySecret) { res.status(503).json({ error: "Payment service not configured" }); return; }

      // HMAC verify (timing-safe; mismatched lengths throw -> false).
      const expected = __pgCrypto.createHmac("sha256", keySecret).update(razorpayOrderId + "|" + razorpayPaymentId).digest("hex");
      let sigOk = false;
      try { sigOk = __pgCrypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(razorpaySignature), "hex")); } catch (_e) { sigOk = false; }
      if (!sigOk) {
        try { req.log.warn({ uid, orderId: razorpayOrderId }, "[BCD-PG] verify-payment signature mismatch"); } catch (_e) {}
        res.status(400).json({ error: "Payment verification failed \u2014 invalid signature" });
        return;
      }

      try {
        // Resolve the row created for this order; self-heal if create-order's insert was lost.
        let ordRes = await pool.query("SELECT * FROM driver_plans WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
        let ord = ordRes.rows[0];
        if (!ord) {
          // SERVER-AUTHORITATIVE self-heal: derive the plan from the Razorpay order itself
          // (we set notes.plan_id at create time), falling back to the charged amount. NEVER
          // trust a client-supplied plan key here — that could activate the wrong (cheaper) plan.
          let planKey = null;
          try {
            const keyId = process.env["RAZORPAY_KEY_ID"];
            const RazorpayCtor = __getRazorpayCtor();
            if (RazorpayCtor) {
              const rzp = new RazorpayCtor({ key_id: keyId, key_secret: keySecret });
              const rOrder = await rzp.orders.fetch(razorpayOrderId);
              const noteUid = rOrder && rOrder.notes && rOrder.notes.driver_uid;
              if (noteUid && noteUid !== uid) { res.status(403).json({ error: "forbidden", message: "Order does not belong to this driver." }); return; }
              const notePlan = rOrder && rOrder.notes && rOrder.notes.plan_id;
              if (notePlan && Object.prototype.hasOwnProperty.call(__PG_PLANS, notePlan)) planKey = notePlan;
              else if (rOrder && rOrder.amount != null && __PG_AMOUNT_TO_PLAN[String(rOrder.amount)]) planKey = __PG_AMOUNT_TO_PLAN[String(rOrder.amount)];
            }
          } catch (fe) {
            try { req.log.error({ err: fe, orderId: razorpayOrderId }, "[BCD-PG] verify-payment self-heal razorpay fetch failed"); } catch (_e) {}
          }
          if (!planKey) { res.status(404).json({ error: "order_not_found", message: "Plan order not found for this driver." }); return; }
          const meta0 = __PG_PLANS[planKey];
          await pool.query(
            "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1,$2,$3,$4,$5,'created',false,$6,NOW()) ON CONFLICT DO NOTHING",
            [uid, planKey, meta0.label, meta0.amountPaise, meta0.durationDays, razorpayOrderId]
          );
          ordRes = await pool.query("SELECT * FROM driver_plans WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
          ord = ordRes.rows[0];
        }
        if (!ord || ord.driver_uid !== uid) { res.status(404).json({ error: "order_not_found", message: "Plan order not found for this driver." }); return; }

        // Fast idempotent path: already active and not expired -> return current state (no re-charge).
        if (ord.status === "active" && ord.expires_at && new Date(ord.expires_at).getTime() > Date.now()) {
          const expMs = new Date(ord.expires_at).getTime();
          res.json({ ok: true, active: true, planExpiryAt: expMs, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(ord.expires_at).toISOString() } });
          return;
        }

        // Strict expiry: daily +12h, weekly +7d, monthly +30d; unknown -> the row's own duration_days.
        const meta = (ord.plan_id && Object.prototype.hasOwnProperty.call(__PG_PLANS, ord.plan_id)) ? __PG_PLANS[ord.plan_id] : null;
        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + (meta ? meta.ms : (Number(ord.duration_days || 1) * DAY_MS)));

        let activatedExpiry = null;
        let alreadyActive = false;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Per-driver transaction lock (same namespace as create-order) serialises the whole
          // money path: concurrent verifies for one driver run strictly one-at-a-time, so the
          // "cancel others + activate paid row" sequence can never leave two active rows.
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [__pgLockKey(uid)]);
          // Re-read the paid row UNDER the lock; re-check idempotency to avoid a double activation.
          const cur = await client.query("SELECT status, expires_at FROM driver_plans WHERE razorpay_order_id = $1 AND driver_uid = $2 FOR UPDATE", [razorpayOrderId, uid]);
          const crow = cur.rows[0];
          if (crow && crow.status === "active" && crow.expires_at && new Date(crow.expires_at).getTime() > Date.now()) {
            alreadyActive = true;
            activatedExpiry = crow.expires_at;
            await client.query("COMMIT");
          } else {
            // One active row per driver: cancel every OTHER active row first.
            await client.query(
              "UPDATE driver_plans SET status = 'cancelled', active = false WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2",
              [uid, razorpayOrderId]
            );
            // Activate ONLY the paid row; assert exactly one row updated or roll back.
            const upd = await client.query(
              "UPDATE driver_plans SET status = 'active', active = true, razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at",
              [razorpayPaymentId, startedAt.toISOString(), expiresAt.toISOString(), razorpayOrderId, uid]
            );
            if (upd.rowCount !== 1) { throw new Error("activation_row_mismatch:" + upd.rowCount); }
            activatedExpiry = upd.rows[0].expires_at;
            await client.query("COMMIT");
          }
        } catch (txErr) {
          try { await client.query("ROLLBACK"); } catch (_e) {}
          throw txErr;
        } finally {
          client.release();
        }

        const expMs = new Date(activatedExpiry).getTime();
        // PG is the single source of truth in this build; no Firestore mirror is written.
        try { req.log.info({ uid, planId: ord.plan_id, orderId: razorpayOrderId, idempotent: alreadyActive }, "[BCD-PG] verify-payment activated"); } catch (_e) {}
        res.json({ ok: true, active: true, planStartAt: startedAt.getTime(), planExpiryAt: expMs, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(activatedExpiry).toISOString() } });
      } catch (err) {
        try { req.log.error({ err }, "[BCD-PG] verify-payment failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to verify payment." });
      }
    });

    try { (typeof logger !== "undefined" ? logger : console).info({}, "[BCD-PG] PG-authoritative driver-plans guard registered (create-order + verify-payment)"); } catch (_e) {}
  } catch (e) {
    try { (typeof logger !== "undefined" ? logger : console).error({ err: e }, "[BCD-PG] additive override failed to register (server continues)"); } catch (_e) {}
  }
})();
// === END [BCD-PG] driver-plans PostgreSQL-authoritative one-active guard ===
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
// Reuses ONLY `app` and `pool`; the token verifier is resolved defensively (same as the
// money block) so it never hard-references a Firestore or specific auth binding.
// Touches NOTHING else: not create-order, verify-payment, onboarding-fee, Razorpay, delivery
// routes, OTP, MPIN, login, sessions, wallet, customer booking, or UI.
;(() => {
  try {
    async function __psVerifyIdToken(idToken) {
      if (typeof auth !== "undefined" && auth && typeof auth.verifyIdToken === "function") {
        return await auth.verifyIdToken(idToken);
      }
      if (typeof getAuth === "function") {
        return await getAuth().verifyIdToken(idToken);
      }
      if (typeof import_auth !== "undefined" && import_auth && typeof import_auth.getAuth === "function") {
        const a = (typeof _app !== "undefined" && _app) ? import_auth.getAuth(_app) : import_auth.getAuth();
        return await a.verifyIdToken(idToken);
      }
      if (typeof admin !== "undefined" && admin && typeof admin.auth === "function") {
        return await admin.auth().verifyIdToken(idToken);
      }
      if (typeof import_app !== "undefined" && import_app && import_app.default && typeof import_app.default.auth === "function") {
        return await import_app.default.auth().verifyIdToken(idToken);
      }
      try {
        const fa = globalThis.require("firebase-admin");
        if (fa && typeof fa.auth === "function") return await fa.auth().verifyIdToken(idToken);
      } catch (_e) {}
      try {
        const faAuth = globalThis.require("firebase-admin/auth");
        if (faAuth && typeof faAuth.getAuth === "function") {
          const a = (typeof _app !== "undefined" && _app) ? faAuth.getAuth(_app) : faAuth.getAuth();
          return await a.verifyIdToken(idToken);
        }
      } catch (_e) {}
      throw new Error("no_admin_auth_binding");
    }

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
        const decoded = await __psVerifyIdToken(m[1]);
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
// ==== [BCD-PLANS-RESTORE] END driver-plans route restore ====
