/**
 * auth-v2-api.ts — V2 API compat shim
 * Still used by: app/create-pin-v2.tsx, app/forgot-pin-v2.tsx
 */
import { sendOtp, setPinWithToken, type SetPinResult } from "@/utils/auth-api";
import { setSessionId } from "@/utils/session";

export { sendOtp as sendOtpV2 };

/**
 * setPinV2 — compat wrapper that uses the caller-supplied explicit credentials.
 *
 * `create-pin-v2.tsx` calls this immediately after `signInWithCustomToken`, where
 * `firebaseAuth.currentUser` may not yet be synchronised with the freshly-signed-in
 * user. Passing the idToken obtained directly from `userCred.user.getIdToken()`
 * avoids a "Not signed in" failure from the module-level cache lagging behind.
 *
 * The sessionId from OTP verification is applied via `setSessionId` (primes the
 * module-level cache) AND passed explicitly to `setPinWithToken` so the set-pin
 * request carries the correct OTP-issued session header.
 */
export async function setPinV2(
  pin: string,
  idToken?: string,
  sessionId?: string | null,
): Promise<SetPinResult> {
  // Prime the module-level session cache so any subsequent requests pick up the
  // OTP-issued session even if the global interceptor hasn't caught up yet.
  if (sessionId) {
    await setSessionId(sessionId);
  }

  // Use the explicit idToken when available. Fall back to module-level setPin
  // only if the caller didn't supply one (shouldn't happen in the V2 flows).
  if (idToken) {
    return setPinWithToken(pin, idToken, sessionId);
  }

  // Fallback — import lazily to avoid a circular dep concern at module load.
  const { setPin } = await import("@/utils/auth-api");
  return setPin(pin);
}
