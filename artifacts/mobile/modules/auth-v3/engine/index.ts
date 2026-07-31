/**
 * COMPARTMENT 2 — Authentication Engine
 *
 * Single responsibility: orchestrate all authentication operations.
 * This is the only compartment that combines API + Firebase + Session +
 * Validation to produce a typed authentication result.
 *
 * Rules:
 *   ✓ May import from: Config, Validation, Errors, API (C5), Firebase (C6),
 *     Session (C3)
 *   ✗ No UI, no React, no navigation
 *   ✗ Never throws — all results are typed discriminated unions
 *
 * Replaceability: swap the auth strategy (e.g. add biometrics, change PIN to
 *   password) by changing only this file and the screens that call it.
 * Debugging scope: if login succeeds but session is not saved, or OTP flow
 *   completes incorrectly, or account creation fails → this file.
 */

import { validatePin, validatePhone } from "../validation";
import { mapError, makeError, logDiagnostic, AuthV3Error, ERR } from "../errors";
import { apiVerifyPin, apiSendOtp, apiVerifyOtp, apiSetPin, apiCreateAccount, ApiSignupParams } from "../api";
import { firebaseSignIn, firebaseSignOut }  from "../firebase";
import { sessionSave, sessionClear, sessionRestore, V3Session } from "../session";

// ─── Result types ─────────────────────────────────────────────────────────────

export type EngineResult<T = Record<string, never>> =
  | ({ ok: true  } & T)
  | { ok: false; error: AuthV3Error };

export type LoginResult     = EngineResult<{ session: V3Session }>;
export type SendOtpResult   = EngineResult<{ otpId: string }>;
export type VerifyOtpResult = EngineResult<{ token: string; sessionId: string | null }>;
export type SetPinResult    = EngineResult;
export type FinishAuthResult = EngineResult<{ session: V3Session }>;

// Re-export session type so screens don't import from session compartment directly
export type { V3Session };

// ─── Engine operations ────────────────────────────────────────────────────────

/**
 * Daily login: verify PIN → sign in with Firebase → save session.
 * Used by: PinScreen
 */
export async function engineLogin(
  phone: string,
  pin:   string,
): Promise<LoginResult> {
  const phoneCheck = validatePhone(phone);
  if (!phoneCheck.valid) {
    return { ok: false, error: makeError(ERR.INVALID_PIN, phoneCheck.message) };
  }

  const pinCheck = validatePin(pin);
  if (!pinCheck.valid) {
    return { ok: false, error: makeError(ERR.INVALID_PIN, pinCheck.message) };
  }

  const pinResult = await apiVerifyPin(phone, pin);
  if (!pinResult.ok) return { ok: false, error: pinResult.error };

  const fbResult = await firebaseSignIn(pinResult.token);
  if (!fbResult.ok) return { ok: false, error: fbResult.error };

  await sessionSave(fbResult.uid, phone);
  return { ok: true, session: { uid: fbResult.uid, phone } };
}

/**
 * Send an OTP to the given phone number.
 * Used by: SignupFormScreen, ForgotPinScreen
 */
export async function engineSendOtp(phone: string): Promise<SendOtpResult> {
  const result = await apiSendOtp(phone);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, otpId: result.otpId };
}

/**
 * Verify a 6-digit OTP and return the backend token + sessionId.
 * Caller must store these in FlowContext for use by engineFinishAuth().
 * Used by: OtpScreen
 */
export async function engineVerifyOtp(
  phone: string,
  otp:   string,
): Promise<VerifyOtpResult> {
  const result = await apiVerifyOtp(phone, otp);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, token: result.token, sessionId: result.sessionId };
}

/**
 * Complete the forgot-PIN or signup flow:
 *   1. Sign in with the OTP-issued custom token
 *   2. Save the new PIN via the backend
 *   3. (signup only) Create the driver account
 *   4. Persist the session
 *
 * Used by: ConfirmPinScreen
 */
export async function engineFinishAuth(params: {
  verifyToken:     string;
  verifySessionId: string | null;
  pin:             string;
  phone:           string;
  /** Provide for signup flow; omit for forgot-PIN flow. */
  signupData?:     Omit<ApiSignupParams, "phone">;
}): Promise<FinishAuthResult> {
  const { verifyToken, verifySessionId, pin, phone, signupData } = params;

  // Step 1 — Firebase sign-in with the OTP-issued token
  const fbResult = await firebaseSignIn(verifyToken);
  if (!fbResult.ok) return { ok: false, error: fbResult.error };

  // Step 2 — Save the new PIN
  const pinResult = await apiSetPin(pin, fbResult.idToken, verifySessionId);
  if (!pinResult.ok) return { ok: false, error: pinResult.error };

  // Step 3 — Create account (signup flow only)
  if (signupData) {
    const accountResult = await apiCreateAccount({ phone, ...signupData });
    if (!accountResult.ok) return { ok: false, error: accountResult.error };
  }

  // Step 4 — Persist session
  await sessionSave(fbResult.uid, phone);
  return { ok: true, session: { uid: fbResult.uid, phone } };
}

/**
 * Log out: sign out of Firebase and clear the stored session.
 * Used by: HomeScreen
 */
export async function engineLogout(): Promise<void> {
  await firebaseSignOut();
  await sessionClear();
}

/**
 * Attempt to restore a previously saved session on app launch.
 * Returns the session if valid, null if not found or expired.
 * Used by: WelcomeScreen
 */
export async function engineRestoreSession(): Promise<V3Session | null> {
  try {
    return await sessionRestore();
  } catch (raw) {
    const err = mapError(raw, "engine.restoreSession");
    logDiagnostic(err);
    return null;
  }
}
