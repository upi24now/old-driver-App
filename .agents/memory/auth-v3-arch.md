---
name: Authentication V3 architecture
description: PIN-first auth design, single-screen multi-step approach, stale-closure fix pattern
---

# Authentication V3 — Durable Architecture Notes

## Core Rule
Daily login = Mobile Number + PIN. OTP is ONLY for: (1) New signup, (2) Forgot PIN. OTP is NEVER used for normal/returning driver login.

## Single-Screen Multi-Step Pattern
**Why:** `_layout.tsx` exempts only `/login-v3` from the global auth guard. Adding new screens (e.g. `/enter-pin-v3`) would require touching `_layout.tsx` (B2 file, off-limits). Solution: all auth steps live inside `app/login-v3.tsx` as a step-based state machine with sub-view components. No new routes needed.

**How:** `step: AuthStep` state drives a `switch` that renders different sub-components. `flow: FlowState` carries cross-step data (phone, pin, otp, signup fields, verify token).

## B2 Isolation Rule
Do NOT touch: `DriverContext.tsx`, `_layout.tsx`, `auth-api.ts`, session architecture. These are B2 files. Integration only after V3 is fully tested and approved.

## Files
- `app/login-v3.tsx` — complete multi-step auth flow (Phases 1–10)
- `utils/auth-v3-api.ts` — API layer: v3SendOtp, v3VerifyOtp, v3VerifyPin, v3SetPin, v3CreateDriverAccount
- `contexts/AuthV3Context.tsx` — auth state machine (unchanged from Task #5 merge)
- `utils/auth-v3-bridge.ts` — promise-buffered session restore bridge (unchanged)

## Auth Flows

### Existing Driver (daily login)
`PHONE_ENTRY` → `PIN_ENTRY` → `verifyPinApi` → `signInWithCustomToken` → `finishAuth`

### New Driver (signup)
`PHONE_ENTRY` → `SIGNUP_FORM` → `SIGNUP_OTP` (sendOtp) → `SIGNUP_NEW_PIN` → `SIGNUP_CONFIRM` → `signInWithCustomToken` + `setPinWithToken` + `ensureDriverSignup` → `finishAuth`

### Forgot PIN
`PIN_ENTRY` → `FORGOT_PHONE` → `FORGOT_OTP` (sendOtp) → `FORGOT_NEW_PIN` → `FORGOT_CONFIRM` → `signInWithCustomToken` + `setPinWithToken` → `finishAuth`

## finishAuth sequence (shared by all flows)
1. `setSessionId(sessionId)` — prime module-level cache
2. `AsyncStorage.setItem(SESSION_KEY, uid)` — persist session
3. `authV3.endVerifySuccess(uid, phone)` — sets isOtpVerified=true (marks sessionAlreadyRestoredRef=true, prevents duplicate onAuthStateChanged restore)
4. `callV3SessionRestoreHandler(uid, phone)` — bridge to DriverContext for profile hydration + navigation
5. Fallback: `router.replace("/(tabs)")` if bridge throws

## Stale-Closure Fix for Auto-Submit
**Rule:** When auto-submitting on 6th digit in onDigit callback, NEVER call `handler()` with no args — the closure captures old `flow.pin`. Always compute next value locally and pass it as a parameter.

**Pattern:**
```typescript
onDigit={(d) => {
  const next = (flow.pin + d).slice(0, PIN_LENGTH);
  setFlow((f) => ({ ...f, pin: next }));
  if (next.length === PIN_LENGTH) setTimeout(() => handlePinLogin(next), 80);
}}
```
Handler signature: `handlePinLogin(pinOverride?: string)` — uses `pinOverride ?? flow.pin`.

## Vehicles
From vehicle-selection.tsx: two_wheeler, loader_three_wheeler, tata_ace, mini_truck, mahindra_pickup, tata_407, canter. Referenced in auth-v3-api.ts as V3_VEHICLES.

## AuthV3Context interface (must maintain for DriverContext compat)
`beginVerify()`, `endVerifySuccess(uid, phone)`, `endVerifyFailure()`, `setPinSetupIdentity(uid, phone)`, `clearAuth()`, `setPhone(p)`. These are called by DriverContext via the bridge.
