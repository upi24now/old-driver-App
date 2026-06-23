// ─── config-api.ts ────────────────────────────────────────────────────────────
//
// Phase 5J-Tier-1: REST-backed config reads — replaces Firestore reads of
// app_config/* documents.
//

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ─── Onboarding fee config ─────────────────────────────────────────────────────

export type OnboardingFeeConfig = {
  enabled:      boolean;
  amount:       number;
  currency:     string;
  title:        string;
  description?: string;
};

const DEFAULT_FEE_CONFIG: OnboardingFeeConfig = {
  enabled:  true,
  amount:   10,
  currency: "INR",
  title:    "One-time onboarding fee",
};

/**
 * GET /api/config/onboarding-fee
 *
 * No auth required.  Falls back to DEFAULT_FEE_CONFIG on any error so the
 * onboarding-fee screen always has a usable amount.
 */
export async function getOnboardingFeeConfig(): Promise<OnboardingFeeConfig> {
  try {
    const res = await fetch(`${BASE_URL}/config/onboarding-fee`);
    if (!res.ok) return DEFAULT_FEE_CONFIG;
    const json = (await res.json()) as { ok?: boolean; config?: OnboardingFeeConfig };
    if (!json.ok || !json.config) return DEFAULT_FEE_CONFIG;
    return json.config;
  } catch {
    return DEFAULT_FEE_CONFIG;
  }
}
