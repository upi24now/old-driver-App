# Single-Device Login — Verification Report

Date: 2026-06-26
Feature: PIN-primary daily login + one-account-one-active-device for the Bike Courier Driver App.
Scope: ADDITIVE only. No Firestore for business data. Wallet / Plans / KYC / Orders-lifecycle /
Profile / Razorpay / Customer-app logic untouched.

## 1. Artifacts delivered

| Artifact | Purpose |
| --- | --- |
| `artifacts/api-server/src/routes/auth.ts`, `src/lib/require-auth.ts`, `src/lib/session.ts` | Canonical source (PIN routes, session mint/enforce, OTP rate limit) |
| `lib/db/src/schema/drivers.ts` + `otp_send_events` schema | Canonical schema (`activeSessionId`, `activeSessionAt`, OTP send-events) |
| `production-baseline/driver-session-login-patch/` | Byte-safe prod-bundle patch on base `395ffcb2…` |
| `…/api-pkg/migrations/003_single_device_login.sql` | Idempotent prod migration |
| `…/api-pkg/DEPLOY.md`, `SHA256SUMS.txt` | Deploy + rollback runbook + checksums |
| Mobile: `contexts/DriverContext.tsx`, `app/login.tsx`, `app/create-pin.tsx`, `utils/session.ts`, `utils/api-client.ts` | PIN-primary UI + session plumbing |

## 2. Checksums (byte-safe splice)

```
BASE  production-api.js : 395ffcb2265179178487878f853b2a86b8eac8a53a77928737c20a28c633b719
PATCH production-api.js : 21ee8ca710a6667fac31e518a2d6e63d15f11e7cc1132bfa4e94411e9003fd93
```

- Splice point: immediately AFTER the last global middleware
  `app.use((0, import_pino_http.default)({ logger }));`, i.e. after `express.json()` and
  BEFORE the base bundle's own pre-existing `/api/auth/send-otp`+`/api/auth/verify-otp`
  override AND before `app.use("/api", routes_default)`.
- `patch.py` proves: prefix bit-identical, block verbatim, suffix bit-identical,
  `len(out) == len(base) + len(block)`, first divergence within the inserted region only.
- `node --check production-api.js` → OK.
- `sha256sum -c SHA256SUMS.txt` → all listed files OK.

### Why the splice point moved (vs. the first attempt)
The base bundle `395ffcb2` ALREADY contains an additive `/api/auth/send-otp` +
`/api/auth/verify-otp` override (from the driver-orders patch). Inserting our block before
`app.use("/api", routes_default)` placed it AFTER that pre-existing override, so Express
first-match-wins kept serving the OLD handlers (token only, no `sessionId`, no rate limit,
no session write). Moving the splice to just after the pino middleware makes our handlers
register FIRST and win. `__dsRequireDriver` is a hoisted function declaration, so the
wrapper still binds correctly at the earlier point.

## 3. Runtime test matrix (patched bundle booted on PORT=5099 against migrated dev DB)

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| T1 | `verify-otp` (test phone) | `{ token, sessionId }`, `active_session_id` written | PASS — token + sessionId; DB session set |
| T2a | `pin-status` with CORRECT `x-session-id` | 200 | PASS — `{hasPin:false}` 200 |
| T2b | `pin-status` with STALE `x-session-id` | 401 SESSION_REPLACED | PASS — `{error:"SESSION_REPLACED",message:"Logged in on another device"}` 401 |
| T2c | `pin-status` with NO `x-session-id` (device active) | 401 SESSION_REPLACED | PASS — 401 SESSION_REPLACED |
| T3 | `verify-pin` correct PIN | `{ token, sessionId }` 200 | PASS |
| T4 | `verify-pin` wrong PIN ×3 | 401, 401, 429 lock; correct PIN still 429; `pin_failed_attempts=3`, locked | PASS |
| T5 | `send-otp` 4× in 24h (non-test phone) | 200, 200, 200, 429 | PASS — 4th = 429; `otp_send_events` count = 3 |
| T6 | route parity: `healthz`, malformed `verify-pin` body | 200 / 400 | PASS |

All session writes confirmed in PG (`drivers.active_session_id` populated for both test
drivers; `otp_send_events` accrued exactly 3 rows for the rate-limit phone). Test rows
deleted after the run.

## 4. Migration (idempotent)

`003_single_device_login.sql` applied to dev DB; every statement is `IF NOT EXISTS`
(ALTER … ADD COLUMN for `active_session_id` / `active_session_at`, CREATE TABLE
`otp_send_events` + index, defensive PIN columns). Re-runnable with no data change.

## 5. Typechecks

- `pnpm --filter @workspace/mobile run typecheck` — clean
- `pnpm run typecheck:libs` — clean
- `pnpm --filter @workspace/api-server run typecheck` — clean

## 6. Scope / safety confirmation

- No Firestore is used for any business data added by this feature (PG only).
- Wallet / Plans / KYC / Orders-lifecycle / Profile / Razorpay / customer-app routes are
  byte-for-byte unchanged in the bundle and untouched in source.
- Single-device enforcement is null-safe (legacy NULL `active_session_id` skips the check)
  and fail-open on a session-check DB error (never hard-blocks a token-verified driver).
- No new secrets / env vars required. `TEST_OTP_PHONES` (already present) bypasses OTP store.

## 7. Deployment status

NOT DEPLOYED — per instructions. Deploy + rollback steps are in `DEPLOY.md`.
