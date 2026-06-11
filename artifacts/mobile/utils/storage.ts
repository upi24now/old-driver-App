/**
 * storage.ts
 *
 * Firebase Storage helpers for KYC document uploads.
 *
 * Upload method — Firebase Storage REST API with base64 body:
 *   The Firebase Web Storage SDK (uploadBytes / uploadString) internally
 *   constructs Blob/ArrayBuffer, which React Native/Expo does not support.
 *   Workaround: read the file as base64 with expo-file-system/legacy, then
 *   POST directly to the Firebase Storage REST endpoint with the raw base64
 *   string as the body and Content-Transfer-Encoding: base64.
 *   No Blob, no ArrayBuffer, no XMLHttpRequest blob.
 *
 * Storage paths:
 *   drivers/{uid}/selfie.jpg
 *   drivers/{uid}/aadhaar.jpg
 *   drivers/{uid}/pan.jpg
 *   drivers/{uid}/license.jpg
 *   drivers/{uid}/rc.jpg
 *   drivers/{uid}/insurance.jpg
 *
 * Firebase Storage rules required:
 *   match /drivers/{uid}/{fileName} {
 *     allow read:  if request.auth != null;
 *     allow write: if request.auth != null && request.auth.uid == uid;
 *   }
 */

import * as FileSystem from "expo-file-system/legacy";
import { firebaseAuth } from "./firebase";

// ─── Bucket ───────────────────────────────────────────────────────────────────

const BUCKET = process.env["EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"] ?? "";

// ─── Content-type detection ───────────────────────────────────────────────────

function contentTypeFromUri(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// ─── Main upload helper ───────────────────────────────────────────────────────

/**
 * Upload a local image URI to Firebase Storage using the REST API + base64.
 * No Blob, no ArrayBuffer, no Firebase Storage SDK upload methods.
 *
 * @param uid      - Driver UID (must match Firebase Auth UID for Storage rules)
 * @param docId    - Document slot identifier used as the filename stem (e.g. "selfie")
 * @param localUri - Local file:// or content:// path from ImagePicker / cache
 * @returns        - Permanent HTTPS download URL
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const authUid     = firebaseAuth.currentUser?.uid ?? null;
  const objectPath  = `drivers/${uid}/${docId}.jpg`;
  const encodedPath = encodeURIComponent(objectPath);
  const contentType = contentTypeFromUri(localUri);
  const bucket      = BUCKET;

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   authUid    :", authUid ?? "(null — unauthenticated!)");
  console.log("[storage]   match      :", authUid === uid);
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   objectPath :", objectPath);
  console.log("[storage]   contentType:", contentType);
  console.log("[storage]   bucket     :", bucket || "(EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET not set!)");
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!authUid) {
    throw new Error("storage/unauthenticated: no Firebase Auth session before upload");
  }
  if (!bucket) {
    throw new Error("storage/no-bucket: EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET env var is not set");
  }
  if (authUid !== uid) {
    console.warn(`[storage] WARNING: authUid "${authUid}" !== uid "${uid}" — Storage rules will reject`);
  }

  // ── Read file as base64 ───────────────────────────────────────────────────
  console.log("[storage] reading file as base64 via FileSystem…");
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (err) {
    const e = err as Error;
    console.error("[storage] FileSystem.readAsStringAsync FAILED:", e?.message);
    throw new Error(`Could not read local file: ${e?.message ?? String(err)}`);
  }
  console.log("[storage] base64 length:", base64.length,
    "(~" + Math.round(base64.length * 0.75 / 1024) + " KB)");
  if (!base64 || base64.length === 0) {
    throw new Error(`FileSystem returned empty base64 for ${localUri}`);
  }

  // ── Get Firebase ID token ─────────────────────────────────────────────────
  let idToken: string;
  try {
    idToken = await firebaseAuth.currentUser!.getIdToken();
  } catch (err) {
    const e = err as Error;
    console.error("[storage] getIdToken FAILED:", e?.message);
    throw new Error(`Could not get auth token: ${e?.message ?? String(err)}`);
  }

  // ── Upload via Firebase Storage REST API ──────────────────────────────────
  const uploadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}` +
    `?uploadType=media&name=${encodedPath}`;

  console.log("[storage] REST upload start…");
  console.log("[storage]   url:", uploadUrl.slice(0, 120));

  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization":            `Bearer ${idToken}`,
        "Content-Type":             contentType,
        "Content-Transfer-Encoding":"base64",
      },
      body: base64,
    });
  } catch (err) {
    const e = err as Error;
    console.error("[storage] fetch THREW:", e?.message);
    throw new Error(`Storage REST network error: ${e?.message ?? String(err)}`);
  }

  console.log("[storage] response status:", res.status, res.statusText);

  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch { /* ignore */ }
    console.error("[storage] REST upload FAILED ─────────────────");
    console.error("[storage]   status      :", res.status);
    console.error("[storage]   statusText  :", res.statusText);
    console.error("[storage]   responseText:", text);
    throw new Error(`Storage REST upload failed ${res.status}: ${text}`);
  }

  console.log("[storage] REST upload OK");

  // ── Build download URL ────────────────────────────────────────────────────
  const downloadURL =
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;

  console.log("[storage] downloadURL:", downloadURL.slice(0, 100));
  return downloadURL;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Returns true when the URI is already a remote HTTPS URL that does not need
 * re-uploading (e.g. a Firebase Storage URL loaded back from Firestore).
 */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith("https://") || uri.startsWith("http://");
}
