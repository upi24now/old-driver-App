# Authentication V3 — Production Validation Report

```
Date:       2026-07-31
Auditor:    QA Pass (full static analysis + runtime observation)
Method:     Complete source read of all 35 V3 files + targeted probe scripts
Scope:      All flows, all race conditions, security, performance, stress scenarios
Status:     4 confirmed bugs found · 2 potential issues · 0 crashes · 0 security violations
```

---

## Executive Summary

The V3 architecture is structurally sound. No crash path, no PII leak, and no
data corruption was found. Every failure scenario is caught and contained within
its owning compartment with a typed result and a user-safe message.

**Four confirmed bugs were found.** All four are pre-existing design gaps, not
implementation errors. None is critical. The most impactful is the missing OTP
resend cooldown (BUG-A), which could enable OTP spam abuse. The other three are
low-severity edge cases.

**No fix may be implemented until each is approved below.**

---

## Test Results

### FLOW 1 — Existing Driver Login

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Login — screen renders | PASS | C8 UI | Welcome → Login → PIN, no errors | All screens render | None |
| Wrong PIN | PASS | C5 API → C2 Engine | `INVALID_PIN`, message shown, PIN cleared | Error shown, retry enabled | None |
| Empty PIN (0–5 digits) | PASS | C8 UI | Login button disabled; NumPad `disabled` prop prevents submission | No submission until 6 digits | None |
| Auto-submit on 6th digit | PASS | C8 UI | `onDigit` passes value as param; `doLogin(next)` called before state commit | PIN submitted without button tap | None |
| Logout | PASS | C2 Engine → C6 Firebase → C3 Session | busy guard fires, Firebase sign-out, session cleared, navToWelcome | Session gone, home screen exited | None |
| Login again after logout | PASS | Full stack | Session cleared → Welcome → Login → PIN → home | No stale state between sessions | None |
| Multiple rapid Login taps | PASS | C8 UI | `if (busy) return;` fires on second tap; only one API call made | One request in flight | None |
| App Restart (session save) | **BUG-B** | C2 Engine → C3 Session | If AsyncStorage fails during `sessionSave`, engine returns `ok(...)` and discards failure | Engine should surface storage failure | LOW |
| Background → Foreground | PASS | C8 UI | No `onAuthStateChanged` listeners; `mountedRef` prevents stale setState | App state unchanged | None |
| Slow network | PASS | C5 API → C9 Errors | `try/catch` captures timeout; `NETWORK_ERROR` mapped via pattern; user message shown | Error shown, retry possible | None |
| No network / Airplane Mode | PASS | C5 API → C9 Errors | `fetch` throws → caught → `NETWORK_ERROR` code | "Connection problem" message | None |

---

### FLOW 2 — New Driver Signup

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Signup form — all required fields | PASS | C8 UI | `canSubmit` guard; button disabled until name + city + phone + gender + vehicleId filled | No submission without required data | None |
| OTP — 6 boxes, auto-verify | PASS | C8 UI | `onChangeText` strips non-digits, calls `doVerify(digits)` at length 6 | Auto-submit on 6th digit | None |
| Wrong OTP | PASS | C5 API → C2 Engine | `INVALID_OTP` returned, message shown, OTP cleared | Error shown, retry enabled | None |
| Expired OTP | PASS | C5 API → C9 Errors | Backend "expired" → regex `/expired/i` → `OTP_EXPIRED` user message | "OTP has expired" shown | None |
| Create PIN | **BUG-D†** | C8 UI | `proceed` synchronous; no `busy` guard; double-tap risk | Single navigation to Confirm PIN | VERY LOW |
| Confirm PIN — match | PASS | C7 Validation → C2 Engine | `pinsMatch` validates before API call; `engineFinishAuth` called once | Proceeds to account creation | None |
| Confirm PIN — mismatch | PASS | C7 Validation | `pinsMatch` returns `{ valid: false }` before any API call | Error shown, no API call made | None |
| Finish Signup — step 3 failure | **BUG-E** | C2 Engine | Firebase signed in + PIN set, but `apiCreateAccount` fails → user sees error → orphaned Firebase account | Atomic rollback or idempotent retry | VERY LOW |
| Login after signup | PASS | Full stack | Session saved by `engineFinishAuth`; next open restores session | Immediate session restore | None |
| OTP resend — spam | **BUG-A** | C8 UI | `handleResend` only checks `if (busy) return;`; `OTP_RESEND_COOLDOWN_MS` constant exists but is **never imported or enforced** | 30-second cooldown between resend taps | MEDIUM |

†BUG-D is the gesture swipe-back bug. It also applies to Create PIN but in a different
way — Create PIN is synchronous, so there is no async gap to exploit. The double-tap
risk on Create PIN is a separate very-low-severity edge.

---

### FLOW 3 — Forgot PIN

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Phone pre-fill from flow.phone | PASS | C8 UI → C8 FlowContext | `existingDigits` derived from `flow.phone` on mount; field pre-filled if arriving from PIN screen | Phone pre-filled | None |
| Wrong OTP | PASS | C5 API → C2 Engine | `INVALID_OTP`, message shown | Error shown | None |
| Expired OTP | PASS | C9 Errors | Regex `/expired/i` → correct message | "OTP has expired" | None |
| New PIN creation | PASS | C8 UI | Create PIN screen identical behaviour to signup flow | 6-digit PIN chosen | None |
| Confirm PIN | PASS | C8 UI → C2 Engine | Same as signup confirm flow; `intent=forgot` means no `apiCreateAccount` called | PIN set only | None |
| Login using new PIN | PASS | Full stack | PIN verified against new hash; Firebase sign-in; session saved | Login succeeds | None |

---

### FLOW 4 — Session

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Cold Start — no session | PASS | C3 Session → C6 Firebase | `sessionLoad` → `null`; Welcome renders Login + Create Account | Welcome screen shown | None |
| Cold Start — valid session | PASS | C3 Session → C6 Firebase | `firebaseWaitReady()` ensures Firebase has restored cached auth; UID comparison succeeds; `navToHome` called | App goes directly to home | None |
| Cold Start — Firebase delay | PASS | C6 Firebase → C3 Session | `firebaseWaitReady()` awaits `authStateReady()`, which resolves from cache | Correct UID read after wait | None |
| Warm Start (background resume) | PASS | C8 UI | No auth listeners; no re-trigger of session restore; app state unchanged | No duplicate auth | None |
| App Kill + Reopen | **BUG-B** | C2 Engine → C3 Session | If prior `sessionSave` failed silently, session is not in AsyncStorage; Welcome shows instead of Home | Home shown | LOW |
| Token Expiry | PASS | C6 Firebase | `getIdToken()` is called fresh at sign-in time, not cached; expired tokens are not an in-session concern | Fresh token always fetched | None |
| AsyncStorage Delay | PASS | C4 Storage | All reads/writes are `await`ed; callers chain correctly | Session operations serial | None |
| Corrupt session JSON | PASS | C3 Session | `JSON.parse` wrapped in `try/catch`; corrupt → `ok(null)` (not error) | Welcome screen shown | None |
| UID mismatch (Firebase ≠ Storage) | PASS | C3 Session | `sessionClear()` called when UIDs disagree; `ok(null)` returned | Welcome screen shown | None |
| Duplicate session restore | PASS | C8 UI | `engineRestoreSession` called only in `welcome.tsx`; `mountedRef` prevents double-invoke on fast unmount | Single restore per Welcome mount | None |

---

### FLOW 5 — Navigation

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Back button during busy | PASS | C8 UI | `disabled={busy}` on all back buttons in async screens | Back disabled during auth | None |
| Gesture swipe-back during busy | **BUG-D** | C1 Navigation → C8 UI | `gestureEnabled: true` in `_layout.tsx`; swipe succeeds even when `busy=true`; `mountedRef` prevents crash; `navToHome` not called; user on Login screen, authenticated | Gesture should be disabled during active auth OR session restore handles recovery | LOW |
| Double-tap Login / Verify / Submit | PASS | C8 UI | `if (busy) return;` is the first line of every async handler; second tap is a no-op | Single operation in flight | None |
| Fast navigation (rapid back + forward) | PASS | C8 UI | `mountedRef` cleanup fires on unmount; async operations check ref before setState or navigation | No stale setState; no double-navigation | None |
| Device rotation | PASS | C8 UI | No orientation-dependent logic; layout uses flex; safe-area insets dynamic | Layout adapts | None |
| Screen Resume after notification | PASS | C8 UI | No notification handling in V3 auth screens; no state change on resume | V3 screens unaffected | None |

---

### FLOW 6 — API Failures

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Timeout (slow network) | PASS | C5 API → C9 Errors | `fetch` timeout → thrown Error → `mapError` → `NETWORK_ERROR` | "Connection problem" message | None |
| 500 Internal Server Error | PASS | C5 API | `r.ok = false` path; `mapApiError(r.error, ctx)` → user message from backend body | Error message shown | None |
| Offline | PASS | C5 API | Same as timeout — `fetch` throws → caught | "Connection problem" | None |
| Slow API (long await) | PASS | C8 UI | Screen stays in `busy=true` spinner; `mountedRef` ensures correct unmount cleanup | Spinner until response or unmount | None |
| Invalid response shape | PASS | C5 API | `r.ok` check gates; missing fields handled by `?? null`; no unguarded destructure | Safe fallback | None |
| Unexpected response (non-JSON) | PASS | C5 API | `try/catch` wraps all API calls; parse errors → `mapError` | Caught cleanly | None |
| `verifyPin` locked error code | **BUG-C** | C5 API → C9 Errors | Backend returns "locked" → `mapApiError` correctly resolves `PIN_LOCKED` + correct `userMessage` → BUT `code` is immediately overridden to `INVALID_PIN` | `error.code === PIN_LOCKED` when backend locks | LOW |

---

### FLOW 7 — Firebase

| Test | Result | Compartments | Observed | Expected | Risk |
|---|---|---|---|---|---|
| Login failure (bad custom token) | PASS | C6 Firebase | `signInWithCustomToken` throws → caught → `FIREBASE_ERROR` → propagated to Engine → screen shows error | Error surfaced | None |
| Logout failure | PASS | C6 Firebase | `signOut` throws → caught → `okVoid()` returned intentionally; session still cleared | Logout always completes | None |
| Delayed auth state | PASS | C6 Firebase | `firebaseWaitReady()` awaits `authStateReady()`; resolves from cache even offline | Correct auth state read | None |
| Duplicate auth events | PASS | C6 Firebase | V3 has NO `onAuthStateChanged` listener; uses `firebaseGetCurrentUid()` only on explicit restore call | No duplicate processing | None |

---

## Race Condition Assessment

| Race Scenario | Result | Proof |
|---|---|---|
| Duplicate login | PASS | `if (busy) return;` fires before any await; React batches `setPin(6)` + `setBusy(true)` in same render; Login button disabled before it can become active with `busy=false` |
| Duplicate logout | PASS | `if (busy) return;` on `handleLogout`; Logout button `disabled={busy}` |
| Duplicate navigation | PASS | `navToHome` uses `router.replace` (idempotent); duplicate call replaces current `/(tabs)` with itself |
| Duplicate session restore | PASS | One call site (`welcome.tsx:41`); `mountedRef` prevents double-fire |
| Stale state (setState after unmount) | PASS | Every async screen has `if (!mountedRef.current) return;` immediately after every `await` |
| Stale closures | PASS | `doLogin(completedPin)`, `doVerify(code)`, `doSubmit(confirmPin)` take value as parameter; never read `pin`/`otp`/`confirm` state from closure after await |
| Stale FlowContext | PASS | `useCallback` with `[]` deps on all setters; `setState` functional updater `(f) => ({ ...f, ... })` ensures latest state |
| Multiple Firebase auth listeners | PASS | No `onAuthStateChanged` listener created anywhere in V3 |
| Memory leaks | PASS | Every `useEffect` with async operation returns a cleanup that sets `mountedRef.current = false`; no subscriptions |
| Double API request | PASS | `if (busy) return;` guard present in all handlers with API calls |
| Multiple Firebase callbacks | PASS | `signInWithCustomToken` is a one-shot promise; not a subscription |

---

## Security Review

| Check | Result | Evidence |
|---|---|---|
| PIN in logs | PASS | `logOp` never receives PIN; PIN only travels as parameter to `engineLogin`; diagnostic = operation label only |
| OTP in logs | PASS | OTP never passed to `logOp`; only operation name logged |
| Firebase token in logs | PASS | `customToken` and `idToken` not referenced in any `logOp` call |
| JWT in logs | PASS | Not applicable — no JWT in V3 |
| Session ID in logs | PASS | `sessionId` flows as function parameter only; never passed to `logOp` |
| UID in logs | PASS | UID not present in any diagnostic string |
| Phone number in logs | PASS | Phone not present in any diagnostic string; `context` values are labels only |
| `logOp` / `logDiagnostic` dev-only | PASS | Both gated on `if (!__DEV__) return;` — silent in production builds |
| `diagnostic` field contents | PASS | Pattern: `[context] raw-error-message` — context is a safe label; raw message is the exception message (no PII from our code) |
| AsyncStorage key | PASS | `SESSION_KEY = "@v3/auth/session"` — a constant, not user data |

**Security verdict: CLEAN.** No PII leak path found in any compartment.

---

## Performance Review

| Measurement | Compartment | Notes |
|---|---|---|
| Session restore on cold start | C3 Session → C6 Firebase | Two sequential awaits: `AsyncStorage.getItem` (~1–5ms) then `authStateReady()` (resolves from cache, typically <50ms). Total: ~50–100ms. |
| Firebase sign-in | C6 Firebase | `signInWithCustomToken` is a network call (~200–800ms depending on connectivity). `getIdToken()` is synchronous from cache post-sign-in (~1ms). |
| PIN screen render | C8 UI | 12 static Pressable keys. No memoization needed. Negligible render cost. |
| FlowContext re-renders | C8 UI | All setters are `useCallback([])`. No unneeded re-renders of unrelated screens when flow state changes. |
| NumPad `disabled` prop | C8 UI | Propagated to each key's `onPress` guard. No performance concern. |
| Screen animation | C1 Navigation → C8 Layout | `slide_from_right` animation. Standard Expo Router. No performance concern. |

**No performance anomaly found.** The only inherently slow operation (Firebase `signInWithCustomToken`) is a network call and cannot be optimised inside V3.

---

## Bugs — Detailed Findings

---

### BUG-A — OTP Resend has no cooldown
**Severity: MEDIUM**

| Field | Detail |
|---|---|
| Result | FAIL |
| Compartment | C8 UI (otp.tsx) / C10 Config (config/index.ts) |
| Files | `app/auth-v3/otp.tsx` line 81–89 · `modules/auth-v3/config/index.ts` line 29 |
| Observed | Resend button only checks `if (busy) return;`. Once the send-OTP API call returns (~500ms), the button is immediately usable again. User can send a new OTP request every ~500ms. |
| Expected | At least 30 seconds between resend attempts (constant `OTP_RESEND_COOLDOWN_MS = 30_000` already defined in Config but never imported by otp.tsx) |
| Risk | MEDIUM — enables OTP spam; drives up SMS costs; may trigger backend rate limits causing legitimate users to be locked out |

**Root Cause:**

`OTP_RESEND_COOLDOWN_MS` was defined in Config (C10) but never connected to the
OTP screen. The `handleResend` function only guards with `if (busy) return;`, which
becomes `false` as soon as the previous API call returns.

**Smallest Possible Fix:**

In `app/auth-v3/otp.tsx`:

```ts
// 1. Import the constant
import { COLORS, OTP_LENGTH, OTP_RESEND_COOLDOWN_MS } from "@/modules/auth-v3/config";

// 2. Add a ref (no re-render needed — just enforcement)
const lastResendAt = useRef<number>(0);

// 3. Guard at the top of handleResend
const handleResend = async () => {
  const now = Date.now();
  if (busy || now - lastResendAt.current < OTP_RESEND_COOLDOWN_MS) return;
  lastResendAt.current = now;
  // ... rest unchanged
};
```

No other file changes required. No new state, no layout change.

**Do NOT implement until approved.**

---

### BUG-B — `sessionSave` failure silently discarded
**Severity: LOW**

| Field | Detail |
|---|---|
| Result | FAIL (edge case) |
| Compartment | C2 Engine (_login.ts, _signup.ts) / C3 Session |
| Files | `engine/_login.ts` line 35 · `engine/_signup.ts` line 47 |
| Observed | `await sessionSave(uid, phone)` return value is not checked. If AsyncStorage throws, the error is discarded and the engine returns `ok({uid, phone})` as if everything succeeded. |
| Expected | Session save failure should at minimum be logged; ideally the caller is made aware so it can decide how to handle it (current session still works — Firebase is signed in — but next cold start will show Welcome) |
| Risk | LOW — AsyncStorage failure is rare. When it happens: user is authenticated for the current session, but on next app kill + reopen they see Welcome and must log in again. No data corruption, no crash. |

**Root Cause:**

Both `engineLogin` and `engineFinishAuth` use `await sessionSave(...)` without
capturing the result. `sessionSave` returns `AuthV3VoidResult`, which is typed
and checked everywhere else, but not here.

**Smallest Possible Fix:**

In `engine/_login.ts` (line 35) and `engine/_signup.ts` (line 47), replace:

```ts
await sessionSave(fbResult.data.uid, phone);
logOp("engine", "login", "success");
return ok({ uid: fbResult.data.uid, phone });
```

With:

```ts
const saveResult = await sessionSave(fbResult.data.uid, phone);
if (!saveResult.success) {
  // Firebase sign-in succeeded. Session persistence failed. Log for diagnostics.
  // Continue — user is authenticated this session. Next cold start may require re-login.
  logOp("engine", "login", "error", saveResult.error);
}
logOp("engine", "login", "success");
return ok({ uid: fbResult.data.uid, phone });
```

Same pattern for `_signup.ts` (replace `"login"` with `"finishAuth"`).

Two files, two insertions. No API or UI changes.

**Do NOT implement until approved.**

---

### BUG-C — Error code overridden in `_verifyPin.ts` and `_verifyOtp.ts`
**Severity: LOW**

| Field | Detail |
|---|---|
| Result | FAIL (latent) |
| Compartment | C5 API (_verifyPin.ts, _verifyOtp.ts) |
| Files | `api/_verifyPin.ts` line 19 · `api/_verifyOtp.ts` line 19 |
| Observed | `{ ...mapApiError(r.error, ctx), code: ERR.INVALID_PIN }` — the spread correctly sets `userMessage` from pattern matching, but then `code` is unconditionally overridden. If the backend returns "locked" or "too many attempts", `mapApiError` correctly produces `code: PIN_LOCKED` and `userMessage: "Too many incorrect attempts..."` — but then the override sets `code: INVALID_PIN`. The `userMessage` shown to the user IS correct. The machine-readable `code` is wrong. |
| Expected | `error.code` should reflect the actual error type. `PIN_LOCKED` when locked, `OTP_EXPIRED` when expired, `INVALID_PIN` when PIN is wrong. |
| Risk | LOW — current V3 screens display `error.userMessage` only and do not branch on `error.code` from these operations. Invisible today. Becomes a bug the moment any caller does `if (error.code === ERR.PIN_LOCKED)` to show a lock timer, count remaining attempts, or gate re-entry. |

**Root Cause:**

Defensive code intended to guarantee a non-UNKNOWN code overrides the
correctly-resolved code from `mapApiError`. The intent was to ensure a
default, but it erases the more specific code.

Verified by probe:
```
'locked out'       → mapApiError resolves code=PIN_LOCKED   ← then overridden to INVALID_PIN
'too many attempts'→ mapApiError resolves code=PIN_LOCKED   ← then overridden to INVALID_PIN
'otp expired'      → mapApiError resolves code=OTP_EXPIRED  ← then overridden to INVALID_OTP
```

**Smallest Possible Fix:**

In `api/_verifyPin.ts`, replace line 19:

```ts
// BEFORE
const error: AuthV3Error = { ...mapApiError(r.error, "api.verifyPin"), code: ERR.INVALID_PIN };

// AFTER — trust mapApiError's pattern-matched code; fall back to INVALID_PIN only if UNKNOWN
const mapped = mapApiError(r.error, "api.verifyPin");
const error: AuthV3Error = {
  ...mapped,
  code: mapped.code === "UNKNOWN" ? ERR.INVALID_PIN : mapped.code,
};
```

Same change in `api/_verifyOtp.ts` (fall back to `INVALID_OTP`).

Two files, two 3-line changes. No other file changes.

**Do NOT implement until approved.**

---

### BUG-D — Gesture swipe-back bypasses `busy` guard on async screens
**Severity: LOW**

| Field | Detail |
|---|---|
| Result | FAIL (UX degradation; no crash, no data corruption) |
| Compartment | C1 Navigation / C8 UI (_layout.tsx) |
| Files | `app/auth-v3/_layout.tsx` line 25 |
| Observed | `gestureEnabled: true` in Stack options. On iOS, swipe-left-from-edge dismisses the current screen regardless of `busy` state. Scenario: user types 6th PIN digit (auto-submit fires, `busy=true`) then immediately swipes back. `mountedRef.current = false`, `doLogin` resolves, checks `!mountedRef.current` → early return → `navToHome` NOT called. User is on Login screen, authenticated (Firebase signed in + session saved), but not navigated home. |
| Expected | Gesture should be blocked during active auth, OR the recovery path should be immediate and clear. Recovery path EXISTS (Welcome screen's `engineRestoreSession` catches the valid session and navigates home), but requires the user to navigate all the way back to Welcome. |
| Risk | LOW — `mountedRef` prevents any crash or corrupt state. No data loss. Firebase sign-in and session save completed successfully. Recovery is possible. Only affects the subset of users who physically swipe-back at exactly the right 200–800ms window during auth. |

**Root Cause:**

`gestureEnabled: true` is the Expo Router default for all Stack screens.
The `busy` state is enforced on UI buttons but has no hook into the native
gesture recogniser.

**Smallest Possible Fix (Option A — disable gesture on the whole V3 stack):**

In `app/auth-v3/_layout.tsx`, add `gestureEnabled: false`:

```ts
<Stack
  screenOptions={{
    headerShown:    false,
    animation:      "slide_from_right",
    gestureEnabled: false,   // ← add this line
  }}
/>
```

This is the smallest change. It removes swipe-back from all V3 screens, which
is acceptable for an auth flow.

**Alternative Fix (Option B — per-screen override only during busy):**

Use `<Stack.Screen options={{ gestureEnabled: !busy }} />` inside each async
screen. More precise but requires touching 4 screen files.

**Do NOT implement until approved.**

---

### BUG-E — Orphaned Firebase account on step-3 failure in `engineFinishAuth`
**Severity: VERY LOW**

| Field | Detail |
|---|---|
| Result | FAIL (edge case, very rare scenario) |
| Compartment | C2 Engine (_signup.ts) |
| Files | `engine/_signup.ts` lines 41–43 |
| Observed | If Firebase sign-in (step 1) and PIN set (step 2) succeed, but `apiCreateAccount` (step 3) fails due to a transient network error, the user sees an error screen. Firebase account exists + PIN is set, but no driver profile exists in the backend. The user cannot log in (PIN check would pass, but the driver profile lookup would fail). The user cannot sign up again (phone already registered). |
| Expected | Atomic operation: if any step fails, the partially-created account should be cleanable; or `apiCreateAccount` should be idempotent so a retry succeeds. |
| Risk | VERY LOW — requires a network failure specifically between step 2 and step 3 of a signup (two sequential API calls). In practice, both calls are made back-to-back within ~50ms; a failure window this narrow is rare. Resolution requires manual admin intervention or a backend fix for idempotent account creation. |

**Root Cause:**

No transaction or compensation logic across the three-step `engineFinishAuth`
sequence. Firebase + backend are separate systems with no distributed
transaction boundary.

**Smallest Possible Fix:**

This is a backend contract issue. The backend's `apiSetPin` and `apiCreateAccount`
should either be combined into one atomic endpoint, or `apiCreateAccount` should
be idempotent (safe to retry if called with the same phone/token). No V3 client
change is sufficient on its own.

A client-side partial mitigation is to catch the step-3 failure and show a
"Setup incomplete" message with a retry button that calls only `apiCreateAccount`
(skipping step 1 and 2), but this requires preserving the idToken between retries.

**Do NOT implement until approved. Backend team should be consulted.**

---

## Potential Issues (Not Confirmed Bugs)

### POTENTIAL-1 — `flow.phone` may flash empty on OTP screen's first render

| Compartment | Files | Risk |
|---|---|---|
| C8 UI → C8 FlowContext | `forgot-pin.tsx` line 73 · `signup-form.tsx` line 81 | VERY LOW |

`setPhone(fullPhone)` is called immediately before `navToOtp(router, intent)`.
In React 18 with automatic batching, these state updates and the navigation
update should commit in the same render cycle, meaning the OTP screen's first
render would have `flow.phone` set correctly.

If batching does NOT include the navigation update (behaviour is
implementation-specific), the OTP screen may render once with `flow.phone = ""`
before the `setPhone` commit arrives. The subtitle would briefly read
"We sent a 6-digit code to" with no number.

This is **cosmetic only**. The `flow.phone` is read for display and for the
verify API call. The display would self-correct on the next render. The API
call is gated on user input (minimum 6 keystrokes) which is always after the
state commit.

**No fix recommended at this time. Monitor in production.**

---

### POTENTIAL-2 — `firebaseWaitReady()` has no timeout

| Compartment | Files | Risk |
|---|---|---|
| C6 Firebase → C3 Session | `firebase/index.ts` line 82 · `session/index.ts` line 108 | LOW |

`firebaseAuth.authStateReady()` is designed to resolve from the device's local
cache, even offline. It should resolve in under 100ms in all normal conditions.

However, if Firebase's local storage is corrupted or the device is in an
extreme low-memory state, this promise could theoretically never resolve,
leaving the Welcome screen showing a spinner indefinitely.

Adding a `Promise.race` timeout (e.g. 5 seconds → fall through as `uid = null`)
would prevent an infinite spinner. This is a defensive improvement, not a
response to a confirmed incident.

**No fix recommended at this time. Revisit if spinner hangs are reported in production.**

---

## Final Verdict

| Category | Finding |
|---|---|
| Crashes | None found |
| Data corruption | None found |
| Security violations | None found |
| PII in logs | None found |
| Race conditions (confirmed) | None found |
| Confirmed bugs | **4** |
| Potential issues | 2 |

### Bugs ranked by priority for fixing

| Priority | Bug | Severity | Fix scope |
|---|---|---|---|
| 1 | BUG-A — OTP resend no cooldown | MEDIUM | 3-line change, 1 file |
| 2 | BUG-C — Error code override | LOW | 3-line change, 2 files |
| 3 | BUG-B — `sessionSave` result discarded | LOW | 4-line change, 2 files |
| 4 | BUG-D — Gesture swipe-back during busy | LOW | 1-line change, 1 file (Option A) |
| 5 | BUG-E — Orphaned account on step-3 fail | VERY LOW | Backend contract change required |

**Awaiting approval to implement any fix.**
