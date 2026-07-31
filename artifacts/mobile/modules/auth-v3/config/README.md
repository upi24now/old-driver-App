# Compartment 10 — Configuration

## Purpose
Single source of truth for every constant, limit, timeout, palette colour,
and vehicle catalogue used across the auth-v3 module.

## Public Interface
```ts
PIN_LENGTH         = 6
OTP_LENGTH         = 6
PHONE_DIGITS       = 10
PHONE_PREFIX       = "+91"
SESSION_KEY        = "@v3/auth/session"
OTP_RESEND_COOLDOWN_MS = 30_000
COLORS             = { primary, bg, text, error, … }
VEHICLES           = [{ id, name }, …]
type VehicleId
```

## Inputs
None. Pure constant exports.

## Outputs
Constants and type aliases.

## Dependencies
None. This is the root compartment — it imports nothing from auth-v3.

## MUST NOT
- Import from any other auth-v3 compartment.
- Contain any logic, functions, or async operations.
- Store runtime state.

## Known assumptions
- `PHONE_PREFIX` is `+91` (India). If multi-country support is added, this
  must become an enum or a runtime value passed from a higher layer.
- `VEHICLES` is a static list. A dynamic list requires an API call — that
  belongs in the API compartment, not here.
