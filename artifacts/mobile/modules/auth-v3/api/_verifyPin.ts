/**
 * Internal — API: Verify PIN
 * Do not import this file directly. Use modules/auth-v3/api (index.ts).
 */

import { verifyPinApi } from "@/utils/auth-api";
import { mapApiError, mapError, logOp, ERR } from "../errors";
import { ok, fail, AuthV3Result, AuthV3Error } from "../types";

export type VerifyPinData = { token: string; sessionId: string | null };

export async function apiVerifyPin(
  phone: string,
  pin:   string,
): Promise<AuthV3Result<VerifyPinData>> {
  try {
    const r = await verifyPinApi(phone, pin);
    if (!r.ok) {
      const error: AuthV3Error = { ...mapApiError(r.error, "api.verifyPin"), code: ERR.INVALID_PIN };
      logOp("api", "verifyPin", "error", error);
      return fail(error);
    }
    logOp("api", "verifyPin", "success");
    return ok({ token: r.token, sessionId: r.sessionId ?? null });
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "api.verifyPin"), code: ERR.API_ERROR };
    logOp("api", "verifyPin", "error", error);
    return fail(error);
  }
}
