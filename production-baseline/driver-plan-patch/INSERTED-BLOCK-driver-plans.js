// === BEGIN driver plan activation routes (surgical additive patch: POST /api/driver-plans/create-order, POST /api/driver-plans/verify-payment) ===
var __DP_PLANS = {
  daily:   { amountPaise: 300,   durationMs: 12 * 60 * 60 * 1000 },
  weekly:  { amountPaise: 1900,  durationMs: 7 * 24 * 60 * 60 * 1000 },
  monthly: { amountPaise: 10000, durationMs: 30 * 24 * 60 * 60 * 1000 },
};
function __dpKeys() {
  return { keyId: process.env["VITE_RAZORPAY_KEY_ID"], keySecret: process.env["RAZORPAY_KEY_SECRET"] };
}
app.post("/api/driver-plans/create-order", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  try {
    const planType = req.body && req.body.planType;
    const plan = planType && Object.prototype.hasOwnProperty.call(__DP_PLANS, planType) ? __DP_PLANS[planType] : null;
    if (!plan) { res.status(400).json({ ok: false, error: "invalid_plan", message: "Unknown planType." }); return; }
    const d = await __dsFindDriver(uid);
    if (!d) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }
    const { keyId, keySecret } = __dpKeys();
    if (!keyId || !keySecret) { res.status(500).json({ ok: false, error: "razorpay_not_configured", message: "Payment is temporarily unavailable." }); return; }
    const receipt = ("dp_" + d.uid + "_" + Date.now()).slice(0, 40);
    let order = null, rzpStatus = 0;
    try {
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64"),
        },
        body: JSON.stringify({ amount: plan.amountPaise, currency: "INR", receipt, notes: { driver_uid: d.uid, plan_type: planType } }),
      });
      rzpStatus = rzpRes.status;
      order = await rzpRes.json().catch(() => null);
      if (!rzpRes.ok) order = null;
    } catch (netErr) {
      try { req.log.error({ netErr }, "driver-plans/create-order: razorpay network error"); } catch {}
    }
    if (!order || !order.id) {
      try { req.log.error({ rzpStatus }, "driver-plans/create-order: razorpay order failed"); } catch {}
      res.status(502).json({ ok: false, error: "razorpay_order_failed", message: "Could not start payment. Please try again." });
      return;
    }
    await pool.query(
      "INSERT INTO driver_plan_orders (razorpay_order_id, driver_uid, plan_type, amount_paise, currency, status, created_at) VALUES ($1, $2, $3, $4, 'INR', 'created', NOW()) ON CONFLICT (razorpay_order_id) DO NOTHING",
      [order.id, d.uid, planType, plan.amountPaise]
    );
    try { req.log.info({ uid: d.uid, planType, orderId: order.id }, "driver-plans/create-order (additive)"); } catch {}
    res.json({ razorpayOrderId: order.id, amount: order.amount, currency: order.currency ?? "INR", keyId });
  } catch (err) {
    try { req.log.error({ err }, "driver-plans/create-order (additive) failed"); } catch {}
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to create plan order." });
  }
});
app.post("/api/driver-plans/verify-payment", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  try {
    const b = req.body || {};
    const planType = b.planType;
    const razorpayOrderId = b.razorpayOrderId;
    const razorpayPaymentId = b.razorpayPaymentId;
    const razorpaySignature = b.razorpaySignature;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({ ok: false, error: "missing_fields", message: "Missing required payment fields." });
      return;
    }
    const plan = planType && Object.prototype.hasOwnProperty.call(__DP_PLANS, planType) ? __DP_PLANS[planType] : null;
    if (!plan) { res.status(400).json({ ok: false, error: "invalid_plan" }); return; }
    const d = await __dsFindDriver(uid);
    if (!d) { res.status(404).json({ ok: false, error: "driver_not_found" }); return; }
    const ordRes = await pool.query("SELECT * FROM driver_plan_orders WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
    const ord = ordRes.rows[0];
    if (!ord || ord.driver_uid !== d.uid || ord.plan_type !== planType) {
      res.status(404).json({ ok: false, error: "order_not_found", message: "Plan order not found for this driver." });
      return;
    }
    if (ord.status === "paid" && ord.plan_expires_at) {
      res.json({ ok: true, planExpiryAt: new Date(ord.plan_expires_at).getTime() });
      return;
    }
    const { keySecret } = __dpKeys();
    if (!keySecret) { res.status(500).json({ ok: false, error: "razorpay_not_configured" }); return; }
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", keySecret).update(razorpayOrderId + "|" + razorpayPaymentId).digest("hex");
    let sigOk = false;
    try { sigOk = expected.length === razorpaySignature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature)); } catch { sigOk = false; }
    if (!sigOk) {
      try { req.log.warn({ orderId: razorpayOrderId }, "driver-plans/verify-payment: signature mismatch"); } catch {}
      res.status(400).json({ ok: false, error: "signature_mismatch", message: "Payment signature mismatch." });
      return;
    }
    const expiresAt = new Date(Date.now() + plan.durationMs);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE drivers SET subscription_plan = $1, subscription_expires_at = $2, updated_at = NOW() WHERE uid = $3",
        [planType, expiresAt.toISOString(), d.uid]
      );
      await client.query(
        "UPDATE driver_plan_orders SET status = 'paid', razorpay_payment_id = $1, plan_expires_at = $2, paid_at = NOW() WHERE razorpay_order_id = $3",
        [razorpayPaymentId, expiresAt.toISOString(), razorpayOrderId]
      );
      await client.query("COMMIT");
    } catch (txErr) {
      try { await client.query("ROLLBACK"); } catch {}
      throw txErr;
    } finally {
      client.release();
    }
    try { req.log.info({ uid: d.uid, planType, orderId: razorpayOrderId }, "driver-plans/verify-payment (additive) activated"); } catch {}
    res.json({ ok: true, planExpiryAt: expiresAt.getTime() });
  } catch (err) {
    try { req.log.error({ err }, "driver-plans/verify-payment (additive) failed"); } catch {}
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to verify payment." });
  }
});
// === END driver plan activation routes ===
