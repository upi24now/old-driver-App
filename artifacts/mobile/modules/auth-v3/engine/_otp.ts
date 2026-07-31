/**
 * Internal — Engine: OTP Operations
 * Do not import this file directly. Use modules/auth-v3/engine (index.ts).
 *
 * Sends and verifies one-time passwords. Used by both the signup and
 * forgot-PIN flows.
 */

import { apiSendOtp, apiVerifyOtp } from "../api";
import { logOp }                    from "../errors";
import { ok, AuthV3Result }         from "../types";

export type OtpVerifyData = { token: string; sessionId: string | null };

export async function engineSendOtp(
  phone: string,
): Promise<AuthV3Result<{ otpId: string }>> {
  const result = await apiSendOtp(phone);
  if (!result.success) return result;
  logOp("engine", "sendOtp", "success");
  return ok(result.data);
}

export async function engineVerifyOtp(
  phone: string,
  otp:   string,
): Promise<AuthV3Result<OtpVerifyData>> {
  const result = await apiVerifyOtp(phone, otp);
  if (!result.success) return result;
  logOp("engine", "verifyOtp", "success");
  return ok(result.data);
}
