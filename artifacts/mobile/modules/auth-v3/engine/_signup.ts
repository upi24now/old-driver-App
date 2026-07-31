/**
 * Internal — Engine: Finish Authentication (Signup + Forgot-PIN)
 * Do not import this file directly. Use modules/auth-v3/engine (index.ts).
 *
 * Completes either the signup or forgot-PIN flow:
 *   1. Sign in with the OTP-issued custom token
 *   2. Save the new PIN via the backend
 *   3. (signup only) Create the driver account
 *   4. Persist the session
 */

import { apiSetPin, apiCreateAccount, type CreateAccountParams } from "../api";
import { firebaseSignIn, firebaseSignOut } from "../firebase";
import { sessionSave, V3Session }          from "../session";
import { logOp }                    from "../errors";
import { ok, fail, AuthV3Result }   from "../types";

export type FinishAuthParams = {
  verifyToken:     string;
  verifySessionId: string | null;
  pin:             string;
  phone:           string;
  /** Provide for signup; omit for forgot-PIN. */
  signupData?:     Omit<CreateAccountParams, "phone">;
};

export async function engineFinishAuth(
  params: FinishAuthParams,
): Promise<AuthV3Result<V3Session>> {
  const { verifyToken, verifySessionId, pin, phone, signupData } = params;

  // Step 1 — Firebase sign-in with the OTP-issued token
  const fbResult = await firebaseSignIn(verifyToken);
  if (!fbResult.success) return fbResult;

  // Step 2 — Save the new PIN
  const pinResult = await apiSetPin(pin, fbResult.data.idToken, verifySessionId);
  if (!pinResult.success) return pinResult;

  // Step 3 — Create account (signup path only)
  if (signupData) {
    const accountResult = await apiCreateAccount({ phone, ...signupData });
    if (!accountResult.success) {
      // Firebase is signed in (step 1 complete) but account creation failed.
      // Sign out locally so the driver can retry signup from a clean state.
      await firebaseSignOut();
      return accountResult;
    }
  }

  // Step 4 — Persist session
  const saveResult = await sessionSave(fbResult.data.uid, phone);
  if (!saveResult.success) {
    logOp("engine", "finishAuth", "error", saveResult.error);
    return saveResult;
  }
  logOp("engine", "finishAuth", "success");
  return ok({ uid: fbResult.data.uid, phone });
}
