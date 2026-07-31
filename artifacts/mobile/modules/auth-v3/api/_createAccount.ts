/**
 * Internal — API: Create Driver Account
 * Do not import this file directly. Use modules/auth-v3/api (index.ts).
 */

import { ensureDriverSignup } from "@/utils/profile-api";
import { mapError, logOp, ERR } from "../errors";
import { okVoid, fail, AuthV3VoidResult, AuthV3Error } from "../types";

export type CreateAccountParams = {
  phone:          string;
  name:           string;
  city:           string;
  gender:         string;
  vehicleId:      string;
  vehicleName:    string;
  licenseNumber?: string;
  vehicleNumber?: string;
};

export async function apiCreateAccount(
  params: CreateAccountParams,
): Promise<AuthV3VoidResult> {
  try {
    await ensureDriverSignup(params);
    logOp("api", "createAccount", "success");
    return okVoid();
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "api.createAccount"), code: ERR.API_ERROR };
    logOp("api", "createAccount", "error", error);
    return fail(error);
  }
}
