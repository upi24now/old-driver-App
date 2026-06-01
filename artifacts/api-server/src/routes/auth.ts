import { Router } from "express";
import { adminAuth, adminDb } from "../lib/firebase-admin";

const router = Router();

router.post("/auth/send-otp", async (req, res) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
    return;
  }

  try {
    const db  = await adminDb();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    await db.collection("otps").doc(phone).set({
      otp,
      expiresAt,
      createdAt: Date.now(),
    });

    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP generated");

    const isDev = process.env["NODE_ENV"] !== "production";
    res.json({ sent: true, ...(isDev ? { devOtp: otp } : {}) });
  } catch (err) {
    req.log.error({ err }, "send-otp failed");
    res.status(500).json({ error: "Failed to send OTP. Check Firebase configuration." });
  }
});

router.post("/auth/verify-otp", async (req, res) => {
  const { phone, otp } = req.body as { phone?: string; otp?: string };

  if (!phone || !otp) {
    res.status(400).json({ error: "phone and otp are required." });
    return;
  }

  try {
    const db   = await adminDb();
    const auth = await adminAuth();

    const snap = await db.collection("otps").doc(phone).get();
    if (!snap.exists) {
      res.status(401).json({ error: "OTP not found or expired. Request a new code." });
      return;
    }

    const data = snap.data() as { otp: string; expiresAt: number };

    if (Date.now() > data.expiresAt) {
      await db.collection("otps").doc(phone).delete();
      res.status(401).json({ error: "OTP expired. Request a new code." });
      return;
    }

    if (data.otp !== otp) {
      res.status(401).json({ error: "Incorrect OTP. Try again." });
      return;
    }

    await db.collection("otps").doc(phone).delete();

    const uid   = `91${phone}`;
    const token = await auth.createCustomToken(uid);

    req.log.info({ uid }, "OTP verified — custom token issued");
    res.json({ token });
  } catch (err) {
    req.log.error({ err }, "verify-otp failed");
    res.status(500).json({ error: "Verification failed. Check Firebase configuration." });
  }
});

export default router;
