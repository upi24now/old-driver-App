---
name: Auth V2 architecture
description: Brand-new isolated auth flow (login-v2, forgot-pin-v2, verify-otp-v2, create-pin-v2) — why it's structured this way and key constraints.
---

# Auth V2 Architecture

## Why it exists
V1's forgot-PIN flow has a race condition in `signInForSession` where `isOtpVerifying=true` doesn't commit to React state before `onAuthStateChanged` fires, causing `_layout.tsx` guard to redirect to /login. After multiple failed attempts to fix the race, V2 was built as a clean slate.

## Files
- `utils/auth-v2-store.ts` — module-level state (phone, otpId, pendingToken, pendingSessionId). Persists across screen navigations in the same JS session.
- `utils/auth-v2-api.ts` — `setPinV2(pin, idToken, sessionId)` which accepts an explicit ID token instead of reading `firebaseAuth.currentUser`. Also re-exports `sendOtpV2`, `verifyOtpV2`, `verifyPinV2` from auth-api.ts.
- `app/login-v2.tsx` — two phases: "phone" (send OTP) + "pin" (verify via DriverContext.confirmPin)
- `app/forgot-pin-v2.tsx` — phone entry only; navigates to verify-otp-v2?intent=forgot
- `app/verify-otp-v2.tsx` — OTP verify; stores token in AuthV2Store; routes by intent
- `app/create-pin-v2.tsx` — enter+confirm PIN; signInWithCustomToken → setPinV2 → confirmPin

## Key constraint: _layout.tsx whitelist
V2 paths need a guard whitelist in `_layout.tsx` (after `isOtpVerifying` guard) or `signInWithCustomToken` in `create-pin-v2` triggers the `driverUid=SET, isOtpVerified=false` → /login redirect. Added 9-line early-return block for the 4 V2 paths — purely additive, no existing logic changed.

## Final auth step pattern
V2 always terminates with `DriverContext.confirmPin(phone, pin)` which:
1. Calls verifyPinApi → gets fresh token
2. Calls establishSession → sets isOtpVerified=true + driverUid
3. Calls router.replace(nextRoute) internally — NO explicit navigation needed in V2 screens

**Why:** confirmPin is the WORKING path in V1 (only signInForSession is broken). V2 reuses it as the final step.

## Navigation flow
- Login:      login-v2 → verify-otp-v2?intent=login → login-v2?phase=pin → (confirmPin navigates)
- Forgot PIN: login-v2 → forgot-pin-v2 → verify-otp-v2?intent=forgot → create-pin-v2?intent=reset → (confirmPin navigates)
- No PIN:     login-v2?phase=pin (pinNotFound from confirmPin) → create-pin-v2?intent=setup → (confirmPin navigates)

## Logs
[V2_LOGIN] [V2_FORGOT_PIN] [V2_VERIFY_OTP] [V2_CREATE_PIN] [V2_SAVE_PIN] [V2_LOGIN_SUCCESS]

## Testing checklist (required before replacing V1)
✓ Login, ✓ Forgot PIN, ✓ Create PIN, ✓ PIN Save, ✓ Login With New PIN,
✓ Logout, ✓ Session Restore, ✓ App Restart, ✓ Invalid OTP, ✓ Invalid PIN
