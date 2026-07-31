/**
 * COMPARTMENT 2 — Authentication Engine  (Public Contract)
 *
 * Single responsibility: orchestrate all authentication operations.
 * This file is the ONLY file other compartments may import from this
 * directory. Internal implementation files (_login.ts etc.) are private.
 *
 * Rules:
 *   ✓ May import from: Config, Validation, Errors, Types, API (C5),
 *     Firebase (C6), Session (C3)
 *   ✗ No UI, no React, no navigation
 *   ✗ Never throws — all results are AuthV3Result / AuthV3VoidResult
 *
 * Replaceability: change the auth strategy (biometrics, password, etc.) by
 *   modifying internal _*.ts files without changing the public contract here.
 * Debugging scope: login succeeds but session not saved, wrong flow branching,
 *   account creation fails → this compartment's internal files.
 */

export { engineLogin }          from "./_login";
export { engineSendOtp,
         engineVerifyOtp }      from "./_otp";
export { engineFinishAuth }     from "./_signup";
export { engineRestoreSession,
         engineLogout }         from "./_session";

export type { FinishAuthParams } from "./_signup";
export type { OtpVerifyData }   from "./_otp";

// Re-export the session type so screens don't reach into the Session compartment.
export type { V3Session } from "../session";
