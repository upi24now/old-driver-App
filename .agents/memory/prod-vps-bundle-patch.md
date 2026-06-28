---
name: Production VPS API is a separate prebuilt bundle (no source)
description: The live driver/customer API is NOT artifacts/api-server; it's a standalone esbuild bundle on the VPS whose source is lost — how to patch it additively.
---

# Production API ≠ artifacts/api-server

The LIVE production API (api.bikecourierservice.com, PM2 `bike-courier-api`, port 3000,
cwd `/home/.../api-pkg`, entry `dist/production-api.js`) is a SEPARATE product from the
Replit `artifacts/api-server` (which builds `dist/index.mjs`, port 8080).

**The prod bundle's source tree (`api-server-baseline`, with `src/lib/firebase.ts`,
`src/middlewares/customerAuth.ts`, customer + Razorpay + Phase-1 `mirror-parity` worker)
exists NOWHERE accessible** — not on the VPS (only built bundles ship), not in this repo's
working tree, not in git history. Only the built `production-api.js` (unminified esbuild ESM,
~200k lines) survives. The Replit api-server has driver/OTP/dispatch code but ZERO
customer/Razorpay/mirror code — they never overlap.

**Why:** prod was built from a different/superset codebase that was lost; the Replit repo
diverged. Searching the repo for `production-api`/`customer/orders`/`razorpay/create-order`/
`MIRROR_ENABLED` returns 0 — that's expected, not a missing-file bug.

# How to patch the prod bundle additively (no source)

It's an unminified ESM bundle where esbuild concatenates all ESM modules into ONE top-level
scope, so top-level `var`s are mutually visible. Reusable top-level bindings:
- `var pool` = node-postgres `Pool` (reads `process.env.DATABASE_URL`) → use `pool.query()` / `pool.connect()`.
- `var auth` = Firebase Admin `getAuth(getApp2())` → `auth.createCustomToken(uid)`, `auth.verifyIdToken()`.
- `var app` = Express app; `express.json()` already applied; `app.use("/api", routes_default)` is the single API mount, followed by a catch-all 404 (that 404 is why missing routes return 404).

**How to apply:** insert new `app.<verb>(...)` handlers as plain text immediately BEFORE
`app.use("/api", routes_default);`, referencing `pool`/`auth` (prefix all new identifiers to
avoid collisions). For DB tables that may not exist in prod, self-create with
`CREATE TABLE IF NOT EXISTS`. Validate with `node --check`, then boot the bundle on a spare
PORT with NODE_ENV=development against the Replit dev DB (Firebase secrets are in env) and curl
the routes. A `relation "admin_roles" does not exist` startup warning when booting on the dev
DB is EXPECTED/non-fatal (prod DB has those tables); the server still listens.

## CRITICAL: never patch the bundle with the text `edit` tool — use byte-safe insertion

The `edit`/`write` text tools round-trip the whole multi-MB bundle through a text/UTF-8
re-encode and **silently mutate unrelated bytes** elsewhere in the file (observed: ~25
in-place same-length substitutions in bundled charset/"chars" tables hundreds of thousands of
lines away from the edit, plus a few KB of net size drift — NOT visible as U+FFFD, count stays
0). A late insertion that shows `cmp`/`diff` differences *before* the insertion point is the
tell. The deliverable must differ from the live bundle ONLY by the additive block, so:

**Patch via raw bytes (Python `open(...,'rb')` / Node `Buffer`):** read pristine bundle as
bytes, find the anchor line bytes (e.g. `b'app.use("/api", routes_default);\n'`, assert it
occurs exactly once), build `new = orig[:idx] + block + orig[idx:]`, write binary. Then
`cmp pristine new` must report the FIRST (and only) difference exactly at the insertion offset;
by construction the head and tail equal the original. Always `node --check` + boot-smoke after.

The VPS `package.json` lists NO dependencies (everything is bundled), so injected code CANNOT
`import`/`require` new modules at runtime — it MUST reuse the bundle's own bundled bindings.
Deliver as a tar of the `api-pkg` (dist/production-api.js + mirror-parity.mjs + index.mjs +
package.json + package-lock.json + ecosystem.config.cjs); operator drops in `dist/` and
`pm2 reload bike-courier-api --update-env`. Never enable MIRROR_ENABLED in the deploy step.

## No runtime DDL in injected routes (least-privilege)
When added routes need new columns, do NOT run `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
inside the request path. The VPS app DB role may lack ALTER → every such route returns a
persistent 500 even when the schema is fine. Instead ship a one-time idempotent migration
`.sql` in the package and require the operator runs it BEFORE deploy; runtime code uses only
SELECT/UPDATE. (Caught in architect review of the PIN-routes patch.)

## Node built-ins ARE available via dynamic import
The "cannot import new modules" rule is about npm deps absent from the bundle's package.json.
Node CORE modules still work: `const c = await import("node:crypto")` inside a handler is valid
(Node 24 ESM) and was proven at runtime (scrypt PIN hash/verify). Use dynamic import of
`node:crypto` rather than assuming a bundled crypto binding exists.

## Prod `drivers` schema diverges from the Replit repo schema — target the bundle's columns
The mobile login gate is `GET /api/drivers/me` (profile-api.ts → DriverContext): any non-OK
status makes getDriverProfile return null → app bounces to login. The live bundle had NO `/me`
route, so it fell through to the admin-gated `GET /api/drivers/:uid` (uid="me") → 403.
**Fix = add driver-self routes, not change the uid scheme** (uid stays `"91"+phone`).
- The prod `drivers` table (read the bundle's compiled `pgTable("drivers",…)` for ground truth)
  uses **`push_token`/`push_token_type`/`push_token_platform`/`push_token_updated_at`** and
  **registration_fee_*** — it does NOT have `fcm_token`, nor the newer api-server columns
  (`subscription_*`, `today_*`, `trips_today`, `rating`, `onboarding_fee_*`). The Replit DEV DB
  has the OPPOSITE set (fcm_token, onboarding_fee_*, etc.). So: a `/me/fcm-token` route must
  write `push_token` (NOT fcm_token); `/me` returns the missing app-expected fields as null.
**Why:** the mobile app was built against the newer artifacts/api-server contract; copying that
route verbatim writes the wrong column and 500s/silently-misses on prod.
**How to apply:** register `app.get("/api/drivers/me")` + `app.patch(".../me/fcm-token")` BEFORE
`app.use("/api", routes_default)` so they beat the admin `/:uid` route; reproduce
computeOnboardingStep (account_blocked→vehicle→profile→documents→fee→reupload→pending→dashboard)
for `nextRoute`. Smoke a real ID token by: verify-otp (TEST_OTP_PHONES) → custom token →
Identity Toolkit `accounts:signInWithCustomToken?key=$EXPO_PUBLIC_FIREBASE_API_KEY` → idToken →
call `/me`. To smoke against the dev DB, ALTER it into a prod-schema superset, then revert.

## Smoke-testing a Razorpay money-path patch WITHOUT real keys
**Rule:** to exercise the full PG-write path of a `verify-payment` route without prod Razorpay
secrets, boot the bundle with DUMMY `VITE_RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, manually
`INSERT` the bridge order row (status='created'), then locally compute the signature
`HMAC_SHA256("<order_id>|<payment_id>", <dummy_secret>)` and POST it — the route's own HMAC
check uses the same dummy secret so it matches and the PG UPDATE runs. `create-order` with dummy
keys returns 502 `razorpay_order_failed` (Razorpay REST rejects the key) which still proves the
route exists (JSON, not 404). **Why:** dummy keys can't mint a real order but you fully control
both sides of the HMAC, so verify-payment's signature gate + tx commit are testable offline.
**How to apply:** prod reuses EXISTING env `VITE_RAZORPAY_KEY_ID`+`RAZORPAY_KEY_SECRET` (note the
VITE_ prefix on the id) — no new secret. Plan prices/durations are server-computed, never trust client.

## Prod vs dev DB subscription-column divergence
Prod `drivers` had NO `subscription_plan`/`subscription_expires_at` (5J-Tier-3 /me read them →
hard-null → "plan disappeared"); the Replit DEV DB already HAS them (newer api-server schema).
**How to apply:** when smoke-cleaning the dev DB, DROP only columns/tables YOU added; leave
pre-existing subscription cols intact. The fix is the idempotent pre-deploy migration + /me reading the cols.

## Prod driver-plans field-naming diverges from in-repo source
Prod bundle's `/api/driver-plans` endpoints use DIFFERENT field names than `artifacts/api-server`
source. `create-order` RESPONSE returns `orderId`/`planId`/`keyId` (NOT source's
`razorpayOrderId`). `verify-payment` REQUEST requires snake_case `razorpay_order_id`,
`razorpay_payment_id`, `razorpay_signature` (camelCase → 400 "...are required"; snake_case →
reaches HMAC check). **Why:** prod is a separate prebuilt bundle, source lost. **How to apply:**
mobile must send BOTH camelCase + snake_case razorpay_* in verify-payment so prod AND in-repo
source resolve; map create-order response defensively (orderId ?? razorpayOrderId ...). Prod
verify SUCCESS body shape unobserved (no key_secret to forge a valid sig) — keep response logging
and gate success on an explicit positive flag or an expiry field, never a bare 200.

## Prod verify-payment success contract + plan read-path
verify-payment SUCCESS body = `{"ok":true,"plan":{id,label,amount,durationDays,status:"active",startedAt,expiresAt}}`
(expiry is NESTED under `plan.expiresAt` ISO string — NOT top-level planExpiryAt). Mobile success
check must accept `ok===true`/`plan.status==="active"` and read expiry from `plan.expiresAt`.
The persisted plan is read back via `GET /api/driver-plans/status` (and `/current`) →
`{"active":true,"plan":{...}}`; `/api/driver-plans/me` is 404. **Read-path mismatch:** prod
`GET /api/drivers/me` returns `{driver}` and does NOT carry subscriptionPlan/subscriptionExpiresAt,
but the mobile app's refreshSubscription/getDriverProfile reads plan from /me → shows plan inactive
after a successful payment. Canonical plan source in prod is /api/driver-plans/status, not /me.
**How to apply:** backend HMAC-only verify (no Razorpay round-trip) means a locally-computed
signature with the matching test key pair drives a real prod 200 + persist for E2E proof.

## Byte-safe splice patcher: keep the anchor literal OUT of the inserted block
A patcher that asserts `patched.count(ANCHOR) == 1` (post-insert) will FAIL if the
inserted block contains the anchor string anywhere — **including in a comment/header**
(e.g. "spliced before `app.use("/api", routes_default);`"). The base has exactly one
anchor; the block adds a second → assertion trips. Fix = reword the block comment so it
never contains the exact anchor literal; do NOT relax the assertion (it is also what
prevents accidental double-registration). The real byte-safety guarantee is the
prefix/suffix/length invariant: `strip(inserted_block) == base` byte-for-byte.
