/**
 * auth-v3-bridge.ts
 *
 * Module-level bridge for the V3 authentication session-restore handler.
 *
 * AuthV3Context detects a valid cold-start session (Firebase user + matching
 * AsyncStorage uid) and delegates profile hydration + navigation to DriverContext
 * via this bridge. Using module-level state avoids a circular React context
 * dependency between the two providers (AuthV3Provider wraps DriverProvider, so
 * DriverContext cannot import AuthV3Context's context object at module scope
 * without creating a cycle).
 *
 * RACE SAFETY: React's useEffect order in a parent/child tree is NOT guaranteed
 * to complete before Firebase fires onAuthStateChanged. On cold start, Firebase
 * can fire within the same microtask batch as the initial render, potentially
 * before DriverProvider's mount effect has registered the handler.
 *
 * Solution: `callV3SessionRestoreHandler` waits up to 3 s for the handler to
 * register (promise-based). Since `callV3SessionRestoreHandler` is `await`-ed in
 * AuthV3Context's `finally` block, `setAuthLoading(false)` is NOT called until
 * either the handler completes or the 3 s timeout fires. This keeps the auth
 * overlay in place during the entire session restore flow.
 *
 * Usage:
 *   DriverContext.tsx mount effect:
 *     registerV3SessionRestoreHandler(async (uid, phone) => { ... })
 *
 *   AuthV3Context.tsx onAuthStateChanged (when sessionValid=true):
 *     await callV3SessionRestoreHandler(uid, phone)
 */

type SessionRestoreHandler = (uid: string, phone: string) => Promise<void>;

// Current registered handler (null until DriverProvider mounts).
let _handler: SessionRestoreHandler | null = null;

// Promise that resolves the instant a handler is registered.
// Created lazily: only if a callV3SessionRestoreHandler() arrives before registration.
let _readyPromise: Promise<SessionRestoreHandler> | null = null;
let _readyResolve: ((fn: SessionRestoreHandler) => void) | null = null;

function getReadyPromise(): Promise<SessionRestoreHandler> {
  if (!_readyPromise) {
    _readyPromise = new Promise((resolve) => {
      _readyResolve = resolve;
    });
  }
  return _readyPromise;
}

/**
 * Register the session restore callback.
 * Called by DriverContext in its mount useEffect.
 * Idempotent — re-registering replaces the previous handler.
 * Also delivers to any in-flight `callV3SessionRestoreHandler` that was waiting.
 */
export function registerV3SessionRestoreHandler(fn: SessionRestoreHandler): void {
  _handler = fn;
  // Resolve any pending callV3SessionRestoreHandler that arrived before us.
  if (_readyResolve) {
    console.log("[AUTH_V3_BRIDGE] handler registered — delivering buffered restore call");
    _readyResolve(fn);
    _readyResolve = null;
  } else {
    console.log("[AUTH_V3_BRIDGE] session restore handler registered (no pending call)");
  }
}

/**
 * Invoke the registered session restore callback and await it.
 * Called by AuthV3Context when it detects sessionValid=true in onAuthStateChanged.
 *
 * If no handler is registered yet, waits up to 3 s for DriverProvider to register
 * one (handles the React effect-order race on cold start). AuthV3Context's
 * `setAuthLoading(false)` fires ONLY after this function returns, so the auth
 * overlay stays in place throughout the entire session restore flow.
 */
export async function callV3SessionRestoreHandler(uid: string, phone: string): Promise<void> {
  let handler = _handler;

  if (!handler) {
    // Handler not yet registered — wait for DriverProvider's mount effect.
    // In practice this resolves within <50 ms; the 3 s cap is a safety net only.
    console.log("[AUTH_V3_BRIDGE] handler not yet registered — waiting up to 3s for uid:", uid);
    const result = await Promise.race([
      getReadyPromise(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    handler = result;
  }

  if (handler) {
    await handler(uid, phone);
  } else {
    console.warn("[AUTH_V3_BRIDGE] session restore handler not registered within 3s — skipping restore for uid:", uid);
  }
}
