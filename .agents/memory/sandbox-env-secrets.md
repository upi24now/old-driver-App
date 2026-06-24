---
name: Reading secrets for verification scripts
description: code_execution sandbox cannot read process.env/secrets; use the bash shell instead.
---

The `code_execution` JS sandbox has **no `process.env`** (`typeof process === "object"` but `process.env === undefined`), and `viewEnvVars` only reports presence, never secret *values*. So you cannot build a Firebase Admin (or any secret-backed) client inside the sandbox.

**Why:** the sandbox is isolated from the workspace env injection that normal processes get.

**How to apply:** to run a read-only secret-backed verification (e.g. query production Firestore with FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY), write a throwaway script to `/tmp/*.mjs` and run it with `node` via the **bash tool** — the shell *does* expose the secrets. Import workspace packages (e.g. `firebase-admin`) with `createRequire("/home/runner/workspace/artifacts/<pkg>/package.json")` since they don't resolve from the repo root. Apply the same `\n`→newline fix to FIREBASE_PRIVATE_KEY the server uses. Never print secret values.

For production Postgres reads, prefer `executeSql({ environment: "production" })` (read-only replica) — that callback works from the sandbox without needing env access.
