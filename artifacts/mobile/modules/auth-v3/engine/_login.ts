/**
 * Internal — Engine: Daily Login
 * Do not import this file directly. Use modules/auth-v3/engine (index.ts).
 *
 * Flow: validatePhone + validatePin → apiVerifyPin → firebaseSignIn → sessionSave
 */

import { apiVerifyPin }             from "../api";
import { firebaseSignIn }           from "../firebase";
import { sessionSave, V3Session }   from "../session";
import { validatePin, validatePhone } from "../validation";
import { makeError, logOp, ERR }    from "../errors";
import { ok, fail, AuthV3Result }   from "../types";

export async function engineLogin(
  phone: string,
  pin:   string,
): Promise<AuthV3Result<V3Session>> {
  const phoneCheck = validatePhone(phone);
  if (!phoneCheck.valid) {
    return fail(makeError(ERR.INVALID_PHONE, phoneCheck.message, "engine.login: invalid phone"));
  }

  const pinCheck = validatePin(pin);
  if (!pinCheck.valid) {
    return fail(makeError(ERR.INVALID_PIN, pinCheck.message, "engine.login: invalid pin format"));
  }

  const pinResult = await apiVerifyPin(phone, pin);
  if (!pinResult.success) return pinResult; // propagate as-is

  const fbResult = await firebaseSignIn(pinResult.data.token);
  if (!fbResult.success) return fbResult;

  const saveResult = await sessionSave(fbResult.data.uid, phone);
  if (!saveResult.success) {
    logOp("engine", "login", "error", saveResult.error);
    return saveResult;
  }
  logOp("engine", "login", "success");
  return ok({ uid: fbResult.data.uid, phone });
}
