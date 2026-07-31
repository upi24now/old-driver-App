---
name: Authentication V3 architecture
description: Auth V3 context split, bug fixes, bridge pattern, and V3 screen routing decisions
---

# Authentication V3 — Durable Architecture Notes

## What Changed
Auth state machine moved out of DriverContext into a new `contexts/AuthV3Context.tsx`.
DriverContext delegates via `useAuthV3()` and exposes identical interface through `useDriver()`.

## Bug Fix #1 — Stale sessionKeyRef
**Rule:** In V3, `onAuthStateChanged` calls `AsyncStorage.getItem(SESSION_VERIFIED_KEY)` FRESH on every invocation.  
**Why:** The old code stored a mount-time promise in `sessionKeyRef.current`. After `signOut()` removes the key, the stale promise resolved to the old UID → false `sessionValid=true` on re-login in the same session.  
**How to apply:** Never snapshot AsyncStorage reads into a useRef at mount time for auth state validation.

## Bug Fix #2 — React-state flash guard race
**Rule:** The OTP/login in-flight guard is a synchronous `useRef` (`isVerifyingRef`), NOT a useState. It is set BEFORE `signInWithCustomToken` as the first operation in `beginVerify()`.  
**Why:** Firebase fires `onAuthStateChanged(null → user)` synchronously during `signInWithCustomToken`. If the guard is only a React state (`isOtpVerifying`), React may not have flushed it before the callback fires → _layout.tsx routes to /login mid-login.  
**How to apply:** Any future guard that must block an async Firebase callback must use a useRef, not a useState.

## Session Restore Bridge
`utils/auth-v3-bridge.ts` holds a module-level `_handler` pointer.
- AuthV3Context calls `callV3SessionRestoreHandler(uid, phone)` when sessionValid=true.
- DriverContext registers the profile-hydration + navigation callback via `registerV3SessionRestoreHandler(fn)` in its mount effect.
- This avoids circular context dependency: AuthV3Provider wraps DriverProvider.

## Auth State Methods (AuthV3Context)
- `beginVerify()` — sync ref + queues isOtpVerifying=true; called BEFORE signInWithCustomToken
- `endVerifySuccess(uid, phone)` — atomically sets isOtpVerified=true + clears guard + sets uid/phone
- `endVerifyFailure()` — clears guard + isOtpVerifying
- `setPinSetupIdentity(uid, phone)` — sets uid/phone without releasing guard (PIN setup path)
- `clearAuth()` — full reset including isVerifyingRef; called from signOut

## Screen Routing (V3)
- Login: `/login-v3` — phone entry, pushes to `/verify-otp-v3?phone=+91XXXXXXXXXX`
- OTP verify: `/verify-otp-v3` — reads phone from URL param, calls `confirmOtpV2Direct(token, phone, sessionId)`
- `_layout.tsx` initialRouteName = "login-v3"
- Unauthenticated routes to `/login-v3` (not `/login` or `/login-v2`)
- SESSION_REPLACED handler → `/login-v3`

## V2 Compat Shims Kept
- `utils/auth-v2-api.ts` — re-exports sendOtpV2/setPinV2; used by create-pin-v2.tsx, forgot-pin-v2.tsx
- `utils/auth-v2-store.ts` — module-level store for phone/token/sessionId; used by V2 forgot/create-pin screens

## Safety Timeout
Moved to AuthV3Context (8s `setTimeout(() => setAuthLoading(false), 8000)`). DriverContext no longer has its own auth-loading timeout.

## FCM Registration
DriverContext has a `useEffect(() => { if (driverUid) registerDriverPushToken(driverUid) }, [driverUid])` to catch fresh logins where the AuthV3Context onAuthStateChanged was suppressed by isVerifyingRef.
