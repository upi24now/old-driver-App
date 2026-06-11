/**
 * storage.ts
 *
 * Firebase Storage helpers for KYC document uploads.
 *
 * Every document is uploaded to:
 *   drivers/{uid}/{docId}.jpg
 *
 * The caller receives a permanent HTTPS download URL that is safe to store
 * in Firestore and load in any web browser / admin panel.
 */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

/**
 * Upload a local image URI (file:// or content://) to Firebase Storage and
 * return the permanent HTTPS download URL.
 *
 * @param uid      - Driver UID, used as the top-level folder
 * @param docId    - Document slot: "selfie" | "aadhaar" | "pan" | "license" | "rc" | "insurance"
 * @param localUri - Local file:// or content:// path from ImagePicker / app cache
 * @returns Firebase Storage download URL (https://firebasestorage.googleapis.com/...)
 */
export async function uploadDocumentImage(
  uid:      string,
  docId:    string,
  localUri: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob     = await response.blob();
  const path     = `drivers/${uid}/${docId}.jpg`;
  const fileRef  = ref(storage, path);
  await uploadBytes(fileRef, blob);
  return getDownloadURL(fileRef);
}

/**
 * Returns true when the URI is already a remote HTTPS URL that does not need
 * to be re-uploaded (e.g. a Firebase Storage URL loaded back from Firestore).
 */
export function isRemoteUrl(uri: string): boolean {
  return uri.startsWith("https://") || uri.startsWith("http://");
}
