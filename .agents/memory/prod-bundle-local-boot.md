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

# Capturing HTTP probe results across the sandbox process reaper

**The sandbox kills spawned processes when the originating bash call returns**, even with
`setsid`/`disown`/`nohup` and `</dev/null`. So a server booted in call A is **gone** by
call B (curl → HTTP 000). Booting + probing must happen in **one** call.

**But** combined boot+probe calls frequently get SIGTERM (143) / SIGKILL (137) near the end,
and any buffered stdout is then lost (the call shows "no output"). Nesting a 2nd node process
(a node orchestrator that spawns the bundle) makes the kill worse.

**What works:** one foreground bash script that backgrounds the bundle (output → a log file),
polls the log for `API server listening`, runs the curls **appending each result to a results
file** (`>> /tmp/proofresults.txt`), then kills the bundle. Even if the call is killed at the
end, the results file is already on disk — `cat` it in the next (lightweight) call. Persist
results to a file rather than relying on the call's own stdout.

**Distinguishing a reached route from the catch-all:** the bundle's catch-all 404 body is
exactly `{"error":"Not found"}`. A patched-in route that runs its own logic returns a
*different* body (e.g. `{"sent":true,...}` 200, or domain 401 `Incorrect PIN` / `Missing ...
Authorization header`). A real domain 401 proves the route is mounted; only `{"error":"Not
found"}` means still-missing.
