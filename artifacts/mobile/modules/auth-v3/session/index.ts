/**
 * COMPARTMENT 3 — Session Manager
 *
 * Single responsibility: save, load, clear, and restore the V3 auth session.
 * Orchestrates Storage (C4) and Firebase (C6) — it alone knows that a valid
 * session requires both a stored record AND a live Firebase user.
 *
 * Rules:
 *   ✓ May import from: Config, Errors, Types, Storage (C4), Firebase (C6)
 *   ✗ No UI, no navigation, no React
 *
 * All functions return AuthV3Result / AuthV3VoidResult — never throw.
 *
 * Replaceability: swap the session validation strategy (e.g. add a server-side
 *   check) by changing only this file.
 * Debugging scope: session restore fails on cold start, sessions persist after
 *   logout, or sessions expire unexpectedly → this file.
 */

import { SESSION_KEY }                               from "../config";
import { makeError, logOp, ERR }                     from "../errors";
import { ok, okVoid, fail, AuthV3Result, AuthV3VoidResult } from "../types";
import { storageWrite, storageRead, storageRemove }  from "../storage";
import { firebaseGetCurrentUid, firebaseWaitReady }  from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type V3Session = { uid: string; phone: string };

type SessionRecord = V3Session & { savedAt: number };

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Persist a new session after successful authentication.
 */
export async function sessionSave(
  uid:   string,
  phone: string,
): Promise<AuthV3VoidResult> {
  const record: SessionRecord = { uid, phone, savedAt: Date.now() };
  const result = await storageWrite(SESSION_KEY, JSON.stringify(record));
  if (!result.success) {
    logOp("session", "save", "error", result.error);
    return result;
  }
  logOp("session", "save", "success");
  return okVoid();
}

/**
 * Load the stored session without validating against Firebase.
 * Returns success with data=null if absent or corrupted (not an error state).
 */
export async function sessionLoad(): Promise<AuthV3Result<V3Session | null>> {
  const readResult = await storageRead(SESSION_KEY);
  if (!readResult.success) {
    logOp("session", "load", "error", readResult.error);
    return fail(readResult.error);
  }

  if (!readResult.data) {
    logOp("session", "load", "success");
    return ok(null);
  }

  try {
    const parsed = JSON.parse(readResult.data);
    if (typeof parsed.uid !== "string" || typeof parsed.phone !== "string") {
      logOp("session", "load", "success"); // corrupt = no session, not an error
      return ok(null);
    }
    logOp("session", "load", "success");
    return ok({ uid: parsed.uid, phone: parsed.phone });
  } catch {
    logOp("session", "load", "success"); // parse fail = no session
    return ok(null);
  }
}

/**
 * Delete the stored session (call on logout or when Firebase disagrees).
 */
export async function sessionClear(): Promise<AuthV3VoidResult> {
  const result = await storageRemove(SESSION_KEY);
  if (!result.success) {
    logOp("session", "clear", "error", result.error);
    return result;
  }
  logOp("session", "clear", "success");
  return okVoid();
}

/**
 * Validate the stored session against live Firebase auth state.
 *
 * Waits for firebaseWaitReady() — on cold start Firebase hasn't restored its
 * cached auth yet, so currentUser would be null even with a valid session.
 *
 * Returns the session if storage and Firebase agree on the UID.
 * Returns data=null (not an error) if no session or UIDs disagree.
 */
export async function sessionRestore(): Promise<AuthV3Result<V3Session | null>> {
  const loadResult = await sessionLoad();
  if (!loadResult.success) return loadResult;
  if (!loadResult.data) return ok(null);

  await firebaseWaitReady();

  const uid = firebaseGetCurrentUid();
  if (!uid || uid !== loadResult.data.uid) {
    // Firebase and storage disagree — wipe the stale record.
    await sessionClear();
    logOp("session", "restore", "success");
    return ok(null);
  }

  logOp("session", "restore", "success");
  return ok(loadResult.data);
}
