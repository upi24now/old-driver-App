/**
 * auth-v3-session.ts — Persistent V3 session management
 *
 * Handles reading, writing and validating the V3 session stored in
 * AsyncStorage. Completely independent from B2 — no DriverContext, no bridge.
 *
 * Key:  @v3/auth/session
 * Value: { uid: string; phone: string }
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { firebaseAuth } from "@/utils/firebase";

const SESSION_KEY = "@v3/auth/session";

export type V3Session = { uid: string; phone: string };

/**
 * Persist a new V3 session after successful authentication.
 */
export async function saveV3Session(uid: string, phone: string): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ uid, phone }));
}

/**
 * Read the stored V3 session (raw — no Firebase validation).
 * Returns null if absent or if parsing fails.
 */
export async function getV3Session(): Promise<V3Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as V3Session;
  } catch {
    return null;
  }
}

/**
 * Delete the stored V3 session (logout).
 */
export async function clearV3Session(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}

/**
 * Validate the stored session against the live Firebase auth state.
 * Returns the session if both AsyncStorage and Firebase agree on the UID.
 * Clears and returns null if the session is stale.
 */
export async function checkV3Session(): Promise<V3Session | null> {
  const session = await getV3Session();
  if (!session) return null;

  const firebaseUser = firebaseAuth.currentUser;
  if (!firebaseUser || firebaseUser.uid !== session.uid) {
    await clearV3Session();
    return null;
  }

  return session;
}
