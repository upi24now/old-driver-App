/**
 * Internal — API: Set PIN
 * Do not import this file directly. Use modules/auth-v3/api (index.ts).
 */

import { setPinWithToken } from "@/utils/auth-api";
import { mapApiError, mapError, logOp, ERR } from "../errors";
import { okVoid, fail, AuthV3VoidResult, AuthV3Error } from "../types";

export async function apiSetPin(
  pin:       string,
  idToken:   string,
  sessionId: string | null,
): Promise<AuthV3VoidResult> {
  try {
    const r = await setPinWithToken(pin, idToken, sessionId ?? undefined);
    if (!r.ok) {
      const error: AuthV3Error = { ...mapApiError(r.error, "api.setPin"), code: ERR.API_ERROR };
      logOp("api", "setPin", "error", error);
      return fail(error);
    }
    logOp("api", "setPin", "success");
    return okVoid();
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "api.setPin"), code: ERR.API_ERROR };
    logOp("api", "setPin", "error", error);
    return fail(error);
  }
}
