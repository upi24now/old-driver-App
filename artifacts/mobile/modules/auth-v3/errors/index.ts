/**
 * COMPARTMENT 9 — Error Handler
 *
 * Single responsibility: map raw thrown values into typed, user-safe errors;
 * log safe diagnostics; provide user-facing messages.
 *
 * Rules:
 *   ✓ May import from: Config
 *   ✗ No authentication logic, no API calls, no navigation, no storage
 *   ✗ Never logs secrets, tokens, or PII
 *
 * Replaceability: swap the error-mapping or logging strategy here without
 *   touching any screen or business-logic compartment.
 * Debugging scope: if an error message is wrong or missing → this file.
 */

// ─── Error type ───────────────────────────────────────────────────────────────

export type AuthV3Error = {
  /** Machine-readable code for programmatic handling. */
  code:        string;
  /** Message safe to show to the end user. */
  userMessage: string;
  /** Sanitised diagnostic string — NO tokens, NO PII. For dev logs only. */
  diagnostic:  string;
};

// ─── Known codes ──────────────────────────────────────────────────────────────

export const ERR = {
  INVALID_PIN:       "INVALID_PIN",
  PIN_LOCKED:        "PIN_LOCKED",
  INVALID_OTP:       "INVALID_OTP",
  OTP_EXPIRED:       "OTP_EXPIRED",
  FIREBASE_FAIL:     "FIREBASE_FAIL",
  NETWORK:           "NETWORK",
  SESSION_CORRUPT:   "SESSION_CORRUPT",
  SIGNUP_DATA_MISSING: "SIGNUP_DATA_MISSING",
  UNKNOWN:           "UNKNOWN",
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

// ─── Mapping helpers ──────────────────────────────────────────────────────────

const SERVER_MESSAGE_PATTERNS: Array<{ pattern: RegExp; code: ErrorCode; userMessage: string }> = [
  {
    pattern: /locked|too many attempt/i,
    code: ERR.PIN_LOCKED,
    userMessage: "Too many incorrect attempts. Please try again later.",
  },
  {
    pattern: /invalid.*pin|wrong.*pin|incorrect.*pin|pin.*invalid|pin.*incorrect/i,
    code: ERR.INVALID_PIN,
    userMessage: "Incorrect PIN. Please try again.",
  },
  {
    pattern: /invalid.*otp|wrong.*otp|otp.*invalid|otp.*incorrect/i,
    code: ERR.INVALID_OTP,
    userMessage: "Incorrect OTP. Please try again.",
  },
  {
    pattern: /expired/i,
    code: ERR.OTP_EXPIRED,
    userMessage: "This OTP has expired. Please request a new one.",
  },
  {
    pattern: /network|fetch|timeout|connect/i,
    code: ERR.NETWORK,
    userMessage: "Connection problem. Please check your internet and try again.",
  },
];

/**
 * Convert any thrown or returned error value into a typed AuthV3Error.
 * The `context` string describes which operation failed (for diagnostics only).
 */
export function mapError(raw: unknown, context: string): AuthV3Error {
  const message = raw instanceof Error ? raw.message : String(raw ?? "unknown error");

  for (const { pattern, code, userMessage } of SERVER_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return { code, userMessage, diagnostic: `[${context}] ${message}` };
    }
  }

  return {
    code:        ERR.UNKNOWN,
    userMessage: "Something went wrong. Please try again.",
    diagnostic:  `[${context}] ${message}`,
  };
}

/**
 * Map a plain string returned from an API { ok: false, error: string } result
 * into a typed AuthV3Error.
 */
export function mapApiError(apiError: string, context: string): AuthV3Error {
  return mapError(new Error(apiError), context);
}

/**
 * Log a diagnostic line to the console.
 * Never logs tokens, UIDs, phone numbers, or any sensitive value.
 */
export function logDiagnostic(error: AuthV3Error): void {
  if (__DEV__) {
    console.warn(`[auth-v3][${error.code}] ${error.diagnostic}`);
  }
}

/**
 * Build a one-off AuthV3Error from a known code and user message.
 * Use for pre-validation errors that don't come from a thrown exception.
 */
export function makeError(
  code: ErrorCode,
  userMessage: string,
  diagnostic?: string,
): AuthV3Error {
  return { code, userMessage, diagnostic: diagnostic ?? userMessage };
}
