/**
 * storage.ts
 *
 * Firebase Storage helpers for KYC document uploads.
 *
 * Storage paths:
 *   drivers/{uid}/selfie.jpg
 *   drivers/{uid}/aadhaar.jpg
 *   drivers/{uid}/pan.jpg
 *   drivers/{uid}/license.jpg
 *   drivers/{uid}/rc.jpg
 *   drivers/{uid}/insurance.jpg
 *
 * Upload method — base64 via Expo FileSystem:
 *   Blob / XHR blob both fail on Android Expo Go with storage/unknown.
 *   FileSystem.readAsStringAsync + uploadString("base64") is the only
 *   method that reliably works on React Native / Expo SDK 54.
 */

import * as FileSystem from "expo-file-system/legacy";
import { getDownloadURL, ref, uploadString } from "firebase/storage";
import { firebaseAuth, storage } from "./firebase";

// ─── Content-type detection ───────────────────────────────────────────────────

function contentTypeFromUri(uri: string): string {
  const lower = (uri.toLowerCase().split("?")[0] ?? "");
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// ─── Main upload helper ───────────────────────────────────────────────────────

/**
 * Upload a local image URI (file:// or content://) to Firebase Storage using
 * Expo FileSystem base64 encoding and return the permanent HTTPS download URL.
 *
 * @param uid      - Driver UID (must match Firebase Auth UID for Storage rules)
 * @param docId    - Document slot identifier used as the filename stem
 * @param localUri - Local file:// or content:// path from ImagePicker / app cache
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const authUid     = firebaseAuth.currentUser?.uid ?? null;
  const storagePath = `drivers/${uid}/${docId}.jpg`;
  const contentType = contentTypeFromUri(localUri);

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   authUid    :", authUid ?? "(null — unauthenticated!)");
  console.log("[storage]   match      :", authUid === uid);
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   storagePath:", storagePath);
  console.log("[storage]   contentType:", contentType);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  if (!authUid) {
    throw new Error("storage/unauthenticated: no Firebase Auth session before upload");
  }
  if (authUid !== uid) {
    console.warn(`[storage] WARNING: authUid "${authUid}" !== uid "${uid}" — Storage rules will reject`);
  }

  // ── Read file as base64 ────────────────────────────────────────────────────
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
  console.log("[storage] base64 length:", base64.length, "(chars ~", Math.round(base64.length * 0.75 / 1024), "KB uncompressed)");
  if (!base64 || base64.length === 0) {
    throw new Error(`FileSystem returned empty base64 for ${localUri}`);
  }

  // ── Upload via uploadString ────────────────────────────────────────────────
  const fileRef = ref(storage, storagePath);
  console.log("[storage] uploadString start…");
  try {
    await uploadString(fileRef, base64, "base64", { contentType });
    console.log("[storage] uploadString OK");
  } catch (err) {
    const e = err as Error & { code?: string; customData?: unknown; serverResponse?: string };
    console.error("[storage] uploadString FAILED ─────────────────");
    console.error("[storage]   code          :", e?.code);
    console.error("[storage]   message       :", e?.message);
    console.error("[storage]   customData    :", JSON.stringify(e?.customData));
    console.error("[storage]   serverResponse:", e?.serverResponse);
    console.error("[storage]   stack         :", e?.stack);
    throw err;
  }

  // ── Get download URL ───────────────────────────────────────────────────────
  const downloadURL = await getDownloadURL(fileRef);
  console.log("[storage] downloadURL:", downloadURL.slice(0, 80));
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
