---
name: Prod bundle express-var-name drift
description: Why additive VPS-bundle patches must not hardcode the esbuild express import var (import_expressNN), and how to dodge it.
---

# Prod bundle: esbuild express var name drifts between builds

When re-applying an additive route patch into the live VPS `production-api.js`
(the standalone esbuild ESM bundle), the express module binding name is **not
stable**: it appears as `import_express34` in one build and `import_express33` in
another. An IIFE wrapper that passes the bundle's `import_express34` by name will
throw `ReferenceError` at module eval on a drifted bundle and crash the whole
co-hosted (authoritative) server at boot.

**Rule:** never depend on the bundle's minified express var. Resolve express at
runtime inside the inserted block instead, and shim `.default`:
`var __e = globalThis.require("express"); use (__e && __e.default) ? __e : {default:__e}`.
The bundle banner defines `globalThis.require = __bannerCrReq(import.meta.url)`,
so `globalThis.require` works even though the file is ESM (`"type":"module"`).

**What IS stable** across additive patches (never renamed, safe to reuse by name):
`app`, `pool` (pg Pool), `auth` (Firebase Admin, declared `var auth = getAuth(...)`).
Confirm by usage before writing: `pool.query(` present, and `auth = getAuth(` or
`auth.createCustomToken`/`auth.verifyIdToken` present.

**Why:** the live bundle drifts ahead of every local copy, so a SHA-locked patcher
(`apply-patch.py` asserting a fixed base SHA) goes stale and refuses to run. The
restore patcher must be drift-tolerant: locate the splice by the unique anchor
`app.use("/api", routes_default);`, be idempotent (marker + sentinel-route check),
hard-fail all binding/runtime preflights AND the byte-safety reconstruction
**before any write**, and back up the target in place.

**How to apply:** see `production-baseline/driver-auth-routes-restore/` —
`apply-auth-restore.cjs` (self-locating, drift-tolerant) + verbatim
`auth-routes-body.js`. This pattern restores any additive router lost when an
unrelated additive patch was layered onto the wrong base.
