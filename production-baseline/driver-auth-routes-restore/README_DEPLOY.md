# Restore `/api/auth/*` driver auth routes — live VPS bundle

## What this does
The live `api-pkg/dist/production-api.js` lost its entire `/api/auth/*` router, so
every login call returns `404` (PIN **and** OTP login broken). This re-splices
**only** those routes back in, additively, immediately before the bundle's
`app.use("/api", routes_default)` (i.e. before the catch-all 404 handler).

Restored (and ONLY these):
- `POST /api/auth/send-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/set-pin`
- `GET  /api/auth/pin-status`
- `POST /api/auth/verify-pin`

Route bodies are the exact, proven block from `auth-routes-body.js` — the same
source that produced the routes in your working backup
`production-api.js.bak.driver-plan-active.20260629-061142`.

## Why it is drift-tolerant
The live bundle drifts ahead of every local copy. This patcher therefore:
- has **no base-SHA lock** — it finds the splice point by a unique anchor;
- is **idempotent** — re-running is a safe no-op once applied;
- does **not** depend on the bundle's minified express var name
  (`import_express34` vs `import_express33` …) — express is resolved at runtime
  via `globalThis.require("express")`;
- still reuses the bundle's stable module-scope `app`, `pool`, `auth` bindings,
  and **aborts** (no write) if `pool.query(` is absent — never ships a crashing boot.

Purely additive: **0 deletions, 0 modifications**. Removing the inserted block
reproduces the base byte-for-byte (the patcher self-proves this and aborts if not).

## Touches NOTHING else
driver plans · Razorpay · customer orders · dispatch · offers · wallet · FCM ·
KYC · driver online/offline · active delivery · demo mode · frontend — all untouched.

---

## Deploy (run on the VPS, inside `api-pkg/`)

```bash
# 0) copy this folder to the VPS (example)
#    scp -r driver-auth-routes-restore  user@vps:/path/to/api-pkg/

cd /path/to/api-pkg

# 1) apply (auto-backs up the current bundle, then patches in place)
node driver-auth-routes-restore/apply-auth-restore.cjs dist/production-api.js

# 2) verify syntax
node --check dist/production-api.js

# 3) prove the 5 routes now exist
grep -o 'authRouter\.\(post\|get\)("/auth/[a-z-]*"' dist/production-api.js | sort

# 4) prove no unrelated routes changed (stripping the inserted block == the backup)
#    (replace TIMESTAMP with the .bak file the apply step printed)
sed '/BEGIN PG-ONLY AUTH ROUTES RESTORE PATCH/,/END PG-ONLY AUTH ROUTES RESTORE PATCH/d' \
    dist/production-api.js > /tmp/stripped.js
diff -B dist/production-api.js.bak.auth-restore.TIMESTAMP /tmp/stripped.js \
    && echo "ADDITIVE-ONLY: base reproduced ignoring blank lines"

# 5) restart the service (pm2 — adjust the app name to your ecosystem)
pm2 restart bike-courier-api --update-env
pm2 logs bike-courier-api --lines 50 | grep AUTH_PATCH
#   expect: [AUTH_PATCH] /api/auth/* routes mounted (send-otp, verify-otp, verify-pin, set-pin, pin-status)
#   expect: [AUTH_PATCH] schema ensured (...)

# 6) live smoke test (expect 200/400/401, NOT 404)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.bikecourierservice.com/api/auth/send-otp \
     -H 'Content-Type: application/json' -d '{"phone":"8299013350"}'
```

## Rollback (single command)
Restore the backup the apply step created, then restart:

```bash
cd /path/to/api-pkg
cp dist/production-api.js.bak.auth-restore.TIMESTAMP dist/production-api.js
pm2 restart bike-courier-api --update-env
```

(`TIMESTAMP` is printed by the apply step as `BACKUP : …`. The original
pre-patch bundle is preserved untouched in that file.)
