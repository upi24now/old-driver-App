/**
 * storage.ts
 *
 * KYC document upload helper — uploads to the Bike Courier API server (VPS),
 * not to Firebase Storage.
 *
 * Upload method — multipart/form-data via the API server:
 *   POST <BASE_URL>/kyc/upload
 *   Fields: file (image), uid, docId
 *   Auth:   Bearer Firebase ID token
 *
 * The server stores files at:
 *   <UPLOADS_DIR>/kyc/<uid>/<docId>.jpg
 *
 * and returns:
 *   { ok: true, url: "https://api.bikecourierservice.com/uploads/kyc/<uid>/<docId>.jpg" }
 *
 * The returned URL is stored in Firestore by submitDriverDocuments() — no
 * changes needed to the Firestore schema or submitDriverDocuments().
 *
 * Environment (mobile):
 *   EXPO_PUBLIC_DOMAIN — the API server host (e.g. api.bikecourierservice.com in prod,
 *                        Replit dev domain in development)
 *   EXPO_PUBLIC_FIREBASE_API_KEY etc. — Firebase Auth still used for ID tokens
 */

import * as FileSystem from "expo-file-system/legacy";
import { firebaseAuth } from "./firebase";

// ─── Upload base URL ──────────────────────────────────────────────────────────
//
// Uses EXPO_PUBLIC_UPLOAD_DOMAIN when set (points at Hostinger VPS for KYC uploads).
// Falls back to EXPO_PUBLIC_DOMAIN so EAS builds that don't set UPLOAD_DOMAIN
// still work.  In dev (Expo Go) EXPO_PUBLIC_UPLOAD_DOMAIN=api.bikecourierservice.com
// is injected by the dev script so uploads always go to the VPS, while auth/login
// routes continue to use EXPO_PUBLIC_DOMAIN (the Replit dev domain).

const UPLOAD_DOMAIN = process.env["EXPO_PUBLIC_UPLOAD_DOMAIN"] ?? process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = UPLOAD_DOMAIN ? `https://${UPLOAD_DOMAIN}/api` : "/api";

// ─── Content-type detection ───────────────────────────────────────────────────

function contentTypeFromUri(uri: string): string {
  const lower = (uri.toLowerCase().split("?")[0]) ?? "";
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// ─── Main upload helper ───────────────────────────────────────────────────────

/**
 * Upload a local image URI to the API server as multipart/form-data.
 * Returns the permanent HTTPS download URL served by the API server.
 *
 * @param uid      - Driver UID (must match the Firebase Auth UID)
 * @param docId    - Document slot: selfie | aadhaar | pan | license | rc | insurance
 * @param localUri - Local file:// or content:// path from ImagePicker
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const authUid     = firebaseAuth.currentUser?.uid ?? null;
  const contentType = contentTypeFromUri(localUri);
  const uploadUrl   = `${BASE_URL}/kyc/upload`;

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   authUid    :", authUid ?? "(null — unauthenticated!)");
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   uploadUrl  :", uploadUrl);
  console.log("[storage]   contentType:", contentType);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!authUid) {
    throw new Error("upload/unauthenticated: no Firebase Auth session");
  }
  if (authUid !== uid) {
    console.warn(`[storage] WARNING: authUid "${authUid}" !== uid "${uid}"`);
  }

  // ── Get Firebase ID token ─────────────────────────────────────────────────
  let idToken: string;
  try {
    idToken = await firebaseAuth.currentUser!.getIdToken(/* forceRefresh */ true);
  } catch (err) {
    const e = err as Error;
    console.error("[storage] getIdToken FAILED:", e?.message);
    throw new Error(`Could not get auth token: ${e?.message ?? String(err)}`);
  }

  console.log("[UPLOAD_API_URL]", uploadUrl);
  console.log("[UPLOAD_TOKEN_PRESENT]", idToken.length > 0 ? "yes" : "NO — empty token!");
  console.log("[UPLOAD_TOKEN_UID]", authUid);

  // ── Read file as base64, then build a data URI for fetch ──────────────────
  //
  // React Native's fetch() cannot read file:// URIs as a body stream.
  // We use expo-file-system to read the file as base64, convert it to a
  // Uint8Array, and use that as the fetch body for the multipart part.
  // expo-file-system/legacy uploadAsync is the most reliable alternative,
  // so we use FileSystem.uploadAsync which natively handles multipart on
  // both iOS and Android without Blob or ArrayBuffer.
  console.log("[storage] uploading via FileSystem.uploadAsync (multipart)…");

  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(uploadUrl, localUri, {
      httpMethod:   "POST",
      uploadType:   FileSystem.FileSystemUploadType.MULTIPART,
      fieldName:    "file",
      mimeType:     contentType,
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      parameters: {
        uid,
        docId,
      },
    });
  } catch (err) {
    const e = err as Error;
    console.error("[storage] FileSystem.uploadAsync THREW:", e?.message);
    console.error("[storage]   stack:", e?.stack);
    throw new Error(`Upload network error: ${e?.message ?? String(err)}`);
  }

  console.log("[storage] uploadAsync status:", result.status);
  console.log("[storage] uploadAsync body  :", result.body?.slice(0, 300));

  if (result.status < 200 || result.status >= 300) {
    console.error("[storage] Upload FAILED ───────────────────────────");
    console.error("[storage]   status:", result.status);
    console.error("[storage]   body  :", result.body);
    let serverError = `HTTP ${result.status}`;
    try {
      const parsed = JSON.parse(result.body) as { error?: string };
      if (parsed.error) serverError = parsed.error;
    } catch { /* ignore parse errors */ }
    throw new Error(`Upload failed: ${serverError}`);
  }

  // ── Parse response and extract URL ────────────────────────────────────────
  let parsed: { ok: boolean; url?: string; error?: string };
  try {
    parsed = JSON.parse(result.body) as typeof parsed;
  } catch (err) {
    console.error("[storage] Failed to parse server response:", result.body);
    throw new Error("Server returned an unexpected response after upload.");
  }

  if (!parsed.ok || !parsed.url) {
    console.error("[storage] Server returned ok:false or missing url:", parsed);
    throw new Error(parsed.error ?? "Server did not return a download URL.");
  }

  console.log("[storage] upload OK — downloadURL:", parsed.url.slice(0, 100));
  return parsed.url;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Returns true when the URI is already a remote HTTPS URL that does not need
 * re-uploading (e.g. a URL already stored in Firestore from a previous upload).
 */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith("https://") || uri.startsWith("http://");
}
