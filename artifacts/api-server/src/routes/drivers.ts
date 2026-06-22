import { Router, type IRouter } from "express";
import { adminAuth, adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { db, driversTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { pgGetActiveOrders } from "../lib/order-pg-service";

const router: IRouter = Router();

/**
 * POST /api/drivers/signup
 *
 * Upserts the driver row in PostgreSQL. Called after OTP success so that the
 * drivers row exists before document submission (which has a FK constraint on
 * driver_documents.driver_uid → drivers.uid).
 *
 * New-driver defaults (always stamped on INSERT):
 *   onboarding_fee_applies = true
 *   onboarding_fee_status  = "pending"
 *   onboarding_fee_amount  = 10   (₹10 floor)
 *   verification_status    = "unsubmitted"
 *   documents_submitted    = false
 *   account_status         = "active"
 *
 * Body-supplied values take precedence over defaults at INSERT time so that
 * the mobile can pass already-known Firestore state during migration.
 *
 * ON CONFLICT: COALESCE(existing, incoming) is used for all KYC/onboarding
 * columns so that a more-advanced state (e.g. "paid", "approved") is never
 * overwritten by a stale body value. Profile text fields use the previous
 * non-empty COALESCE pattern.
 *
 * Authentication:
 *   Authorization: Bearer <Firebase ID token>
 *   The token uid becomes drivers.uid.
 *
 * Body: { phone: string; name?: string; city?: string; gender?: string;
 *         vehicleId?: string; vehicleName?: string;
 *         licenseNumber?: string; vehicleNumber?: string;
 *         verificationStatus?: string; documentsSubmitted?: boolean;
 *         onboardingFeeApplies?: boolean; onboardingFeeStatus?: string;
 *         onboardingFeeAmount?: number }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false; error: "missing_phone" }
 * Response 401: { ok: false; error: "..." }
 * Response 500: { ok: false; error: "server_error" }
 */
router.post("/drivers/signup", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const body = (req.body ?? {}) as {
    phone?:                unknown;
    name?:                 unknown;
    city?:                 unknown;
    gender?:               unknown;
    vehicleId?:            unknown;
    vehicleName?:          unknown;
    licenseNumber?:        unknown;
    vehicleNumber?:        unknown;
    verificationStatus?:   unknown;
    documentsSubmitted?:   unknown;
    onboardingFeeApplies?: unknown;
    onboardingFeeStatus?:  unknown;
    onboardingFeeAmount?:  unknown;
  };

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!phone) {
    res.status(400).json({ ok: false, error: "missing_phone", message: "phone is required." });
    return;
  }

  // Helper: accept non-empty strings only; ignore null/undefined/empty.
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const name          = str(body.name);
  const city          = str(body.city);
  const gender        = str(body.gender);
  const vehicleId     = str(body.vehicleId);
  const vehicleName   = str(body.vehicleName);
  const licenseNumber = str(body.licenseNumber)?.toUpperCase() ?? null;
  const vehicleNumber = str(body.vehicleNumber)?.toUpperCase() ?? null;

  // KYC / onboarding fields — body values override defaults at INSERT time.
  // Defaults ensure new drivers always start with the correct initial state.
  const verificationStatus  = str(body.verificationStatus)    ?? "unsubmitted";
  const onboardingFeeStatus = str(body.onboardingFeeStatus)   ?? "pending";
  const documentsSubmitted : boolean =
    typeof body.documentsSubmitted  === "boolean" ? body.documentsSubmitted  : false;
  const onboardingFeeApplies: boolean =
    typeof body.onboardingFeeApplies === "boolean" ? body.onboardingFeeApplies : true;
  const onboardingFeeAmount : number =
    typeof body.onboardingFeeAmount === "number" && (body.onboardingFeeAmount as number) > 0
      ? Math.round(body.onboardingFeeAmount as number)
      : 10;   // ₹10 floor

  try {
    await db
      .insert(driversTable)
      .values({
        uid,
        phone,
        // Profile (optional at signup; filled in profile-setup screen)
        ...(name          !== null && { name }),
        ...(city          !== null && { city }),
        ...(gender        !== null && { gender }),
        ...(vehicleId     !== null && { vehicleId }),
        ...(vehicleName   !== null && { vehicleName }),
        ...(licenseNumber !== null && { licenseNumber }),
        ...(vehicleNumber !== null && { vehicleNumber }),
        // Onboarding — always stamped on first INSERT (body can override for migration)
        onboardingFeeApplies,
        onboardingFeeStatus,
        onboardingFeeAmount,
        onboardingFeeCurrency: "INR",
        verificationStatus,
        documentsSubmitted,
        accountStatus: "active",
      })
      .onConflictDoUpdate({
        target: driversTable.uid,
        set: {
          // Profile text fields: keep existing non-empty value; fall back to incoming.
          phone:         sql`COALESCE(NULLIF(EXCLUDED.phone, ''),          drivers.phone)`,
          name:          sql`COALESCE(NULLIF(EXCLUDED.name, ''),           drivers.name)`,
          city:          sql`COALESCE(NULLIF(EXCLUDED.city, ''),           drivers.city)`,
          gender:        sql`COALESCE(NULLIF(EXCLUDED.gender, ''),         drivers.gender)`,
          vehicleId:     sql`COALESCE(NULLIF(EXCLUDED.vehicle_id, ''),     drivers.vehicle_id)`,
          vehicleName:   sql`COALESCE(NULLIF(EXCLUDED.vehicle_name, ''),   drivers.vehicle_name)`,
          licenseNumber: sql`COALESCE(NULLIF(EXCLUDED.license_number, ''), drivers.license_number)`,
          vehicleNumber: sql`COALESCE(NULLIF(EXCLUDED.vehicle_number, ''), drivers.vehicle_number)`,
          // KYC / onboarding: preserve existing non-null DB value so that a
          // more-advanced state ("paid", "approved") is never overwritten.
          // COALESCE(existing, incoming): existing wins if already set.
          verificationStatus:   sql`COALESCE(drivers.verification_status,   EXCLUDED.verification_status)`,
          documentsSubmitted:   sql`COALESCE(drivers.documents_submitted,   EXCLUDED.documents_submitted)`,
          onboardingFeeApplies: sql`COALESCE(drivers.onboarding_fee_applies, EXCLUDED.onboarding_fee_applies)`,
          onboardingFeeStatus:  sql`COALESCE(drivers.onboarding_fee_status,  EXCLUDED.onboarding_fee_status)`,
          onboardingFeeAmount:  sql`COALESCE(drivers.onboarding_fee_amount,  EXCLUDED.onboarding_fee_amount)`,
          updatedAt:            sql`NOW()`,
        },
      });

    req.log.info({ uid }, "signup: driver row upserted");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "signup: PostgreSQL error");
    res.status(500).json({ ok: false, error: "server_error", message: "Could not create driver record." });
  }
});

/**
 * POST /api/drivers/register-keys
 *
 * Duplicate-driver guard called before final KYC document submission.
 * Checks whether the supplied phone, licenseNumber, or vehicleNumber is
 * already registered to a DIFFERENT driver account.
 *
 * Authentication:
 *   Requires a valid Firebase ID token in the Authorization header:
 *     Authorization: Bearer <idToken>
 *   The token's uid must match body.driverUid — a driver may only check
 *   uniqueness for their own account.
 *
 * The same driver updating their own profile is always allowed through
 * because each query excludes the requesting driverUid.
 *
 * No matched-driver details are returned — only a boolean ok / duplicate
 * signal — so no private driver data is leaked to the caller.
 *
 * Read path: PostgreSQL `drivers` table.
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 *
 * Body:
 *   { driverUid: string; phone?: string; licenseNumber?: string; vehicleNumber?: string }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false; error: "missing_uid" | "missing_token" }
 * Response 401: { ok: false; error: "invalid_token" }
 * Response 403: { ok: false; error: "uid_mismatch" }
 * Response 409: { ok: false; error: "duplicate"; message: string }
 * Response 500: { ok: false; error: "server_error"; message: string }
 */
router.post("/drivers/register-keys", async (req, res) => {
  // ── 1. Extract and validate the Bearer token ────────────────────────────────
  const authHeader  = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!bearerToken) {
    res.status(401).json({ ok: false, error: "missing_token", message: "Authorization header required." });
    return;
  }

  // ── 2. Verify the Firebase ID token ─────────────────────────────────────────
  let decodedUid: string;
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(bearerToken);
    decodedUid    = decoded.uid;
  } catch (err) {
    req.log.warn({ err }, "register-keys: invalid Firebase ID token");
    res.status(401).json({ ok: false, error: "invalid_token", message: "Invalid or expired token." });
    return;
  }

  // ── 3. Extract and validate driverUid from body ──────────────────────────────
  const { driverUid, phone, licenseNumber, vehicleNumber } =
    req.body as {
      driverUid:      unknown;
      phone?:         unknown;
      licenseNumber?: unknown;
      vehicleNumber?: unknown;
    };

  if (typeof driverUid !== "string" || !driverUid) {
    res.status(400).json({ ok: false, error: "missing_uid", message: "driverUid is required." });
    return;
  }

  // ── 4. Ensure the token belongs to the driver making the request ────────────
  if (decodedUid !== driverUid) {
    req.log.warn({ decodedUid, driverUid }, "register-keys: uid mismatch — token does not match body driverUid");
    res.status(403).json({ ok: false, error: "uid_mismatch", message: "Token does not match the supplied driverUid." });
    return;
  }

  const DUPLICATE_MSG =
    "Your account already exists with this mobile, license, or vehicle number. Please login or contact support.";

  try {
    // ── 5. Phone duplicate check ───────────────────────────────────────────────
    if (typeof phone === "string" && phone.trim().length > 0) {
      const rows = await db
        .select({ uid: driversTable.uid })
        .from(driversTable)
        .where(and(
          eq(driversTable.phone, phone.trim()),
          ne(driversTable.uid, driverUid),
        ))
        .limit(1);

      if (rows.length > 0) {
        req.log.info({ driverUid, field: "phone" }, "register-keys: duplicate phone");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 6. License number duplicate check ─────────────────────────────────────
    if (typeof licenseNumber === "string" && licenseNumber.trim().length > 0) {
      const normalised = licenseNumber.trim().toUpperCase();
      const rows = await db
        .select({ uid: driversTable.uid })
        .from(driversTable)
        .where(and(
          eq(driversTable.licenseNumber, normalised),
          ne(driversTable.uid, driverUid),
        ))
        .limit(1);

      if (rows.length > 0) {
        req.log.info({ driverUid, field: "licenseNumber" }, "register-keys: duplicate licenseNumber");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 7. Vehicle number duplicate check ─────────────────────────────────────
    if (typeof vehicleNumber === "string" && vehicleNumber.trim().length > 0) {
      const normalised = vehicleNumber.trim().toUpperCase();
      const rows = await db
        .select({ uid: driversTable.uid })
        .from(driversTable)
        .where(and(
          eq(driversTable.vehicleNumber, normalised),
          ne(driversTable.uid, driverUid),
        ))
        .limit(1);

      if (rows.length > 0) {
        req.log.info({ driverUid, field: "vehicleNumber" }, "register-keys: duplicate vehicleNumber");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    req.log.info({ driverUid }, "register-keys: no duplicates found");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, driverUid }, "register-keys: PostgreSQL error");
    res.status(500).json({
      ok:      false,
      error:   "server_error",
      message: "Could not verify account. Please try again.",
    });
  }
});

/**
 * PATCH /api/drivers/:uid/status
 *
 * Updates the driver's online status in Firestore.
 * Called when the driver toggles the online/offline switch.
 *
 * Authentication:
 *   Authorization: Bearer <Firebase ID token>
 *   Token uid must match :uid.
 *
 * Body: { isOnline: boolean }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false; error: "invalid_body" }
 * Response 401: { ok: false; error: "missing_token" | "invalid_token" }
 * Response 403: { ok: false; error: "uid_mismatch" }
 * Response 500: { ok: false; error: "server_error" }
 */
router.patch("/drivers/:uid/status", async (req, res) => {
  const { uid } = req.params as { uid: string };

  const authHeader  = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearerToken) {
    res.status(401).json({ ok: false, error: "missing_token" });
    return;
  }

  let decodedUid: string;
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(bearerToken);
    decodedUid    = decoded.uid;
  } catch (err) {
    req.log.warn({ err }, "status: invalid Firebase ID token");
    res.status(401).json({ ok: false, error: "invalid_token" });
    return;
  }

  if (decodedUid !== uid) {
    req.log.warn({ decodedUid, uid }, "status: uid mismatch");
    res.status(403).json({ ok: false, error: "uid_mismatch" });
    return;
  }

  const { isOnline } = req.body as { isOnline?: unknown };
  if (typeof isOnline !== "boolean") {
    res.status(400).json({ ok: false, error: "invalid_body", message: "isOnline must be a boolean." });
    return;
  }

  try {
    const fsDb = await adminFirestore();
    await fsDb.collection("drivers").doc(uid).update({
      isOnline,
      lastSeenAt: Date.now(),
    });
    req.log.info({ uid, isOnline }, "driver status updated");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "status: Firestore update failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * POST /api/drivers/:uid/location
 *
 * Records the driver's current GPS coordinates in Firestore.
 * Called every ~15 s while the driver is online (foreground only).
 *
 * Authentication:
 *   Authorization: Bearer <Firebase ID token>
 *   Token uid must match :uid.
 *
 * Body:
 *   { latitude: number; longitude: number; isOnline: boolean; accuracy?: number }
 *
 * Response 200: { ok: true }
 * Response 400: { ok: false; error: "invalid_body" }
 * Response 401: { ok: false; error: "missing_token" | "invalid_token" }
 * Response 403: { ok: false; error: "uid_mismatch" }
 * Response 500: { ok: false; error: "server_error" }
 */
router.post("/drivers/:uid/location", async (req, res) => {
  const { uid } = req.params as { uid: string };

  const authHeader  = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearerToken) {
    res.status(401).json({ ok: false, error: "missing_token" });
    return;
  }

  let decodedUid: string;
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(bearerToken);
    decodedUid    = decoded.uid;
  } catch (err) {
    req.log.warn({ err }, "location: invalid Firebase ID token");
    res.status(401).json({ ok: false, error: "invalid_token" });
    return;
  }

  if (decodedUid !== uid) {
    req.log.warn({ decodedUid, uid }, "location: uid mismatch");
    res.status(403).json({ ok: false, error: "uid_mismatch" });
    return;
  }

  const { latitude, longitude, isOnline, accuracy } = req.body as {
    latitude?:  unknown;
    longitude?: unknown;
    isOnline?:  unknown;
    accuracy?:  unknown;
  };

  if (
    typeof latitude  !== "number" ||
    typeof longitude !== "number" ||
    typeof isOnline  !== "boolean"
  ) {
    res.status(400).json({
      ok:      false,
      error:   "invalid_body",
      message: "latitude (number), longitude (number), and isOnline (boolean) are required.",
    });
    return;
  }

  try {
    const fsDb = await adminFirestore();
    const update: Record<string, unknown> = {
      latitude,
      longitude,
      isOnline,
      lastSeenAt: Date.now(),
    };
    if (typeof accuracy === "number") update["accuracy"] = accuracy;

    await fsDb.collection("drivers").doc(uid).update(update);
    req.log.info({ uid, latitude, longitude, isOnline }, "driver location updated");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "location: Firestore update failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ─── GET /api/drivers/:uid/active-orders ──────────────────────────────────────
//
// Dual-read verification endpoint — Phase 2B-2B.
//
// Reads the driver's active orders from BOTH Firestore and PostgreSQL in
// parallel, compares them on four dimensions, logs the result, and always
// returns the Firestore data.  PG is verification-only at this stage.
//
// Log tags:
//   [PG_ACTIVE_MATCH] — count + IDs + status + driver_uid + accepted_at all agree
//   [PG_ACTIVE_DIFF]  — any dimension diverges (diffs logged as structured data)
//
// Comparison dimensions:
//   count       — total number of active orders
//   ids         — set equality (order may differ)
//   status      — string equality per matched order
//   driver_uid  — string equality per matched order
//   accepted_at — PG returns JS Date; Firestore returns Timestamp; ±1 s tolerance
//
// Auth: Bearer token uid must match :uid param.

router.get("/drivers/:uid/active-orders", async (req, res) => {
  const { uid } = req.params as { uid: string };

  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  if (tokenUid !== uid) {
    req.log.warn({ tokenUid, uid }, "active-orders: uid mismatch");
    res.status(403).json({ ok: false, error: "uid_mismatch" });
    return;
  }

  const rawMax = req.query["max"];
  const maxResults = typeof rawMax === "string" ? Math.min(parseInt(rawMax, 10) || 3, 10) : 3;

  const firestoreDb = await adminFirestore();

  // ── Parallel reads ────────────────────────────────────────────────────────────
  const ACTIVE_STATUSES = [
    "driver_assigned", "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop",
  ];

  const [pgResult, fsResult] = await Promise.allSettled([
    pgGetActiveOrders(uid, maxResults),
    firestoreDb
      .collection("orders")
      .where("driverUid", "==", uid)
      .where("status", "in", ACTIVE_STATUSES)
      .limit(maxResults)
      .get(),
  ]);

  // ── Firestore is always returned ──────────────────────────────────────────────
  if (fsResult.status === "rejected") {
    req.log.error({ err: fsResult.reason, uid }, "active-orders: Firestore read failed");
    res.status(500).json({ ok: false, error: "firestore_error" });
    return;
  }

  const fsDocs = fsResult.value.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
  );
  // Sort newest-first by acceptedAt (matching mobile sort)
  fsDocs.sort((a, b) => {
    const ta = (a["acceptedAt"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const tb = (b["acceptedAt"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return tb - ta;
  });

  // ── PG comparison ─────────────────────────────────────────────────────────────
  if (pgResult.status === "rejected") {
    req.log.error({ err: pgResult.reason, uid }, "[PG_ACTIVE_DIFF] PG read threw — skipping compare");
  } else {
    const pgRows = pgResult.value;
    const diffs: { dimension: string; detail: unknown }[] = [];

    // Count
    if (pgRows.length !== fsDocs.length) {
      diffs.push({ dimension: "count", detail: { pg: pgRows.length, fs: fsDocs.length } });
    }

    // ID sets
    const pgIds = new Set(pgRows.map((r) => r.id));
    const fsIds = new Set(fsDocs.map((d) => d["id"] as string));
    const onlyInPg = [...pgIds].filter((id) => !fsIds.has(id));
    const onlyInFs = [...fsIds].filter((id) => !pgIds.has(id));
    if (onlyInPg.length > 0 || onlyInFs.length > 0) {
      diffs.push({ dimension: "ids", detail: { onlyInPg, onlyInFs } });
    }

    // Per-order field comparison (matched by ID)
    for (const pgRow of pgRows) {
      const fsDoc = fsDocs.find((d) => d["id"] === pgRow.id);
      if (!fsDoc) continue; // already captured in ids diff

      const orderDiffs: { field: string; pg: unknown; fs: unknown }[] = [];

      // status
      const pgStatus = pgRow.status ?? null;
      const fsStatus = (fsDoc["status"] as string | undefined) ?? null;
      if (pgStatus !== fsStatus) orderDiffs.push({ field: "status", pg: pgStatus, fs: fsStatus });

      // driver_uid
      const pgDriver = pgRow.driverUid ?? null;
      const fsDriver = (fsDoc["driverUid"] as string | undefined) ?? null;
      if (pgDriver !== fsDriver) orderDiffs.push({ field: "driver_uid", pg: pgDriver, fs: fsDriver });

      // accepted_at — PG: Date | null; Firestore: Timestamp | null
      const pgMs = pgRow.acceptedAt instanceof Date ? pgRow.acceptedAt.getTime() : null;
      const fsTs = fsDoc["acceptedAt"] as { toMillis?: () => number } | null | undefined;
      const fsMs = fsTs?.toMillis?.() ?? null;
      if (pgMs === null && fsMs === null) {
        // both null — fine
      } else if (pgMs === null || fsMs === null || Math.abs(pgMs - fsMs) > 1000) {
        orderDiffs.push({ field: "accepted_at", pg: pgMs, fs: fsMs });
      }

      if (orderDiffs.length > 0) {
        diffs.push({ dimension: `order:${pgRow.id}`, detail: orderDiffs });
      }
    }

    if (diffs.length === 0) {
      req.log.info({ uid, count: fsDocs.length }, "[PG_ACTIVE_MATCH]");
    } else {
      req.log.info({ uid, diffs }, "[PG_ACTIVE_DIFF]");
    }
  }

  res.json({ ok: true, orders: fsDocs });
});

export default router;
