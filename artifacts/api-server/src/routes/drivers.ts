import { Router, type IRouter } from "express";
import { adminAuth, adminFirestore } from "../lib/firebase-admin";

const router: IRouter = Router();

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
 * because each Firestore query excludes the requesting driverUid.
 *
 * No matched-driver details are returned — only a boolean ok / duplicate
 * signal — so no private driver data is leaked to the caller.
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
  const authHeader = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!bearerToken) {
    res.status(401).json({ ok: false, error: "missing_token", message: "Authorization header required." });
    return;
  }

  // ── 2. Verify the Firebase ID token ─────────────────────────────────────────
  let decodedUid: string;
  try {
    const auth = await adminAuth();
    const decoded = await auth.verifyIdToken(bearerToken);
    decodedUid = decoded.uid;
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
    const db  = await adminFirestore();
    const col = db.collection("drivers");

    // ── 5. Phone ──────────────────────────────────────────────────────────────
    if (typeof phone === "string" && phone.trim().length > 0) {
      const snap = await col.where("phone", "==", phone.trim()).get();
      if (snap.docs.some((d) => d.id !== driverUid)) {
        req.log.info({ driverUid, field: "phone" }, "register-keys: duplicate phone");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 6. License number ─────────────────────────────────────────────────────
    if (typeof licenseNumber === "string" && licenseNumber.trim().length > 0) {
      const normalised = licenseNumber.trim().toUpperCase();
      const snap = await col.where("licenseNumber", "==", normalised).get();
      if (snap.docs.some((d) => d.id !== driverUid)) {
        req.log.info({ driverUid, field: "licenseNumber" }, "register-keys: duplicate licenseNumber");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 7. Vehicle number ─────────────────────────────────────────────────────
    if (typeof vehicleNumber === "string" && vehicleNumber.trim().length > 0) {
      const normalised = vehicleNumber.trim().toUpperCase();
      const snap = await col.where("vehicleNumber", "==", normalised).get();
      if (snap.docs.some((d) => d.id !== driverUid)) {
        req.log.info({ driverUid, field: "vehicleNumber" }, "register-keys: duplicate vehicleNumber");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    req.log.info({ driverUid }, "register-keys: no duplicates found");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, driverUid }, "register-keys: Firestore error");
    res.status(500).json({
      ok:      false,
      error:   "server_error",
      message: "Could not verify account. Please try again.",
    });
  }
});

export default router;
