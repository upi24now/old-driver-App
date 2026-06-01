import crypto from "crypto";
import { Router } from "express";

const router = Router();

// ─── In-memory OTP store (single-instance; Phase 1) ───────────────────────
interface OtpEntry { otp: string; expiresAt: number }
const otpStore = new Map<string, OtpEntry>();

// ─── Credential derivation ────────────────────────────────────────────────
function deriveCredentials(phone: string): { email: string; password: string } {
  const session  = process.env["SESSION_SECRET"] ?? "dev-secret";
  const email    = `drv91${phone}@bikecourier.app`;
  const password = crypto.createHmac("sha256", session).update(phone).digest("hex");
  return { email, password };
}

// ─── Firebase REST helper (public API key, no Admin SDK) ──────────────────
async function ensureFirebaseAccount(email: string, password: string): Promise<void> {
  const apiKey = process.env["FIREBASE_API_KEY"];
  if (!apiKey) throw new Error("FIREBASE_API_KEY is not set.");

  const signUpRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );

  if (signUpRes.ok) return;

  const signUpBody = await signUpRes.json() as { error?: { message?: string } };
  if (signUpBody.error?.message !== "EMAIL_EXISTS") {
    throw new Error(`Firebase signUp failed: ${signUpBody.error?.message ?? "unknown"}`);
  }

  // Account already exists — the HMAC password is deterministic so it always matches
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );

  if (!signInRes.ok) {
    const signInBody = await signInRes.json() as { error?: { message?: string } };
    throw new Error(`Firebase signIn check failed: ${signInBody.error?.message ?? "unknown"}`);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────
router.post("/auth/send-otp", (req, res) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
    return;
  }

  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  otpStore.set(phone, { otp, expiresAt });

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

  try {
    const { email, password } = deriveCredentials(phone);
    await ensureFirebaseAccount(email, password);
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP verified — Firebase credentials issued");
    res.json({ email, password });
  } catch (err) {
    req.log.error({ err }, "verify-otp Firebase step failed");
    res.status(500).json({ error: "Verification failed. Check Firebase configuration." });
  }
});

export default router;
