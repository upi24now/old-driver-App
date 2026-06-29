// GET /api/drivers/me — driver self-profile (driverAuth-gated, NOT admin).
//
// ROOT CAUSE THIS FIXES
// ---------------------
// The live bundle has NO dedicated GET /api/drivers/me route. The request fell
// through to the admin route  router11.get("/:uid", adminAuth)  (uid="me"), so a
// normal driver's Firebase token (no admin claim) received:
//     403 {"error":"Forbidden — account does not have admin access"}
// The driver app treats any non-404 /drivers/me error as fatal, so login bounced
// back to /login even though verify-otp / set-pin / verify-pin all returned 200.
//
// FIX (purely additive — 0 deletions / 0 modifications)
// -----------------------------------------------------
// Register an app-level GET /api/drivers/me BEFORE app.use("/api", routes_default)
// so Express matches it ahead of the param route. It authenticates the driver's
// OWN id token via the existing driverAuth middleware (which sets req.driverUid)
// and returns the SAME shape the admin "/:uid" route returns: { ok, driver, location }.
//   - 200 + driver        → normal case (driver row exists)
//   - 404 "Driver not found" → preserves the app's new-signup (ensureDriverSignup) path
// Only the literal path "me" is intercepted. Every real "/:uid" (a true driver uid)
// still routes to the admin (adminAuth) handler, so admin authorization is unchanged.
app.get("/api/drivers/me", driverAuth, async (req, res) => {
  try {
    const uid = String(req.driverUid);
    const [driver] = await db.select().from(driversTable).where(eq(driversTable.uid, uid)).limit(1);
    if (!driver) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }
    const [location] = await db.select().from(driverLocationsTable).where(eq(driverLocationsTable.driverUid, uid)).limit(1);
    res.json({ ok: true, driver, location: location ?? null });
  } catch (err) {
    try { req.log.error({ err }, "[DRIVERS_ME_PATCH] GET /api/drivers/me failed"); } catch (_e) {}
    res.status(500).json({ error: "Failed to fetch driver" });
  }
});
try { console.log("[DRIVERS_ME_PATCH] GET /api/drivers/me self-profile route mounted (driverAuth)"); } catch (_e) {}
