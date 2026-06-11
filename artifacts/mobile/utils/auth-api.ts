const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// Log base URL once at module load so it's visible immediately in the console
console.log("[auth-api] BASE_URL =", BASE_URL || "(empty — EXPO_PUBLIC_DOMAIN not set, relative /api)");

export type SendOtpResult =
  | { ok: true;  devOtp?: string }
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

  if (!DOMAIN) {
    console.warn(
      "[sendOtp] WARNING: EXPO_PUBLIC_DOMAIN is not set. " +
      "BASE_URL is a relative path (\"/api\") which only works in a browser/web context. " +
      "On a real Android/iOS device this will fail with a network error. " +
      "Set EXPO_PUBLIC_DOMAIN to your Replit dev domain (e.g. abc123.repl.co)."
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
             (DOMAIN ? "Check your network." : "EXPO_PUBLIC_DOMAIN is not configured — contact support."),
    };
  }

  console.log("[sendOtp] response status :", res.status, res.statusText);

  let json: { sent?: boolean; devOtp?: string; error?: string };
  try {
    json = (await res.json()) as typeof json;
    console.log("[sendOtp] response body  :", JSON.stringify(json));
  } catch (parseErr) {
    const e = parseErr as Error;
    console.error("[sendOtp] failed to parse response JSON:", e?.message);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}).` };
  }

  if (!res.ok) {
    console.error("[sendOtp] server returned error:", res.status, json.error);
    return { ok: false, error: json.error ?? `Server error (${res.status}).` };
  }

  console.log("[sendOtp] SUCCESS — devOtp present:", !!json.devOtp);
  return { ok: true, devOtp: json.devOtp };
}

export async function verifyOtpApi(phone: string, otp: string): Promise<VerifyOtpResult> {
  const url = `${BASE_URL}/auth/verify-otp`;
  const body = JSON.stringify({ phone, otp });
  const headers = { "Content-Type": "application/json" };

  console.log("[verifyOtp] ──────────────────────────────────────");
  console.log("[verifyOtp] URL     :", url);
  console.log("[verifyOtp] method  : POST");
  console.log("[verifyOtp] body    :", body);

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
    console.log("[verifyOtp] response body  :", JSON.stringify(json));
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
