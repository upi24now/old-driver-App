/**
 * admin-otp-store.ts
 *
 * Generates, stores and verifies 6-digit OTPs for admin login.
 *
 * Storage:  Firestore collection `adminOtps/{encodedPhone}`
 * Expiry:   10 minutes
 * Max tries: 5 per OTP before it is wiped
 *
 * Dev bypass:
 *   ALLOW_DEV_ADMIN_OTP=true  →  OTP "123456" is always accepted
 *   (phone must still exist in adminUsers and be active)
 *
 * SMS delivery:
 *   If FAST2SMS_API_KEY is set → sends real SMS via Fast2SMS (India)
 *   Otherwise → logs OTP to server console (operator must plug in SMS provider)
 */

import { adminFirestore } from "./firebase-admin";
import { FieldValue }      from "firebase-admin/firestore";
import { logger }          from "./logger";

const EXPIRY_MS    = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const DEV_OTP      = "123456";

// Firestore doc IDs cannot contain '/' — '+' is safe but we encode it for clarity.
function phoneToDocId(phone: string): string {
  return phone.replace(/\+/g, "P");
}

export function isDevOtpEnabled(): boolean {
  return process.env["ALLOW_DEV_ADMIN_OTP"] === "true";
}

export async function generateAndStoreOtp(phone: string): Promise<string> {
  const db  = await adminFirestore();
  const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
  await db.collection("adminOtps").doc(phoneToDocId(phone)).set({
    code:      otp,
    expiresAt: new Date(Date.now() + EXPIRY_MS),
    attempts:  0,
    createdAt: FieldValue.serverTimestamp(),
  });
  return otp;
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  const fast2smsKey = process.env["FAST2SMS_API_KEY"];
  // Strip country code for Fast2SMS (expects 10-digit Indian number)
  const digits = phone.replace(/^\+91/, "").replace(/\D/g, "");

  if (fast2smsKey) {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization:  fast2smsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route:           "otp",
        variables_values: otp,
        numbers:         digits,
      }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok || body["return"] === false) {
      logger.error({ phone, body }, "admin-otp: Fast2SMS delivery failed");
      throw new Error("SMS delivery failed. Please try again.");
    }
    logger.info({ phone }, "admin-otp: OTP SMS sent via Fast2SMS");
  } else {
    // No SMS provider configured.
    // Set FAST2SMS_API_KEY (or another provider) for production SMS delivery.
    logger.warn(
      { phone, otp },
      "admin-otp: [NO SMS PROVIDER] OTP logged here — set FAST2SMS_API_KEY to send real SMS",
    );
  }
}

export async function verifyAdminOtp(
  phone: string,
  code:  string,
): Promise<{ valid: boolean; error?: string }> {
  // Dev mode bypass — phone was already checked against adminUsers by the caller
  if (isDevOtpEnabled() && code === DEV_OTP) {
    logger.warn({ phone }, "admin-otp: dev OTP bypass used (ALLOW_DEV_ADMIN_OTP=true)");
    return { valid: true };
  }

  const db  = await adminFirestore();
  const ref = db.collection("adminOtps").doc(phoneToDocId(phone));
  const snap = await ref.get();

  if (!snap.exists) {
    return { valid: false, error: "No OTP found. Request a new OTP." };
  }

  const data     = snap.data()!;
  const attempts = ((data["attempts"] as number) ?? 0) + 1;

  if (attempts > MAX_ATTEMPTS) {
    await ref.delete();
    return { valid: false, error: "Too many attempts. Request a new OTP." };
  }

  const expiresAt =
    (data["expiresAt"] as import("firebase-admin/firestore").Timestamp | null)
      ?.toDate?.() ?? new Date(0);

  if (new Date() > expiresAt) {
    await ref.delete();
    return { valid: false, error: "OTP expired. Request a new OTP." };
  }

  // Increment attempts before checking code (rate-limit even on wrong guess)
  await ref.update({ attempts });

  if (data["code"] !== code) {
    return { valid: false, error: "Invalid OTP." };
  }

  // Valid — consume the OTP
  await ref.delete();
  return { valid: true };
}
