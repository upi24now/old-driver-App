---
name: KYC admin read-path migration
description: Admin panel GET /kyc/drivers was Firestore-only but document submission is PG-primary — fixed by switching read to PG + adding Firestore projection on submit.
---

## The gap

`POST /api/drivers/documents` (PG-primary) writes **only to PG** — no Firestore mirror.
`GET /api/kyc/drivers` (admin panel list) queried **Firestore only**: `drivers.where("documentsSubmitted", "==", true)`.
Result: any driver who submitted via the new PG flow was invisible to the admin panel.

## Fix applied

1. **`GET /api/kyc/drivers`** switched to PG read (driversTable + driverDocumentsTable batch join).
   Response shape identical to previous Firestore version — admin panel requires no changes.

2. **`POST /api/drivers/documents`** gained a fire-and-forget Firestore projection after the PG write:
   - Sets documentsSubmitted, documentsSubmittedAt, verificationStatus=pending, kycRejectionReason=null, rejectedDocuments=null.
   - Sets documents.{docType} = { url, status: "pending" } for each submitted doc.
   - Fetches driver row from PG to include profile fields (name, phone, city, vehicleId, etc.).
   - Uses `merge: true` — safe even if Firestore doc doesn't exist yet.

**Why:** approve/reject routes still fire-and-forget mirror writes to Firestore; having a Firestore doc prevents cold-create race on approve. The projection is non-fatal (logged as WARN on failure).

## Secondary issues noted (not fixed here)

- Document URLs stored as `http://sisko.replit.dev/...` (HTTP, dev domain) — `API_PUBLIC_URL` not set.
- Files are stored on local disk — not suitable for autoscale/deployed server (ephemeral filesystem).
  Real fix: migrate KYC uploads to object storage (Firebase Storage, GCS, or S3).
- Driver 918299013350 is missing `licenseBack` (7 of 8 docs uploaded).
