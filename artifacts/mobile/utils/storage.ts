/**
 * storage.ts
 *
 * KYC document upload helper — uploads directly to Firebase Storage.
 *
 * Storage path : drivers/{uid}/kyc/{docId}.jpg
 * Download URL : returned by getDownloadURL(), stored in Firestore by
 *                submitDriverDocuments() via the kycDocuments flat map.
 *
 * No Hostinger VPS or custom API server involved.
 */

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, firebaseAuth } from "./firebase";

// ─── Content-type detection ────────────────────────────────────────────────────

function contentTypeFromUri(uri: string): string {
  const lower = (uri.toLowerCase().split("?")[0]) ?? "";
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif"))  return "image/gif";
  return "image/jpeg";
}

// ─── Main upload helper ────────────────────────────────────────────────────────

/**
 * Upload a local image URI directly to Firebase Storage.
 * Returns the permanent HTTPS download URL.
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
  const authUid     = firebaseAuth.currentUser?.uid ?? null;
  const storagePath = `drivers/${uid}/kyc/${docId}.jpg`;
  const contentType = contentTypeFromUri(localUri);

  console.log("[storage] uploadDocumentImage ─────────────────────");
  console.log("[storage]   uid        :", uid);
  console.log("[storage]   authUid    :", authUid ?? "(null — unauthenticated!)");
  console.log("[storage]   docId      :", docId);
  console.log("[storage]   storagePath:", storagePath);
  console.log("[storage]   contentType:", contentType);
  console.log("[storage]   localUri   :", localUri.slice(0, 120));

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!authUid) {
    throw new Error("upload/unauthenticated: no Firebase Auth session");
  }
  if (authUid !== uid) {
    console.warn(`[storage] WARNING: authUid "${authUid}" !== uid "${uid}"`);
  }

  // ── Convert local URI → Blob ───────────────────────────────────────────────
  // React Native fetch() can read file:// and content:// URIs natively.
  let blob: Blob;
  try {
    const response = await fetch(localUri);
    if (!response.ok) {
      throw new Error(`fetch responded ${response.status} ${response.statusText}`);
    }
    blob = await response.blob();
    console.log("[storage] blob size:", blob.size, "bytes");
  } catch (err) {
    const e = err as Error;
    console.error("[storage] fetch/blob FAILED:", e?.message);
    throw new Error(`Could not read local file: ${e?.message ?? String(err)}`);
  }

  // ── Upload to Firebase Storage ─────────────────────────────────────────────
  const storageRef = ref(storage, storagePath);
  try {
    console.log("[storage] uploading to Firebase Storage…");
    await uploadBytes(storageRef, blob, { contentType });
    console.log("[storage] uploadBytes complete — path:", storagePath);
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error("[storage] uploadBytes FAILED — code:", e?.code, "msg:", e?.message);
    throw new Error(`Firebase Storage upload failed (${e?.code ?? "unknown"}): ${e?.message ?? String(err)}`);
  }

  // ── Get download URL ───────────────────────────────────────────────────────
  let downloadURL: string;
  try {
    downloadURL = await getDownloadURL(storageRef);
    console.log("[storage] download URL:", downloadURL.slice(0, 100));
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error("[storage] getDownloadURL FAILED — code:", e?.code, "msg:", e?.message);
    throw new Error(`Could not get download URL (${e?.code ?? "unknown"}): ${e?.message ?? String(err)}`);
  }

  return downloadURL;
}

// ─── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Returns true when the URI is already a remote HTTPS URL that does not need
 * re-uploading (e.g. a Firebase Storage URL already stored in Firestore).
 */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith("https://") || uri.startsWith("http://");
}
