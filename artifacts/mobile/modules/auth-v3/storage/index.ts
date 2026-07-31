/**
 * COMPARTMENT 4 — Secure Storage
 *
 * Single responsibility: read, write, and remove values from local persistent
 * storage. Owns the storage abstraction boundary.
 *
 * Rules:
 *   ✓ May import from: Config, Errors, Types
 *   ✗ No authentication logic, no Firebase, no navigation, no React
 *
 * All functions return AuthV3Result / AuthV3VoidResult — never throw.
 *
 * Replaceability: swap AsyncStorage for expo-secure-store by changing only
 *   this file. No other compartment changes.
 * Debugging scope: stored value missing, stale, or corrupted → this file.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapError, logOp, ERR, makeError } from "../errors";
import { ok, okVoid, fail, AuthV3Result, AuthV3VoidResult } from "../types";

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Write a string value under the given key.
 * Returns a void success or a typed storage error — never throws.
 */
export async function storageWrite(
  key:   string,
  value: string,
): Promise<AuthV3VoidResult> {
  try {
    await AsyncStorage.setItem(key, value);
    logOp("storage", "write", "success");
    return okVoid();
  } catch (raw) {
    const error = mapError(raw, `storage.write(${key})`);
    logOp("storage", "write", "error", error);
    return fail({ ...error, code: ERR.STORAGE_ERROR });
  }
}

/**
 * Read the string value for the given key.
 * Returns success with data=null if the key does not exist.
 * Returns success with data=null on parse error (treated as a cache miss).
 * Returns a storage error only if the underlying read itself fails.
 */
export async function storageRead(
  key: string,
): Promise<AuthV3Result<string | null>> {
  try {
    const value = await AsyncStorage.getItem(key);
    logOp("storage", "read", "success");
    return ok(value);
  } catch (raw) {
    const error = mapError(raw, `storage.read(${key})`);
    logOp("storage", "read", "error", error);
    return fail({ ...error, code: ERR.STORAGE_ERROR });
  }
}

/**
 * Remove the value for the given key.
 * Silent on not-found. Returns a storage error only if the remove itself fails.
 */
export async function storageRemove(
  key: string,
): Promise<AuthV3VoidResult> {
  try {
    await AsyncStorage.removeItem(key);
    logOp("storage", "remove", "success");
    return okVoid();
  } catch (raw) {
    const error = mapError(raw, `storage.remove(${key})`);
    logOp("storage", "remove", "error", error);
    return fail({ ...error, code: ERR.STORAGE_ERROR });
  }
}
