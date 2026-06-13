import { firebaseAuth } from "@/utils/firebase";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

async function getIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * PATCH /api/drivers/:uid/status
 * Updates the driver's online/offline status on the server.
 * Fire-and-forget safe — returns { ok: false } on any error.
 */
export async function patchDriverStatus(
  uid:      string,
  isOnline: boolean,
): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false };
  try {
    const res  = await fetch(`${BASE_URL}/drivers/${uid}/status`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({ isOnline }),
    });
    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch {
    return { ok: false };
  }
}

/**
 * POST /api/drivers/:uid/location
 * Posts the driver's current GPS coordinates to the server.
 * Called every ~15 s while the driver is online (foreground only).
 * Fire-and-forget safe — returns { ok: false } on any error.
 */
export async function postDriverLocation(
  uid:    string,
  coords: {
    latitude:  number;
    longitude: number;
    isOnline:  boolean;
    accuracy?: number;
  },
): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false };
  try {
    const res  = await fetch(`${BASE_URL}/drivers/${uid}/location`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify(coords),
    });
    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch {
    return { ok: false };
  }
}

export type RegisterKeysResult =
  | { ok: true }
  | { ok: false; error: string; message: string };

/**
 * Pre-submission duplicate-driver check.
 *
 * Calls POST /api/drivers/register-keys with the driver's unique identifiers.
 * Attaches the current user's Firebase ID token as a Bearer token so the server
 * can verify the caller's identity and confirm body.driverUid matches the token.
 *
 * Returns { ok: true } when no other account holds any of the supplied keys.
 * Returns { ok: false, message } when:
 *   - the driver is not authenticated (no current Firebase user)
 *   - a duplicate is found
 *   - a network or server error occurs
 *
 * The caller should show message to the user and abort submission on !ok.
 */
export async function registerDriverKeys(params: {
  driverUid:      string;
  phone:          string | null;
  licenseNumber?: string;
  vehicleNumber?: string;
}): Promise<RegisterKeysResult> {
  // ── Get the current user's Firebase ID token ─────────────────────────────
  const user = firebaseAuth.currentUser;
  if (!user) {
    return {
      ok:      false,
      error:   "not_authenticated",
      message: "You must be signed in to submit documents. Please restart the app and try again.",
    };
  }

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    return {
      ok:      false,
      error:   "token_error",
      message: "Could not verify your session. Please restart the app and try again.",
    };
  }

  // ── Call the endpoint ─────────────────────────────────────────────────────
  try {
    const res = await fetch(`${BASE_URL}/drivers/register-keys`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify(params),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
    if (!res.ok || !json.ok) {
      return {
        ok:      false,
        error:   json.error   ?? "duplicate",
        message: json.message ?? "Your account already exists with this mobile, license, or vehicle number. Please login or contact support.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok:      false,
      error:   "network_error",
      message: "Network error. Please check your connection and try again.",
    };
  }
}
