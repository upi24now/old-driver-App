import { firebaseAuth } from "@/utils/firebase";
import { getSessionIdSync } from "@/utils/session";

const _rawDomain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
// Strip any accidental protocol prefix or trailing /api so we never produce
// https://https://... or .../api/api regardless of how the env var is set.
const _cleanDomain = _rawDomain
  .replace(/^https?:\/\//i, "")   // remove leading protocol
  .replace(/\/api\/?$/, "")        // remove trailing /api
  .replace(/\/$/, "");             // remove trailing slash

// V1 base — used by set-pin (unchanged path) and verifyPinApi (graceful 404 fallback).
const BASE_URL    = _cleanDomain ? `https://${_cleanDomain}/api`    : "/api";
// V2 base — used by all new auth endpoints (send-otp → otp/send, verify-otp → otp/verify).
const BASE_URL_V2 = _cleanDomain ? `https://${_cleanDomain}/api/v2` : "/api/v2";

// Log both the raw env var and the constructed URLs on module load
console.log("[auth-api] EXPO_PUBLIC_DOMAIN (raw)  =", _rawDomain || "(not set)");
console.log("[auth-api] BASE_URL (v1, constructed) =", BASE_URL);
console.log("[auth-api] BASE_URL_V2 (constructed)  =", BASE_URL_V2);

// ─── otp_id session — module-level ────────────────────────────────────────────
// sendOtp stores the otp_id returned by POST /auth/otp/send.
// verifyOtpApi reads it when building the /auth/otp/verify request body.
// This avoids changing the confirmOtp(phone, otp) signature in DriverContext.
// Cleared on successful verification or on a fresh sendOtp call.
let _pendingOtpId: string | null = null;

// ─── Error normaliser ─────────────────────────────────────────────────────────
// Guarantees the returned value is always a plain string so callers never
// accidentally pass an object to a React <Text> child (which throws
// "Objects are not valid as a React child").
function normalizeError(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (v !== null && v !== undefined && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["message"] === "string") return o["message"];
    if (typeof o["error"]   === "string") return o["error"];
    try { return JSON.stringify(v); } catch { return fallback; }
  }
  return fallback;
}

export type SendOtpResult =
  | { ok: true;  otpId: string }
  | { ok: false; error: string };

export type VerifyOtpResult =
  | { ok: true;  token: string; sessionId?: string }
  | { ok: false; error: string };

export type VerifyPinResult =
  | { ok: true;  token: string; sessionId?: string }
  | { ok: false; error: string; pinNotFound?: boolean };

/**
 * POST /api/v2/auth/otp/send — request an OTP for the given phone number.
 *
 * Backend V2 contract:
 *   Request  : { phone, user_type: "driver" }
 *   Response : { otp_id: string, ... }
 *
 * The returned otp_id is stored in module state and automatically consumed
 * by verifyOtpApi on the next call — no signature change needed in callers.
 */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  // Reset any stale pending otp_id from a previous attempt.
  _pendingOtpId = null;

  const url  = `${BASE_URL_V2}/auth/otp/send`;
  const body = JSON.stringify({ phone, user_type: "driver" });
  const headers = { "Content-Type": "application/json" };

  console.log("[sendOtp] ──────────────────────────────────────");
  console.log("[sendOtp] URL     :", url);
  console.log("[sendOtp] method  : POST");
  console.log("[sendOtp] headers :", JSON.stringify(headers));
  console.log("[sendOtp] body    :", body);

  if (!_cleanDomain) {
    console.warn(
      "[sendOtp] WARNING: EXPO_PUBLIC_DOMAIN is not set. " +
      "BASE_URL_V2 is a relative path (\"/api/v2\") which only works in a browser/web context. " +
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

  let json: { otp_id?: string; sent?: boolean; error?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[sendOtp] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    const errMsg = normalizeError(json.error, `Server error (${res.status}).`);
    console.error("[sendOtp] server returned error:", res.status, errMsg);
    return { ok: false, error: errMsg };
  }

  // Log the full response so the exact field names are visible in dev logs.
  console.log("[sendOtp] FULL response body:", JSON.stringify(json));

  // Accept whichever field name the backend uses for the OTP session ID.
  // snake_case (otp_id) is the primary convention; camelCase and plain "id"
  // are tried as fallbacks so the app works across backend versions.
  const raw = json as Record<string, unknown>;
  const otpId =
    typeof raw["otp_id"]    === "string" ? (raw["otp_id"]    as string) :
    typeof raw["id"]        === "string" ? (raw["id"]        as string) :
    typeof raw["otpId"]     === "string" ? (raw["otpId"]     as string) :
    typeof raw["otp_token"] === "string" ? (raw["otp_token"] as string) :
    "";

  if (!otpId) {
    console.warn(
      "[sendOtp] WARNING: could not find otp_id in response — tried otp_id / id / otpId / otp_token.",
      "Verify step will proceed without otp_id; backend must support phone-only OTP matching.",
    );
  }

  // Store for verifyOtpApi to consume.
  _pendingOtpId = otpId || null;

  console.log("[sendOtp] SUCCESS — otp_id:", otpId ? `received (${otpId.slice(0, 8)}…)` : "MISSING");
  return { ok: true, otpId };
}

/**
 * POST /api/v2/auth/otp/verify — verify the OTP received by the driver.
 *
 * Backend V2 contract:
 *   Request  : { otp_id, phone, otp, user_type: "driver" }
 *   Response : { token/customToken: string, sessionId?: string }
 *
 * otp_id is read from module state written by the preceding sendOtp call.
 * Signature is intentionally unchanged (phone, otp) so DriverContext.confirmOtp
 * requires no modification.
 */
export async function verifyOtpApi(phone: string, otp: string): Promise<VerifyOtpResult> {
  const url  = `${BASE_URL_V2}/auth/otp/verify`;

  // Build the request body. otp_id is included only when it is non-empty —
  // sending otp_id:"" (empty string) causes backends that index OTPs by ID
  // to throw a catch-all error ("An unexpected error occurred"). If otp_id is
  // absent the backend must fall back to phone-based OTP matching.
  const verifyPayload: Record<string, string> = { phone, otp, user_type: "driver" };
  if (_pendingOtpId) verifyPayload["otp_id"] = _pendingOtpId;

  const body    = JSON.stringify(verifyPayload);
  const headers = { "Content-Type": "application/json" };

  console.log("[verifyOtp] ──────────────────────────────────────");
  console.log("[verifyOtp] URL      :", url);
  console.log("[verifyOtp] method   : POST");
  console.log("[verifyOtp] otp_id   :", _pendingOtpId ? `present (${_pendingOtpId.slice(0, 8)}…)` : "ABSENT — will be omitted from request");
  console.log("[verifyOtp] request body:", body);

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

  let json: { token?: string; customToken?: string; sessionId?: string; error?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[verifyOtp] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  console.log(
    "[verifyOtp] RAW response keys:", Object.keys(json).join(","),
    "| token:", json.token ? "present" : "absent",
    "| customToken:", json.customToken ? "present" : "absent",
    "| sessionId:", json.sessionId ? "present" : "absent",
  );

  if (!res.ok) {
    const errMsg = normalizeError(json.error, `Server error (${res.status}).`);
    console.error("[verifyOtp] server returned error:", res.status, errMsg);
    return { ok: false, error: errMsg };
  }

  // The backend returns the Firebase token as `customToken`; some builds use `token`.
  // Accept either so the success contract is stable.
  const token = json.token ?? json.customToken ?? (json as any).firebase_custom_token;
  if (!token) {
    console.error("[verifyOtp] no token in successful response");
    return { ok: false, error: "No token received from server." };
  }

  // Clear the pending otp_id — it has been consumed successfully.
  _pendingOtpId = null;

  console.log("[verifyOtp] SUCCESS — token received");
  return { ok: true, token, sessionId: json.sessionId };
}

/**
 * POST /api/v2/auth/verify-pin — daily login factor: phone + 6-digit PIN.
 *
 * Backend V2 schema: { phone: string, user_type: "driver", pin: string }
 * Response success:  { token/customToken: string, sessionId?: string }
 * Response 404:      driver has no PIN — app falls back to OTP setup flow.
 * Server enforces a 3-attempt / 24h lockout.
 */
export async function verifyPinApi(phone: string, pin: string): Promise<VerifyPinResult> {
  const url  = `${BASE_URL}/v2/auth/verify-pin`;
  // user_type is required by the V2 VerifyPinSchema.
  // Omitting it causes HTTP 422 Validation Error.
  const body = JSON.stringify({ phone, user_type: "driver", pin });
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
      serverMsg = ((await res.json()) as { error?: unknown })?.error as string | undefined;
      if (typeof serverMsg !== "string") serverMsg = undefined;
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

  let json: { token?: string; customToken?: string; sessionId?: string; error?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[verifyPin] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    const errMsg = normalizeError(json.error, `Server error (${res.status}).`);
    console.error("[verifyPin] server returned error:", res.status, errMsg);
    return { ok: false, error: errMsg };
  }
  // The backend returns the Firebase token as `customToken`; some older builds
  // returned it as `token`. Accept either so the success contract is stable.
  const token = json.token ?? json.customToken ?? (json as any).firebase_custom_token;
  if (!token) {
    console.error("[verifyPin] no token in successful response");
    return { ok: false, error: "No token received from server." };
  }

  console.log("[verifyPin] SUCCESS — token received");
  return { ok: true, token, sessionId: json.sessionId };
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

  console.log("[setPin] POST /auth/set-pin — Authorization:", "present", "| x-session-id:", sessionId ? "present (" + sessionId.slice(0, 8) + "…)" : "ABSENT");

  try {
    const res = await fetch(`${BASE_URL}/auth/set-pin`, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ pin }),
    });
    // Response shape varies across backend builds: some return { ok, sessionId },
    // others { sessionId } or { customSessionId }. Read tolerantly and key
    // success off the HTTP status, not a specific `ok` field.
    const json = (await res.json()) as {
      ok?: boolean;
      sessionId?: string;
      customSessionId?: string;
      error?: unknown;
    };
    const newSessionId = json.sessionId ?? json.customSessionId;
    console.log("[setPin] response status:", res.status, "| body keys:", Object.keys(json).join(","), "| sessionId:", newSessionId ? "present" : "ABSENT");

    // Treat a non-2xx status OR an explicit { ok:false } (some backends return
    // 200 with a semantic failure) as an error. A missing `ok` field is fine —
    // not every build sends one — so only `=== false` counts as failure.
    if (!res.ok || json.ok === false) {
      const errMsg = normalizeError(json.error, `Server error (${res.status}).`);
      console.error("[setPin] server returned error:", res.status, errMsg);
      return { ok: false, error: errMsg };
    }
    return { ok: true, sessionId: newSessionId };
  } catch (err) {
    const e = err as Error;
    console.error("[setPin] fetch THREW:", e?.message);
    return { ok: false, error: `Could not save PIN (${e?.message ?? String(err)}).` };
  }
}
