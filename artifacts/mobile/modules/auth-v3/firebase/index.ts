/**
 * COMPARTMENT 6 — Firebase Layer
 *
 * Single responsibility: all Firebase Authentication operations.
 * This is the ONLY file in auth-v3 that imports from firebase/auth.
 *
 * Rules:
 *   ✓ May import from: Config, Errors, Types
 *   ✗ No routing, no UI, no session storage, no AsyncStorage
 *
 * All functions return AuthV3Result / AuthV3VoidResult — never throw.
 *
 * Replaceability: swap Firebase for another auth provider by replacing
 *   only this file. All callers depend on the typed interface, not Firebase.
 * Debugging scope: sign-in fails, token fetch fails, sign-out hangs → this file.
 */

import { signInWithCustomToken, signOut } from "firebase/auth";
import { firebaseAuth } from "@/utils/firebase";
import { mapError, logOp, ERR } from "../errors";
import { ok, okVoid, fail, AuthV3Result, AuthV3VoidResult, AuthV3Error } from "../types";

// ─── Result data types ────────────────────────────────────────────────────────

export type FirebaseSignInData = { uid: string; idToken: string };

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Sign in using a custom token issued by the backend.
 * Returns the Firebase UID and a freshly-issued ID token on success.
 * Never throws — errors are returned as a typed result.
 */
export async function firebaseSignIn(
  customToken: string,
): Promise<AuthV3Result<FirebaseSignInData>> {
  try {
    const cred    = await signInWithCustomToken(firebaseAuth, customToken);
    const idToken = await cred.user.getIdToken();
    logOp("firebase", "signIn", "success");
    return ok({ uid: cred.user.uid, idToken });
  } catch (raw) {
    const error: AuthV3Error = { ...mapError(raw, "firebase.signIn"), code: ERR.FIREBASE_ERROR };
    logOp("firebase", "signIn", "error", error);
    return fail(error);
  }
}

/**
 * Sign the current user out of Firebase.
 * Best-effort: returns success even if Firebase sign-out fails, because the
 * caller should always proceed with local session cleanup.
 */
export async function firebaseSignOut(): Promise<AuthV3VoidResult> {
  try {
    await signOut(firebaseAuth);
    logOp("firebase", "signOut", "success");
    return okVoid();
  } catch (raw) {
    // Non-fatal: log the issue but report success so logout always completes.
    const error: AuthV3Error = { ...mapError(raw, "firebase.signOut"), code: ERR.FIREBASE_ERROR };
    logOp("firebase", "signOut", "error", error);
    return okVoid(); // intentional — caller always clears session after this
  }
}

/**
 * Return the UID of the currently authenticated Firebase user, or null.
 * May be null immediately after a cold start — call firebaseWaitReady() first
 * if you need a reliable answer on the first render.
 */
export function firebaseGetCurrentUid(): string | null {
  return firebaseAuth.currentUser?.uid ?? null;
}

/**
 * Wait for Firebase to finish restoring its cached auth state.
 * Resolves immediately if Firebase is already ready.
 * Must be called before firebaseGetCurrentUid() on cold start.
 */
export async function firebaseWaitReady(): Promise<void> {
  await firebaseAuth.authStateReady();
}
