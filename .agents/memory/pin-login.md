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

## set-pin completion must ADOPT the rotated session, or login loops back to OTP
**Rule:** after a successful `set-pin`, the mobile client MUST end up holding the
server's *current* `active_session_id` before navigating off `/create-pin`. The
single-device model rotates the session on set-pin; if the client keeps the old
`x-session-id`, the next authenticated request 401s `SESSION_REPLACED`, the global
interceptor auto-signs-out, and the `_layout` guard bounces the user back to the
phone/OTP screen — the "set PIN → back to OTP" loop.
**Why:** the bounce is NOT a navigation bug — `router.replace(next)` is correct.
The guard only sends to `/login` when `driverUid`/`isOtpVerified` flip false, which
ONLY happens via `signOut`, which is wired to `SESSION_REPLACED`. So any "set-pin
loops to login" report = stale-session 401, not routing.
**How to apply:** (1) read set-pin's new session id tolerantly (`json.sessionId ??
json.customSessionId`) and `setSessionId` it; (2) if set-pin returns NO session id,
re-sync by calling `verifyPinApi(phone, pinJustSet)` and adopt its sessionId;
(3) FAIL-SAFE — if neither yields a session, do NOT navigate; show a retryable
error and stay on `/create-pin` (navigating without a valid session re-triggers the
loop). Gate set-pin success on HTTP status but still treat explicit `{ok:false}` as
failure (don't blindly trust 200).

## Deployed prod API ≠ repo handlers — never assume response shapes
**Rule:** the live `api.bikecourierservice.com` runs a separate prebuilt bundle that
differs from BOTH `artifacts/api-server` source AND the `production-baseline` patches.
Observed: prod `verify-otp` returns `{ok, customToken, uid, sessionId}` (NOT the
repo's `{token, sessionId}`), and prod `send-otp` returns `{ok, expiresInSeconds}`
and does NOT honor the `TEST_OTP_PHONES` bypass (so you can't drive a live OTP probe
of gated endpoints like set-pin from the agent).
**Why:** client parsing keyed on repo field names silently breaks ("No token received
from server" came from reading only `json.token`). Can't introspect prod set-pin live
because the test-phone OTP shortcut is inactive there.
**How to apply:** make client parsers shape-tolerant (accept `token ?? customToken`,
`sessionId ?? customSessionId`); add request/response logging to capture real prod
shapes from device logs rather than guessing; verify against the live domain, not
repo source.

## "set PIN → bounce to login" REAL cause = /drivers/me 403, NOT a session loop
**Rule:** when the prod driver app bounces back to /login during first-time PIN
setup, capture device logs before theorizing. The observed cause was NOT set-pin
session rotation — the user never reached /create-pin. Trace (deployed prod
api.bikecourierservice.com): verify-pin 404 (no PIN) → OTP setup → verify-otp 200
`{ok,customToken,uid,sessionId}` → signInWithCustomToken SUCCESS → `getDriverProfile`
`GET /api/drivers/me` → **403 `{"error":"Forbidden — account does not have admin
access"}`** (twice incl. retry) → `establishSession` `[OTP_PROFILE_GATE] source≠404`
skips ensureDriverSignup, calls `setIsOtpVerifying(false)`, returns `{ok:false}`
WITHOUT `setIsOtpVerified(true)` → `_layout` guard sees driverUid present +
isOtpVerified=false → `router.replace("/login")`.
**Why:** the bounce is the route guard reacting to `isOtpVerified` never flipping
true; `isOtpVerified` only flips true at the END of establishSession, which aborts
early when the profile load fails. The prod `/api/drivers/me` route returns 403
"admin access" for a normal driver token (separate prebuilt prod bundle; route
exists but is gated wrong / missing the driver self-read path — 403, not 404).
**How to apply:** the fix belongs on the backend (prod /drivers/me must serve the
authenticated driver's own profile, not require admin) — client cannot fix a 403
without masking real failures. The earlier client-side "set-pin session adoption"
work fixed a DIFFERENT, downstream symptom and does not address this; don't conflate
them. Always confirm WHICH screen the bounce fires from via logs first.

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
