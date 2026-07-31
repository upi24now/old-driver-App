/**
 * COMPARTMENT — Shared Types
 *
 * Defines the single result contract used by every public function across
 * the auth-v3 module. Having one contract here means:
 *
 *   - Every caller knows exactly what to check (result.success).
 *   - No function ever throws to its caller.
 *   - No function ever returns null, undefined, or a boolean flag.
 *
 * Dependencies: Errors (for AuthV3Error type only).
 */

import type { AuthV3Error } from "../errors";
export type { AuthV3Error };

// ─── Core result types ────────────────────────────────────────────────────────

/**
 * Result for operations that return data on success.
 *
 * Usage:
 *   const r = await apiVerifyPin(phone, pin);
 *   if (!r.success) { show(r.error.userMessage); return; }
 *   use(r.data.token);
 */
export type AuthV3Result<T> =
  | { success: true;  data: T }
  | { success: false; error: AuthV3Error };

/**
 * Result for operations that succeed/fail without returning data.
 *
 * Usage:
 *   const r = await sessionClear();
 *   if (!r.success) logDiagnostic(r.error);
 */
export type AuthV3VoidResult =
  | { success: true }
  | { success: false; error: AuthV3Error };

// ─── Factory helpers ──────────────────────────────────────────────────────────
// Use these inside compartment implementations for concise, consistent returns.

/** Produce a successful data result. */
export function ok<T>(data: T): AuthV3Result<T> {
  return { success: true, data };
}

/** Produce a successful void result. */
export function okVoid(): AuthV3VoidResult {
  return { success: true };
}

/** Produce a failure result (works for both data and void result types). */
export function fail(error: AuthV3Error): { success: false; error: AuthV3Error } {
  return { success: false, error };
}
