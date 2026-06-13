---
name: KYC VPS upload (canonical approach)
description: KYC docs upload from mobile to VPS API server via FileSystem.uploadAsync; NOT Firebase Storage.
---

## Rule
KYC document uploads go from the mobile app → VPS API (`https://api.bikecourierservice.com/api/kyc/upload`) via multipart/form-data. Do NOT use Firebase Storage for this.

## Mobile upload (storage.ts)
- `FileSystem.uploadAsync` from `expo-file-system`
- `FileSystemUploadType` must be imported from `expo-file-system/legacy` (NOT from the main index in v56)
- Auth: `firebaseAuth.currentUser?.getIdToken()` → Bearer header
- EXPO_PUBLIC_UPLOAD_DOMAIN=api.bikecourierservice.com (set in workflow)
- Upload URL: `https://${EXPO_PUBLIC_UPLOAD_DOMAIN}/api/kyc/upload`
- On success: server returns `{ ok: true, url: "https://...api/uploads/kyc/{uid}/{docId}.jpg" }`

## expo-file-system v56 import quirk
`FileSystemUploadType` is in `expo-file-system/legacy` sub-path (NOT re-exported from main index).
`FileSystemUploadResult` type: use `Awaited<ReturnType<typeof FileSystem.uploadAsync>>` instead of `FileSystem.FileSystemUploadResult`.

## Backend (api-server)
- Route: `POST /api/kyc/upload` in `kyc-upload.ts`
- Auth: `adminAuth().verifyIdToken(bearerToken)` — logs `[SERVER_VERIFY_TOKEN_OK]` / `[SERVER_VERIFY_TOKEN_FAIL]`
- Saves file at: `{UPLOADS_DIR}/kyc/{uid}/{docId}.jpg` — logs `[KYC_UPLOAD_FILE_SAVED]`
- Download URL: `{API_PUBLIC_URL}/api/uploads/kyc/{uid}/{docId}.jpg`
- Static route mounted at `/api/uploads` via `initStaticUploads(uploadsDir)` called from index.ts

## Critical env-loading fix (ESM import hoisting)
Static ESM imports are hoisted before module body. `app.ts` module-level constants
capture `process.env` BEFORE dotenv runs. Fix: `initStaticUploads(uploadsDir)` is
exported from `app.ts` and called in `index.ts` AFTER `dotenvConfig()` runs.
Same in `kyc-upload.ts`: `getUploadsDir()` reads `process.env["UPLOADS_DIR"]` at
request time, not at module init.

## Startup logs added
`index.ts` logs `{ uploadsDir, publicUrl }` after dotenv. Firebase Admin logs `{ projectId }` on init. Upload route logs `[KYC_UPLOAD_FILE_SAVED]` with uid/docId/size/path.

## Deployment package
- Built with `pnpm --filter @workspace/api-server deploy --prod --legacy /tmp/api-deploy`
- Contains: `dist/` (esbuild bundle) + `node_modules/` (production, pnpm resolved) + `package.json`
- firebase-admin is externalized from esbuild bundle → must be in node_modules ✅
- All other deps (express, cors, pino, multer, dotenv) are bundled into dist/index.mjs
- Deploy target: `/home/bikecourierservice-api/htdocs/api.bikecourierservice.com/bike-courier-api`
- Activation: extract package + create .env + `pm2 restart api` (or `pm2 start dist/index.mjs --name api`)

## Firestore schema (unchanged)
`submitDriverDocuments()` writes `documents.{id}.uri` + `documents.{id}.status="pending"` + `documentsSubmitted=true` + `verificationStatus="pending"` + `documentsSubmittedAt=serverTimestamp()`.
