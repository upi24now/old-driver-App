import { firebaseAuth } from "@/utils/firebase";
import { getSessionIdSync } from "@/utils/session";

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
  | { ok: true;  token: string; sessionId?: string }
  | { ok: false; error: string };

export type VerifyPinResult =
  | { ok: true;  token: string; sessionId?: string }
  | { ok: false; error: string; pinNotFound?: boolean };

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

  let json: { token?: string; sessionId?: string; error?: string };
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
  return { ok: true, token: json.token, sessionId: json.sessionId };
}

/**
 * POST /auth/verify-pin — daily login factor: phone + 6-digit PIN.
 *
 * Mirrors verify-otp's success contract (returns a Firebase custom token plus
 * the minted single-device sessionId), but uses no Firebase session — the
 * driver is signing in fresh. Server enforces a 3-attempt / 24h lockout.
 */
export async function verifyPinApi(phone: string, pin: string): Promise<VerifyPinResult> {
  const url = `${BASE_URL}/auth/verify-pin`;
  const body = JSON.stringify({ phone, pin });
  const headers = { "Content-Type": "application/json" };

  console.log("[verifyPin] ──────────────────────────────────────");
  console.log("[verifyPin] URL     :", url);
  console.log("[verifyPin] method  : POST");

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error("[verifyPin] fetch THREW ─────────────────────────");
    console.error("[verifyPin]   error.message:", e?.message);
    return {
      ok:    false,
      error: `Could not connect to server (${e?.message ?? String(err)}).`,
    };
  }

  console.log("[verifyPin] response status :", res.status, res.statusText);

  // A 404 from verify-pin means this account has no login PIN set yet — OR the
  // backend it reached lacks the verify-pin route entirely (e.g. an older API
  // bundle that answers with a non-JSON "Cannot POST /…" HTML body). In BOTH
  // cases the correct, safe behavior is identical: route the driver into
  // first-time OTP + PIN setup. We therefore treat ANY 404 as pinNotFound
  // WITHOUT requiring a parseable JSON body, so a non-JSON 404 can never
  // dead-end the login screen with an "unexpected response" error. (No
  // anonymous PIN-existence lookup is made — the verify-pin response alone
  // drives the UI.)
  if (res.status === 404) {
    let serverMsg: string | undefined;
    try {
      serverMsg = ((await res.json()) as { error?: string })?.error;
    } catch {
      // Non-JSON 404 body (e.g. an Express "Cannot POST" HTML page) — ignore.
    }
    console.error("[verifyPin] 404 — no PIN set / route absent; falling back to OTP");
    return {
      ok:          false,
      pinNotFound: true,
      error:       serverMsg ?? "No PIN set for this account.",
    };
  }

  let json: { token?: string; sessionId?: string; error?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[verifyPin] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    console.error("[verifyPin] server returned error:", res.status, json.error);
    return { ok: false, error: json.error ?? `Server error (${res.status}).` };
  }
  if (!json.token) {
    console.error("[verifyPin] no token in successful response");
    return { ok: false, error: "No token received from server." };
  }

  console.log("[verifyPin] SUCCESS — token received");
  return { ok: true, token: json.token, sessionId: json.sessionId };
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

export type SetPinResult =
  | { ok: true;  sessionId?: string }
  | { ok: false; error: string };

/**
 * POST /auth/set-pin — store the driver's 6-digit PIN (server hashes it).
 * Requires a valid Firebase session from the just-completed OTP login.
 */
export async function setPin(pin: string): Promise<SetPinResult> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "Not signed in." };

  // Single-device login: set-pin runs through require-auth, which 401s
  // SESSION_REPLACED unless the request echoes the active session id. The global
  // fetch interceptor (utils/api-client.ts) normally injects this, but set-pin
  // fires the instant after OTP — before the interceptor/cache are guaranteed to
  // be in lockstep — so attach it explicitly here. If absent, set-pin would 401,
  // the PIN would never persist, and every later PIN login would 404 "No PIN set".
  const sessionId = getSessionIdSync();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };
  if (sessionId) headers["x-session-id"] = sessionId;

  try {
    const res = await fetch(`${BASE_URL}/auth/set-pin`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ pin }),
    });
    const json = (await res.json()) as { ok?: boolean; sessionId?: string; error?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Server error (${res.status}).` };
    }
    return { ok: true, sessionId: json.sessionId };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: `Could not save PIN (${e?.message ?? String(err)}).` };
  }
}
