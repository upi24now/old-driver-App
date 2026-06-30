---
name: KYC upload via fee-gated open endpoint
description: Driver KYC images upload to /api/kyc/upload-open (x-driver-uid header), fee-gated; prod VPS API diverges from repo.
---

# KYC document upload (driver app)

Driver KYC images upload via `POST /api/kyc/upload-open` (mobile helper `uploadDocumentImage` in `artifacts/mobile/utils/storage.ts`).

- Auth: `x-driver-uid` header = the driver's 10-digit phone uid. It is the "open" endpoint — NO Firebase Bearer token.
- Multipart: field `file` (ONE image per request) + `documentType` (one of: selfie, aadhaarFront, aadhaarBack, pan, licenseFront, licenseBack, rcFront, rcBack).
- **Fee-gated**: requires the PG `drivers` row to already exist AND `registration_fee_paid=true`, else 403. So uploads MUST run AFTER the row is created (registerDriverKeys + patchDriverProfile/Vehicle) and AFTER the onboarding fee is verified.
- Each success upserts `driver_documents(status='pending')` and flips `drivers.documents_submitted=true` / `verification_status='pending'` server-side — so there is NO separate PG submit call.

**Why:** The production VPS API (https://api.bikecourierservice.com/api) DIVERGED from the repo: prod HAS `upload-open` but LACKS `POST /api/drivers/documents` (404). The repo's old flow uploaded to `/api/kyc/upload` then called `submitDocumentsToPostgres` → `/api/drivers/documents`, which 404'd on prod, so no driver/document rows were created and drivers stayed invisible to the admin panel. `upload-open` does the file save + PG writes in one call.

**Deploy hazard (proven):** `upload-open` has NO source in this repo (absent from every branch — `main`, `replit-agent`, backups) yet is LIVE on the VPS (`POST /api/kyc/upload-open` → 400 on empty body = route matched, not 404). Meanwhile the repo HAS the driver/admin OTP routes that the VPS is missing (send-otp/verify-otp/admin request-otp all 404 on prod). So a repo-built `dist` is NOT a superset of prod: shipping it would ADD OTP but DROP `upload-open` → KYC upload regression. Never dist-deploy from this repo without first restoring upload-open into source (or confirming the prod bundle is preserved).

**How to apply:** Never reintroduce `/api/drivers/documents` for the driver app. Keep document uploads ordered after fee payment. The active onboarding screen is `registration.tsx` (DriverContext collapses all onboarding steps to `/registration`); `document-upload.tsx` is the re-upload path (fee already paid). Show success only after every image returns `ok:true` (sequential upload, abort on first failure). Doc numbers (aadhaar/pan/rc) are NOT accepted by upload-open and are dropped. Treat the prod API as possibly behind the repo — verify endpoints exist on prod before relying on them.

## Documents-lock-after-verification (added)
Lock rule: once `drivers.verification_status` ∈ {approved, verified}, KYC docs are read-only (no upload/replace/delete/re-upload/picker). Enforced in:
- Frontend `artifacts/mobile/app/document-upload.tsx` (driver-level `driverLocked` forces all cards "locked", label "Verified • Locked", guards in handleUpload/removeDoc).
- Source backend routes `POST /api/kyc/upload` (pre-multer gate so verified file is never overwritten) + `POST /api/drivers/documents`, via `artifacts/api-server/src/lib/kyc-lock.ts` (`isDriverVerificationLocked`, 403 message "Documents are locked after verification.").
**Prod enforcement — CORRECTED (the `/upload-open` assumption was wrong for the CURRENT live server).** Black-box fingerprinting of `https://api.bikecourierservice.com` proved: `/api/kyc/upload-open` → **404 (absent)**, `mpin/login` → 404, `otp/gate` → 404, but `verify-pin`/`verify-otp`/`send-otp`/`set-pin`/`healthz` all present. The ONLY bundle matching that exact surface is `production-baseline/dist/production-api.js` (sha `2fd330d4…`). The `attached_assets/current-live-*` 8.5/8.6MB snapshots use `mpin/login`+`otp/gate` (404 on live → NOT live); the 4MB `live-production-api_…` has `/upload-open` (404 on live → NOT live). **So the live bundle = `dist/production-api.js`.**
- **Live driver document-write route = `POST /api/kyc/driver/:uid/submit-documents`** (driverAuth; mounted via `kyc_default`/router8 under `/api`). It only flips `documents_submitted=true`/`kyc_status='submitted'` on `driversTable` — it does NOT write files. `driverDocumentsTable` is **only read** (GET `/api/kyc/driver/:uid/documents`, adminAuth) and never inserted/updated/deleted anywhere in the live bundle → KYC image bytes are uploaded client-side, so submit-documents is the only server-side doc-mutation gate to lock. Admin `approve`/`reject` (adminAuth, same router8) MUST stay open.
- Prefix discovery gotcha: domain routers (`kyc_default`,`drivers_default`,…) mount on `routes_default` at `/api`, so the real path is `/api/kyc/driver/:uid/...` — probing `/api/driver/...` or `/api/admin/driver/...` falsely 404s. An existing route returns **401** (auth) vs **404** (absent); use that to confirm a route exists.
- Patch package for the live route: `production-baseline/kyc-verify-lock/apply-kyc-submitdocs-lock.cjs` (sentinel `KYC_SUBMITDOCS_LOCK_V1`, anchors on `"/driver/:uid/submit-documents"` then the handler's `const uid = String(req.params["uid"]);`; one-time backup `<file>.submitdocslock.bak`; +864 bytes, one insertion). Harness `verify-submitdocs-lock.mjs` (12 cases) + `DEPLOY.md` (pm2 `bike-courier-api`, backup/patch/`node --check`/restart/rollback). No SSH to VPS exists → hand off the package; operator runs the self-locating patcher in place.

**Lock rules learned (apply to BOTH source guard and bundle patch):**
- **Fail CLOSED on indeterminate status.** For an *authenticated* document-write request, a DB error must NOT pass through — return 503, never `next()`. Fail-open on a write-mutation access-control gate is a real bypass. (Token-invalid is different: that still falls through to the existing 401 path.)
- **Evaluate verification_status and kyc_status INDEPENDENTLY** (`vs===approved||vs===verified||ks===approved||ks===verified`). The naive `(vs || ks)` fallback silently misses mixed rows like `vs=pending, ks=approved` because a truthy non-approved `vs` short-circuits `ks`.
- Source schema caveat: the source `drivers` table (`lib/db/src/schema/drivers.ts`, exported as `ln`) has ONLY `verification_status` — there is NO `kyc_status` column there, so the source helper checks verification_status only; the VPS bundle DB has both.
