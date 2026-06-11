/**
 * storage.ts
 *
 * Firebase Storage helpers for KYC document uploads.
 *
 * Every document is uploaded to:
 *   drivers/{uid}/{docId}.jpg
 *
 * IMPORTANT — React Native blob gotcha:
 *   fetch(localUri).blob() is BROKEN on Android for file:// URIs.
 *   The resulting Blob has wrong size/type and Firebase Storage rejects it
 *   with "storage/unknown". The only reliable method on React Native is
 *   XMLHttpRequest with responseType="blob".
 */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseAuth, storage } from "./firebase";

// ─── Content-type detection ───────────────────────────────────────────────────

function contentTypeFromUri(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// ─── XHR-based blob (the only reliable method on React Native / Android) ─────

function uriToBlob(uri: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      const blob = xhr.response as Blob;
      console.log(
        `[storage] XHR blob — size=${blob.size} type="${blob.type}" uri=${uri.slice(0, 80)}`,
      );
      if (!blob || blob.size === 0) {
        reject(new Error(`uriToBlob produced empty blob for ${uri}`));
      } else {
        resolve(blob);
      }
    };
    xhr.onerror = () => reject(new Error(`uriToBlob XHR network error for ${uri}`));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

// ─── Main upload helper ───────────────────────────────────────────────────────

/**
 * Upload a local image URI (file:// or content://) to Firebase Storage and
 * return the permanent HTTPS download URL.
 *
 * @param uid      - Driver UID, used as the top-level Storage folder
 * @param docId    - Document slot: "selfie" | "aadhaar" | "pan" | "license" | "rc" | "insurance"
 * @param localUri - Local file:// or content:// path from ImagePicker / app cache
 * @returns Firebase Storage download URL (https://firebasestorage.googleapis.com/…)
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const authUid    = firebaseAuth.currentUser?.uid;
  const storagePath = `drivers/${uid}/${docId}.jpg`;
  const contentType = contentTypeFromUri(localUri);

  console.log("[storage] uploadDocumentImage start");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   authUid    :", authUid ?? "(null — unauthenticated)");
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   storagePath:", storagePath);
  console.log("[storage]   contentType:", contentType);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  if (!authUid) {
    throw new Error("storage/unauthenticated: firebaseAuth.currentUser is null before upload");
  }
  if (authUid !== uid) {
    console.warn(`[storage] authUid (${authUid}) !== uid (${uid}) — Storage rules may reject`);
  }

  console.log("[storage] converting URI → Blob via XHR…");
  const blob = await uriToBlob(localUri);
  console.log("[storage] blob ready — size:", blob.size, "type:", blob.type || "(unset)");

  const fileRef = ref(storage, storagePath);
  console.log("[storage] uploadBytes start — path:", storagePath);
  try {
    await uploadBytes(fileRef, blob, { contentType });
  } catch (err) {
    const e = err as Error & { code?: string; serverResponse?: string };
    console.error("[storage] uploadBytes FAILED");
    console.error("[storage]   code           :", e?.code);
    console.error("[storage]   message        :", e?.message);
    console.error("[storage]   serverResponse :", e?.serverResponse);
    console.error("[storage]   stack          :", e?.stack);
    throw err;
  }
  console.log("[storage] uploadBytes OK — fetching download URL");

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
