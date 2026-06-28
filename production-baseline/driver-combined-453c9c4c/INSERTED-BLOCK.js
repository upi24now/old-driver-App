// ============================================================================
// [BCD] COMBINED ADDITIVE PATCH for live VPS bundle 453c9c4c (ESM, PM2 bike-courier-api)
// Spliced verbatim immediately BEFORE the main "/api" router mount.
//
// PART A — driver-plans subsystem ported from backup eec273e6 (behavior-preserving):
//   POST /api/driver-plans/create-order
//   POST /api/driver-plans/verify-payment
//   POST /api/driver-plans/onboarding-fee/create-order
//   POST /api/driver-plans/onboarding-fee/verify-payment
//
// PART B — the 7 missing driver-facing delivery routes:
//   PATCH /api/drivers/me/fcm-token
//   GET   /api/drivers/me/offer-stream        (SSE; OrderDoc[])
//   GET   /api/drivers/:uid/active-orders
//   POST  /api/orders/:orderId/accept         (first-wins claim)
//   PATCH /api/orders/:orderId/stage
//   PATCH /api/orders/:orderId/location
//   POST  /api/orders/:orderId/complete       (OTP verify + delivered + wallet credit)
//
// Reuses ONLY pre-existing top-level bindings present at the splice point:
//   app, auth, db2 (Firestore), FieldValue, pool (pg), import_razorpay,
//   driverAuth (sets req.driverUid), logger.
// Orders/offers are Firestore-authoritative (matches the live dispatcher);
// wallet + fcm-token are PostgreSQL. NO poller, NO FCM send (dispatch is external).
// The whole block is wrapped so a registration failure can never crash boot.
// ============================================================================
;(() => {
  try {
    const crypto2 = globalThis.require("node:crypto");
    const log = (typeof logger !== "undefined" && logger) ? logger : console;
    const blog = (evt, obj) => { try { if (log && log.info) log.info(obj || {}, "[BCD] " + evt); } catch (_e) {} };

    // ---- shared helpers ------------------------------------------------------
    const ONLINE_MODES = { online: 1, prepaid: 1, upi: 1, card: 1, razorpay: 1, paid: 1, wallet: 1, netbanking: 1 };
    const isCashPayment = (pm) => {
      if (typeof pm !== "string") return true;
      const k = pm.trim().toLowerCase();
      if (!k) return true;                 // unknown/empty = cash (fail-safe; never auto-credit)
      return !ONLINE_MODES[k];
    };
    const normalizePaymentMode = (pm) => {
      const k = (typeof pm === "string" ? pm.trim().toLowerCase() : "");
      if (k === "upi") return "UPI";
      if (k === "card") return "Card";
      return isCashPayment(k) ? "Cash" : "UPI";
    };
    const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
    const tsToMs = (v) => {
      try {
        if (!v) return 0;
        if (typeof v.toDate === "function") return v.toDate().getTime();
        if (typeof v._seconds === "number") return v._seconds * 1000;
        if (v instanceof Date) return v.getTime();
        if (typeof v === "number") return v;
        if (typeof v === "string") { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
      } catch (_e) {}
      return 0;
    };
    const tsToIso = (v) => { const ms = tsToMs(v); return ms ? new Date(ms).toISOString() : new Date().toISOString(); };
    const istToday = () => {
      const IST = 5.5 * 3600 * 1000;
      const ist = new Date(Date.now() + IST);
      const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
      const p = (n) => (n < 10 ? "0" + n : "" + n);
      return { todayDate: y + "-" + p(m + 1) + "-" + p(d), startMs: Date.UTC(y, m, d, 0, 0, 0) - IST };
    };

    const TERMINAL = { delivered: 1, cancelled: 1, canceled: 1, completed: 1, rejected: 1, expired: 1, returned: 1 };
    const mapOrder = (id, d) => {
      d = d || {};
      const fare = num(d.fareEstimate != null ? d.fareEstimate : (d.price != null ? d.price : d.amount), 0);
      const total = num(d.totalAmount != null ? d.totalAmount : d.amount, fare);
      return {
        id, status: d.status || "searching", driverUid: d.driverUid || null,
        customerId: d.customerId || d.userId || "",
        customerName: d.customerName || "", customerPhone: d.customerPhone || "",
        customerRating: num(d.customerRating, 5),
        parcelType: d.parcelType || "Parcel", parcelEmoji: d.parcelEmoji || "\uD83D\uDCE6",
        parcelWeight: d.parcelWeight != null ? String(d.parcelWeight) : "",
        pickup: d.pickup || d.pickupAddress || "", pickupAddress: d.pickupAddress || d.pickup || "",
        pickupCity: d.pickupCity || "",
        drop: d.drop || d.deliveryAddress || d.dropAddress || "",
        deliveryAddress: d.deliveryAddress || d.dropAddress || d.drop || "", dropCity: d.dropCity || "",
        distanceKm: num(d.distanceKm, 0), durationMin: num(d.durationMin, 0),
        fareEstimate: fare, totalAmount: total, paymentMode: normalizePaymentMode(d.paymentMode),
        createdAt: tsToIso(d.createdAt),
      };
    };

    const sseInit = (res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      res.write(": ok\n\n");
    };

    // =========================================================================
    // PART A — driver-plans (ported verbatim from backup eec273e6, behavior-preserving)
    // =========================================================================
    const VALID_PLAN_TYPES = new Set(["daily", "weekly", "monthly"]);
    const PLAN_AMOUNT_PAISE = { daily: 300, weekly: 1900, monthly: 1e4 };
    const PLAN_AMOUNT_RUPEES = { daily: 3, weekly: 19, monthly: 100 };
    const PLAN_DAYS = { daily: 0.5, weekly: 7, monthly: 30 };
    const MS_PER_DAY = 864e5;
    const REGISTRATION_FEE_MIN_INR = 10;

    let _rzp = null, _rzpKeyId = null;
    const getRazorpay = () => {
      if (_rzp && _rzpKeyId) return { client: _rzp, keyId: _rzpKeyId };
      const keyId = process.env["RAZORPAY_KEY_ID"];
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keyId || !keySecret) {
        throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required");
      }
      _rzp = new import_razorpay.default({ key_id: keyId, key_secret: keySecret });
      _rzpKeyId = keyId;
      return { client: _rzp, keyId };
    };

    const requireAuth = async (req, res) => {
      const authHeader = req.headers["authorization"];
      if (!authHeader || authHeader.indexOf("Bearer ") !== 0) {
        res.status(401).json({ error: "Missing or invalid Authorization header" });
        return null;
      }
      try {
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        return decoded.uid;
      } catch {
        res.status(401).json({ error: "Invalid or expired token" });
        return null;
      }
    };

    app.post("/api/driver-plans/create-order", async (req, res) => {
      const tokenUid = await requireAuth(req, res);
      if (!tokenUid) return;
      const { driverUid, planType } = req.body || {};
      if (!driverUid || typeof driverUid !== "string") { res.status(400).json({ error: "driverUid is required" }); return; }
      if (tokenUid !== driverUid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      if (!planType || !VALID_PLAN_TYPES.has(planType)) {
        res.status(400).json({ error: `planType must be one of: ${[...VALID_PLAN_TYPES].join(", ")}` });
        return;
      }
      const plan = planType;
      let rzp;
      try { rzp = getRazorpay(); }
      catch (err) { req.log.error({ err }, "Razorpay not configured"); res.status(503).json({ error: "Payment service not configured" }); return; }
      const receipt = `${driverUid}-${plan}-${Date.now()}`;
      try {
        const order = await rzp.client.orders.create({ amount: PLAN_AMOUNT_PAISE[plan], currency: "INR", receipt });
        req.log.info({ driverUid, plan, orderId: order.id }, "Razorpay order created");
        res.json({ razorpayOrderId: order.id, amount: PLAN_AMOUNT_PAISE[plan], currency: "INR", keyId: rzp.keyId });
      } catch (err) {
        req.log.error({ err }, "Razorpay order creation failed");
        res.status(502).json({ error: "Failed to create payment order" });
      }
    });

    app.post("/api/driver-plans/verify-payment", async (req, res) => {
      const tokenUid = await requireAuth(req, res);
      if (!tokenUid) return;
      const { driverUid, planType, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
      if (!driverUid || typeof driverUid !== "string") { res.status(400).json({ error: "driverUid is required" }); return; }
      if (tokenUid !== driverUid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      if (!planType || !VALID_PLAN_TYPES.has(planType)) {
        res.status(400).json({ error: `planType must be one of: ${[...VALID_PLAN_TYPES].join(", ")}` });
        return;
      }
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        res.status(400).json({ error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required" });
        return;
      }
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keySecret) { req.log.error("RAZORPAY_KEY_SECRET is not set"); res.status(503).json({ error: "Payment service not configured" }); return; }
      const expectedSignature = crypto2.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
      let signaturesMatch = false;
      try {
        signaturesMatch = crypto2.timingSafeEqual(Buffer.from(expectedSignature, "hex"), Buffer.from(razorpaySignature, "hex"));
      } catch { signaturesMatch = false; }
      if (!signaturesMatch) {
        req.log.warn({ driverUid, razorpayOrderId }, "Razorpay signature verification failed");
        res.status(400).json({ error: "Payment verification failed \u2014 invalid signature" });
        return;
      }
      const plan = planType;
      const planStartAt = Date.now();
      const planExpiryAt = planStartAt + PLAN_DAYS[plan] * MS_PER_DAY;
      try {
        await db2.doc(`drivers/${driverUid}`).set({
          subscriptionPlan: plan,
          subscriptionExpiresAt: planExpiryAt,
          planType: plan,
          planStatus: "active",
          planStartAt,
          planExpiryAt,
          lastPlanAmount: PLAN_AMOUNT_RUPEES[plan],
          razorpayOrderId,
          razorpayPaymentId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        req.log.info({ driverUid, plan, planExpiryAt, razorpayPaymentId }, "Driver plan activated");
        res.json({ ok: true, planStartAt, planExpiryAt });
      } catch (err) {
        req.log.error({ err }, "Firestore plan write failed");
        res.status(500).json({ error: "Plan activation failed \u2014 please contact support" });
      }
    });

    app.post("/api/driver-plans/onboarding-fee/create-order", async (req, res) => {
      const tokenUid = await requireAuth(req, res);
      if (!tokenUid) return;
      const { driverUid } = req.body || {};
      if (!driverUid || typeof driverUid !== "string") { res.status(400).json({ error: "driverUid is required" }); return; }
      if (tokenUid !== driverUid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      let amountInr = REGISTRATION_FEE_MIN_INR;
      let currency = "INR";
      try {
        const configSnap = await db2.doc("app_config/driver_onboarding").get();
        if (configSnap.exists) {
          const c = configSnap.data();
          if (typeof c["amount"] === "number" && c["amount"] > 0) amountInr = c["amount"];
          if (typeof c["currency"] === "string") currency = c["currency"];
        }
      } catch (err) { req.log.warn({ err }, "Failed to read onboarding fee config, using floor \u20B910"); }
      amountInr = Math.max(amountInr, REGISTRATION_FEE_MIN_INR);
      try {
        const driverSnap = await db2.doc(`drivers/${driverUid}`).get();
        if (driverSnap.exists) {
          const d = driverSnap.data();
          if (d["onboardingFeeApplies"] !== true) { res.status(403).json({ error: "Onboarding fee does not apply to this account" }); return; }
          if (d["onboardingFeeStatus"] === "paid") { res.status(409).json({ error: "Onboarding fee already paid" }); return; }
        }
      } catch (err) { req.log.warn({ err }, "Could not validate driver fee eligibility \u2014 continuing"); }
      let rzp;
      try { rzp = getRazorpay(); }
      catch (err) { req.log.error({ err }, "Razorpay not configured"); res.status(503).json({ error: "Payment service not configured" }); return; }
      const amountPaise = Math.round(amountInr * 100);
      const receipt = `onboarding-${driverUid}-${Date.now()}`;
      req.log.info({ driverUid, amountInr, amountPaise }, "[FeeDebug] server amountInr = " + String(amountInr) + " | server amountPaise = " + String(amountPaise));
      try {
        const order = await rzp.client.orders.create({ amount: amountPaise, currency, receipt });
        req.log.info({ driverUid, amountInr, amountPaise, orderId: order.id, orderAmount: order.amount }, "[FeeDebug] razorpay order response amount = " + String(order.amount));
        res.json({ razorpayOrderId: order.id, amount: amountPaise, currency, keyId: rzp.keyId });
      } catch (err) {
        req.log.error({ err }, "Razorpay onboarding-fee order creation failed");
        res.status(502).json({ error: "Failed to create payment order" });
      }
    });

    app.post("/api/driver-plans/onboarding-fee/verify-payment", async (req, res) => {
      const tokenUid = await requireAuth(req, res);
      if (!tokenUid) return;
      const { driverUid, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
      if (!driverUid || typeof driverUid !== "string") { res.status(400).json({ error: "driverUid is required" }); return; }
      if (tokenUid !== driverUid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        res.status(400).json({ error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required" });
        return;
      }
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keySecret) { req.log.error("RAZORPAY_KEY_SECRET is not set"); res.status(503).json({ error: "Payment service not configured" }); return; }
      const expectedSig = crypto2.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
      let sigsMatch = false;
      try {
        sigsMatch = crypto2.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(razorpaySignature, "hex"));
      } catch { sigsMatch = false; }
      if (!sigsMatch) {
        req.log.warn({ driverUid, razorpayOrderId }, "Onboarding fee payment signature verification failed");
        res.status(400).json({ error: "Payment verification failed \u2014 invalid signature" });
        return;
      }
      try {
        const now = FieldValue.serverTimestamp();
        let registrationFeeAmount = 10;
        try {
          const driverSnap = await db2.doc(`drivers/${driverUid}`).get();
          if (driverSnap.exists) {
            const d = driverSnap.data();
            if (typeof d["onboardingFeeAmount"] === "number" && d["onboardingFeeAmount"] > 0) registrationFeeAmount = d["onboardingFeeAmount"];
          }
        } catch {}
        await db2.collection("driver_payments").add({
          uid: driverUid, type: "onboarding_fee", razorpayOrderId, razorpayPaymentId,
          status: "paid", amountInr: registrationFeeAmount, createdAt: now,
        });
        await db2.doc(`drivers/${driverUid}`).set({
          onboardingFeeStatus: "paid",
          onboardingFeePaidAt: now,
          onboardingFeePaymentId: razorpayPaymentId,
          onboardingFeeUpdatedAt: now,
          registrationFeePaid: true,
          registrationFeeAmount,
          registrationFeePaidAt: now,
          onboardingSubmittedAt: now,
          verificationStatus: "pending",
          documentsSubmitted: true,
          documentsSubmittedAt: now,
          updatedAt: now,
        }, { merge: true });
        req.log.info({ driverUid, razorpayPaymentId, registrationFeeAmount }, "Onboarding fee paid and recorded");
        res.json({ ok: true });
      } catch (err) {
        req.log.error({ err }, "Firestore write failed after onboarding fee signature verify");
        res.status(500).json({ error: "Payment was verified but database update failed \u2014 please contact support" });
      }
    });

    // =========================================================================
    // PART B — driver-facing delivery routes (Firestore-authoritative + PG wallet)
    // =========================================================================

    // PATCH /api/drivers/me/fcm-token  → {ok, saved}
    app.patch("/api/drivers/me/fcm-token", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false, saved: false }); return; }
      const token = (req.body && typeof req.body.fcmToken === "string") ? req.body.fcmToken.trim() : "";
      if (!token) { res.status(400).json({ ok: false, error: "fcmToken is required" }); return; }
      try {
        const type = token.indexOf("ExponentPushToken[") === 0 ? "expo" : "fcm";
        const r = await pool.query(
          "UPDATE drivers SET push_token=$1, push_token_type=$2, push_token_platform=$3, push_token_updated_at=now() WHERE uid=$4",
          [token, type, "unknown", uid]
        );
        res.json({ ok: true, saved: (r.rowCount || 0) > 0 });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, uid }, "[BCD] fcm-token save failed");
        res.status(500).json({ ok: false, saved: false });
      }
    });

    // GET /api/drivers/me/offer-stream  (SSE → OrderDoc[])
    app.get("/api/drivers/me/offer-stream", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
      sseInit(res);
      let eid = 0, last = null, alive = true;
      const build = async () => {
        const snap = await db2.collection("orders").where("activeOfferDriverUids", "array-contains", uid).get();
        const out = [];
        snap.forEach((doc) => {
          const d = doc.data() || {};
          if (d.driverUid) return;            // already claimed by someone
          if (TERMINAL[d.status]) return;
          out.push(mapOrder(doc.id, d));
        });
        out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        return out;
      };
      const emit = async (force) => {
        if (!alive) return;
        try {
          const j = JSON.stringify(await build());
          if (!force && j === last) return;
          last = j; eid += 1;
          res.write("id: " + eid + "\n");
          res.write("data: " + j + "\n\n");
        } catch (err) { if (req.log && req.log.warn) req.log.warn({ err, uid }, "[BCD] offer-stream build failed"); }
      };
      await emit(true);
      const pt = setInterval(() => { void emit(false); }, 3000);
      const hb = setInterval(() => { if (alive) { try { res.write(": ping\n\n"); } catch (_e) {} } }, 20000);
      const cleanup = () => { alive = false; clearInterval(pt); clearInterval(hb); };
      req.on("close", cleanup);
      res.on("close", cleanup);
    });

    // GET /api/drivers/:uid/active-orders  → {ok, orders}
    app.get("/api/drivers/:uid/active-orders", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false, orders: [] }); return; }
      if (req.params.uid !== uid) { res.status(403).json({ ok: false, error: "forbidden", orders: [] }); return; }
      let max = parseInt(req.query.max, 10);
      if (!(max >= 1)) max = 3;
      if (max > 10) max = 10;
      try {
        const snap = await db2.collection("orders").where("driverUid", "==", uid).get();
        const out = [];
        snap.forEach((doc) => {
          const d = doc.data() || {};
          if (TERMINAL[d.status]) return;
          out.push(mapOrder(doc.id, d));
        });
        out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ ok: true, orders: out.slice(0, max) });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, uid }, "[BCD] active-orders failed");
        res.status(500).json({ ok: false, error: "server_error", orders: [] });
      }
    });

    // POST /api/orders/:orderId/accept  (first-wins) → {ok} | {ok:false, reason}
    const OFFER_TTL_MS = 120000;
    app.post("/api/orders/:orderId/accept", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false, reason: "unknown" }); return; }
      const orderId = req.params.orderId;
      const b = req.body || {};
      const driverName = typeof b.driverName === "string" ? b.driverName : null;
      const driverRating = (b.driverRating != null) ? b.driverRating : null;
      const driverTrips = (b.driverTrips != null) ? b.driverTrips : null;
      try {
        const ref = db2.collection("orders").doc(orderId);
        const outcome = await db2.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { reason: "order_missing" };
          const d = snap.data() || {};
          if (d.driverUid && d.driverUid !== uid) return { reason: "already_claimed" };
          if (d.driverUid === uid) return { ok: true };          // idempotent re-accept
          const offers = Array.isArray(d.activeOfferDriverUids) ? d.activeOfferDriverUids : [];
          if (offers.indexOf(uid) < 0) return { reason: "not_in_offer" };
          const st = d.offerStartedAt && d.offerStartedAt[uid];
          if (st) { const ms = tsToMs(st); if (ms && (Date.now() - ms) > OFFER_TTL_MS) return { reason: "expired" }; }
          const upd = { driverUid: uid, status: "driver_assigned", acceptedAt: FieldValue.serverTimestamp(), activeOfferDriverUids: [] };
          if (driverName != null) upd.driverName = driverName;
          if (driverRating != null) upd.driverRating = driverRating;
          if (driverTrips != null) upd.driverTrips = driverTrips;
          tx.update(ref, upd);
          return { ok: true };
        });
        if (outcome && outcome.ok) { blog("accept_ok", { orderId, uid }); res.json({ ok: true }); return; }
        blog("accept_fail", { orderId, uid, reason: outcome && outcome.reason });
        res.json({ ok: false, reason: (outcome && outcome.reason) || "already_claimed" });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, orderId, uid }, "[BCD] accept failed");
        res.status(500).json({ ok: false, reason: "unknown" });
      }
    });

    // PATCH /api/orders/:orderId/stage  (status === stage; identity mapping)
    const STAGE_OK = { to_pickup: 1, at_pickup: 1, to_drop: 1, at_drop: 1 };
    app.patch("/api/orders/:orderId/stage", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false }); return; }
      const orderId = req.params.orderId;
      const stage = (req.body && typeof req.body.stage === "string") ? req.body.stage : "";
      if (!STAGE_OK[stage]) { res.json({ ok: true, ignored: true }); return; }
      try {
        const ref = db2.collection("orders").doc(orderId);
        const r = await db2.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { ok: false };
          const d = snap.data() || {};
          if (d.driverUid !== uid) return { ok: false };
          if (TERMINAL[d.status]) return { ok: false };
          const upd = { status: stage, updatedAt: FieldValue.serverTimestamp() };
          upd[stage + "At"] = FieldValue.serverTimestamp();
          tx.update(ref, upd);
          return { ok: true };
        });
        res.json({ ok: !!(r && r.ok) });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, orderId, uid }, "[BCD] stage failed");
        res.status(500).json({ ok: false });
      }
    });

    // PATCH /api/orders/:orderId/location  (ownership-guarded merge)
    app.patch("/api/orders/:orderId/location", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false }); return; }
      const orderId = req.params.orderId;
      const b = req.body || {};
      const lat = Number(b.latitude), lng = Number(b.longitude);
      const acc = (b.accuracy != null) ? Number(b.accuracy) : null;
      if (!isFinite(lat) || !isFinite(lng)) { res.json({ ok: true, ignored: true }); return; }
      try {
        const ref = db2.collection("orders").doc(orderId);
        const snap = await ref.get();
        if (!snap.exists || (snap.data() || {}).driverUid !== uid) { res.json({ ok: true, ignored: true }); return; }
        const upd = { driverLat: lat, driverLng: lng, locationUpdatedAt: FieldValue.serverTimestamp() };
        if (acc != null && isFinite(acc)) upd.driverAccuracy = acc;
        await ref.set(upd, { merge: true });
        res.json({ ok: true });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, orderId, uid }, "[BCD] location failed");
        res.status(500).json({ ok: false });
      }
    });

    // --- wallet settlement (PG) ---------------------------------------------
    // Cash/COD: audit-only ledger row (amount 0, balance untouched) — NEVER credits
    // the withdrawable wallet, NEVER increments completed_deliveries.
    // Online/prepaid: credit fare to balance + total_earnings + completed_deliveries.
    // Idempotent: a prior credit/cash_collected row for the order short-circuits.
    const settleWallet = async (uid, orderId, fare, cash) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ex = await client.query(
          "SELECT 1 FROM wallet_transactions WHERE order_id=$1 AND type IN ('credit','cash_collected') LIMIT 1",
          [orderId]
        );
        if ((ex.rowCount || 0) > 0) { await client.query("COMMIT"); return; }
        await client.query(
          "INSERT INTO driver_wallets (driver_uid, balance, total_earnings, total_paid, completed_deliveries, last_updated_at) " +
          "VALUES ($1,'0','0','0',0,now()) ON CONFLICT (driver_uid) DO NOTHING",
          [uid]
        );
        const w = await client.query("SELECT balance FROM driver_wallets WHERE driver_uid=$1 FOR UPDATE", [uid]);
        const before = Number((w.rows[0] && w.rows[0].balance) || 0);
        if (cash) {
          await client.query(
            "INSERT INTO wallet_transactions (driver_uid,type,amount,description,order_id,balance_before,balance_after) " +
            "VALUES ($1,'cash_collected','0',$2,$3,$4,$4)",
            [uid, "Cash collected on delivery (audit only)", orderId, String(before)]
          );
        } else {
          const after = before + fare;
          await client.query(
            "UPDATE driver_wallets SET balance=$1, total_earnings=total_earnings+$2, completed_deliveries=completed_deliveries+1, last_updated_at=now() WHERE driver_uid=$3",
            [String(after), String(fare), uid]
          );
          await client.query(
            "INSERT INTO wallet_transactions (driver_uid,type,amount,description,order_id,balance_before,balance_after) " +
            "VALUES ($1,'credit',$2,$3,$4,$5,$6)",
            [uid, String(fare), "Delivery earning", orderId, String(before), String(after)]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_e) {}
        throw e;
      } finally {
        client.release();
      }
    };

    // Daily activity stats — count BOTH cash and online deliveries (display only),
    // sourced from Firestore delivered-today; newBalance is the PG withdrawable balance.
    const dayStats = async (uid) => {
      const t = istToday();
      let balance = 0;
      try {
        const w = await pool.query("SELECT balance FROM driver_wallets WHERE driver_uid=$1 LIMIT 1", [uid]);
        balance = w.rows[0] ? Number(w.rows[0].balance || 0) : 0;
      } catch (_e) {}
      let trips = 0, earn = 0;
      try {
        const snap = await db2.collection("orders").where("driverUid", "==", uid).get();
        snap.forEach((doc) => {
          const d = doc.data() || {};
          if (d.status !== "delivered") return;
          if (tsToMs(d.deliveredAt) >= t.startMs) {
            trips += 1;
            earn += num(d.fareEstimate != null ? d.fareEstimate : (d.price != null ? d.price : d.amount), 0);
          }
        });
      } catch (_e) {}
      return { balance, todayEarnings: earn, tripsToday: trips, todayDate: t.todayDate };
    };

    // POST /api/orders/:orderId/complete  (OTP verify + delivered + wallet credit)
    app.post("/api/orders/:orderId/complete", driverAuth, async (req, res) => {
      const uid = req.driverUid;
      if (!uid) { res.status(401).json({ ok: false, error: "unauthorized" }); return; }
      const orderId = req.params.orderId;
      const otp = (req.body && typeof req.body.otpEntered === "string") ? req.body.otpEntered.trim() : "";
      if (!otp) { res.status(400).json({ ok: false, error: "otp_required" }); return; }
      try {
        const ref = db2.collection("orders").doc(orderId);
        const tr = await db2.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { error: "order_missing" };
          const d = snap.data() || {};
          if (d.driverUid !== uid) return { error: "order_missing" };
          const fare = num(d.fareEstimate != null ? d.fareEstimate : (d.price != null ? d.price : d.amount), 0);
          const cash = isCashPayment(d.paymentMode);
          if (d.status === "delivered") return { delivered: true, fare, cash };  // idempotent
          const otpStored = (d.deliveryOtp != null) ? String(d.deliveryOtp).trim() : "";
          if (!otpStored) return { error: "no_otp_set" };
          if (otpStored !== otp) return { error: "otp_mismatch" };
          tx.update(ref, { status: "delivered", deliveredAt: FieldValue.serverTimestamp() });
          return { delivered: true, fare, cash };
        });
        if (tr.error === "order_missing") { res.status(404).json({ ok: false, error: "order_missing" }); return; }
        if (tr.error === "no_otp_set") { res.status(409).json({ ok: false, error: "no_otp_set" }); return; }
        if (tr.error === "otp_mismatch") { res.status(422).json({ ok: false, error: "otp_mismatch" }); return; }
        try { await settleWallet(uid, orderId, tr.fare, tr.cash); }
        catch (eC) { blog("credit_err", { orderId, err: String(eC && eC.message || eC) }); res.status(500).json({ ok: false, error: "credit_failed", delivered: true }); return; }
        const stats = await dayStats(uid);
        blog("complete_ok", { orderId, uid, cash: tr.cash });
        res.json({ ok: true, newBalance: stats.balance, todayEarnings: stats.todayEarnings, tripsToday: stats.tripsToday, todayDate: stats.todayDate });
      } catch (err) {
        if (req.log && req.log.error) req.log.error({ err, orderId, uid }, "[BCD] complete failed");
        res.status(500).json({ ok: false, error: "server_error" });
      }
    });

    blog("routes_registered", { partA: 4, partB: 7 });
  } catch (e) {
    try { (typeof logger !== "undefined" ? logger : console).error({ err: e }, "[BCD] additive patch failed to register (server continues)"); } catch (_e) {}
  }
})();
