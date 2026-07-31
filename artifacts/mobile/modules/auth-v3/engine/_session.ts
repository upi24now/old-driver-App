/**
 * Internal — Engine: Session Restore + Logout
 * Do not import this file directly. Use modules/auth-v3/engine (index.ts).
 */

import { sessionRestore, sessionClear, V3Session } from "../session";
import { firebaseSignOut }                          from "../firebase";
import { logOp }                                    from "../errors";
import { ok, okVoid, AuthV3Result, AuthV3VoidResult } from "../types";

export async function engineRestoreSession(): Promise<AuthV3Result<V3Session | null>> {
  const result = await sessionRestore();
  if (!result.success) {
    logOp("engine", "restoreSession", "error", result.error);
    return result;
  }
  logOp("engine", "restoreSession", "success");
  return ok(result.data);
}

export async function engineLogout(): Promise<AuthV3VoidResult> {
  // Firebase sign-out is best-effort: always clear local session afterward.
  await firebaseSignOut();
  const result = await sessionClear();
  if (!result.success) {
    logOp("engine", "logout", "error", result.error);
    return result;
  }
  logOp("engine", "logout", "success");
  return okVoid();
}
