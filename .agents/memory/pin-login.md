---
name: PIN login (backend)
description: Backend-only 6-digit PIN auth added in parallel to OTP; hashing + lockout decisions.
---

# PIN login (Phase 1, backend-only)

Optional 6-digit PIN auth runs **in parallel** to the untouched OTP flow. Two routes
live in `auth.ts`: `POST /auth/set-pin` (Firebase Bearer-gated via `requireAuth`) and
`POST /auth/verify-pin` (phone+pin → same `createCustomToken("91"+phone)` as verify-otp).

## Hashing — scrypt, NOT bcrypt/argon2
**Rule:** use Node built-in `node:crypto` scrypt for PIN hashing (`src/lib/pin-hash.ts`,
format `scrypt$saltHex$hashHex`, `timingSafeEqual`).
**Why:** api-server is bundled by esbuild into a single CJS file; bcrypt/argon2 are native
addons that break that bundle. scrypt is secure and dependency-free.

## Lockout / verify semantics
- 5 wrong attempts → lock 15 min (429). No PIN set → 404 (client falls back to OTP).
  Wrong pin → 401. Verify uses `SELECT ... FOR UPDATE` in a tx to make the attempt
  counter race-safe (same pattern as OTP verify).
- PIN columns on `drivers` are all nullable/defaulted so existing rows are unaffected.
- Never log raw PIN (only phone last-4 / uid on reject).

## Login flow is driven by verify-pin alone — NO anonymous pin-status lookup
**Rule:** the login UI must NEVER call an anonymous/by-phone "does a PIN exist?"
endpoint. Daily login = phone + 6-digit PIN → `verify-pin`. The branch that sends
a brand-new driver into OTP + first-time PIN setup keys off **`verify-pin` HTTP
404** (the handler returns 404 *only* for "no PIN set"). Client maps that 404 to
`{ ok:false, pinNotFound:true }` (`verifyPinApi` → `confirmPin` → `login.tsx`
`handleConfirmPin` → `startOtpFlow("setup")`). Other failures stay inline: 401
wrong PIN, 429 locked. "Forgot PIN" → `startOtpFlow("forgot")` → OTP → `/create-pin`.
**Why:** `GET /auth/pin-status` is **Firebase-Bearer-gated BY DESIGN** — an
unauthenticated `?phone=` call correctly returns `401 missing_token` (route's own
`requireAuth`/`__dsRequireDriver` first line; it ignores `?phone=` and keys on the
token uid). That is NOT a bug. User decision: keep Firebase ONLY for OTP + FCM; do
not add any public PIN/account-existence lookup (enumeration risk). The mobile
client helper `getPinStatus`/`PinStatusResult` was dead (never called) and was
removed; the gated `pin-status` route is left untouched (harmless, unused).
**How to apply:** never re-introduce a pre-auth pin-status call; drive PIN-vs-OTP
purely from the verify-pin response. No backend/bundle change is needed for this
(verify-pin already 404s for no-PIN). Optional future hardening: stable
`PIN_NOT_FOUND` code in the 404 body to decouple the UI from the raw status.

## `/create-pin` continuation
`/create-pin` takes the intended route as a `next` param and `router.replace(next)`
after `set-pin` succeeds — it adds NO routing logic. `set-pin` requires an existing
driver row (404 otherwise); the mobile flow has already created the row
(ensureDriverSignup) by the time PIN setup runs.

## set-pin must send x-session-id EXPLICITLY (not rely on the global interceptor)
**Rule:** `setPin()` (mobile `utils/auth-api.ts`) must attach the `x-session-id`
header itself from `getSessionIdSync()`, not depend solely on the global fetch
interceptor (`utils/api-client.ts`) to inject it.
**Why:** `set-pin` is single-device session-gated by `requireAuth`; `verify-otp`
mints AND persists `active_session_id` right before routing to `/create-pin`, so by
the time `set-pin` fires the account already has an active session. set-pin fires
the instant after OTP — the one moment the interceptor install / session cache may
not be in lockstep. A missing header → `401 SESSION_REPLACED` → PIN never persists
→ every later `verify-pin` returns the user-visible `404 "No PIN set"`. This was the
"Set up your PIN → Continue → HTTP 404" bug. The interceptor injection is idempotent
(`if !headers.has(...)`), so an explicit header is safe (no double-set).
**How to apply:** any Bearer-authed auth-api helper that fires during a login
transition should set `x-session-id` explicitly; never trust interceptor timing for
critical auth steps. Proven flow (dev): send-otp 200 → verify-otp 200 → set-pin 200
(with header) → verify-pin 200; set-pin WITHOUT header reproducibly 401s.

## verify-pin 404 must be JSON-agnostic
`verifyPinApi` (mobile `utils/auth-api.ts`) must check `res.status===404` and return
`pinNotFound:true` BEFORE parsing the body. **Why:** dev API returns a 404 with a
JSON body for no-PIN accounts, but a backend missing the route (the separate prod
VPS bundle, which lacks newer routes) returns a 404 with a non-JSON HTML
`Cannot POST /api/auth/verify-pin` page — calling `res.json()` first throws and
dead-ends login with "Server returned an unexpected response (HTTP 404)" instead of
falling back to OTP. **How to apply:** treat ANY 404 as the OTP/create-PIN fallback;
read the JSON error message only opportunistically (tolerate parse failure). Keep
this defensive even after prod parity — it survives partial rollouts/stale bundles.
