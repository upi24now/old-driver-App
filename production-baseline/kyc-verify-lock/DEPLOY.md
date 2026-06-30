# KYC document lock — LIVE production VPS deploy

Locks driver KYC documents once a driver is **approved/verified**. After that,
the only driver-facing document-mutation endpoint on the live API returns:

```
403  { "error": "Documents are locked after verification." }
```

Unverified / pending / rejected drivers are **unaffected** and keep working
exactly as before.

---

## What this patches (and what it does NOT)

The live server (`https://api.bikecourierservice.com`) exposes **one**
driver-facing document-mutation route:

```
POST /api/kyc/driver/:uid/submit-documents     (driverAuth)
```

This is the only API path that records a document state change for a driver.
(The legacy `/api/kyc/upload-open` route **does not exist** on the live server —
it returns 404 — so it is intentionally not touched. KYC image bytes are
uploaded client-side; this endpoint is the server-side gate.)

The patch injects a lock check at the very top of that handler:

- Reads `verification_status` and `kyc_status` for the driver.
- If **either** is `approved` or `verified` (case-insensitive) → `403` with the
  exact message above, **before** any DB write.
- If the status read fails (DB fault) → `503` **fail-closed** (never lets an
  approved driver re-submit).
- Otherwise the request falls through to the original handler unchanged.

**Untouched:** login / PIN / OTP / auth, the admin `approve` / `reject` routes
(still `adminAuth`), dispatch, orders, plans, Razorpay, wallet, online/offline,
active ride, maps, notifications, customer app, and every other route. The patch
adds **one** code block (+864 bytes) and nothing else.

Self-locating & idempotent: it anchors on the route literal and the handler's
first statement, so it survives esbuild variable-name drift, and re-running is a
no-op.

---

## Files in this package

| File | Purpose |
|---|---|
| `apply-kyc-submitdocs-lock.cjs` | The patcher. Run it on the VPS against the live bundle. |
| `verify-submitdocs-lock.mjs` | Behavior harness (12 cases) — proves the lock logic. |
| `base-2fd330d4-production-api.js` | Clean reference bundle matching live (for SHA compare). |
| `production-api.patched-3a084d60.js` | Patched reference (what a clean patch produces). |
| `SHA256SUMS.txt` | Checksums of the above. |

> The **recommended** flow runs the patcher directly on the live VPS file, so it
> works even if the live bundle has drifted slightly from the reference. The
> reference bundles are only for verification / fallback.

---

## VPS paths (from `ecosystem.config.cjs`)

- pm2 app name: `bike-courier-api`
- script: `dist/production-api.js`
- bundle path: `/home/<api-user>/htdocs/api.bikecourierservice.com/api-pkg/dist/production-api.js`

> Replace `<api-user>` / confirm the exact `api-pkg` path with `pm2 describe bike-courier-api` (look at the `script path` / `cwd`).

---

## Deploy steps (run on the VPS)

```bash
# 0) Locate the live bundle and confirm pm2 app
pm2 describe bike-courier-api | grep -E "script path|exec cwd"
BUNDLE=/home/<api-user>/htdocs/api.bikecourierservice.com/api-pkg/dist/production-api.js
ls -l "$BUNDLE"

# 1) BACKUP the live bundle (timestamped, never overwrite)
cp -n "$BUNDLE" "$BUNDLE.pre-submitdocslock.$(date +%Y%m%d-%H%M%S).bak"
ls -l "$BUNDLE".*.bak

# 2) Upload apply-kyc-submitdocs-lock.cjs next to the bundle, then patch IN PLACE.
#    The patcher writes its own one-time backup: <bundle>.submitdocslock.bak
node apply-kyc-submitdocs-lock.cjs "$BUNDLE"
#    Expected: "PATCHED   production-api.js  (backup: production-api.js.submitdocslock.bak)"
#    Re-running prints "skipped (already patched)".

# 3) Syntax check the patched bundle (must print nothing / exit 0)
node --check "$BUNDLE" && echo "PARSE OK"

# 4) Restart the API
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 40   # confirm clean boot, then Ctrl-C
```

---

## Verify after deploy

Use real driver tokens. `<TOKEN_APPROVED>` = a driver whose KYC is
approved/verified; `<TOKEN_PENDING>` = a pending/rejected driver. `<UID>` = that
driver's uid.

```bash
H=https://api.bikecourierservice.com

# A) APPROVED driver -> MUST be blocked with 403 + exact message
curl -s -o /dev/null -w "approved -> %{http_code}\n" \
  -X POST "$H/api/kyc/driver/<UID_APPROVED>/submit-documents" \
  -H "Authorization: Bearer <TOKEN_APPROVED>" -H "Content-Type: application/json" -d '{}'
# expect: 403   body: {"error":"Documents are locked after verification."}

# B) PENDING/REJECTED driver -> MUST still work (200 ok:true), unchanged
curl -s -o /dev/null -w "pending  -> %{http_code}\n" \
  -X POST "$H/api/kyc/driver/<UID_PENDING>/submit-documents" \
  -H "Authorization: Bearer <TOKEN_PENDING>" -H "Content-Type: application/json" -d '{}'
# expect: 200

# C) Sanity: admin approve/reject still reachable (auth-gated, NOT locked)
curl -s -o /dev/null -w "admin approve route -> %{http_code}\n" \
  -X POST "$H/api/kyc/driver/<UID>/approve" -H "Content-Type: application/json" -d '{}'
# expect: 401/403 (auth required) — NOT 404, NOT broken
```

Offline logic proof (run anywhere with Node, no DB needed):

```bash
node verify-submitdocs-lock.mjs production-api.patched-3a084d60.js
# expect: 12/12 passed
```

---

## Rollback (instant)

```bash
# Option 1: restore the patcher's own one-time backup
cp "$BUNDLE.submitdocslock.bak" "$BUNDLE"
pm2 restart bike-courier-api

# Option 2: restore your step-1 timestamped backup
cp "$BUNDLE.pre-submitdocslock.<TIMESTAMP>.bak" "$BUNDLE"
pm2 restart bike-courier-api
```

After rollback, `node --check "$BUNDLE"` should pass and the `approved` driver
curl in step A returns to its pre-patch behavior (200).

---

## Notes

- The reference `base-2fd330d4-production-api.js` matches the live server's route
  fingerprint (`verify-pin` / `verify-otp` / `send-otp` / `set-pin` present;
  `/upload-open`, `mpin/login`, `otp/gate` absent — all confirmed against live).
  If `sha256sum "$BUNDLE"` equals `2fd330d4…`, the live bundle is byte-identical
  to the tested base and the patched result will equal `3a084d60…`.
- If the SHA differs (a newer build was deployed), still prefer running the
  patcher in place — it is self-locating and will patch the current
  submit-documents handler, or fail safely (writes nothing) if the route shape
  changed.
