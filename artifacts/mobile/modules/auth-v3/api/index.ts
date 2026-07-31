/**
 * COMPARTMENT 5 — API Layer  (Public Contract)
 *
 * Single responsibility: communicate with the backend.
 * This file is the ONLY file other compartments may import from this
 * directory. Internal implementation files (_sendOtp.ts etc.) are private.
 *
 * Rules:
 *   ✓ May import from: Config, Errors, Types
 *   ✓ May import underlying network utilities (auth-api, profile-api)
 *   ✗ No UI, no navigation, no storage, no Firebase
 *
 * All functions return AuthV3Result / AuthV3VoidResult — never throw.
 *
 * Replaceability: swap backend endpoints by changing the internal _*.ts files.
 *   Callers depend on this contract only.
 * Debugging scope: API call returns wrong data or fails unexpectedly → this
 *   file and the relevant _*.ts implementation.
 */

export { apiSendOtp }       from "./_sendOtp";
export { apiVerifyOtp }     from "./_verifyOtp";
export { apiVerifyPin }     from "./_verifyPin";
export { apiSetPin }        from "./_setPin";
export { apiCreateAccount } from "./_createAccount";

export type { SendOtpData }        from "./_sendOtp";
export type { VerifyOtpData }      from "./_verifyOtp";
export type { VerifyPinData }      from "./_verifyPin";
export type { CreateAccountParams } from "./_createAccount";

// Re-export vehicle catalogue so callers don't need to import Config directly.
export { VEHICLES, type VehicleId } from "../config";
