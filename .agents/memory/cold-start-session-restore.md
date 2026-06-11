---
name: Cold-start session restore navigation
description: How to correctly restore an OTP-verified session after app kill + cold restart, avoiding flash of login screen.
---

## The rule

When restoring a Firebase Auth session on cold start (app killed + reopened):
1. Restore `isOtpVerified=true` from AsyncStorage
2. Keep `authLoading=true` during Firestore hydration
3. Call `router.replace(nextRoute)` **first**
4. Only then call `setAuthLoading(false)`

**Why:** Expo Stack always starts at `initialRouteName="login"` on cold restart. The routing effect in `_layout.tsx` only routes TO login (when isOtpVerified=false). It has no navigation for the "session valid" path — that navigation must happen explicitly. If `setAuthLoading(false)` is called before navigation, the overlay disappears and the login screen is visible until the async navigation fires (flash of wrong screen).

## How to apply

In `onAuthStateChanged`, after checking AsyncStorage (`sessionValid=true`):
- Do NOT call `setAuthLoading(false)` yet
- Fetch driver doc (race against 3.5s timeout to stay under 5s safety timeout)
- Call `deriveNextRoute(driverDoc)` → get correct screen
- `router.replace(nextRoute as never)` → navigate
- `setAuthLoading(false)` → overlay disappears onto the correct screen

For the non-restore path (no storedUid / mismatch): call `setAuthLoading(false)` immediately after the AsyncStorage check, same as before.

## Background vs kill distinction

- **Background resume**: React state is preserved in memory (`isOtpVerified` stays true), no re-mount, no routing needed. Works fine without any fix.
- **Kill + cold restart**: Full fresh start, React state resets, Stack re-initializes at `initialRouteName="login"`. Requires explicit navigation on restore.

## Storage key

`@bike_courier/session_verified_uid` (defined as `SESSION_VERIFIED_KEY` in DriverContext.tsx)

Written: after `setIsOtpVerified(true)` in `confirmOtp()`  
Cleared: before `firebaseSignOut()` in `signOut()`
