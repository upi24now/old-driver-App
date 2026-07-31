/**
 * COMPARTMENT 6 — Firebase Layer
 *
 * Single responsibility: all Firebase Authentication operations.
 * This is the ONLY file in auth-v3 that imports from firebase/auth.
 *
 * Rules:
 *   ✓ May import from: Config, Errors
 *   ✗ No routing, no UI, no session storage, no AsyncStorage
 *
 * Replaceability: swap Firebase for another auth provider by replacing
 *   only this file. All callers depend on the typed interface, not Firebase.
 * Debugging scope: if sign-in fails, token fetch fails, or sign-out hangs → this file.
 */

import { signInWithCustomToken, signOut } from "firebase/auth";
import { firebaseAuth } from "@/utils/firebase";
import { mapError, logDiagnostic, AuthV3Error } from "../errors";

// ─── Result types ─────────────────────────────────────────────────────────────

export type FirebaseSignInResult =
  | { ok: true;  uid: string; idToken: string }
  | { ok: false; error: AuthV3Error };

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Sign in using a custom token issued by the backend.
 * Returns the Firebase UID and a freshly-issued ID token on success.
 *
 * Never throws — errors are returned as a typed result.
 */
export async function firebaseSignIn(customToken: string): Promise<FirebaseSignInResult> {
  try {
    const cred    = await signInWithCustomToken(firebaseAuth, customToken);
    const idToken = await cred.user.getIdToken();
    return { ok: true, uid: cred.user.uid, idToken };
  } catch (raw) {
    const error = mapError(raw, "firebase.signIn");
    logDiagnostic(error);
    return { ok: false, error };
  }
}

/**
 * Sign the current user out of Firebase.
 * Silent on failure — errors are logged but not surfaced (sign-out should
 * always proceed from the caller's perspective).
 */
export async function firebaseSignOut(): Promise<void> {
  try {
    await signOut(firebaseAuth);
  } catch (raw) {
    const err = mapError(raw, "firebase.signOut");
    logDiagnostic(err);
  }
}

/**
 * Return the UID of the currently authenticated Firebase user, or null.
 * This value may be null immediately after a cold start until Firebase has
 * finished restoring its cached auth state — use firebaseWaitReady() first
 * if you need a reliable answer on cold start.
 */
export function firebaseGetCurrentUid(): string | null {
  return firebaseAuth.currentUser?.uid ?? null;
}

/**
 * Wait for Firebase to finish restoring its cached auth state.
 * Resolves immediately if Firebase is already ready.
 *
 * Must be called before firebaseGetCurrentUid() on cold start to avoid
 * the race where currentUser is null even when a valid session exists.
 */
export async function firebaseWaitReady(): Promise<void> {
  await firebaseAuth.authStateReady();
}
