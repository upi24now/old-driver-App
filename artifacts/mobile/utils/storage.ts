/**
 * storage.ts
 *
 * KYC document upload helper — POSTs to the VPS API server via
 * multipart/form-data.
 *
 * Upload endpoint : https://<EXPO_PUBLIC_UPLOAD_DOMAIN>/api/kyc/upload
 * Auth            : Firebase ID token in Authorization: Bearer header
 *
 * The server saves the file to disk and returns:
 *   { ok: true, url: "https://api.bikecourierservice.com/api/uploads/kyc/<uid>/<docId>.jpg" }
 *
 * That URL is stored in Firestore by submitDriverDocuments() in firestore.ts.
 */

import * as FileSystem from "expo-file-system/legacy";
// FileSystemUploadType is not re-exported from the expo-file-system main index
// in v56 — import from the legacy sub-path which is the stable, supported way.
import { FileSystemUploadType } from "expo-file-system/legacy";
import { firebaseAuth } from "./firebase";

// ─── Upload domain ─────────────────────────────────────────────────────────────
// EXPO_PUBLIC_UPLOAD_DOMAIN is set to api.bikecourierservice.com in the workflow.
// Falls back to EXPO_PUBLIC_DOMAIN (the Replit dev domain) for local testing.

function getUploadUrl(): string {
  const domain =
    process.env["EXPO_PUBLIC_UPLOAD_DOMAIN"] ??
    process.env["EXPO_PUBLIC_DOMAIN"]        ??
    "";
  return `https://${domain}/api/kyc/upload`;
}

// ─── Main upload helper ────────────────────────────────────────────────────────

/**
 * Upload a local image URI to the VPS KYC upload endpoint.
 * Returns the publicly accessible HTTPS download URL.
 *
 * @param uid      - Driver UID (must match Firebase Auth UID)
 * @param docId    - Document slot: selfie | aadhaar | pan | license | rc | insurance
 * @param localUri - Local file:// or content:// path from ImagePicker
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const uploadUrl   = getUploadUrl();
  const currentUser = firebaseAuth.currentUser;

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   uploadUrl  :", uploadUrl);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));
  console.log("[storage]   authUid    :", currentUser?.uid ?? "(null — unauthenticated!)");

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (!currentUser) {
    throw new Error("upload/unauthenticated: no Firebase Auth session");
  }
  if (currentUser.uid !== uid) {
    console.warn(`[storage] WARNING: authUid "${currentUser.uid}" !== uid "${uid}"`);
  }

  // ── Get fresh ID token ─────────────────────────────────────────────────────
  console.log("[storage] forceFreshToken=true");
  console.log("[storage] uid=" + currentUser.uid);
  let token: string;
  try {
    token = await currentUser.getIdToken(/* forceRefresh */ true);
    console.log("[storage] token length=" + token.length);
    console.log("[storage] token prefix=" + token.slice(0, 20));
  } catch (err) {
    const e = err as Error;
    console.error("[storage] getIdToken FAILED:", e?.message);
    throw new Error(`Could not get auth token: ${e?.message ?? String(err)}`);
  }

  const authHeader = `Bearer ${token}`;
  console.log("[storage] Authorization header prefix=" + authHeader.slice(0, 14) + "…");

  // ── Multipart upload ───────────────────────────────────────────────────────
  console.log("[storage] starting FileSystem.uploadAsync…");
  let result: Awaited<ReturnType<typeof FileSystem.uploadAsync>>;
  try {
    result = await FileSystem.uploadAsync(uploadUrl, localUri, {
      httpMethod:  "POST",
      uploadType:  FileSystemUploadType.MULTIPART,
      fieldName:   "file",
      mimeType:    "image/jpeg",
      parameters:  { uid, documentType: docId },
      headers:     { Authorization: authHeader },
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

  let parsed: { ok: boolean; url?: string; error?: string };
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
