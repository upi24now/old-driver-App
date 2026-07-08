// Additive route: POST /api/orders/:orderId/driver-cancel
//
// Confirmed facts this body relies on (gathered from the LIVE bundle, not guessed):
//   - Route param name is :orderId (matches the sibling routes
//     PATCH /api/orders/:orderId/stage and POST /api/orders/:orderId/accept).
//   - `driverAuth` middleware exists in the live bundle and sets req.driverUid
//     from the verified Firebase ID token (see src/middlewares/driverAuth.ts
//     compiled in-bundle: `req.driverUid = decoded.uid`).
//   - `orders` table (raw SQL via `pool`, not Drizzle) has columns:
//     id, status, driver_uid, active_offer_driver_uids (jsonb array), raw (jsonb), updated_at
//     (confirmed via the live bundle's own SELECT/UPDATE statements against `orders`).
//   - The live bundle's confirmed order status vocabulary includes at least
//     'pending', 'accepted', 'finding_driver', 'dispatched'. 'accepted' is the
//     status the order is in immediately after a driver accepts it and before
//     pickup — this is the case this route is meant to unwind.
//
// Design choice (documented, not a guess): to avoid inventing status literals
// that were never confirmed in the live bundle (e.g. an unconfirmed
// 'to_pickup'/'at_pickup' vocabulary on the `status` column itself — those
// names exist in the mobile client's *stage* field, which may be a separate
// concept from `orders.status` in this bundle), this route ONLY allows
// cancellation while status = 'accepted'. It explicitly rejects the known
// pool/terminal statuses. If further stages need cancel support later, extend
// CANCELLABLE_STATUSES below once those literal values are confirmed the same
// way (grep the live bundle) rather than guessing them in.
//
// Purely additive. Never throws unhandled; every branch returns a response.
// NOTE: this file is spliced in BEFORE `app.use("/api", routes_default)`,
// i.e. directly on the bare `app`, the same way the live bundle's sibling
// routes POST /api/orders/:orderId/accept and PATCH /api/orders/:orderId/stage
// are registered. Those siblings include the `/api` prefix literally in their
// own path (they are not mounted under a `/api` sub-router), so this route
// must do the same or it registers at the wrong path and still 404s.
app.post("/api/orders/:orderId/driver-cancel", driverAuth, async (req, res) => {
  const orderId = String(req.params["orderId"] || "").trim();
  const driverUid = req.driverUid;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "";

  if (!orderId) {
    return res.status(400).json({ ok: false, error: "orderId is required" });
  }
  if (!driverUid) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const CANCELLABLE_STATUSES = ["accepted"];

  try {
    const result = await pool.query(
      `UPDATE orders
         SET status = 'finding_driver',
             driver_uid = NULL,
             active_offer_driver_uids = '[]'::jsonb,
             raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
               'driverCancelledBy', $2::text,
               'driverCancelReason', $3::text,
               'driverCancelledAt', now()
             ),
             updated_at = now()
       WHERE id = $1
         AND driver_uid = $2
         AND status = ANY($4::text[])
       RETURNING id`,
      [orderId, driverUid, reason, CANCELLABLE_STATUSES]
    );

    if (result.rows.length > 0) {
      console.log(`[driver-cancel] order ${orderId} returned to pool by driver ${driverUid}`);
      return res.json({ ok: true });
    }

    // 0 rows updated — classify why, without guessing: read current state.
    const cur = await pool.query(
      `SELECT status, driver_uid FROM orders WHERE id = $1`,
      [orderId]
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    const row = cur.rows[0];
    if (row.driver_uid !== driverUid) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    // Any other status for an order still owned by this driver (already back
    // in the pool, already delivered, etc.) is NOT re-treated as success —
    // only an exact status='accepted' match commits above. This keeps the
    // response semantics unambiguous: 200 means "just cancelled it", nothing
    // else does.
    return res.status(409).json({ ok: false, error: "too_late" });
  } catch (err) {
    console.error("[driver-cancel] error:", err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: "unknown" });
  }
});
