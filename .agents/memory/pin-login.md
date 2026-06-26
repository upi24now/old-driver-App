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

## Phase 2 — mobile "Create PIN" injection
Post-OTP PIN creation is shown ONLY to drivers without a PIN, injected in
`login.tsx` `handleVerify()` **between** OTP success and the existing
onboarding/Home `router.replace(nextRoute)` — never on cold-start session
restore, so existing logged-in drivers never see PIN setup.
- Trigger source: additive `GET /auth/pin-status` (Bearer-gated, returns only
  `{hasPin}`). New driver with no `drivers` row → `hasPin:false` (rows.length 0).
- **Fail-open rule:** if the pin-status check errors (network/server/token), the
  login flow MUST fall through to the original `nextRoute`. Never block login on
  the PIN check.
- `/create-pin` screen takes the intended route as a `next` param and
  `router.replace(next)` after `set-pin` succeeds — it adds NO routing logic.
- `set-pin` requires an existing driver row (404 otherwise); the mobile flow has
  already created the row (ensureDriverSignup) by the time PIN setup runs.
