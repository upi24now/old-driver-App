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
