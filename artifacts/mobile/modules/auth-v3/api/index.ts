/**
 * COMPARTMENT 5 — API Layer
 *
 * Single responsibility: communicate with the backend.
 * Wraps existing auth-api and profile-api utilities with typed V3 results.
 *
 * Rules:
 *   ✓ May import from: Config, Errors
 *   ✓ May import underlying network utilities (auth-api, profile-api)
 *   ✗ No UI, no navigation, no storage, no Firebase
 *
 * Replaceability: swap the backend endpoints or underlying fetch utilities by
 *   changing only this file. Callers depend on the typed interface.
 * Debugging scope: if an API call returns wrong data or fails unexpectedly → this file.
 */

import {
  sendOtp,
  verifyOtpApi,
  verifyPinApi,
  setPinWithToken,
} from "@/utils/auth-api";
import { ensureDriverSignup } from "@/utils/profile-api";
import { mapApiError, mapError, logDiagnostic, AuthV3Error } from "../errors";
import { VEHICLES, VehicleId } from "../config";

// Re-export for consumers that need the catalogue without importing Config directly
export { VEHICLES, VehicleId };

// ─── Result types ─────────────────────────────────────────────────────────────

export type ApiSendOtpResult =
  | { ok: true;  otpId: string }
  | { ok: false; error: AuthV3Error };

export type ApiVerifyOtpResult =
  | { ok: true;  token: string; sessionId: string | null }
  | { ok: false; error: AuthV3Error };

export type ApiVerifyPinResult =
  | { ok: true;  token: string; sessionId: string | null }
  | { ok: false; error: AuthV3Error };

export type ApiSetPinResult =
  | { ok: true }
  | { ok: false; error: AuthV3Error };

export type ApiCreateAccountResult =
  | { ok: true }
  | { ok: false; error: AuthV3Error };

export type ApiSignupParams = {
  phone:          string;
  name:           string;
  city:           string;
  gender:         string;
  vehicleId:      string;
  vehicleName:    string;
  licenseNumber?: string;
  vehicleNumber?: string;
};

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Send an OTP to the given +91 phone number.
 * Used by: Forgot PIN flow, New Signup flow.
 */
export async function apiSendOtp(phone: string): Promise<ApiSendOtpResult> {
  try {
    const r = await sendOtp(phone);
    if (!r.ok) return { ok: false, error: mapApiError(r.error, "api.sendOtp") };
    return { ok: true, otpId: r.otpId ?? "" };
  } catch (raw) {
    const error = mapError(raw, "api.sendOtp");
    logDiagnostic(error);
    return { ok: false, error };
  }
}

/**
 * Verify a 6-digit OTP code.
 * Returns a custom auth token and session ID on success.
 */
export async function apiVerifyOtp(
  phone: string,
  otp: string,
): Promise<ApiVerifyOtpResult> {
  try {
    const r = await verifyOtpApi(phone, otp);
    if (!r.ok) return { ok: false, error: mapApiError(r.error, "api.verifyOtp") };
    return { ok: true, token: r.token, sessionId: r.sessionId ?? null };
  } catch (raw) {
    const error = mapError(raw, "api.verifyOtp");
    logDiagnostic(error);
    return { ok: false, error };
  }
}

/**
 * Verify a driver PIN — the primary daily login method.
 * Returns a custom auth token and session ID if correct.
 */
export async function apiVerifyPin(
  phone: string,
  pin: string,
): Promise<ApiVerifyPinResult> {
  try {
    const r = await verifyPinApi(phone, pin);
    if (!r.ok) return { ok: false, error: mapApiError(r.error, "api.verifyPin") };
    return { ok: true, token: r.token, sessionId: r.sessionId ?? null };
  } catch (raw) {
    const error = mapError(raw, "api.verifyPin");
    logDiagnostic(error);
    return { ok: false, error };
  }
}

/**
 * Save a new PIN using an ID token and session ID.
 * Called after OTP verification (forgot-PIN and signup paths).
 */
export async function apiSetPin(
  pin:       string,
  idToken:   string,
  sessionId: string | null,
): Promise<ApiSetPinResult> {
  try {
    const r = await setPinWithToken(pin, idToken, sessionId ?? undefined);
    if (!r.ok) return { ok: false, error: mapApiError(r.error, "api.setPin") };
    return { ok: true };
  } catch (raw) {
    const error = mapError(raw, "api.setPin");
    logDiagnostic(error);
    return { ok: false, error };
  }
}

/**
 * Create a new driver account (upsert) after OTP verification.
 */
export async function apiCreateAccount(
  params: ApiSignupParams,
): Promise<ApiCreateAccountResult> {
  try {
    await ensureDriverSignup(params);
    return { ok: true };
  } catch (raw) {
    const error = mapError(raw, "api.createAccount");
    logDiagnostic(error);
    return { ok: false, error };
  }
}
