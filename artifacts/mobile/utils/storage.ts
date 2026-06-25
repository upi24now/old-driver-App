/**
 * storage.ts
 *
 * KYC document upload helper — POSTs to the VPS API server via
 * multipart/form-data.
 *
 * Upload endpoint : https://<EXPO_PUBLIC_UPLOAD_DOMAIN>/api/kyc/upload-open
 * Auth            : x-driver-uid header (the driver's 10-digit phone uid).
 *                   This is the "open" endpoint — it does NOT use a Firebase
 *                   ID token. It is gated server-side: the driver row must
 *                   already exist in PG and registration_fee_paid must be true
 *                   (otherwise it returns 403).
 *
 * One image per request. Each successful upload:
 *   - saves the file to VPS local disk (/uploads/kyc/<uid>/<documentType>.jpg)
 *   - upserts driver_documents (driver_uid, doc_type, url, status='pending')
 *   - on first submit, flips drivers.documents_submitted=true and
 *     verification_status='pending'
 *
 * Returns:
 *   { ok: true, documentType, url: "https://.../uploads/kyc/<uid>/<type>.jpg" }
 */

import * as FileSystem from "expo-file-system/legacy";
// FileSystemUploadType is not re-exported from the expo-file-system main index
// in v56 — import from the legacy sub-path which is the stable, supported way.
import { FileSystemUploadType } from "expo-file-system/legacy";

// ─── Upload domain ─────────────────────────────────────────────────────────────
// EXPO_PUBLIC_UPLOAD_DOMAIN is set to api.bikecourierservice.com in the workflow.
// Falls back to EXPO_PUBLIC_DOMAIN (the Replit dev domain) for local testing.

function getUploadUrl(): string {
  const domain =
    process.env["EXPO_PUBLIC_UPLOAD_DOMAIN"] ??
    process.env["EXPO_PUBLIC_DOMAIN"]        ??
    "";
  return `https://${domain}/api/kyc/upload-open`;
}

// ─── Main upload helper ────────────────────────────────────────────────────────

/**
 * Upload a single local image URI to the VPS open KYC upload endpoint.
 * Returns the publicly accessible HTTPS download URL.
 *
 * @param uid      - Driver UID (the 10-digit phone number; sent as x-driver-uid)
 * @param docId    - documentType slot. Must be one of:
 *                   selfie | aadhaarFront | aadhaarBack | pan |
 *                   licenseFront | licenseBack | rcFront | rcBack
 * @param localUri - Local file:// or content:// path from ImagePicker
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const uploadUrl = getUploadUrl();

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   uploadUrl  :", uploadUrl);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  // ── UID guard ──────────────────────────────────────────────────────────────
  // The open endpoint authenticates the driver purely via the x-driver-uid
  // header, which the server requires to be exactly 10 digits.
  if (!/^\d{10}$/.test(uid)) {
    console.warn(`[storage] WARNING: uid "${uid}" is not a 10-digit phone number — server will reject it`);
  }

  // ── Multipart upload ───────────────────────────────────────────────────────
  console.log("[storage] starting FileSystem.uploadAsync…");
  let result: Awaited<ReturnType<typeof FileSystem.uploadAsync>>;
  try {
    result = await FileSystem.uploadAsync(uploadUrl, localUri, {
      httpMethod:  "POST",
      uploadType:  FileSystemUploadType.MULTIPART,
      fieldName:   "file",
      mimeType:    "image/jpeg",
      parameters:  { documentType: docId },
      headers:     { "x-driver-uid": uid },
    });
    console.log("[storage] uploadAsync complete — status:", result.status);
    console.log("[storage] response body:", (result.body ?? "").slice(0, 200));
  } catch (err) {
    const e = err as Error;
    console.error("[storage] uploadAsync THREW:", e?.message);
    throw new Error(`Network error during upload: ${e?.message ?? String(err)}`);
  }

  // ── Parse response ─────────────────────────────────────────────────────────
  if (result.status < 200 || result.status >= 300) {
    let serverError = `Server responded ${result.status}`;
    try {
      const parsed = JSON.parse(result.body) as { error?: string };
      if (parsed.error) serverError = `${serverError}: ${parsed.error}`;
    } catch { /* ignore parse error */ }
    throw new Error(serverError);
  }

  let parsed: { ok: boolean; documentType?: string; url?: string; error?: string };
  try {
    parsed = JSON.parse(result.body) as typeof parsed;
  } catch {
    throw new Error(`Invalid JSON from upload server: ${(result.body ?? "").slice(0, 100)}`);
  }

  if (!parsed.ok || !parsed.url) {
    throw new Error(parsed.error ?? "Upload failed: server returned no URL");
  }

  console.log("[storage] download URL:", parsed.url.slice(0, 120));
  return parsed.url;
}

// ─── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Returns true when the URI is already a remote HTTPS URL (a previously
 * uploaded VPS URL) that does not need re-uploading.
 */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith("https://") || uri.startsWith("http://");
}
