import { Router, type IRouter } from "express";
import { adminFirestore } from "../lib/firebase-admin";

const router: IRouter = Router();

/**
 * POST /api/drivers/register-keys
 *
 * Duplicate-driver guard called before final KYC document submission.
 * Checks whether the supplied phone, licenseNumber, or vehicleNumber is
 * already registered to a DIFFERENT driver account.
 *
 * The same driver updating their own profile is always allowed through
 * because each query excludes the requesting driverUid.
 *
 * No matched-driver details are returned — only a boolean ok / duplicate
 * signal — so no private driver data is leaked to the caller.
 *
 * Body:
 *   { driverUid: string; phone?: string; licenseNumber?: string; vehicleNumber?: string }
 *
 * Response 200: { ok: true }
 * Response 409: { ok: false; error: "duplicate"; message: string }
 * Response 400: { ok: false; error: "missing_uid" }
 * Response 500: { ok: false; error: "server_error"; message: string }
 */
router.post("/drivers/register-keys", async (req, res) => {
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

  const DUPLICATE_MSG =
    "Your account already exists with this mobile, license, or vehicle number. Please login or contact support.";

  try {
    const db  = await adminFirestore();
    const col = db.collection("drivers");

    // ── 1. Phone ─────────────────────────────────────────────────────────────
    if (typeof phone === "string" && phone.trim().length > 0) {
      const snap = await col.where("phone", "==", phone.trim()).get();
      if (snap.docs.some((d) => d.id !== driverUid)) {
        req.log.info({ driverUid, field: "phone" }, "register-keys: duplicate phone");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 2. License number ─────────────────────────────────────────────────────
    if (typeof licenseNumber === "string" && licenseNumber.trim().length > 0) {
      const normalised = licenseNumber.trim().toUpperCase();
      const snap = await col.where("licenseNumber", "==", normalised).get();
      if (snap.docs.some((d) => d.id !== driverUid)) {
        req.log.info({ driverUid, field: "licenseNumber" }, "register-keys: duplicate licenseNumber");
        res.status(409).json({ ok: false, error: "duplicate", message: DUPLICATE_MSG });
        return;
      }
    }

    // ── 3. Vehicle number ─────────────────────────────────────────────────────
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
