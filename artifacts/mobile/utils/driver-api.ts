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
  // The backend route POST /api/drivers/:uid/location reads
  // { lat, lng, accuracy, isOnline } from the body. Map the GPS coordinates to
  // the lat/lng field names the server expects — sending latitude/longitude
  // leaves lat/lng NULL in driver_locations and the dispatcher then treats the
  // driver as having no position (totalOnline: 0).
  const payload = {
    lat:      coords.latitude,
    lng:      coords.longitude,
    accuracy: coords.accuracy,
    isOnline: coords.isOnline,
  };
  try {
    console.log("[DriverLocation] update payload:", JSON.stringify(payload));
    const res  = await fetch(`${BASE_URL}/drivers/${uid}/location`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok?: boolean };
    console.log("[DriverLocation] update response:", res.status, JSON.stringify(json));
    return { ok: !!json.ok };
  } catch (err) {
    console.log("[DriverLocation] update error:", err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}

/**
 * PATCH /api/drivers/me/fcm-token
 * Phase 4A — saves the driver's Expo/FCM push token to PostgreSQL. The uid is
 * derived server-side from the Firebase ID token, so none is passed here.
 * Fire-and-forget safe — returns { ok: false } on any error so the caller can
 * fall back to the Firestore shadow write.
 */
export async function saveDriverFcmToken(
  fcmToken: string,
): Promise<{ ok: boolean; saved: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, saved: false };
  try {
    const res  = await fetch(`${BASE_URL}/drivers/me/fcm-token`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fcmToken }),
    });
    const json = (await res.json()) as { ok?: boolean; saved?: boolean };
    // `saved` is only true when the row was actually written to PG. The server
    // returns ok:true, saved:false when no drivers row exists yet (the
    // Firestore shadow write below still persists the token in that case).
    return { ok: !!json.ok, saved: !!json.saved };
  } catch {
    return { ok: false, saved: false };
  }
}

// DocumentNumbers is retained because document-upload.tsx tracks the optional
// ID-number fields in local state. These numbers are NOT sent to the server:
// KYC images upload to /api/kyc/upload-open, which accepts images only. There is
// no /api/drivers/documents call anywhere in the app (that prod route is 404).
export type DocumentNumbers = {
  aadhaar?: string;
  pan?:     string;
  license?: string;
  rc?:      string;
};

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

// ─── GET /api/drivers/me/trips ────────────────────────────────────────────────
//
// Phase 5J-Tier-1: PG-backed trip history — replaces getDriverCompletedTrips
// Firestore read in the trips screen.  uid is derived from the Bearer token.
// Returns an empty array on any failure so the screen shows "No trips yet".
//
export type TripRecord = {
  orderId:       string;
  customerName:  string;
  pickupAddress: string;
  dropAddress:   string;
  fareEstimate:  number;
  distanceKm?:   number;
  paymentMode:   string;
  status:        string;
  deliveredAt:   number | null;
};

export async function getDriverTrips(limit = 20): Promise<TripRecord[]> {
  const idToken = await getIdToken();
  if (!idToken) return [];
  try {
    const res  = await fetch(`${BASE_URL}/drivers/me/trips?limit=${limit}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; trips?: TripRecord[] };
    if (!json.ok || !Array.isArray(json.trips)) return [];
    return json.trips;
  } catch {
    return [];
  }
}
