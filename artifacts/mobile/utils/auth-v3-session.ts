/**
 * auth-v3-session.ts — V3 Persistent Session Management
 *
 * Handles reading, writing and validating the V3 auth session stored in
 * AsyncStorage. Completely independent from B2.
 *
 * Key:   @v3/auth/session
 * Value: { uid: string; phone: string }
 *
 * IMPORTANT — Firebase auth timing:
 * On cold start, `firebaseAuth.currentUser` is null until Firebase has
 * internally restored its cached auth state. `checkV3Session()` uses
 * `firebaseAuth.authStateReady()` to wait for that restoration before
 * comparing UIDs. Without this, session restore would always fail on
 * first launch after an app kill.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { firebaseAuth } from "@/utils/firebase";

const SESSION_KEY = "@v3/auth/session";

export type V3Session = { uid: string; phone: string };

/** Persist a new V3 session after successful authentication. */
export async function saveV3Session(uid: string, phone: string): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ uid, phone }));
}

/**
 * Read the stored V3 session without validating against Firebase.
 * Returns null if absent or corrupted.
 */
export async function getV3Session(): Promise<V3Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.phone !== "string"
    ) return null;
    return parsed as V3Session;
  } catch {
    return null;
  }
}

/** Delete the stored V3 session (used on logout). */
export async function clearV3Session(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}

/**
 * Validate the stored session against the live Firebase auth state.
 *
 * Waits for `authStateReady()` so that on cold start we don't falsely
 * reject a valid session just because Firebase hasn't finished restoring yet.
 *
 * Returns the session if both AsyncStorage and Firebase agree on the UID.
 * Clears the stale record and returns null if they disagree.
 */
export async function checkV3Session(): Promise<V3Session | null> {
  const session = await getV3Session();
  if (!session) return null;

  // Wait for Firebase to finish restoring its cached auth state.
  // This resolves immediately if Firebase has already restored.
  await firebaseAuth.authStateReady();

  const user = firebaseAuth.currentUser;
  if (!user || user.uid !== session.uid) {
    await clearV3Session();
    return null;
  }

  return session;
}
