---
name: Artifact-managed workflow env injection
description: You cannot inject env vars into an artifact-managed workflow via configureWorkflow; use a split-process harness for runtime-testing env-gated modes.
---

# Can't override env on artifact-managed workflows

`configureWorkflow` (and `restart_workflow`) CANNOT change the command of an artifact-managed workflow (e.g. `artifacts/api-server: API Server`). The platform rejects it: `PROHIBITED_ACTION … managed by an artifact and cannot be overridden via setRunWorkflow`. The run command is owned by `.replit-artifact/artifact.toml` (`[services.development] run = ...`).

**Why it matters:** to runtime-test a feature gated by an env var (e.g. `DISPATCH_SOURCE=pg_shadow`) you cannot just restart the workflow with the var set.

**How to apply:** run a **separate single-purpose harness process** that sets `process.env.X` then mirrors the relevant slice of the server's startup gate (import the same functions, e.g. `logDispatchSource` + `planDispatchStartup` + the one start function under test). Build it with the same esbuild + esbuild-plugin-pino runner pattern as the other `verify-*.mjs` scripts.

**Critical safety rule:** the harness must start ONLY the component under test. Do NOT start a second full server — the api-server starts FCM + round-robin + PG shadow-writer dispatchers unconditionally, so a second instance double-dispatches (real driver double-pushes / double assignment). Keep the authoritative dispatchers running once, in the live workflow, untouched.

## Proving a read-only loop made no writes
- Seed clearly-prefixed PG-only test rows (isolated from Firestore so no live dispatcher/FCM touches them); a PG order with `rejected_by = ARRAY[<onlyEligibleUid>]` forces the NO_DRIVER branch, an empty `rejected_by` forces CANDIDATE.
- After the run, assert the test rows are byte-identical (status unchanged, no driver_uid, 0 order_offers created), then delete them.
- A full-orders md5 checksum will still drift because the always-on PG shadow-writer keeps mirroring Firestore during the window — attribute drift by checking `updated_at > beforeSnapshot` (those rows are the shadow writer's, not the read-only loop's), don't expect the global checksum to match.
