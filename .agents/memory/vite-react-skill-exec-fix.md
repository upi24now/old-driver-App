---
name: Vite react-vite skill exec fix
description: When using the react-vite integratedSkill, pnpm process tree too deep for Replit port detection; fix with exec in dev script.
---

When a Vite artifact uses `[[integratedSkills]] name = "react-vite"`, Replit's workflow port detection consistently reports `openPorts: null` and times out with `DIDNT_OPEN_A_PORT` even though Vite starts fine and serves HTTP 200.

**Root cause:** The process tree `workflow → sh → pnpm → sh → node vite.js` is too deep for the port scanner to track.

**Fix:** Add `exec` to the `dev` script in `package.json`:
```json
"dev": "exec vite --config vite.config.ts --host 0.0.0.0"
```

`exec` replaces the intermediate shell(s) with the vite process, making `node vite.js` a closer descendant of the workflow root process. After this change, `restart_workflow` succeeds immediately.

**Why:** Replit's port monitor tracks port bindings by process subtree. The `react-vite` skill adds an extra nesting layer compared to `kind = "design"` artifacts (which don't have integratedSkills). `exec` collapses the chain so the port open is visible to the monitor.

**How to apply:** Whenever creating a `kind = "web"` artifact with `react-vite` integratedSkill, always set the dev script to `exec vite ...` not just `vite ...`.
