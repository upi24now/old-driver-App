---
name: PG dispatch write/FCM safety gates (5G-A)
description: The two env gates and defense-in-depth force that keep the PG dispatcher from ever writing or sending FCM without explicit opt-in.
---

# PG dispatcher write/FCM safety gates

Three independent conditions must ALL be true before the PG dispatcher can do anything beyond verify-only logging:
1. `DISPATCH_SOURCE=pg` (else PG dispatcher never starts).
2. `ALLOW_PG_DISPATCH_WRITES=true` — gates assign/timeout/claim commits.
3. `PG_FCM_SEND_ENABLED=true` — gates FCM sends (on top of #2).

**Strict parsing:** a gate opens ONLY when `value.trim().toLowerCase() === "true"`. `"1"`, `"yes"`, `"false"`, empty, typos all stay closed. Closed-by-default is the safe state. Lives in `resolvePgWriteGates()` / `isFlagTrue()` in `dispatch-source.ts`.

## Two enforcement layers (defense in depth)
- **Plan-time:** `planDispatchStartup(value, gates)` sets `pgDispatcherVerifyOnly = !(source==="pg" && allowPgDispatchWrites)`.
- **Run-time:** `runPgDispatcherPass` re-resolves gates EVERY pass and runs `resolveEffectiveVerifyOnly(requested, gates)`. If a caller requests writes (`verifyOnly=false`) while the gate is closed, it FORCES verify-only — it does NOT throw.

**Why force-verify-only instead of throw:** the PG dispatcher is co-hosted in the same process as the always-authoritative Firestore dispatcher. Throwing would kill Firestore too. Degrading to verify-only keeps Firestore serving while guaranteeing no un-gated PG write escapes. This is the documented "safer option" for the spec's "throw OR force verify-only" choice.

## Rollback
`DISPATCH_SOURCE=firestore` (or unset) → Firestore-only on next restart; no PG dispatcher starts. BUT the **PG shadow-writer is NOT a dispatcher** — it mirrors mobile-initiated Firestore events into PG and runs in ALL modes regardless. Rollback controls dispatcher authority only, not shadow mirroring. If someone needs "zero PG writes of any kind," the shadow-writer must be accounted for separately.

## Startup log
`[PG_DISPATCH_WRITE_GUARD] writesAllowed=false|true` (via `logPgWriteGuard`), warn-level when writes are allowed.

## Verifying
`verify-write-gates.ts` (+ `.mjs` runner) is a pure offline matrix (no DB) over A–D scenarios + strict-parsing + the runtime force. Run from `artifacts/api-server`: `node ./verify-write-gates.mjs`.
