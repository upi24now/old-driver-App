---
name: Forgot-PIN → _layout.tsx race condition
description: onAuthStateChanged race that caused forgot-PIN flow to route to /login instead of /create-pin
---

# Root cause
`onAuthStateChanged` called `setDriverUid(user.uid)` synchronously — BEFORE the
`pinSetupInProgressRef` guard (which was only inside the async IIFE).

This triggered a `_layout.tsx` re-render. If React hadn't yet committed
`isOtpVerifying=true` (queued before the `await signInWithCustomToken` in
`signInForSession`, but potentially not flushed before the Firebase callback fired),
`_layout.tsx` saw:
```
driverUid=uid  isOtpVerified=false  isOtpVerifying=false
```
→ routed to `/login`, overriding `router.replace("/create-pin?intent=reset")`.

**Why:** `setIsOtpVerifying(true)` is a React state update (async commit).
`setDriverUid(uid)` inside the Firebase callback may land in a different React
batch. The window between "queued" and "committed" is the race.

# Fix (in DriverContext.tsx — `onAuthStateChanged`)
Move `pinSetupInProgressRef.current` check to BEFORE `setDriverUid(user.uid)`.
During `signInForSession`, the callback now returns immediately without setting
`driverUid`. `signInForSession` sets it directly after `signInWithCustomToken`
resolves — at which point `isOtpVerifying=true` IS already committed.

**How to apply:** Any time `onAuthStateChanged` sets React state synchronously
BEFORE an async guard check, there is a potential race with `_layout.tsx`. Guards
that only exist inside async IIFEs are invisible to synchronous state updates.
