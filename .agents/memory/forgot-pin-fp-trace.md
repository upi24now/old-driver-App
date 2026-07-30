---
name: Forgot-PIN FP_TRACE runtime investigation
description: Comprehensive [FP_TRACE] log instrumentation added to trace the forgot-PIN flow; how to read the output.
---

# [FP_TRACE] runtime tracing — forgot-PIN investigation

## What was added (commit 1798072, pushed to bike-Driver-app-1 main)
All logs are tagged `[FP_TRACE]` for easy grep/filter.

| Tag | File | What it proves |
|-----|------|----------------|
| `[FP_TRACE][LAYOUT_RENDER #N]` | _layout.tsx | Every render of RootLayoutNav with full state snapshot |
| `[FP_TRACE][LAYOUT_EFFECT #N] BRANCH →` | _layout.tsx | Exact branch the useEffect took (isOtpVerifying guard / driverUid check / isOtpVerified check / /login redirect) |
| `[FP_TRACE][SIGN_IN_FOR_SESSION]` | DriverContext.tsx | Step-by-step inside signInForSession: setIsOtpVerifying queued, ref set, signInWithCustomToken called/resolved, setDriverUid queued |
| `[FP_TRACE][ON_AUTH_STATE_CHANGED]` | DriverContext.tsx | Guard hit/not-hit with timestamp |
| `[FP_TRACE][HANDLE_VERIFY]` | login.tsx | Entry, confirmOtp call/return, router.replace call + post-call confirmation |
| `[FP_TRACE][CREATE_PIN_MOUNTED]` | create-pin.tsx | Proves screen was rendered; if ABSENT after OTP success → navigation never committed |

## How to read the logs during forgot-PIN flow
1. Look for `[FP_TRACE][HANDLE_VERIFY] FORGOT BRANCH — calling router.replace("/create-pin?intent=reset")`
   - If ABSENT: `router.replace` was never reached (check confirmOtp result)
   - If PRESENT: navigation was attempted

2. After that line, look for `[FP_TRACE][CREATE_PIN_MOUNTED]`
   - If ABSENT: the navigation was overwritten by _layout.tsx before create-pin rendered

3. Look for `[FP_TRACE][LAYOUT_EFFECT #N] BRANCH → /login (driverUid=SET but isOtpVerified=false, isOtpVerifying=false)`
   - If present: THIS is the killer line. Note the render #N and compare to when SIGN_IN_FOR_SESSION called setIsOtpVerifying(true).

## Critical question the logs will answer
If `isOtpVerifying=false` in a LAYOUT_EFFECT where `driverUid=SET` and `isOtpVerified=false`, then:
- Check SIGN_IN_FOR_SESSION: was setIsOtpVerifying(true) called before setDriverUid?
- Check if they were batched in the same render or separate renders
- The render #N on LAYOUT_RENDER and LAYOUT_EFFECT timestamps tell us exactly when each state update committed

**Why:** setIsOtpVerifying(true) and setDriverUid(uid) are called in sequence inside an async function. If React commits them in separate batches, there's a window where driverUid=uid + isOtpVerifying=false → _layout.tsx routes to /login.
