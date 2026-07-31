/**
 * COMPARTMENT 4 — Secure Storage
 *
 * Single responsibility: read, write, and remove values from local persistent
 * storage (AsyncStorage). Owns the storage abstraction boundary — swap the
 * underlying store here without touching any other compartment.
 *
 * Rules:
 *   ✓ May import from: Config, Errors
 *   ✗ No authentication logic, no Firebase, no navigation, no React
 *
 * Replaceability: replace AsyncStorage with expo-secure-store or encrypted
 *   storage by changing only this file.
 * Debugging scope: if a stored value is missing, stale, or corrupted → this file.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapError, logDiagnostic } from "../errors";

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Write a string value under the given key.
 * Throws if the write fails (caller should wrap in try/catch).
 */
export async function storageWrite(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (raw) {
    const err = mapError(raw, `storage.write(${key})`);
    logDiagnostic(err);
    throw err;
  }
}

/**
 * Read the string value for the given key.
 * Returns null if the key does not exist or if a parse error occurs.
 * Does NOT throw — storage read failures are treated as cache misses.
 */
export async function storageRead(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (raw) {
    const err = mapError(raw, `storage.read(${key})`);
    logDiagnostic(err);
    return null;
  }
}

/**
 * Remove the value for the given key.
 * Silent on failure — removal is best-effort (e.g. during logout).
 */
export async function storageRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (raw) {
    const err = mapError(raw, `storage.remove(${key})`);
    logDiagnostic(err);
  }
}
