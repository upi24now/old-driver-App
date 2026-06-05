import { Router } from "express";
import { adminAuth } from "../lib/firebase-admin";

const router = Router();

// ─── In-memory OTP store ──────────────────────────────────────────────────
interface OtpEntry { otp: string; expiresAt: number }
const otpStore = new Map<string, OtpEntry>();

// ─── Test phone bypass ────────────────────────────────────────────────────
// Format: TEST_OTP_PHONES="phone1:otp1,phone2:otp2"
// Example: TEST_OTP_PHONES="8299013350:123456"
function parseTestPhones(): Map<string, string> {
  const raw = process.env["TEST_OTP_PHONES"] ?? "";
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [phone, otp] = entry.trim().split(":");
    if (phone && otp) map.set(phone.trim(), otp.trim());
  }
  return map;
}

// ─── Routes ───────────────────────────────────────────────────────────────
router.post("/auth/send-otp", (req, res) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
    return;
  }

  const testPhones = parseTestPhones();
  if (testPhones.has(phone)) {
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP send — test bypass active");
    res.json({ sent: true });
    return;
  }

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  otpStore.set(phone, { otp, expiresAt });

  // prune expired entries
  for (const [key, val] of otpStore) {
    if (Date.now() > val.expiresAt) otpStore.delete(key);
  }

  req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP generated");

  const isDev = process.env["NODE_ENV"] !== "production";
  res.json({ sent: true, ...(isDev ? { devOtp: otp } : {}) });
});

router.post("/auth/verify-otp", async (req, res) => {
  const { phone, otp } = req.body as { phone?: string; otp?: string };

  if (!phone || !otp) {
    res.status(400).json({ error: "phone and otp are required." });
    return;
  }

  const testPhones = parseTestPhones();
  if (testPhones.has(phone)) {
    if (testPhones.get(phone) !== otp) {
      res.status(401).json({ error: "Incorrect OTP. Try again." });
      return;
    }
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP verify — test bypass matched");
  } else {
    const entry = otpStore.get(phone);
    if (!entry) {
      res.status(401).json({ error: "OTP not found or expired. Request a new code." });
      return;
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(phone);
      res.status(401).json({ error: "OTP expired. Request a new code." });
      return;
    }

    if (entry.otp !== otp) {
      res.status(401).json({ error: "Incorrect OTP. Try again." });
      return;
    }

    otpStore.delete(phone);
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP verified");
  }

  try {
    const uid   = `91${phone}`;
    const auth  = await adminAuth();
    const token = await auth.createCustomToken(uid);

    req.log.info({ uid }, "OTP verified — custom token issued");
    res.json({ token });
  } catch (err) {
    req.log.error({ err }, "verify-otp custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

export default router;
