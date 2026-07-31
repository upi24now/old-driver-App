# Compartment 7 — Validation Layer

## Purpose
Validate user inputs before they reach the Engine or API.
All logic is pure and synchronous — no I/O, no side effects.

## Public Interface
```ts
type ValidationResult = { valid: true } | { valid: false; message: string }

validatePin(pin: string): ValidationResult
validatePhoneDigits(digits: string): ValidationResult  // raw digits, no prefix
validatePhone(phone: string): ValidationResult          // full E.164 e.g. +91XXXXXXXXXX
validateOtp(otp: string): ValidationResult
pinsMatch(pin: string, confirm: string): ValidationResult
```

## Inputs
Raw string values from UI form fields.

## Outputs
`ValidationResult` — either `{ valid: true }` or `{ valid: false; message }`.
The `message` is safe to display directly to the user.

## Dependencies
- Config (C10) — for PIN_LENGTH, OTP_LENGTH, PHONE_DIGITS

## MUST NOT
- Make API calls.
- Import from Firebase, Storage, Session, or Engine.
- Contain async operations.
- Display UI.

## Known assumptions
- Phone numbers are 10 digits for the +91 prefix. Multi-country support
  requires extending `validatePhone` with a configurable digit count.
- PIN must be exactly 6 digits. No complexity rules are enforced here —
  add them here if business rules change, not in the Engine.
