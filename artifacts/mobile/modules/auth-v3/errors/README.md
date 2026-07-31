# Compartment 9 — Error Handler

## Purpose
Convert raw thrown values and API error strings into typed, user-safe
`AuthV3Error` objects. Emit structured diagnostic logs. Provide stable
machine-readable error codes that UI can switch on.

## Public Interface
```ts
type AuthV3Error = { code: ErrorCode; userMessage: string; diagnostic: string }
type ErrorCode   = "INVALID_PIN" | "INVALID_OTP" | "FIREBASE_ERROR" | …

const ERR = { INVALID_PIN, INVALID_OTP, PIN_LOCKED, OTP_EXPIRED,
              FIREBASE_ERROR, API_ERROR, NETWORK_ERROR, STORAGE_ERROR,
              SESSION_EXPIRED, SESSION_CORRUPT, VALIDATION_ERROR,
              INVALID_PHONE, SIGNUP_DATA_MISSING, UNKNOWN }

mapError(raw: unknown, context: string): AuthV3Error
mapApiError(apiError: string, context: string): AuthV3Error
makeError(code, userMessage, diagnostic?): AuthV3Error
logOp(compartment, operation, outcome, error?): void
logDiagnostic(error: AuthV3Error): void   // legacy alias
```

## Inputs
- Raw `unknown` thrown values from try/catch blocks.
- Plain error strings from API `{ ok: false, error: string }` results.
- Known error codes from `ERR` for pre-validation errors.

## Outputs
- `AuthV3Error` objects with a stable code, user message, and diagnostic.
- Console log lines (dev only) — never in production builds.

## Dependencies
- Config (C10) — none currently; ready to add if needed.

## MUST NOT
- Log secrets, tokens, UIDs, phone numbers, PIN digits, or any PII.
- Perform network calls, storage reads, or Firebase operations.
- Navigate or display UI.
- Throw exceptions.

## Known assumptions
- `__DEV__` global is available (React Native / Expo convention).
- Error codes are stable across releases. Remove no code without a
  deprecation cycle — UI code may switch on codes to show custom flows.
- `diagnostic` strings must be sanitised by the caller before passing in.
  Never pass `flow.phone`, `pin`, or token values as part of `context`.
