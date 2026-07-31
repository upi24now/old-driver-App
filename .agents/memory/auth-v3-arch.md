---
name: Authentication V3 architecture
description: Multi-screen PIN-first auth design; one screen = one responsibility; independent from B2
---

# Authentication V3 — Durable Architecture Notes

## Core Rules
1. **One screen = one responsibility** — each auth step is its own file under `app/auth-v3/`
2. **Completely independent from B2** — zero imports from DriverContext, AuthV3Context, auth-v3-bridge, or B2 navigation
3. **V3 is a mini-app** — its own Stack navigator, its own session, its own API layer
4. **OTP rule** — OTP is ONLY used for (1) new signup, (2) forgot PIN. Never for normal login.
5. **No migration yet** — V3's "Home" is a placeholder; B2 integration happens in a future phase

## Guard Exemption (minimal `_layout.tsx` touch)
Added `pathname.startsWith("/auth-v3")` to the existing V3 exemption block (lines ~169-182 in `_layout.tsx`). This is routing config, not a B2 dependency. Without it, B2's guard (which checks `driverUid`) would redirect every V3 screen back to `/login-v3`.

## Entry Point
`app/login-v3.tsx` is now a thin `<Redirect href="/auth-v3/welcome" />`. B2's guard still redirects unauthenticated users to `/login-v3`, which immediately hands off to the V3 stack.

## File Structure
```
app/auth-v3/
  _layout.tsx       — V3 Stack navigator (headerShown: false)
  welcome.tsx       — Session restore check + Login/Create Account
  login.tsx         — Phone number entry → navigates to pin.tsx
  pin.tsx           — PIN entry → verify + sign in → home
  signup-form.tsx   — New driver details → send OTP → otp.tsx?intent=signup
  otp.tsx           — OTP entry (signup or forgot) → verify → create-pin.tsx?intent=...
  create-pin.tsx    — Choose new 6-digit PIN → confirm-pin.tsx?intent=...
  confirm-pin.tsx   — Confirm PIN → (signup) create account + sign in → home
                                  → (forgot) set PIN + sign in → home
  forgot-pin.tsx    — Forgot PIN phone entry → send OTP → otp.tsx?intent=forgot
  home.tsx          — V3 placeholder home (shows UID + phone + logout)

components/auth-v3/
  NumPad.tsx        — 3×4 numpad (1-9, blank, 0, ⌫)
  PinDots.tsx       — 6 filled/empty dots (supports error state = red)

utils/
  auth-v3-store.ts  — Module-level in-memory store for inter-screen state
                      (phone, otpId, verifyToken, verifySessionId, createdPin, signup)
  auth-v3-session.ts — AsyncStorage session: saveV3Session, getV3Session,
                       clearV3Session, checkV3Session (validates against Firebase)
  auth-v3-api.ts    — API wrappers (unchanged): v3VerifyPin, v3SendOtp, v3VerifyOtp,
                      v3SetPin, v3CreateDriverAccount
```

## State-Passing Pattern
- **v3Store** (module-level) holds transient flow state (tokens, signup data, created PIN)
- **URL param `intent`** carries `"signup" | "forgot"` through otp → create-pin → confirm-pin
- **v3Store.setPhone()** called by login.tsx, signup-form.tsx, forgot-pin.tsx before navigating forward

## Auth Flows

### Existing Driver (daily login)
`welcome.tsx` → `login.tsx` → `pin.tsx` → `signInWithCustomToken` → `saveV3Session` → `home.tsx`

### New Driver (signup)
`welcome.tsx` → `signup-form.tsx` → (sendOtp) → `otp.tsx?intent=signup` → `create-pin.tsx?intent=signup` → `confirm-pin.tsx?intent=signup` → `signInWithCustomToken` + `v3SetPin` + `v3CreateDriverAccount` → `saveV3Session` → `home.tsx`

### Forgot PIN
`pin.tsx` → `forgot-pin.tsx` → (sendOtp) → `otp.tsx?intent=forgot` → `create-pin.tsx?intent=forgot` → `confirm-pin.tsx?intent=forgot` → `signInWithCustomToken` + `v3SetPin` → `saveV3Session` → `home.tsx`

### Session Restore (Phase 11)
`welcome.tsx` mounts → `checkV3Session()` → if AsyncStorage session AND Firebase user UID match → `router.replace("/auth-v3/home")`

## Stale-Closure Fix for Auto-Submit
PIN auto-submit (6th digit): compute `next = pin + d` locally, pass as parameter to handler:
```typescript
onDigit={(d) => {
  const next = pin + d;
  setPin(next);
  if (next.length === PIN_LENGTH) setTimeout(() => handleLogin(next), 80);
}}
```
Handler signature: `handleLogin(completedPin: string)` — uses the parameter, never reads `pin` state.

## Colour Constants (all V3 screens)
```
primary: #FF6B00  pressed: #E55A00  bg: #FFFFFF  pageBg: #F5F4F2
text: #111111     sub: #374151      muted: #6B7280  border: #E5E7EB
error: #DC2626    success: #059669
```

## V3 Home is a Placeholder
`home.tsx` shows UID + phone + logout button. During the future B2 migration phase,
successful auth will navigate to `/(tabs)` (B2's real driver home) instead.
Firebase `signInWithCustomToken` already fires DriverContext's `onAuthStateChanged`
so `driverUid` will be set automatically — the guard will allow `/(tabs)` navigation
after migration without any additional changes.
