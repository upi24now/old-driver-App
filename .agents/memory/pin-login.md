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
