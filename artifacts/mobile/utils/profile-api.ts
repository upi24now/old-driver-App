/**
 * profile-api.ts
 *
 * VPS-backed driver profile API utilities (PostgreSQL-sourced).
 *
 * Replaces Firestore reads/writes for:
 *   - Driver profile  (name, city, gender, licenseNumber, vehicleNumber, vehicleId)
 *   - KYC / verification status and document map
 *   - Background / permission setup flags
 *   - Account status  (used for polling-based block enforcement)
 *   - Onboarding fee fields
 *
 * Still Firestore after Step 1 (documented remaining deps):
 *   - subscriptionPlan / subscriptionExpiresAt
 *   - isOnline  (online/offline toggle)
 *   - todayEarnings / tripsToday / todayDate  (daily stats)
 *   - FCM push token
 *   - createDriverDoc  (new-driver Firestore creation, untouched in Step 1)
 *   - getOnboardingFeeConfig  (reads app_config collection, not drivers/{uid})
 *
 * All routes require a valid Firebase ID token:
 *   Authorization: Bearer <Firebase ID token>
 */

import { firebaseAuth } from "@/utils/firebase";
import type { Profile, Vehicle } from "@/contexts/DriverContext";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// Log at bundle-eval time so Expo Metro logs always show the resolved URL.
console.log("[profile-api] EXPO_PUBLIC_DOMAIN =", DOMAIN || "(not set)");
console.log("[profile-api] BASE_URL           =", BASE_URL);

async function getIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

// ─── Response types ────────────────────────────────────────────────────────────

/** Per-document entry returned by GET /api/drivers/me and GET /api/drivers/verification-status. */
export type PgDocEntry = {
  url:             string | null;
  status:          string | null;
  uploadedAt:      string | null;
  rejectionReason: string | null;
  rejectedAt:      string | null;
};

/**
 * Full driver profile as returned by GET /api/drivers/me.
 *
 * Fields NOT present (still Firestore-sourced):
 *   isOnline
 *
 * Phase 5J-Tier-3 additions (now PG-sourced):
 *   subscriptionPlan, subscriptionExpiresAt,
 *   todayDate, todayEarnings, tripsToday, rating
 */
export type PgDriverProfile = {
  uid:                        string;
  phone:                      string;
  name:                       string | null;
  city:                       string | null;
  gender:                     string | null;
  vehicleId:                  string | null;
  vehicleName:                string | null;
  licenseNumber:              string | null;
  vehicleNumber:              string | null;
  accountStatus:              string | null;
  suspendReason:              string | null;
  blacklistReason:            string | null;
  documentsSubmitted:         boolean;
  documentsSubmittedAt:       string | null;
  verificationStatus:         string | null;
  kycRejectionReason:         string | null;
  rejectedDocuments:          string[] | null;
  backgroundSetupShown:       boolean;
  permissionSetupVersion:     number;
  permissionSetupCompletedAt: string | null;
  onboardingFeeApplies:       boolean;
  onboardingFeeStatus:        string | null;
  onboardingFeeAmount:        number | null;
  onboardingFeeCurrency:      string | null;
  // Phase 5J-Tier-3: subscription + daily stats now PG-sourced
  subscriptionPlan:           string | null;
  subscriptionExpiresAt:      number | null;  // epoch ms, matches Firestore format
  todayDate:                  string | null;  // "YYYY-MM-DD"
  todayEarnings:              number | null;
  tripsToday:                 number | null;
  rating:                     number | null;
  createdAt:                  string;
  updatedAt:                  string;
  documents:                  Record<string, PgDocEntry>;
  onboardingStep?:            string;
  nextRoute?:                 string;
};

/** KYC status response from GET /api/drivers/verification-status. */
export type PgVerificationStatus = {
  verificationStatus: string | null;
  documentsSubmitted: boolean;
  kycRejectionReason: string | null;
  rejectedDocuments:  string[] | null;
  documents:          Record<string, PgDocEntry>;
  onboardingStep?:    string;
  nextRoute?:         string;
};

// ─── GET /api/drivers/me ──────────────────────────────────────────────────────

/**
 * Fetches the authenticated driver's full profile from PostgreSQL.
 *
 * @param idTokenOverride - Pass a freshly-obtained ID token directly (e.g. from
 *   `credential.user.getIdToken()` immediately after `signInWithCustomToken`).
 *   Avoids the `firebaseAuth.currentUser` race condition on React Native where
 *   the SDK may not have synchronised `currentUser` by the time this is called.
 *   When omitted, falls back to `firebaseAuth.currentUser.getIdToken()`.
 *
 * Returns null when the driver has no PG row yet (new signup in migration window)
 * or when network/auth is unavailable.
 */
export async function getDriverProfile(idTokenOverride?: string): Promise<PgDriverProfile | null> {
  const idToken = idTokenOverride ?? await getIdToken();
  console.log("[profile-api] getDriverProfile — idToken:", idToken ? `${idToken.slice(0, 12)}...` : "NULL");
  if (!idToken) {
    console.warn("[profile-api] getDriverProfile: no idToken — firebaseAuth.currentUser =", firebaseAuth.currentUser?.uid ?? "null");
    return null;
  }

  const url = `${BASE_URL}/drivers/me`;
  console.log("[profile-api] GET", url);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    console.log("[profile-api] GET /drivers/me →", res.status);

    if (res.status === 404) return null;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[profile-api] GET /drivers/me status:", res.status, body.slice(0, 200));
      return null;
    }

    const json = (await res.json()) as { ok?: boolean; driver?: PgDriverProfile; onboardingStep?: string; nextRoute?: string };
    if (!json.driver) {
      console.warn("[profile-api] GET /drivers/me: ok but no driver field — json.ok =", json.ok);
      return null;
    }
    console.log("[profile-api] GET /drivers/me success — nextRoute:", json.nextRoute ?? "(none)", "verificationStatus:", json.driver.verificationStatus ?? "(none)");
    return { ...json.driver, onboardingStep: json.onboardingStep, nextRoute: json.nextRoute };
  } catch (err) {
    console.error("[profile-api] GET /drivers/me network error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── GET /api/drivers/verification-status ─────────────────────────────────────

/**
 * Fetches the driver's KYC status and document map from PostgreSQL.
 * Returns null when the driver has no PG row yet or network is unavailable.
 */
export async function getDriverVerificationStatus(): Promise<PgVerificationStatus | null> {
  const idToken = await getIdToken();
  if (!idToken) return null;

  try {
    const res = await fetch(`${BASE_URL}/drivers/verification-status`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (res.status === 404) return null;

    if (!res.ok) {
      console.error("[profile-api] GET /drivers/verification-status status:", res.status);
      return null;
    }

    const json = (await res.json()) as { ok?: boolean; nextRoute?: string } & Partial<PgVerificationStatus>;
    if (!json.ok) return null;
    return {
      verificationStatus: json.verificationStatus ?? null,
      documentsSubmitted: json.documentsSubmitted  ?? false,
      kycRejectionReason: json.kycRejectionReason  ?? null,
      rejectedDocuments:  json.rejectedDocuments   ?? null,
      documents:          json.documents           ?? {},
      nextRoute:          json.nextRoute,
    };
  } catch (err) {
    console.error("[profile-api] GET /drivers/verification-status network error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── PATCH /api/drivers/profile ───────────────────────────────────────────────

/**
 * Updates the driver's core profile fields in PostgreSQL.
 * Replaces Firestore updateDriverProfile().
 */
export async function patchDriverProfile(p: Profile): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false };

  try {
    const res = await fetch(`${BASE_URL}/drivers/profile`, {
      method:  "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        name:          p.name          || undefined,
        city:          p.city          || undefined,
        gender:        p.gender        || undefined,
        licenseNumber: p.licenseNumber || undefined,
        vehicleNumber: p.vehicleNumber || undefined,
      }),
    });
    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch {
    return { ok: false };
  }
}

// ─── PATCH /api/drivers/vehicle ───────────────────────────────────────────────

/**
 * Updates the driver's vehicle selection in PostgreSQL.
 * Replaces Firestore updateDriverVehicle().
 */
export async function patchDriverVehicle(v: Vehicle): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false };

  try {
    const res = await fetch(`${BASE_URL}/drivers/vehicle`, {
      method:  "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${idToken}`,
      },
      body: JSON.stringify({ vehicleId: v.id, vehicleName: v.name }),
    });
    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch {
    return { ok: false };
  }
}

// ─── POST /api/drivers/signup ─────────────────────────────────────────────────

/**
 * Upserts the authenticated driver's row in PostgreSQL.
 * Safe to call repeatedly — existing non-null fields are never overwritten with
 * null or empty values. Must be called after OTP success so the drivers row
 * exists before document submission attempts the FK-guarded insert.
 */
export async function ensureDriverSignup(params: {
  phone:                string;
  name?:                string | null;
  city?:                string | null;
  gender?:              string | null;
  vehicleId?:           string | null;
  vehicleName?:         string | null;
  licenseNumber?:       string | null;
  vehicleNumber?:       string | null;
  verificationStatus?:  string | null;
  documentsSubmitted?:  boolean | null;
  onboardingFeeApplies?: boolean | null;
  onboardingFeeStatus?: string | null;
  onboardingFeeAmount?: number | null;
}): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) {
    console.warn("[profile-api] ensureDriverSignup: no id token");
    return { ok: false };
  }

  try {
    const res = await fetch(`${BASE_URL}/drivers/signup`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        phone:                params.phone,
        name:                 params.name                || undefined,
        city:                 params.city                || undefined,
        gender:               params.gender              || undefined,
        vehicleId:            params.vehicleId           || undefined,
        vehicleName:          params.vehicleName         || undefined,
        licenseNumber:        params.licenseNumber       || undefined,
        vehicleNumber:        params.vehicleNumber       || undefined,
        verificationStatus:   params.verificationStatus  || undefined,
        documentsSubmitted:   params.documentsSubmitted  ?? undefined,
        onboardingFeeApplies: params.onboardingFeeApplies ?? undefined,
        onboardingFeeStatus:  params.onboardingFeeStatus || undefined,
        onboardingFeeAmount:  params.onboardingFeeAmount  ?? undefined,
      }),
    });

    if (!res.ok) {
      console.error("[profile-api] POST /drivers/signup status:", res.status);
      return { ok: false };
    }

    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch (err) {
    console.error("[profile-api] POST /drivers/signup network error:", err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}

// ─── PATCH /api/drivers/background-setup ──────────────────────────────────────

/**
 * Records completion of the driver's background / permission setup flow in PostgreSQL.
 * Replaces Firestore updateDriverBackgroundSetup().
 */
export async function patchDriverBackgroundSetup(data: {
  backgroundSetupShown?:       boolean;
  permissionSetupVersion?:     number;
  permissionSetupCompletedAt?: string;
}): Promise<{ ok: boolean }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false };

  try {
    const res = await fetch(`${BASE_URL}/drivers/background-setup`, {
      method:  "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${idToken}`,
      },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as { ok?: boolean };
    return { ok: !!json.ok };
  } catch {
    return { ok: false };
  }
}
