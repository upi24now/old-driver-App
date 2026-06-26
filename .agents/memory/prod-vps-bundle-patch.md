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
