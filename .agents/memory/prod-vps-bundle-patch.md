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

The VPS `package.json` lists NO dependencies (everything is bundled), so injected code CANNOT
`import`/`require` new modules at runtime — it MUST reuse the bundle's own bundled bindings.
Deliver as a tar of the `api-pkg` (dist/production-api.js + mirror-parity.mjs + index.mjs +
package.json + package-lock.json + ecosystem.config.cjs); operator drops in `dist/` and
`pm2 reload bike-courier-api --update-env`. Never enable MIRROR_ENABLED in the deploy step.
