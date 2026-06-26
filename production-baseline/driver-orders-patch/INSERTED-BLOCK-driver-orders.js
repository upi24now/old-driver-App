// === BEGIN driver order-lifecycle routes (surgical additive patch — PG-ONLY, no Firestore) ===
//
// All routes below are ADDITIVE and PG-authoritative. They reuse the helpers
// already present in this bundle: __dsRequireDriver(req,res) -> verified driver
// uid|null(+401), the global `pool` (node-postgres), and `auth` (Firebase Admin).
//
// SAFETY CONTRACT (see DEPLOY.md):
//   * READ routes return a JSON "miss" ({ok:false,...}) when PG has no matching
//     data so the Driver App keeps its existing Firestore fallback. They NEVER
//     return ok:true with empty data.
//   * GET /orders/:id/stream OVERLAPS the existing Firestore SSE route: it does a
//     PG existence check and calls next() to fall through untouched when the order
//     is not in PG (so customer + driver live tracking are unaffected).
//   * WRITE routes are PG-only and return ok:false/error on a PG miss. They write
//     ONLY to PG (never Firestore). CASH/COD completions never credit the wallet.
//   * Net deploy effect is ZERO behavior change until orders exist in PG.

var __DO_ACTIVE = ["driver_assigned", "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop"];
var __DO_POOL   = ["searching", "pending", "dispatched"];
var __DO_ONLINE = ["upi", "card", "online", "prepaid"];

// ONLINE allow-list (fail-safe): anything unknown/empty/null is treated as CASH
// and therefore must NOT credit the withdrawable wallet.
function __doIsCash(pm) { return __DO_ONLINE.indexOf(String(pm == null ? "" : pm).toLowerCase()) === -1; }

function __doNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }

// Build the OrderDoc shape the Driver App expects from a PG row. The mirrored
// Firestore doc (row.raw) carries the descriptive fields; flat columns are the
// authoritative live overlay (status / driver / offer / location).
function __doOrderToDoc(row) {
  var raw = (row.raw && typeof row.raw === "object") ? row.raw : {};
  var doc = Object.assign({}, raw, {
    id: row.id,
    status: row.status != null ? row.status : raw.status,
    driverUid: row.driver_uid != null ? row.driver_uid : null,
  });
  if (row.driver_name != null) doc.driverName = row.driver_name;
  if (row.fare_estimate != null) doc.fareEstimate = __doNum(row.fare_estimate);
  if (Array.isArray(row.active_offer_driver_uids)) doc.activeOfferDriverUids = row.active_offer_driver_uids.map(String);
  var loc = (row.location && typeof row.location === "object") ? row.location : null;
  if (loc) {
    if (loc.lat != null) doc.driverLat = __doNum(loc.lat);
    if (loc.lng != null) doc.driverLng = __doNum(loc.lng);
    if (loc.accuracy != null) doc.locationAccuracy = __doNum(loc.accuracy);
  }
  return doc;
}

function __doSseHeaders(res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

// ── GET /api/drivers/:uid/active-orders ─────────────────────────────────────
// Returns ok:true + orders ONLY when PG holds ≥1 active order for this driver.
// On no-PG-data (or any error) returns ok:false so the app falls back to Firestore.
app.get("/api/drivers/:uid/active-orders", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  try {
    const max = Math.max(1, Math.min(10, parseInt(req.query.max, 10) || 3));
    const r = await pool.query(
      "SELECT * FROM orders WHERE driver_uid = $1 AND status = ANY($2::text[]) ORDER BY accepted_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT $3",
      [uid, __DO_ACTIVE, max]
    );
    if (r.rows.length === 0) {
      res.json({ ok: false, source: "pg", reason: "no_pg_orders", orders: [] });
      return;
    }
    res.json({ ok: true, source: "pg", orders: r.rows.map(__doOrderToDoc) });
  } catch (err) {
    try { req.log.error({ err }, "active-orders (additive) failed"); } catch {}
    res.status(200).json({ ok: false, source: "pg", reason: "server_error", orders: [] });
  }
});

// ── GET /api/drivers/me/offer-stream (SSE) ──────────────────────────────────
// Emits OrderDoc[] for orders currently offered to this driver (PG offer pool).
// Re-emits on connect; empty array when PG has no offers.
app.get("/api/drivers/me/offer-stream", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  __doSseHeaders(res);
  let closed = false, eid = 0;
  const send = async () => {
    if (closed) return;
    try {
      const r = await pool.query(
        "SELECT * FROM orders WHERE status = ANY($1::text[]) AND active_offer_driver_uids @> $2::jsonb ORDER BY updated_at DESC NULLS LAST LIMIT 10",
        [__DO_POOL, JSON.stringify([uid])]
      );
      const docs = r.rows.map(__doOrderToDoc);
      res.write("id: " + (++eid) + "\n");
      res.write("data: " + JSON.stringify(docs) + "\n\n");
    } catch (err) {
      try { res.write("id: " + (++eid) + "\n"); res.write("data: []\n\n"); } catch {}
    }
  };
  await send();
  const poll = setInterval(send, 4000);
  const ping = setInterval(() => { if (!closed) { try { res.write(": ping\n\n"); } catch {} } }, 20000);
  req.on("close", () => { closed = true; clearInterval(poll); clearInterval(ping); });
});

// ── GET /api/orders/:id/stream (PG SSE, else fall through to existing route) ──
// Soft-auth + PG existence check FIRST. If the order is not in PG (or no/invalid
// token, or a PG error) we call next() so the existing Firestore SSE handler
// serves the request exactly as before. No headers are written before next().
app.get("/api/orders/:id/stream", async (req, res, next) => {
  const h = req.headers["authorization"] || "";
  if (!h.startsWith("Bearer ")) return next();
  let uid;
  try { uid = (await auth.verifyIdToken(h.slice(7).trim())).uid; } catch { return next(); }
  const id = req.params.id;
  let exists;
  try { exists = await pool.query("SELECT status, driver_uid, active_offer_driver_uids FROM orders WHERE id = $1 LIMIT 1", [id]); }
  catch { return next(); }
  if (!exists.rows.length) return next();
  // Authorize: only the assigned driver, or a driver currently offered this
  // order, may stream it from PG. Anyone else (e.g. the customer app, or a
  // driver probing a foreign order id) falls through via next() to the existing
  // Firestore SSE route, which applies its own access rules. This prevents an
  // authenticated driver from reading arbitrary orders' status from PG.
  {
    const er = exists.rows[0];
    const eOffers = Array.isArray(er.active_offer_driver_uids) ? er.active_offer_driver_uids.map(String) : [];
    if (er.driver_uid !== uid && eOffers.indexOf(uid) === -1) return next();
  }
  __doSseHeaders(res);
  let closed = false, eid = 0, last = "\u0000";
  const send = async () => {
    if (closed) return;
    try {
      const r = await pool.query("SELECT status FROM orders WHERE id = $1 LIMIT 1", [id]);
      const st = r.rows.length ? r.rows[0].status : null;
      if (st !== last) {
        last = st;
        res.write("id: " + (++eid) + "\n");
        res.write("data: " + JSON.stringify({ status: st }) + "\n\n");
      }
    } catch {}
  };
  await send();
  const poll = setInterval(send, 3000);
  const ping = setInterval(() => { if (!closed) { try { res.write(": ping\n\n"); } catch {} } }, 20000);
  req.on("close", () => { closed = true; clearInterval(poll); clearInterval(ping); });
});

// ── POST /api/orders/:id/accept ─────────────────────────────────────────────
app.post("/api/orders/:id/accept", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT id, status, driver_uid, active_offer_driver_uids FROM orders WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!r.rows.length) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "order_missing" }); return; }
    const o = r.rows[0];
    if (o.driver_uid && o.driver_uid !== uid) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "already_claimed" }); return; }
    if (o.driver_uid === uid && __DO_ACTIVE.indexOf(o.status) !== -1) { await client.query("COMMIT"); res.json({ ok: true }); return; }
    const offers = Array.isArray(o.active_offer_driver_uids) ? o.active_offer_driver_uids.map(String) : [];
    if (offers.indexOf(uid) === -1) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "not_in_offer" }); return; }
    if (__DO_POOL.indexOf(o.status) === -1) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "already_claimed" }); return; }
    const dn = (typeof b.driverName === "string" && b.driverName) ? b.driverName : null;
    await client.query(
      "UPDATE orders SET status = 'driver_assigned', driver_uid = $1, driver_name = COALESCE($2, driver_name), accepted_at = NOW(), active_offer_driver_uids = '[]'::jsonb, updated_at = NOW() WHERE id = $3",
      [uid, dn, id]
    );
    await client.query("COMMIT");
    try { req.log.info({ uid, id }, "orders/accept (additive)"); } catch {}
    res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    try { req.log.error({ err }, "orders/accept (additive) failed"); } catch {}
    res.status(200).json({ ok: false, reason: "unknown" });
  } finally { client.release(); }
});

// ── POST /api/orders/:id/reject ─────────────────────────────────────────────
app.post("/api/orders/:id/reject", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT active_offer_driver_uids, rejected_driver_uids FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rows.length) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "order_missing" }); return; }
    const o = r.rows[0];
    const offers = (Array.isArray(o.active_offer_driver_uids) ? o.active_offer_driver_uids.map(String) : []).filter((x) => x !== uid);
    const rej = (Array.isArray(o.rejected_driver_uids) ? o.rejected_driver_uids.map(String) : []);
    if (rej.indexOf(uid) === -1) rej.push(uid);
    await client.query(
      "UPDATE orders SET active_offer_driver_uids = $1::jsonb, rejected_driver_uids = $2::jsonb, updated_at = NOW() WHERE id = $3",
      [JSON.stringify(offers), JSON.stringify(rej), id]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    res.status(200).json({ ok: false, reason: "unknown" });
  } finally { client.release(); }
});

// ── POST /api/orders/:id/timeout ────────────────────────────────────────────
app.post("/api/orders/:id/timeout", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT active_offer_driver_uids FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rows.length) { await client.query("ROLLBACK"); res.json({ ok: false, reason: "order_missing" }); return; }
    const offers = (Array.isArray(r.rows[0].active_offer_driver_uids) ? r.rows[0].active_offer_driver_uids.map(String) : []).filter((x) => x !== uid);
    await client.query("UPDATE orders SET active_offer_driver_uids = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(offers), id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    res.status(200).json({ ok: false });
  } finally { client.release(); }
});

// ── POST /api/orders/:id/driver-cancel ──────────────────────────────────────
app.post("/api/orders/:id/driver-cancel", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const reason = (req.body && typeof req.body.reason === "string") ? req.body.reason : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT driver_uid FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rows.length) { await client.query("ROLLBACK"); res.status(404).json({ ok: false, error: "order_missing" }); return; }
    // Ownership required: only the assigned driver may driver-cancel. An order
    // with a NULL driver_uid is unassigned and must not be mutable by a
    // non-owner (prevents a driver cancelling an order they were never given).
    if (r.rows[0].driver_uid !== uid) { await client.query("ROLLBACK"); res.status(409).json({ ok: false, error: "not_your_order" }); return; }
    await client.query(
      "UPDATE orders SET status = 'pending', driver_uid = NULL, driver_name = NULL, active_offer_driver_uids = '[]'::jsonb, cancel_reason = $1, cancelled_by = 'driver', cancelled_at = NOW(), updated_at = NOW() WHERE id = $2",
      [reason, id]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    res.status(500).json({ ok: false, error: "server_error" });
  } finally { client.release(); }
});

// ── PATCH /api/orders/:id/stage ─────────────────────────────────────────────
// Driver-driven intermediate transitions only. "delivered" is intentionally
// excluded — completion (with OTP + wallet credit) goes through /complete.
app.patch("/api/orders/:id/stage", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const stage = req.body && req.body.stage;
  if (["to_pickup", "at_pickup", "to_drop", "at_drop"].indexOf(stage) === -1) {
    res.status(400).json({ ok: false, error: "invalid_stage" });
    return;
  }
  try {
    const r = await pool.query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND driver_uid = $3 RETURNING id",
      [stage, id, uid]
    );
    res.json({ ok: r.rows.length > 0, updated: r.rows.length > 0 });
  } catch (err) {
    res.status(200).json({ ok: false });
  }
});

// ── PATCH /api/orders/:id/location ──────────────────────────────────────────
app.patch("/api/orders/:id/location", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const b = req.body || {};
  const lat = Number(b.latitude), lng = Number(b.longitude);
  if (!isFinite(lat) || !isFinite(lng)) { res.status(400).json({ ok: false, error: "invalid_coords" }); return; }
  const loc = { lat, lng };
  const acc = (b.accuracy == null) ? null : Number(b.accuracy);
  if (acc != null && isFinite(acc)) loc.accuracy = acc;
  try {
    const r = await pool.query(
      "UPDATE orders SET location = $1::jsonb, location_updated_at = NOW(), updated_at = NOW() WHERE id = $2 AND driver_uid = $3 RETURNING id",
      [JSON.stringify(loc), id, uid]
    );
    res.json({ ok: r.rows.length > 0 });
  } catch (err) {
    res.status(200).json({ ok: false });
  }
});

// ── POST /api/orders/:id/complete ───────────────────────────────────────────
// Server-verified drop OTP; idempotent; CASH/COD never credits the wallet.
app.post("/api/orders/:id/complete", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const id = req.params.id;
  const otpEntered = String((req.body && req.body.otpEntered) != null ? req.body.otpEntered : "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT o.*, ot.value AS __otp FROM orders o LEFT JOIN order_otps ot ON ot.order_id = o.id WHERE o.id = $1 FOR UPDATE OF o",
      [id]
    );
    if (!r.rows.length) { await client.query("ROLLBACK"); res.json({ ok: false, error: "order_not_found" }); return; }
    const o = r.rows[0];
    // Ownership required: only the assigned driver may complete (and idempotently
    // re-complete) an order. A NULL driver_uid means unassigned — completion by a
    // non-owner is rejected even if they somehow supply the drop OTP.
    if (o.driver_uid !== uid) { await client.query("ROLLBACK"); res.json({ ok: false, error: "not_your_order" }); return; }
    const raw = (o.raw && typeof o.raw === "object") ? o.raw : {};
    const pm = raw.paymentMode != null ? raw.paymentMode : (raw.payment_mode != null ? raw.payment_mode : "");
    const isCash = __doIsCash(pm);
    const fare = __doNum(o.fare_estimate != null ? o.fare_estimate : (o.total_amount != null ? o.total_amount : (raw.fareEstimate != null ? raw.fareEstimate : 0)));
    const already = o.status === "delivered";
    if (!already) {
      const expected = o.__otp != null ? String(o.__otp) : null;
      if (expected === null) { await client.query("ROLLBACK"); res.json({ ok: false, error: "otp_unavailable" }); return; }
      if (expected !== otpEntered) { await client.query("ROLLBACK"); res.json({ ok: false, error: "invalid_otp" }); return; }
      await client.query("UPDATE orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
      if (!isCash && fare > 0) {
        await client.query(
          "INSERT INTO driver_wallets (driver_uid, balance, total_earnings, total_paid, completed_deliveries, last_updated_at) VALUES ($1, '0', '0', '0', 0, NOW()) ON CONFLICT (driver_uid) DO NOTHING",
          [uid]
        );
        const w = await client.query("SELECT balance FROM driver_wallets WHERE driver_uid = $1 FOR UPDATE", [uid]);
        const before = __doNum(w.rows[0].balance);
        const after = before + fare;
        const dup = await client.query("SELECT 1 FROM wallet_transactions WHERE order_id = $1 AND type = 'credit' LIMIT 1", [id]);
        if (!dup.rows.length) {
          await client.query(
            "UPDATE driver_wallets SET balance = $1, total_earnings = total_earnings + $2, completed_deliveries = completed_deliveries + 1, last_updated_at = NOW() WHERE driver_uid = $3",
            [String(after), String(fare), uid]
          );
          await client.query(
            "INSERT INTO wallet_transactions (driver_uid, type, amount, description, order_id, balance_before, balance_after) VALUES ($1, 'credit', $2, $3, $4, $5, $6)",
            [uid, String(fare), "Delivery earning " + id, id, String(before), String(after)]
          );
        }
      }
    }
    await client.query("COMMIT");
    const today = new Date().toISOString().slice(0, 10);
    const de = await pool.query(
      "SELECT COALESCE(SUM(COALESCE(fare_estimate, total_amount, 0)), 0) AS earn, COUNT(*) AS trips FROM orders WHERE driver_uid = $1 AND status = 'delivered' AND (delivered_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date",
      [uid]
    );
    const wal = await pool.query("SELECT balance FROM driver_wallets WHERE driver_uid = $1", [uid]);
    try { req.log.info({ uid, id, isCash }, "orders/complete (additive)"); } catch {}
    res.json({
      ok: true,
      newBalance: __doNum(wal.rows[0] && wal.rows[0].balance),
      todayEarnings: __doNum(de.rows[0].earn),
      tripsToday: parseInt(de.rows[0].trips, 10) || 0,
      todayDate: today,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    try { req.log.error({ err }, "orders/complete (additive) failed"); } catch {}
    res.status(500).json({ ok: false, error: "server_error" });
  } finally { client.release(); }
});

// ── GET /api/drivers/me/trips ───────────────────────────────────────────────
app.get("/api/drivers/me/trips", async (req, res) => {
  const uid = await __dsRequireDriver(req, res);
  if (!uid) return;
  const lim = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
  try {
    const r = await pool.query(
      "SELECT * FROM orders WHERE driver_uid = $1 AND status = 'delivered' ORDER BY delivered_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT $2",
      [uid, lim]
    );
    const trips = r.rows.map((row) => {
      const raw = (row.raw && typeof row.raw === "object") ? row.raw : {};
      return {
        orderId: row.id,
        customerName: raw.customerName != null ? raw.customerName : "",
        pickupAddress: raw.pickup != null ? raw.pickup : (raw.pickupAddress != null ? raw.pickupAddress : ""),
        dropAddress: raw.drop != null ? raw.drop : (raw.dropAddress != null ? raw.dropAddress : (raw.deliveryAddress != null ? raw.deliveryAddress : "")),
        fareEstimate: __doNum(row.fare_estimate != null ? row.fare_estimate : (row.total_amount != null ? row.total_amount : (raw.fareEstimate != null ? raw.fareEstimate : 0))),
        distanceKm: row.distance_km != null ? __doNum(row.distance_km) : (raw.distanceKm != null ? __doNum(raw.distanceKm) : undefined),
        paymentMode: String(raw.paymentMode != null ? raw.paymentMode : ""),
        status: row.status,
        deliveredAt: row.delivered_at ? new Date(row.delivered_at).getTime() : null,
      };
    });
    res.json({ ok: true, trips });
  } catch (err) {
    res.json({ ok: false, trips: [] });
  }
});
// === END driver order-lifecycle routes ===
