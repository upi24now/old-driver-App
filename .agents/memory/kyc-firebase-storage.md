---
name: KYC Firebase Storage migration
description: KYC docs upload directly to Firebase Storage from the mobile app; no Hostinger VPS or custom API server involved.
---

## Rule
KYC document uploads go directly from the mobile app to Firebase Storage. The Hostinger `/api/kyc/upload` endpoint is abandoned.

## Storage path
`drivers/{uid}/kyc/{docId}.jpg` — where docId is one of: selfie, aadhaar, pan, license, rc, insurance.

## Upload mechanism
`fetch(localUri).blob()` → `uploadBytes(ref(storage, path), blob, {contentType})` → `getDownloadURL()`.
React Native's `fetch()` can read `file://` and `content://` URIs natively (Expo SDK 54+).

## Firestore write
`submitDriverDocuments()` writes two structures on `drivers/{uid}`:
1. `documents.{id}.uri` + `documents.{id}.status = "pending"` — per-doc status map for admin review (backward compat).
2. `kycDocuments.{field}` — flat URL map for admin panel / external consumers.

## docId → kycDocuments field mapping
- selfie    → selfieUrl
- aadhaar   → aadhaarFrontUrl
- insurance → aadhaarBackUrl  (the "insurance" slot is Aadhaar Back per DOCS in document-upload.tsx — confusing but correct)
- pan       → panUrl
- license   → drivingLicenseUrl
- rc        → vehicleRcUrl

**Why:** The "insurance" docId was repurposed for Aadhaar Back in the UI but the id string was never changed. Any future doc slot changes must update this mapping in firestore.ts.

## Admin panel
No admin panel artifact exists in this repo. The external admin panel reads `drivers/{uid}.kycDocuments` directly from Firestore.
