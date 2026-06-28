---
name: Booting the live prod API bundle locally for smoke tests
description: How to run the standalone VPS production-api ESM bundle in the Replit workspace to prove route registration / 401-vs-404.
---

# Boot the prod bundle locally to smoke-test routes

The live VPS API is a standalone esbuild **ESM** bundle (`"type":"module"`). To prove a
patched copy actually registers routes (e.g. delivery routes return **401 not 404** without
a token), boot it locally instead of guessing.

**The only unbundled external is `firebase-admin`** (everything else — express, pg,
drizzle, pino — is bundled; the rest of the "imports" are node builtins). ESM ignores
`NODE_PATH`, so you must run from a cwd whose `node_modules` resolves `firebase-admin`.

**How:** copy the patched bundle into `artifacts/api-server/` as a temp `*.mjs` (that
package already depends on firebase-admin via pnpm) and run it there with `PORT=<free>`
and `NODE_ENV=production`; the `FIREBASE_*` and `DATABASE_URL` secrets are already in the
bash env. It logs `Server listening` (+ the `[BCD]` marker when the delivery block is
present). Then curl `127.0.0.1:<PORT>/api/...`. Delete the temp `.mjs` after.

**Gotchas:**
- It must be run as `.mjs` (or copied to `.mjs`) — a bare `.js` triggers
  `ERR_MODULE_NOT_FOUND` / ESM-resolution errors. Same reason `node --check` needs a `.mjs`.
- A `relation "admin_roles" does not exist` **Bootstrap warning** on boot is a benign
  dev-DB schema gap, not a patch defect — the server still listens and serves.
- When smoke-testing method-specific routes, **use the real HTTP method**: a GET against a
  PATCH-only route (e.g. `/api/drivers/me/fcm-token`) returns 404 by design; PATCH returns
  the expected 401. Always include a known-bad route as a control so a real 401 is
  distinguishable from a catch-all.
