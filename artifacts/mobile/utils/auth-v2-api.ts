/**
 * auth-v2-api.ts
 * V2 authentication API helpers — isolated from DriverContext.
 *
 * Re-exports sendOtp / verifyOtpApi / verifyPinApi from auth-api.ts unchanged.
 * Adds setPinV2 which accepts an explicit idToken instead of reading Firebase
 * state, so create-pin-v2 can call it immediately after signInWithCustomToken
 * without relying on React state.
 */

export { sendOtp    as sendOtpV2    } from "@/utils/auth-api";
export { verifyOtpApi as verifyOtpV2  } from "@/utils/auth-api";
export { verifyPinApi as verifyPinV2  } from "@/utils/auth-api";

// ── Domain ────────────────────────────────────────────────────────────────────
const _rawDomain   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const _cleanDomain = _rawDomain
  .replace(/^https?:\/\//i, "")
  .replace(/\/api\/?$/, "")
  .replace(/\/$/, "");
// V2 base — set-pin lives at POST /api/v2/auth/set-pin.
const BASE_URL_V2 = _cleanDomain ? `https://${_cleanDomain}/api/v2` : "/api/v2";

// ── Types ─────────────────────────────────────────────────────────────────────
export type SetPinV2Result =
  | { ok: true;  sessionId?: string }
  | { ok: false; error: string };

// ── setPinV2 ──────────────────────────────────────────────────────────────────
/**
 * POST /api/v2/auth/set-pin using an explicitly provided Firebase ID token.
 * Does NOT read from firebaseAuth.currentUser — caller supplies the token
 * obtained immediately after signInWithCustomToken.
 */
export async function setPinV2(
  pin:       string,
  idToken:   string,
  sessionId: string | null,
): Promise<SetPinV2Result> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${idToken}`,
  };
  if (sessionId) headers["x-session-id"] = sessionId;

  console.log("[V2_SAVE_PIN] POST /v2/auth/set-pin | sessionId:", sessionId ? "present" : "ABSENT");
  try {
    const res  = await fetch(`${BASE_URL_V2}/auth/set-pin`, {
      method: "POST",
      headers,
      body:   JSON.stringify({ pin }),
    });
    const json = (await res.json()) as {
      ok?: boolean; sessionId?: string; customSessionId?: string; error?: unknown;
    };
    const newSid = json.sessionId ?? json.customSessionId;
    if (!res.ok || json.ok === false) {
      const err = typeof json.error === "string" ? json.error : `Server error (${res.status})`;
      console.error("[V2_SAVE_PIN] failed:", res.status, err);
      return { ok: false, error: err };
    }
    console.log("[V2_SAVE_PIN] OK | newSessionId:", newSid ? "present" : "absent");
    return { ok: true, sessionId: newSid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[V2_SAVE_PIN] fetch threw:", msg);
    return { ok: false, error: `Network error: ${msg}` };
  }
}
