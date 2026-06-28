/**
 * session.ts
 *
 * Single-device login — client-side session id store.
 *
 * Each successful login (verify-otp / verify-pin / set-pin) returns a server
 * minted `sessionId` (crypto.randomUUID) that the server has stored in
 * drivers.active_session_id. Every authenticated request must echo it back via
 * the `x-session-id` header. When the same account logs in on another device,
 * the server rotates active_session_id; this device's now-stale id no longer
 * matches and the server responds 401 { error: "SESSION_REPLACED" }.
 *
 * The id is persisted in AsyncStorage so it survives app backgrounding / cold
 * start, and mirrored into an in-memory cache so the fetch interceptor
 * (utils/api-client.ts) and the SSE connector (utils/order-stream.ts) can read
 * it synchronously without awaiting AsyncStorage on every request.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_ID_KEY = "@bike_courier/session_id";

// Synchronous mirror of the persisted id. Loaded once at app boot via
// loadSessionId() and kept in lock-step with set/clear below.
let _cached: string | null = null;

/** Read the persisted session id into the in-memory cache (call once at boot). */
export async function loadSessionId(): Promise<string | null> {
  try {
    _cached = await AsyncStorage.getItem(SESSION_ID_KEY);
  } catch {
    _cached = null;
  }
  return _cached;
}

/** Synchronous read of the cached session id (null until loaded / after clear). */
export function getSessionIdSync(): string | null {
  return _cached;
}

/** Persist a freshly minted session id and update the in-memory cache. */
export async function setSessionId(id: string): Promise<void> {
  _cached = id;
  try {
    await AsyncStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // Non-fatal — the in-memory cache still carries the id for this run.
  }
}

/** Clear both the persisted and cached session id (on sign-out / SESSION_REPLACED). */
export async function clearSessionId(): Promise<void> {
  _cached = null;
  try {
    await AsyncStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // Non-fatal.
  }
}

// ── Local session-rotation guard ────────────────────────────────────────────
// set-pin (and the verify-pin re-sync) intentionally rotate THIS device's own
// server session to a fresh id. During that brief window a request that was
// already in flight with the OLD id can come back 401 SESSION_REPLACED — a
// SELF-inflicted replacement, not another device claiming the account. While
// this flag is set, the fetch interceptor (utils/api-client.ts) ignores that
// 401 instead of signing the driver out and bouncing them to /login.
//
// This is a COUNTER, not a boolean: each begin pairs with exactly one (delayed)
// end. If a second rotation starts before the first one's end-timer fires, the
// older timer must NOT prematurely re-enable sign-out while the newer rotation
// is still in flight — so suppression stays on until every rotation has ended.
let _rotationCount = 0;

/** Begin a local session rotation — suppresses self-inflicted SESSION_REPLACED. */
export function beginSessionRotation(): void {
  _rotationCount += 1;
}

/** End one local session rotation suppression window. */
export function endSessionRotation(): void {
  _rotationCount = Math.max(0, _rotationCount - 1);
}

/** True while THIS device is rotating its own session (set-pin / re-sync). */
export function isSessionRotating(): boolean {
  return _rotationCount > 0;
}
