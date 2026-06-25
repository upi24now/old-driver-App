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

**How to apply:** Never reintroduce `/api/drivers/documents` for the driver app. Keep document uploads ordered after fee payment. The active onboarding screen is `registration.tsx` (DriverContext collapses all onboarding steps to `/registration`); `document-upload.tsx` is the re-upload path (fee already paid). Show success only after every image returns `ok:true` (sequential upload, abort on first failure). Doc numbers (aadhaar/pan/rc) are NOT accepted by upload-open and are dropped. Treat the prod API as possibly behind the repo — verify endpoints exist on prod before relying on them.
