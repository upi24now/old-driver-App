---
name: api-server rebuild required before restart
description: restart_workflow alone does not recompile the api-server; the stale dist/index.mjs keeps running unless build is run first.
---

## Rule

Any time source files under `artifacts/api-server/src/` are changed, you MUST run:

```
pnpm --filter @workspace/api-server run build
```

**before** calling `restart_workflow`. Only then will the running server serve the new code.

**Why:** The `dev` script is `pnpm run build && pnpm run start`. `restart_workflow` sends SIGTERM to the running `node dist/index.mjs` process. The workflow manager restarts **that same node command** — it does not re-run the full `dev` script from scratch. Result: source changes compile fine via typecheck but the live dist bundle stays stale.

**How to apply:** After every api-server source edit:
1. `pnpm --filter @workspace/api-server run build` — rebuild dist
2. `restart_workflow "artifacts/api-server: API Server"` — start new process from fresh bundle
3. Confirm new PID appears in logs (old PID keeps serving stale code until restart completes)

**Evidence:** After fixing the ₹5→₹10 floor clamp, the new `[FeeDebug]` logs and `Math.max` code existed in source but `dist/index.mjs` was 90 minutes old. The live server kept logging `amountInr: 5` until an explicit `pnpm run build` was run.
