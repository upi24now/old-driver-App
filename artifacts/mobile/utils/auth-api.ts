const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

export type SendOtpResult =
  | { ok: true;  devOtp?: string }
  | { ok: false; error: string };

export type VerifyOtpResult =
  | { ok: true;  token: string }
  | { ok: false; error: string };

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  try {
    const res  = await fetch(`${BASE_URL}/auth/send-otp`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ phone }),
    });
    const json = (await res.json()) as { sent?: boolean; devOtp?: string; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "Failed to send OTP." };
    return { ok: true, devOtp: json.devOtp };
  } catch {
    return { ok: false, error: "Network error. Check your connection." };
  }
}

export async function verifyOtpApi(phone: string, otp: string): Promise<VerifyOtpResult> {
  try {
    const res  = await fetch(`${BASE_URL}/auth/verify-otp`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ phone, otp }),
    });
    const json = (await res.json()) as { token?: string; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "Verification failed." };
    if (!json.token) return { ok: false, error: "No token received from server." };
    return { ok: true, token: json.token };
  } catch {
    return { ok: false, error: "Network error. Check your connection." };
  }
}
