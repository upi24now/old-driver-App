/**
 * COMPARTMENT 3 — Session Manager
 *
 * Single responsibility: save, load, clear, and restore the V3 auth session.
 * Orchestrates the Storage and Firebase compartments — it alone knows that
 * a valid session requires both a stored record AND a live Firebase user.
 *
 * Rules:
 *   ✓ May import from: Config, Errors, Storage (C4), Firebase (C6)
 *   ✗ No UI, no navigation, no React
 *
 * Replaceability: swap the session validation strategy (e.g. add a server-side
 *   check) by changing only this file.
 * Debugging scope: if session restore fails on cold start, sessions persist
 *   after logout, or sessions expire unexpectedly → this file.
 */

import { SESSION_KEY }                         from "../config";
import { mapError, logDiagnostic, AuthV3Error } from "../errors";
import { storageWrite, storageRead, storageRemove } from "../storage";
import { firebaseGetCurrentUid, firebaseWaitReady } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type V3Session = {
  uid:   string;
  phone: string;
};

type SessionRecord = V3Session & { savedAt: number };

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Persist a new session after successful authentication.
 */
export async function sessionSave(uid: string, phone: string): Promise<void> {
  const record: SessionRecord = { uid, phone, savedAt: Date.now() };
  await storageWrite(SESSION_KEY, JSON.stringify(record));
}

/**
 * Load the stored session record without validating against Firebase.
 * Returns null if absent, corrupted, or missing required fields.
 */
export async function sessionLoad(): Promise<V3Session | null> {
  try {
    const raw = await storageRead(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.uid !== "string" || typeof parsed.phone !== "string") return null;
    return { uid: parsed.uid, phone: parsed.phone };
  } catch {
    return null;
  }
}

/**
 * Delete the stored session (call on logout or when Firebase disagrees).
 */
export async function sessionClear(): Promise<void> {
  await storageRemove(SESSION_KEY);
}

/**
 * Validate the stored session against the live Firebase auth state.
 *
 * Waits for firebaseWaitReady() so that on cold start we don't falsely
 * reject a valid session because Firebase hasn't restored its state yet.
 *
 * Returns the session if storage and Firebase agree on the UID.
 * Clears the stale record and returns null if they disagree.
 */
export async function sessionRestore(): Promise<V3Session | null> {
  const session = await sessionLoad();
  if (!session) return null;

  // Wait for Firebase to finish restoring cached auth — resolves immediately
  // if Firebase is already ready (subsequent calls after cold-start).
  await firebaseWaitReady();

  const uid = firebaseGetCurrentUid();
  if (!uid || uid !== session.uid) {
    // Firebase and storage disagree — wipe the stale record.
    await sessionClear();
    return null;
  }

  return session;
}
