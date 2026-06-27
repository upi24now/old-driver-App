// === BEGIN driver-plan one-active-plan fix (additive override: create-order + verify-payment) ===
// Re-registers POST /api/driver-plans/create-order and POST /api/driver-plans/verify-payment
// BEFORE the base bundle's routes so Express first-match-wins serves THESE handlers.
// Reuses ONLY the bundle's guaranteed top-level bindings: `pool` (pg Pool) and `auth` (Firebase Admin),
// and PREFERS the bundle's canonical driver gate `__dsRequireDriver` when present (keeps single-device
// session enforcement). Operates directly on the existing `driver_plans` table. Does NOT touch
// /status, /current, OTP, PIN, login, sessions, wallet, orders, customer Razorpay, or any UI.
var __DPA_PLANS = {
  // amountPaise = what we charge via Razorpay AND store in driver_plans.amount.
  // durationDays is persisted on the row; verify-payment computes expires_at FROM the row's duration_days.
  daily:   { amountPaise: 300,   durationDays: 1,  label: "Daily" },
  weekly:  { amountPaise: 1900,  durationDays: 7,  label: "Weekly" },
  monthly: { amountPaise: 10000, durationDays: 30, label: "Monthly" },
};
// Self-contained fallback auth ONLY used if the bundle has no canonical driver gate.
async function __dpaAuthUid(req, res) {
  try {
    const raw = req.headers["authorization"] || req.headers["Authorization"] || "";
    const hdr = Array.isArray(raw) ? raw[0] : raw;
    const m = /^Bearer\s+(.+)$/i.exec(hdr || "");
    if (!m) { res.status(401).json({ error: "unauthorized", message: "Missing bearer token." }); return null; }
    const decoded = await auth.verifyIdToken(m[1]);
    const uid = decoded && decoded.uid;
    if (!uid) { res.status(401).json({ error: "unauthorized" }); return null; }
    return uid;
  } catch (e) {
    res.status(401).json({ error: "unauthorized", message: "Invalid token." });
    return null;
  }
}
// Prefer the canonical gate (`__dsRequireDriver`) so single-device session enforcement is preserved.
// `typeof` on an undeclared identifier is safe (returns "undefined", no ReferenceError).
async function __dpaRequireDriver(req, res) {
  if (typeof __dsRequireDriver === "function") return await __dsRequireDriver(req, res);
  return await __dpaAuthUid(req, res);
}
// Rule 6 (read side): latest non-expired ACTIVE row only.
async function __dpaGetActivePlan(driverUid) {
  const r = await pool.query(
    "SELECT * FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1",
    [driverUid]
  );
  return r.rows[0] || null;
}
function __dpaResolvePlan(body) {
  const key = body && (body.planId || body.planType || body.plan);
  if (key && Object.prototype.hasOwnProperty.call(__DPA_PLANS, key)) {
    const p = __DPA_PLANS[key];
    return { id: key, amountPaise: p.amountPaise, durationDays: p.durationDays, label: p.label };
  }
  return null;
}
app.post("/api/driver-plans/create-order", async (req, res) => {
  const uid = await __dpaRequireDriver(req, res);
  if (!uid) return;
  const plan = __dpaResolvePlan(req.body);
  if (!plan) { res.status(400).json({ error: "invalid_plan", message: "Unknown plan." }); return; }
  // Per-driver advisory lock serialises the check+create so concurrent taps can't mint two orders.
  const lockKey = "dpa:create:" + uid;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lk = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok", [lockKey]);
    locked = !!(lk.rows && lk.rows[0] && lk.rows[0].ok === true);
    if (!locked) { res.status(409).json({ active: true, error: "A plan order is already being created." }); return; }
    // RULE 1 + 2: if an active non-expired plan exists, never create a Razorpay order.
    const active = await __dpaGetActivePlan(uid);
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
    const keyId = process.env["VITE_RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) { res.status(500).json({ error: "razorpay_not_configured", message: "Payment is temporarily unavailable." }); return; }
    const receipt = ("dp_" + uid + "_" + Date.now()).slice(0, 40);
    let order = null, rzpStatus = 0;
    try {
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64") },
        body: JSON.stringify({ amount: plan.amountPaise, currency: "INR", receipt, notes: { driver_uid: uid, plan_id: plan.id } }),
      });
      rzpStatus = rzpRes.status;
      order = await rzpRes.json().catch(() => null);
      if (!rzpRes.ok) order = null;
    } catch (netErr) {
      try { req.log.error({ netErr }, "driver-plans/create-order: razorpay network error"); } catch {}
    }
    if (!order || !order.id) {
      try { req.log.error({ rzpStatus }, "driver-plans/create-order: razorpay order failed"); } catch {}
      res.status(502).json({ error: "razorpay_order_failed", message: "Could not start payment. Please try again." });
      return;
    }
    // RULE 3 (store side): persist the SELECTED plan against this razorpay_order_id as 'created'.
    await lockClient.query(
      "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', $6, NOW())",
      [uid, plan.id, plan.label, plan.amountPaise, plan.durationDays, order.id]
    );
    try { req.log.info({ uid, planId: plan.id, orderId: order.id }, "driver-plans/create-order (one-active fix)"); } catch {}
    res.json({ razorpayOrderId: order.id, orderId: order.id, amount: order.amount, currency: order.currency || "INR", keyId, planId: plan.id });
  } catch (err) {
    try { req.log.error({ err }, "driver-plans/create-order (fix) failed"); } catch {}
    if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to create plan order." });
  } finally {
    if (locked) { try { await lockClient.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } catch {} }
    lockClient.release();
  }
});
app.post("/api/driver-plans/verify-payment", async (req, res) => {
  const uid = await __dpaRequireDriver(req, res);
  if (!uid) return;
  const b = req.body || {};
  const razorpayOrderId = b.razorpay_order_id || b.razorpayOrderId;
  const razorpayPaymentId = b.razorpay_payment_id || b.razorpayPaymentId;
  const razorpaySignature = b.razorpay_signature || b.razorpaySignature;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({ error: "missing_fields", message: "Missing required payment fields." });
    return;
  }
  try {
    // RULE 3: resolve the EXACT row created for this razorpay_order_id. Never default to monthly.
    const ordRes = await pool.query("SELECT * FROM driver_plans WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
    const ord = ordRes.rows[0];
    if (!ord || ord.driver_uid !== uid) {
      res.status(404).json({ error: "order_not_found", message: "Plan order not found for this driver." });
      return;
    }
    // Idempotent: already activated -> return current state.
    if (ord.status === "active" && ord.expires_at && new Date(ord.expires_at).getTime() > Date.now()) {
      res.json({ ok: true, active: true, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(ord.expires_at).toISOString() } });
      return;
    }
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keySecret) { res.status(500).json({ error: "razorpay_not_configured" }); return; }
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", keySecret).update(razorpayOrderId + "|" + razorpayPaymentId).digest("hex");
    let sigOk = false;
    try { sigOk = expected.length === razorpaySignature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature)); } catch { sigOk = false; }
    if (!sigOk) {
      try { req.log.warn({ orderId: razorpayOrderId }, "driver-plans/verify-payment: signature mismatch"); } catch {}
      res.status(400).json({ error: "signature_mismatch", message: "Payment signature mismatch." });
      return;
    }
    let activatedExpiry = null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // RULE 4 + 5: exactly one active row -> cancel every OTHER active row for this driver first.
      await client.query(
        "UPDATE driver_plans SET status = 'cancelled' WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2",
        [uid, razorpayOrderId]
      );
      // RULE 3 + 4: activate ONLY the paid row; expires_at computed FROM THAT row's stored duration_days.
      const upd = await client.query(
        "UPDATE driver_plans SET status = 'active', razorpay_payment_id = $1, started_at = NOW(), expires_at = NOW() + (duration_days * INTERVAL '1 day') WHERE razorpay_order_id = $2 AND driver_uid = $3 RETURNING expires_at",
        [razorpayPaymentId, razorpayOrderId, uid]
      );
      if (upd.rowCount !== 1) { throw new Error("activation_row_mismatch:" + upd.rowCount); }
      activatedExpiry = upd.rows[0].expires_at;
      await client.query("COMMIT");
    } catch (txErr) {
      try { await client.query("ROLLBACK"); } catch {}
      throw txErr;
    } finally {
      client.release();
    }
    try { req.log.info({ uid, planId: ord.plan_id, orderId: razorpayOrderId }, "driver-plans/verify-payment (one-active fix) activated"); } catch {}
    res.json({ ok: true, active: true, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(activatedExpiry).toISOString() } });
  } catch (err) {
    try { req.log.error({ err }, "driver-plans/verify-payment (fix) failed"); } catch {}
    if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to verify payment." });
  }
});
// === END driver-plan one-active-plan fix ===
