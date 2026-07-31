/**
 * Internal — API: Verify OTP
 * Do not import this file directly. Use modules/auth-v3/api (index.ts).
 */

import { verifyOtpApi } from "@/utils/auth-api";
import { mapApiError, mapError, logOp, ERR } from "../errors";
import { ok, fail, AuthV3Result, AuthV3Error } from "../types";

export type VerifyOtpData = { token: string; sessionId: string | null };

export async function apiVerifyOtp(
  phone: string,
  otp:   string,
): Promise<AuthV3Result<VerifyOtpData>> {
  try {
    const r = await verifyOtpApi(phone, otp);
    if (!r.ok) {
      const mapped = mapApiError(r.error, "api.verifyOtp");
      const error: AuthV3Error = { ...mapped, code: mapped.code === "UNKNOWN" ? ERR.INVALID_OTP : mapped.code };
      logOp("api", "verifyOtp", "error", error);
      return fail(error);
    }
    logOp("api", "verifyOtp", "success");
    return ok({ token: r.token, sessionId: r.sessionId ?? null });
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "api.verifyOtp"), code: ERR.API_ERROR };
    logOp("api", "verifyOtp", "error", error);
    return fail(error);
  }
}
