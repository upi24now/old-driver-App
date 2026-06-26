import { firebaseAuth } from "@/utils/firebase";

const _rawDomain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
// Strip any accidental protocol prefix or trailing /api so we never produce
// https://https://... or .../api/api regardless of how the env var is set.
const _cleanDomain = _rawDomain
  .replace(/^https?:\/\//i, "")   // remove leading protocol
  .replace(/\/api\/?$/, "")        // remove trailing /api
  .replace(/\/$/, "");             // remove trailing slash

const BASE_URL = _cleanDomain ? `https://${_cleanDomain}/api` : "/api";

// Log both the raw env var and the constructed URL on module load
console.log("[auth-api] EXPO_PUBLIC_DOMAIN (raw)  =", _rawDomain || "(not set)");
console.log("[auth-api] BASE_URL (constructed)     =", BASE_URL);

export type SendOtpResult =
  | { ok: true }
  | { ok: false; error: string };

export type VerifyOtpResult =
  | { ok: true;  token: string }
  | { ok: false; error: string };

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const url = `${BASE_URL}/auth/send-otp`;
  const body = JSON.stringify({ phone });
  const headers = { "Content-Type": "application/json" };

  console.log("[sendOtp] ──────────────────────────────────────");
  console.log("[sendOtp] URL     :", url);
  console.log("[sendOtp] method  : POST");
  console.log("[sendOtp] headers :", JSON.stringify(headers));
  console.log("[sendOtp] body    :", body);

  if (!_cleanDomain) {
    console.warn(
      "[sendOtp] WARNING: EXPO_PUBLIC_DOMAIN is not set. " +
      "BASE_URL is a relative path (\"/api\") which only works in a browser/web context. " +
      "On a real Android/iOS device this will fail with a network error. " +
      "Set EXPO_PUBLIC_DOMAIN to the API server domain (e.g. api.bikecourierservice.com)."
    );
  }

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error("[sendOtp] fetch THREW (network/DNS/TLS error) ─────");
    console.error("[sendOtp]   error.name   :", e?.name);
    console.error("[sendOtp]   error.code   :", e?.code);
    console.error("[sendOtp]   error.message:", e?.message);
    console.error("[sendOtp]   error.stack  :", e?.stack);
    return {
      ok:    false,
      error: `Could not connect to server (${e?.message ?? String(err)}). ` +
             (_cleanDomain ? "Check your network." : "EXPO_PUBLIC_DOMAIN is not configured — contact support."),
    };
  }

  console.log("[sendOtp] response status :", res.status, res.statusText);

  let json: { sent?: boolean; error?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[sendOtp] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    console.error("[sendOtp] server returned error:", res.status, json.error);
    return { ok: false, error: json.error ?? `Server error (${res.status}).` };
  }

  console.log("[sendOtp] SUCCESS");
  return { ok: true };
}

export async function verifyOtpApi(phone: string, otp: string): Promise<VerifyOtpResult> {
  const url = `${BASE_URL}/auth/verify-otp`;
  const body = JSON.stringify({ phone, otp });
  const headers = { "Content-Type": "application/json" };

  console.log("[verifyOtp] ──────────────────────────────────────");
  console.log("[verifyOtp] URL     :", url);
  console.log("[verifyOtp] method  : POST");

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error("[verifyOtp] fetch THREW ─────────────────────────");
    console.error("[verifyOtp]   error.name   :", e?.name);
    console.error("[verifyOtp]   error.code   :", e?.code);
    console.error("[verifyOtp]   error.message:", e?.message);
    console.error("[verifyOtp]   error.stack  :", e?.stack);
    return {
      ok:    false,
      error: `Could not connect to server (${e?.message ?? String(err)}).`,
    };
  }

  console.log("[verifyOtp] response status :", res.status, res.statusText);

  let json: { token?: string; error?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[verifyOtp] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    console.error("[verifyOtp] server returned error:", res.status, json.error);
    return { ok: false, error: json.error ?? `Server error (${res.status}).` };
  }
  if (!json.token) {
    console.error("[verifyOtp] no token in successful response");
    return { ok: false, error: "No token received from server." };
  }

  console.log("[verifyOtp] SUCCESS — token received");
  return { ok: true, token: json.token };
}

// ─── PIN factor (parallel to OTP — OTP flow unchanged) ──────────────────────────
//
// These helpers back the post-OTP "Create PIN" step for drivers who have no PIN.
// Both require an existing Firebase session (the driver just signed in via OTP),
// so they send the Firebase ID token as a Bearer credential.

async function getIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export type PinStatusResult =
  | { ok: true;  hasPin: boolean }
  | { ok: false; error: string };

export type SetPinResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * GET /auth/pin-status — does the signed-in driver already have a login PIN?
 *
 * Returns ok:false on any auth/network/server error so the caller can safely
 * skip the PIN step and continue the existing flow rather than blocking login.
 */
export async function getPinStatus(): Promise<PinStatusResult> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "Not signed in." };

  try {
    const res = await fetch(`${BASE_URL}/auth/pin-status`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const json = (await res.json()) as { hasPin?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: json.error ?? `Server error (${res.status}).` };
    }
    return { ok: true, hasPin: !!json.hasPin };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: `Could not check PIN status (${e?.message ?? String(err)}).` };
  }
}

/**
 * POST /auth/set-pin — store the driver's 6-digit PIN (server hashes it).
 * Requires a valid Firebase session from the just-completed OTP login.
 */
export async function setPin(pin: string): Promise<SetPinResult> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "Not signed in." };

  try {
    const res = await fetch(`${BASE_URL}/auth/set-pin`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body:    JSON.stringify({ pin }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Server error (${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: `Could not save PIN (${e?.message ?? String(err)}).` };
  }
}
