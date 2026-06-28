
// ===================================================================
// __BCD_DRIVER_DELIVERY  (additive block — DO NOT remove this marker)
// Driver-facing delivery API + broadcast dispatch poller.
// Spliced IMMEDIATELY BEFORE the main /api router mount line.
// Reuses ONLY top-level bundle bindings:
//   app2, pool, driverAuth, logger,
//   pgAcceptOffer, pgVerifyDeliveryOtp, creditWallet,
//   notificationService_exports (saveFCMToken, sendNotification),
//   init_src, init_logger2, init_notificationService  (esbuild lazy-module initializers)
// Touches NOTHING related to OTP / MPIN / Driver Plan / Razorpay / login / sessions / UI.
// ===================================================================
;(function () {
  "use strict";
  var crypto = require("node:crypto");
  // esbuild bundles `pool`, `db`, `logger`, and the notificationService API inside
  // lazy `__esm` modules that are populated by their initializers. They have already
  // run by this splice point, but we re-invoke (idempotent) to be defensive.
  try { if (typeof init_src === "function") init_src(); } catch (e) {}
  try { if (typeof init_logger2 === "function") init_logger2(); } catch (e) {}
  function getNotif() {
    try {
      if (typeof init_notificationService === "function") init_notificationService();
      if (typeof notificationService_exports !== "undefined") return notificationService_exports;
    } catch (e) {}
    return null;
  }
  var __log = (typeof logger !== "undefined" && logger) ? logger : console;
  function bcdLog(evt, obj) {
    try {
      if (__log && typeof __log.info === "function") __log.info(obj || {}, "[BCD] " + evt);
      else console.log("[BCD] " + evt, obj || {});
    } catch (e) {}
  }

  // ---- payment classification (ONLINE allow-list; unknown/empty/null = cash, fail-safe) ----
  var ONLINE_PAYMENT_MODES = {
    online: 1, prepaid: 1, upi: 1, card: 1, razorpay: 1, paid: 1, wallet: 1, netbanking: 1
  };
  function isCashPayment(pm) {
    if (typeof pm !== "string") return true;
    var k = pm.trim().toLowerCase();
    if (!k) return true;
    return !ONLINE_PAYMENT_MODES[k];
  }
  function normalizePaymentMode(pm) {
    var k = (typeof pm === "string" ? pm.trim().toLowerCase() : "");
    if (k === "upi") return "UPI";
    if (k === "card") return "Card";
    if (isCashPayment(k)) return "Cash";
    return "UPI";
  }

  // ---- IST "today" window (India) ----
  function istToday() {
    var IST = 5.5 * 3600 * 1000;
    var ist = new Date(Date.now() + IST);
    var y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return {
      todayDate: y + "-" + pad(m + 1) + "-" + pad(d),
      startUtc: new Date(Date.UTC(y, m, d, 0, 0, 0) - IST)
    };
  }

  var OFFER_TTL_MS = 120000;        // 2-minute offer window
  var DISPATCH_TICK_MS = 3000;      // poller cadence
  var DISPATCH_MAX_AGE_MIN = 15;    // never re-dispatch orders older than this
  var DISPATCHABLE = ["pending", "searching", "finding_driver"];

  function sseInit(res) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write(": ok\n\n");
  }

  // ================= BROADCAST DISPATCH POLLER =================
  var dispatchRunning = false;
  async function runDispatchOnce() {
    if (dispatchRunning) return;
    dispatchRunning = true;
    try {
      var ordersRes = await pool.query(
        "SELECT id, pickup_address, delivery_address, pickup_city, drop_city, fare_estimate " +
        "FROM orders o " +
        "WHERE o.status = ANY($1::text[]) AND o.driver_uid IS NULL " +
        "AND o.created_at > now() - ($2 || ' minutes')::interval " +
        "AND NOT EXISTS (" +
        "  SELECT 1 FROM order_offers f " +
        "  WHERE f.order_id = o.id AND f.status = 'offered' AND f.expires_at > now()" +
        ") " +
        "ORDER BY o.created_at ASC LIMIT 20",
        [DISPATCHABLE, String(DISPATCH_MAX_AGE_MIN)]
      );
      if (ordersRes.rows.length === 0) return;

      var eligRes = await pool.query(
        "SELECT d.uid " +
        "FROM drivers d " +
        "JOIN driver_locations l ON l.driver_uid = d.uid " +
        "WHERE d.verification_status = 'approved' AND d.account_status = 'active' " +
        "AND l.is_online = TRUE " +
        "AND EXISTS (" +
        "  SELECT 1 FROM driver_plans p " +
        "  WHERE p.driver_uid = d.uid AND p.status = 'active' AND p.expires_at > now()" +
        ")"
      );
      var eligible = eligRes.rows;
      if (eligible.length === 0) {
        bcdLog("dispatch_no_eligible_drivers", { pendingOrders: ordersRes.rows.length });
        return;
      }

      for (var i = 0; i < ordersRes.rows.length; i++) {
        var ord = ordersRes.rows[i];
        try {
          var now = new Date();
          var expires = new Date(now.getTime() + OFFER_TTL_MS);
          for (var j = 0; j < eligible.length; j++) {
            await pool.query(
              "INSERT INTO order_offers " +
              "(id, order_id, driver_uid, status, round, fare_offered, offered_at, expires_at, created_at, updated_at) " +
              "SELECT $1, $2, $3, 'offered', 1, $4, $5, $6, $5, $5 " +
              "WHERE NOT EXISTS (" +
              "  SELECT 1 FROM order_offers f " +
              "  WHERE f.order_id = $2 AND f.driver_uid = $3 AND f.status = 'offered' AND f.expires_at > now()" +
              ")",
              [crypto.randomUUID(), ord.id, eligible[j].uid, ord.fare_estimate, now, expires]
            );
          }

          var route = (ord.pickup_city || ord.pickup_address || "Pickup") +
            " \u2192 " + (ord.drop_city || ord.delivery_address || "Drop");
          var title = "New delivery request";
          var body = route + (ord.fare_estimate != null ? " \u2022 \u20B9" + ord.fare_estimate : "");
          var data = { type: "incoming_order", orderId: ord.id, channelId: "incoming_orders_v2" };
          // FCM/Expo reuse: the bundle's exported sendNotification re-resolves the
          // driver's push token (expo vs fcm split + history) by audience. We target
          // each eligible driver individually so push aligns 1:1 with the offers above.
          var notif = getNotif();
          var pushed = 0;
          if (notif && typeof notif.sendNotification === "function") {
            for (var k = 0; k < eligible.length; k++) {
              try {
                await notif.sendNotification({
                  title: title,
                  body: body,
                  audience: "specific_driver",
                  driverUid: eligible[k].uid,
                  data: data
                });
                pushed += 1;
              } catch (ePush) {
                bcdLog("push_err", { orderId: ord.id, driverUid: eligible[k].uid, err: String(ePush) });
              }
            }
          } else {
            bcdLog("notif_unavailable", { orderId: ord.id });
          }
          bcdLog("dispatched", { orderId: ord.id, drivers: eligible.length, pushed: pushed });
        } catch (eOrder) {
          bcdLog("dispatch_order_err", { orderId: ord.id, err: String(eOrder) });
        }
      }
    } catch (e) {
      bcdLog("dispatch_err", { err: String(e) });
    } finally {
      dispatchRunning = false;
    }
  }

  // ================= ROUTES (registered BEFORE the /api mount → first-match wins) =================

  // PATCH /api/drivers/me/fcm-token  → { ok, saved }
  app2.patch("/api/drivers/me/fcm-token", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var body = req.body || {};
    var token = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
    if (!token) { res.status(400).json({ ok: false, error: "fcmToken is required" }); return; }
    try {
      var d = await pool.query("SELECT uid FROM drivers WHERE uid = $1 LIMIT 1", [uid]);
      if (d.rows.length === 0) { res.json({ ok: true, saved: false }); return; }
      var tokenType = token.indexOf("ExponentPushToken[") === 0 ? "expo" : "fcm";
      var notif = getNotif();
      if (!notif || typeof notif.saveFCMToken !== "function") {
        res.status(500).json({ ok: false, saved: false }); return;
      }
      await notif.saveFCMToken(uid, token, tokenType, "unknown");
      res.json({ ok: true, saved: true });
    } catch (e) {
      if (req.log && req.log.error) req.log.error({ err: e, uid: uid }, "[BCD] fcm-token save failed");
      res.status(500).json({ ok: false, saved: false });
    }
  });

  // GET /api/drivers/me/offer-stream  (SSE → OrderDoc[])
  app2.get("/api/drivers/me/offer-stream", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    sseInit(res);
    var eid = 0, lastJson = null, alive = true;

    async function buildOrders() {
      var q = await pool.query(
        "SELECT o.id, o.status, o.user_id, o.customer_name, o.customer_phone, o.parcel_type, o.weight_kg, " +
        "o.pickup_address, o.pickup_city, o.delivery_address, o.drop_city, o.distance_km, o.duration_min, " +
        "o.fare_estimate, o.total_amount, o.payment_mode, o.created_at, o.driver_uid " +
        "FROM order_offers f JOIN orders o ON o.id = f.order_id " +
        "WHERE f.driver_uid = $1 AND f.status = 'offered' AND f.expires_at > now() " +
        "ORDER BY f.offered_at ASC",
        [uid]
      );
      return q.rows.map(function (r) {
        var fare = r.fare_estimate != null ? Number(r.fare_estimate) : 0;
        var total = r.total_amount != null ? Number(r.total_amount) : fare;
        return {
          id: r.id,
          status: r.status || "pending",
          driverUid: r.driver_uid || null,
          customerId: r.user_id || "",
          customerName: r.customer_name || "",
          customerPhone: r.customer_phone || "",
          customerRating: 5,
          parcelType: r.parcel_type || "Parcel",
          parcelEmoji: "\uD83D\uDCE6",
          parcelWeight: r.weight_kg != null ? String(r.weight_kg) : "",
          pickup: r.pickup_address || "",
          pickupAddress: r.pickup_address || "",
          pickupCity: r.pickup_city || "",
          drop: r.delivery_address || "",
          deliveryAddress: r.delivery_address || "",
          dropCity: r.drop_city || "",
          distanceKm: r.distance_km != null ? Number(r.distance_km) : 0,
          durationMin: r.duration_min != null ? Number(r.duration_min) : 0,
          fareEstimate: fare,
          totalAmount: total,
          paymentMode: normalizePaymentMode(r.payment_mode),
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date().toISOString()
        };
      });
    }

    async function emit(force) {
      if (!alive) return;
      try {
        var json = JSON.stringify(await buildOrders());
        if (!force && json === lastJson) return;
        lastJson = json;
        eid += 1;
        res.write("id: " + eid + "\n");
        res.write("data: " + json + "\n\n");
      } catch (e) { /* keep the stream alive; next tick re-syncs */ }
    }

    await emit(true);
    var pollT = setInterval(function () { void emit(false); }, 3000);
    var hbT = setInterval(function () { if (alive) { try { res.write(": ping\n\n"); } catch (e) {} } }, 20000);
    function cleanup() { alive = false; clearInterval(pollT); clearInterval(hbT); }
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  // Project an orders row into the OrderDoc shape the app parses (mirrors offer-stream).
  function bcdMapOrderRow(r) {
    var fare = r.fare_estimate != null ? Number(r.fare_estimate) : 0;
    var total = r.total_amount != null ? Number(r.total_amount) : fare;
    return {
      id: r.id,
      status: r.status || "pending",
      driverUid: r.driver_uid || null,
      customerId: r.user_id || "",
      customerName: r.customer_name || "",
      customerPhone: r.customer_phone || "",
      customerRating: 5,
      parcelType: r.parcel_type || "Parcel",
      parcelEmoji: "\uD83D\uDCE6",
      parcelWeight: r.weight_kg != null ? String(r.weight_kg) : "",
      pickup: r.pickup_address || "",
      pickupAddress: r.pickup_address || "",
      pickupCity: r.pickup_city || "",
      drop: r.delivery_address || "",
      deliveryAddress: r.delivery_address || "",
      dropCity: r.drop_city || "",
      distanceKm: r.distance_km != null ? Number(r.distance_km) : 0,
      durationMin: r.duration_min != null ? Number(r.duration_min) : 0,
      fareEstimate: fare,
      totalAmount: total,
      paymentMode: normalizePaymentMode(r.payment_mode),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date().toISOString()
    };
  }

  // GET /api/drivers/:uid/active-orders  → { ok, orders: OrderDoc[] }
  // Self-only: :uid must equal the authenticated driver (uid is "91"+phone).
  // Returns 200 with an empty array when the driver has no active (non-terminal)
  // assigned order — this is the app's authoritative "no active order" answer.
  app2.get("/api/drivers/:uid/active-orders", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var target = req.params.uid;
    if (target !== uid) { res.status(403).json({ ok: false, error: "forbidden", orders: [] }); return; }
    var max = parseInt(req.query.max, 10);
    if (!(max >= 1)) max = 3;
    if (max > 10) max = 10;
    try {
      var q = await pool.query(
        "SELECT o.id, o.status, o.user_id, o.customer_name, o.customer_phone, o.parcel_type, o.weight_kg, " +
        "o.pickup_address, o.pickup_city, o.delivery_address, o.drop_city, o.distance_km, o.duration_min, " +
        "o.fare_estimate, o.total_amount, o.payment_mode, o.created_at, o.driver_uid " +
        "FROM orders o " +
        "WHERE o.driver_uid = $1 " +
        "AND o.status NOT IN ('delivered','cancelled','canceled','completed','expired','rejected','returned') " +
        "ORDER BY o.created_at DESC LIMIT $2",
        [uid, max]
      );
      res.json({ ok: true, orders: q.rows.map(bcdMapOrderRow) });
    } catch (e) {
      if (req.log && req.log.error) req.log.error({ err: e, uid: uid }, "[BCD] active-orders failed");
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // GET /api/orders/:orderId/stream  (SSE → { status })
  app2.get("/api/orders/:orderId/stream", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var orderId = req.params.orderId;
    sseInit(res);
    var eid = 0, lastStatus = "\u0000", alive = true;

    async function emit(force) {
      if (!alive) return;
      try {
        // Ownership-gated: a driver may only watch an order assigned to them (IDOR guard).
        var q = await pool.query("SELECT status FROM orders WHERE id = $1 AND driver_uid = $2 LIMIT 1", [orderId, uid]);
        var status = q.rows.length ? (q.rows[0].status || null) : null;
        if (!force && status === lastStatus) return;
        lastStatus = status;
        eid += 1;
        res.write("id: " + eid + "\n");
        res.write("data: " + JSON.stringify({ status: status }) + "\n\n");
      } catch (e) {}
    }

    await emit(true);
    var pollT = setInterval(function () { void emit(false); }, 3000);
    var hbT = setInterval(function () { if (alive) { try { res.write(": ping\n\n"); } catch (e) {} } }, 20000);
    function cleanup() { alive = false; clearInterval(pollT); clearInterval(hbT); }
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  // POST /api/orders/:orderId/accept  → { ok } | { ok:false, reason }
  app2.post("/api/orders/:orderId/accept", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var orderId = req.params.orderId;
    var body = req.body || {};
    var driverName = typeof body.driverName === "string" ? body.driverName : null;
    try {
      var ord = await pool.query("SELECT id FROM orders WHERE id = $1 LIMIT 1", [orderId]);
      if (ord.rows.length === 0) { res.json({ ok: false, reason: "order_missing" }); return; }

      var off = await pool.query(
        "SELECT id, status, (expires_at <= now()) AS expired " +
        "FROM order_offers WHERE order_id = $1 AND driver_uid = $2 ORDER BY offered_at DESC LIMIT 1",
        [orderId, uid]
      );
      if (off.rows.length === 0) { res.json({ ok: false, reason: "not_in_offer" }); return; }
      var offer = off.rows[0];
      if (offer.status !== "offered") { res.json({ ok: false, reason: "already_claimed" }); return; }
      if (offer.expired) { res.json({ ok: false, reason: "expired" }); return; }

      var r = await pgAcceptOffer(offer.id, uid, driverName);
      switch (r && r.outcome) {
        case "accepted": res.json({ ok: true }); return;
        case "expired": res.json({ ok: false, reason: "expired" }); return;
        case "order_taken":
        case "already_responded":
        case "not_owner": res.json({ ok: false, reason: "already_claimed" }); return;
        case "not_found": res.json({ ok: false, reason: "not_in_offer" }); return;
        default: res.json({ ok: false, reason: "already_claimed" }); return;
      }
    } catch (e) {
      if (req.log && req.log.error) req.log.error({ err: e, orderId: orderId, uid: uid }, "[BCD] accept failed");
      res.status(500).json({ ok: false, reason: "unknown" });
    }
  });

  // PATCH /api/orders/:orderId/stage  (advance delivery stage; mirrors to order status)
  var STAGE_TO_STATUS = {
    to_pickup: "accepted",
    at_pickup: "picked_up",
    to_drop: "out_for_delivery",
    at_drop: "out_for_delivery"
  };
  app2.patch("/api/orders/:orderId/stage", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var orderId = req.params.orderId;
    var body = req.body || {};
    var stage = typeof body.stage === "string" ? body.stage : "";
    var newStatus = STAGE_TO_STATUS[stage];
    if (!newStatus) { res.json({ ok: true, ignored: true }); return; }
    try {
      await pool.query(
        "UPDATE orders SET status = $1, updated_at = now() " +
        "WHERE id = $2 AND driver_uid = $3 AND status NOT IN ('delivered','cancelled')",
        [newStatus, orderId, uid]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // PATCH /api/orders/:orderId/location  (driver GPS → live tracking)
  app2.patch("/api/orders/:orderId/location", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var body = req.body || {};
    var lat = Number(body.latitude), lng = Number(body.longitude);
    var acc = body.accuracy != null ? Number(body.accuracy) : null;
    if (!isFinite(lat) || !isFinite(lng)) { res.json({ ok: true, ignored: true }); return; }
    try {
      await pool.query(
        "INSERT INTO driver_locations " +
        "(driver_uid, lat, lng, accuracy, is_online, online_status, last_seen_at, updated_at) " +
        "VALUES ($1, $2, $3, $4, TRUE, 'online', now(), now()) " +
        "ON CONFLICT (driver_uid) DO UPDATE SET " +
        "lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy = EXCLUDED.accuracy, " +
        "last_seen_at = now(), updated_at = now()",
        [uid, lat, lng, acc]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // POST /api/orders/:orderId/complete  (OTP verify → delivered → credit non-cash)
  app2.post("/api/orders/:orderId/complete", driverAuth, async function (req, res) {
    var uid = req.driverUid;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }
    var orderId = req.params.orderId;
    var body = req.body || {};
    var otp = typeof body.otpEntered === "string" ? body.otpEntered.trim() : "";
    if (!otp) { res.status(400).json({ ok: false, error: "otp_required" }); return; }
    try {
      // Pre-normalize an owned, non-terminal order into a deliverable status so the
      // OTP verify (gated on picked_up/out_for_delivery) passes regardless of
      // stage-sync timing. The OTP itself stays the authoritative gate.
      await pool.query(
        "UPDATE orders SET status = 'out_for_delivery', updated_at = now() " +
        "WHERE id = $1 AND driver_uid = $2 " +
        "AND status IN ('accepted','to_pickup','at_pickup','picked_up','to_drop','at_drop')",
        [orderId, uid]
      );

      var vr = await pgVerifyDeliveryOtp(orderId, uid, otp);
      var outcome = vr && vr.outcome;

      if (outcome === "delivered") {
        // Delivery committed by the OTP gate. Settle earnings; if settlement throws we
        // must NOT report success — the client retries and the invalid_status branch
        // below re-settles idempotently (no lost or double credit).
        var settled;
        try {
          settled = await settleDeliveredOrder(uid, orderId);
        } catch (eCredit) {
          bcdLog("credit_err", { orderId: orderId, err: String(eCredit) });
          res.status(500).json({ ok: false, error: "credit_failed", delivered: true });
          return;
        }
        var stats = await completionStats(uid);
        res.json({
          ok: true,
          newBalance: settled.newBalance != null ? settled.newBalance : stats.balance,
          todayEarnings: stats.todayEarnings,
          tripsToday: stats.tripsToday,
          todayDate: stats.todayDate
        });
        return;
      }

      if (outcome === "otp_mismatch") { res.status(422).json({ ok: false, error: "otp_mismatch" }); return; }
      if (outcome === "not_found" || outcome === "not_owner") { res.status(404).json({ ok: false, error: "order_missing" }); return; }
      if (outcome === "no_otp_set") { res.status(409).json({ ok: false, error: "no_otp_set" }); return; }
      if (outcome === "invalid_status") {
        // Re-call after delivery already happened. If delivered, re-run settlement
        // (idempotent) so a prior credit failure self-heals, then return stats.
        var cur = await pool.query("SELECT status FROM orders WHERE id = $1 AND driver_uid = $2 LIMIT 1", [orderId, uid]);
        if (cur.rows.length && cur.rows[0].status === "delivered") {
          var settled2;
          try {
            settled2 = await settleDeliveredOrder(uid, orderId);
          } catch (eCredit2) {
            bcdLog("credit_retry_err", { orderId: orderId, err: String(eCredit2) });
            res.status(500).json({ ok: false, error: "credit_failed", delivered: true });
            return;
          }
          var st = await completionStats(uid);
          res.json({
            ok: true,
            newBalance: settled2.newBalance != null ? settled2.newBalance : st.balance,
            todayEarnings: st.todayEarnings,
            tripsToday: st.tripsToday,
            todayDate: st.todayDate
          });
          return;
        }
        res.status(409).json({ ok: false, error: "invalid_status" }); return;
      }
      res.status(409).json({ ok: false, error: "not_delivered" }); return;
    } catch (e) {
      if (req.log && req.log.error) req.log.error({ err: e, orderId: orderId, uid: uid }, "[BCD] complete failed");
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // Derive two signed int4 keys from a string for pg_advisory_lock(int4,int4).
  // Cluster-wide (per database) so it serializes across PM2 workers too.
  function bcdAdvisoryKeys(s) {
    var h = crypto.createHash("md5").update(String(s)).digest();
    return [h.readInt32BE(0), h.readInt32BE(4)];
  }

  // Settle a just-delivered order. Idempotent + fail-loud on credit error.
  //  - CASH/COD: NEVER credit the withdrawable wallet (driver keeps the cash);
  //    write only a best-effort audit row (amount 0). Returns newBalance null.
  //  - ONLINE/PREPAID: credit fare exactly once (creditWallet has no order-level
  //    dedup, so we guard on an existing credit txn for this order).
  // Concurrency: the existence check + write are NOT atomic on their own, so two
  // parallel /complete retries for the same delivered order could both pass the
  // check and double-credit. We serialize per (uid, orderId) with a Postgres
  // SESSION advisory lock held on a dedicated pooled client across the whole
  // critical section. creditWallet commits on its own connection BEFORE we release
  // the lock, so the next contender's check sees the committed credit and skips.
  // Chosen over a unique index to keep the patch code-only (no prod DB migration).
  async function settleDeliveredOrder(uid, orderId) {
    var ordRow = await pool.query(
      "SELECT payment_mode, fare_estimate FROM orders WHERE id = $1 LIMIT 1", [orderId]
    );
    if (ordRow.rows.length === 0) return { newBalance: null };
    var pm = ordRow.rows[0].payment_mode;
    var fare = ordRow.rows[0].fare_estimate != null ? Number(ordRow.rows[0].fare_estimate) : 0;

    var keys = bcdAdvisoryKeys("bcd_settle:" + uid + ":" + orderId);
    var client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1::int4, $2::int4)", keys);

      if (isCashPayment(pm) || !(fare > 0)) {
        try {
          var balRes = await client.query("SELECT balance FROM driver_wallets WHERE driver_uid = $1 LIMIT 1", [uid]);
          var bal = balRes.rows.length && balRes.rows[0].balance != null ? String(balRes.rows[0].balance) : "0";
          await client.query(
            "INSERT INTO wallet_transactions " +
            "(driver_uid, type, amount, description, order_id, balance_before, balance_after, created_at) " +
            "SELECT $1, 'cash_collected', 0, 'COD cash collected', $2, $3::numeric, $3::numeric, now() " +
            "WHERE NOT EXISTS (" +
            "  SELECT 1 FROM wallet_transactions WHERE driver_uid = $1 AND order_id = $2 AND type = 'cash_collected'" +
            ")",
            [uid, orderId, bal]
          );
        } catch (eAudit) { bcdLog("cash_audit_err", { orderId: orderId, err: String(eAudit) }); }
        bcdLog("cash_no_credit", { orderId: orderId, paymentMode: pm == null ? null : String(pm) });
        return { newBalance: null };
      }

      var existing = await client.query(
        "SELECT 1 FROM wallet_transactions WHERE driver_uid = $1 AND order_id = $2 AND type = 'credit' LIMIT 1",
        [uid, orderId]
      );
      if (existing.rows.length > 0) return { newBalance: null };

      var rec = await creditWallet(uid, fare, "Delivery earnings", { orderId: orderId });
      return { newBalance: rec && typeof rec.balanceAfter === "number" ? rec.balanceAfter : null };
    } finally {
      try { await client.query("SELECT pg_advisory_unlock($1::int4, $2::int4)", keys); } catch (eUnl) {}
      client.release();
    }
  }

  async function completionStats(uid) {
    var t = istToday();
    var balRes = await pool.query("SELECT balance FROM driver_wallets WHERE driver_uid = $1 LIMIT 1", [uid]);
    var balance = balRes.rows.length && balRes.rows[0].balance != null ? Number(balRes.rows[0].balance) : 0;
    var earnRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM wallet_transactions " +
      "WHERE driver_uid = $1 AND type = 'credit' AND created_at >= $2",
      [uid, t.startUtc]
    );
    var todayEarnings = earnRes.rows.length ? Number(earnRes.rows[0].s) : 0;
    var tripRes = await pool.query(
      "SELECT COUNT(*)::int AS c FROM orders " +
      "WHERE driver_uid = $1 AND status = 'delivered' AND delivered_at >= $2",
      [uid, t.startUtc]
    );
    var tripsToday = tripRes.rows.length ? Number(tripRes.rows[0].c) : 0;
    return { balance: balance, todayEarnings: todayEarnings, tripsToday: tripsToday, todayDate: t.todayDate };
  }

  setInterval(function () { void runDispatchOnce(); }, DISPATCH_TICK_MS);
  bcdLog("driver_delivery_block_installed", { offerTtlMs: OFFER_TTL_MS, dispatchTickMs: DISPATCH_TICK_MS });
})();
// =================== end __BCD_DRIVER_DELIVERY ====================
