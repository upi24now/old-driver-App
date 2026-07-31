/**
 * Internal — API: Send OTP
 * Do not import this file directly. Use modules/auth-v3/api (index.ts).
 */

import { sendOtp } from "@/utils/auth-api";
import { mapApiError, mapError, logOp, ERR } from "../errors";
import { ok, fail, AuthV3Result, AuthV3Error } from "../types";

export type SendOtpData = { otpId: string };

export async function apiSendOtp(phone: string): Promise<AuthV3Result<SendOtpData>> {
  try {
    const r = await sendOtp(phone);
    if (!r.ok) {
      const error: AuthV3Error = { ...mapApiError(r.error, "api.sendOtp"), code: ERR.API_ERROR };
      logOp("api", "sendOtp", "error", error);
      return fail(error);
    }
    logOp("api", "sendOtp", "success");
    return ok({ otpId: r.otpId ?? "" });
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "api.sendOtp"), code: ERR.API_ERROR };
    logOp("api", "sendOtp", "error", error);
    return fail(error);
  }
}
