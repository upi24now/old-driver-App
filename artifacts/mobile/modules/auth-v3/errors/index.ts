/**
 * COMPARTMENT 9 — Error Handler
 *
 * Single responsibility: map raw thrown values into typed, user-safe errors;
 * emit safe structured diagnostics; provide user-facing messages.
 *
 * Rules:
 *   ✓ May import from: Config
 *   ✗ No authentication logic, no API calls, no navigation, no storage
 *   ✗ NEVER logs secrets, tokens, UIDs, phone numbers, or PII
 *
 * Replaceability: swap the mapping rules, logging destination, or user
 *   messages without touching any other compartment.
 * Debugging scope: if an error message is wrong, missing, or a code is
 *   unrecognised → this file.
 */

// ─── Error type ───────────────────────────────────────────────────────────────

export type AuthV3Error = {
  /** Stable machine-readable code. UI reacts to codes, not messages. */
  code:        ErrorCode;
  /** Safe user-facing message — no internal details, no PII. */
  userMessage: string;
  /** Sanitised diagnostic — NO tokens, NO PII. Dev logs only. */
  diagnostic:  string;
};

// ─── Stable error codes ───────────────────────────────────────────────────────
//
// Add new codes here; never remove existing ones (external code may depend
// on a code to show a specific UI or decide a recovery path).

export const ERR = {
  // Input validation
  VALIDATION_ERROR:  "VALIDATION_ERROR",
  INVALID_PIN:       "INVALID_PIN",
  INVALID_OTP:       "INVALID_OTP",
  INVALID_PHONE:     "INVALID_PHONE",

  // Authentication
  PIN_LOCKED:        "PIN_LOCKED",
  OTP_EXPIRED:       "OTP_EXPIRED",
  SIGNUP_DATA_MISSING: "SIGNUP_DATA_MISSING",

  // Infrastructure
  FIREBASE_ERROR:    "FIREBASE_ERROR",
  API_ERROR:         "API_ERROR",
  NETWORK_ERROR:     "NETWORK_ERROR",
  STORAGE_ERROR:     "STORAGE_ERROR",

  // Session
  SESSION_EXPIRED:   "SESSION_EXPIRED",
  SESSION_CORRUPT:   "SESSION_CORRUPT",

  // Catch-all
  UNKNOWN:           "UNKNOWN",
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

// ─── Pattern-based message table ──────────────────────────────────────────────

type Mapping = { pattern: RegExp; code: ErrorCode; userMessage: string };

const MAPPINGS: Mapping[] = [
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
    code: ERR.NETWORK_ERROR,
    userMessage: "Connection problem. Please check your internet and try again.",
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert any thrown or returned error value into a typed AuthV3Error.
 * The `context` string describes which operation failed — for diagnostics only.
 * Never put tokens, UIDs, phone numbers, or PII into `context`.
 */
export function mapError(raw: unknown, context: string): AuthV3Error {
  const message = raw instanceof Error ? raw.message : String(raw ?? "unknown error");

  for (const { pattern, code, userMessage } of MAPPINGS) {
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
 * Map a plain string from an API { ok: false, error: string } result into
 * a typed AuthV3Error.
 */
export function mapApiError(apiError: string, context: string): AuthV3Error {
  return mapError(new Error(apiError), context);
}

/**
 * Build an AuthV3Error from a known code and user message.
 * Use for pre-validation errors that don't come from a thrown exception.
 */
export function makeError(
  code:        ErrorCode,
  userMessage: string,
  diagnostic?: string,
): AuthV3Error {
  return { code, userMessage, diagnostic: diagnostic ?? userMessage };
}

// ─── Observability ────────────────────────────────────────────────────────────

type Outcome = "success" | "error";

/**
 * Emit a structured diagnostic event.
 *
 * Format: [auth-v3][compartment.operation] outcome — diagnostic
 *
 * NEVER include tokens, UIDs, phone numbers, PIN digits, or any PII.
 * Only log the operation name and the sanitised diagnostic from AuthV3Error.
 */
export function logOp(
  compartment: string,
  operation:   string,
  outcome:     Outcome,
  error?:      AuthV3Error,
): void {
  if (!__DEV__) return;

  const prefix = `[auth-v3][${compartment}.${operation}]`;
  if (outcome === "success") {
    console.log(`${prefix} ✓`);
  } else if (error) {
    console.warn(`${prefix} ✗ ${error.code} — ${error.diagnostic}`);
  } else {
    console.warn(`${prefix} ✗`);
  }
}

/**
 * Legacy alias — kept for backward compat with existing call sites.
 * Prefer logOp() in new code.
 */
export function logDiagnostic(error: AuthV3Error): void {
  if (__DEV__) {
    console.warn(`[auth-v3][${error.code}] ${error.diagnostic}`);
  }
}
