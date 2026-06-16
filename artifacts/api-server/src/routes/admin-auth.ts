/**
 * admin-auth.ts
 *
 * Public (unauthenticated) admin login routes.
 *
 *   POST /api/admin/auth/request-otp
 *     Body: { phone: string }
 *     1. Normalise phone to E.164 (+91XXXXXXXXXX)
 *     2. Look up adminUsers/{phone}
 *        - If collection is empty AND phone === ADMIN_OWNER_PHONE → auto-create owner
 *        - Otherwise → 403 if not found or not active
 *     3. Generate 6-digit OTP, store in adminOtps/{phone}
 *     4. Send SMS (Fast2SMS if FAST2SMS_API_KEY set; else log to console)
 *     Response: { ok: true }
 *
 *   POST /api/admin/auth/verify-otp
 *     Body: { phone: string, otp: string }
 *     1. Normalise phone
 *     2. Verify OTP (dev bypass: ALLOW_DEV_ADMIN_OTP=true + "123456")
 *     3. On success → issue 12-hour JWT
 *     Response: { ok: true, token: string, user: { phone, name, role } }
 */

import { Router }           from "express";
import { adminFirestore }   from "../lib/firebase-admin";
import { FieldValue }       from "firebase-admin/firestore";
import { signAdminJwt }     from "../lib/admin-jwt";
import {
  generateAndStoreOtp,
  sendOtpSms,
  verifyAdminOtp,
}                           from "../lib/admin-otp-store";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise an Indian phone number to E.164 format (+91XXXXXXXXXX).
 * Accepts: 10-digit, 09XXXXXXXX, 919XXXXXXXX, +919XXXXXXXX
 */
function normalisePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-().]/g, "");

  if (/^\+91\d{10}$/.test(stripped)) return stripped;
  if (/^91\d{10}$/.test(stripped))   return `+${stripped}`;
  if (/^0\d{10}$/.test(stripped))    return `+91${stripped.slice(1)}`;
  if (/^\d{10}$/.test(stripped))     return `+91${stripped}`;

  return null; // unrecognised format
}

// ─── POST /api/admin/auth/request-otp ────────────────────────────────────────

router.post("/admin/auth/request-otp", async (req, res) => {
  const { phone: rawPhone } = (req.body ?? {}) as { phone?: unknown };

  if (typeof rawPhone !== "string" || !rawPhone.trim()) {
    res.status(400).json({ ok: false, error: "phone is required." });
    return;
  }

  const phone = normalisePhone(rawPhone.trim());
  if (!phone) {
    res
      .status(400)
      .json({ ok: false, error: "Invalid phone number. Use 10-digit Indian mobile number." });
    return;
  }

  try {
    const db          = await adminFirestore();
    const usersCol    = db.collection("adminUsers");
    const userRef     = usersCol.doc(phone);
    const userSnap    = await userRef.get();

    // ── Owner bootstrap ───────────────────────────────────────────────────────
    // If no admin users exist at all AND this phone matches ADMIN_OWNER_PHONE,
    // auto-create the owner entry so the owner can bootstrap without manual DB setup.
    if (!userSnap.exists) {
      const ownerPhone = process.env["ADMIN_OWNER_PHONE"]
        ? normalisePhone(process.env["ADMIN_OWNER_PHONE"]) ?? ""
        : "";

      if (ownerPhone && phone === ownerPhone) {
        const totalSnap = await usersCol.limit(1).get();
        if (totalSnap.empty) {
          await userRef.set({
            phone,
            name:      "Owner",
            role:      "owner",
            isActive:  true,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: "system",
          });
          req.log.info({ phone }, "admin-auth: owner bootstrapped from ADMIN_OWNER_PHONE");
        } else {
          // Users exist but this phone isn't one of them
          req.log.warn({ phone }, "admin-auth: phone not in adminUsers (bootstrap skipped — users exist)");
          res.status(403).json({ ok: false, error: "Phone number not authorised for admin access." });
          return;
        }
      } else {
        req.log.warn({ phone }, "admin-auth: phone not in adminUsers");
        res.status(403).json({ ok: false, error: "Phone number not authorised for admin access." });
        return;
      }
    } else {
      // ── Existing user checks ────────────────────────────────────────────────
      const userData = userSnap.data()!;
      if (userData["isActive"] === false) {
        req.log.warn({ phone }, "admin-auth: disabled admin attempted login");
        res.status(403).json({ ok: false, error: "This admin account has been disabled." });
        return;
      }
    }

    // ── Generate and send OTP ─────────────────────────────────────────────────
    const otp = await generateAndStoreOtp(phone);
    await sendOtpSms(phone, otp);

    req.log.info({ phone }, "admin-auth: OTP sent");
    res.json({ ok: true, message: "OTP sent to your mobile number." });
  } catch (err) {
    req.log.error({ err }, "admin-auth: request-otp failed");
    res.status(500).json({ ok: false, error: "Failed to send OTP. Please try again." });
  }
});

// ─── POST /api/admin/auth/verify-otp ─────────────────────────────────────────

router.post("/admin/auth/verify-otp", async (req, res) => {
  const { phone: rawPhone, otp } = (req.body ?? {}) as {
    phone?: unknown;
    otp?:   unknown;
  };

  if (typeof rawPhone !== "string" || !rawPhone.trim()) {
    res.status(400).json({ ok: false, error: "phone is required." });
    return;
  }
  if (typeof otp !== "string" || !otp.trim()) {
    res.status(400).json({ ok: false, error: "otp is required." });
    return;
  }

  const phone = normalisePhone(rawPhone.trim());
  if (!phone) {
    res.status(400).json({ ok: false, error: "Invalid phone number." });
    return;
  }

  try {
    const db       = await adminFirestore();
    const userSnap = await db.collection("adminUsers").doc(phone).get();

    if (!userSnap.exists) {
      res.status(403).json({ ok: false, error: "Phone number not authorised." });
      return;
    }

    const userData = userSnap.data()!;
    if (userData["isActive"] === false) {
      res.status(403).json({ ok: false, error: "This admin account has been disabled." });
      return;
    }

    // Verify OTP (handles dev bypass internally)
    const result = await verifyAdminOtp(phone, otp.trim());
    if (!result.valid) {
      req.log.warn({ phone, error: result.error }, "admin-auth: OTP verification failed");
      res.status(401).json({ ok: false, error: result.error ?? "Invalid OTP." });
      return;
    }

    // Issue JWT
    const token = signAdminJwt({
      phone,
      role: (userData["role"] as string) ?? "support",
      name: (userData["name"] as string) ?? phone,
    });

    req.log.info({ phone, role: userData["role"] }, "admin-auth: login successful");
    res.json({
      ok:    true,
      token,
      user: {
        phone,
        name: userData["name"] ?? phone,
        role: userData["role"] ?? "support",
      },
    });
  } catch (err) {
    req.log.error({ err }, "admin-auth: verify-otp failed");
    res.status(500).json({ ok: false, error: "Verification failed. Please try again." });
  }
});

export default router;
