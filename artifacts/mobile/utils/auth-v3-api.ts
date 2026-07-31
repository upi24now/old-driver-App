/**
 * auth-v3-api.ts — Authentication V3 API Layer
 *
 * Thin, typed wrappers over the existing backend APIs.
 * No React, no Firebase, no AsyncStorage — pure API calls only.
 * All results follow the { ok, ...data } | { ok: false, error } pattern.
 *
 * Consumed exclusively by: app/login-v3.tsx
 */

import {
  sendOtp,
  verifyOtpApi,
  verifyPinApi,
  setPinWithToken,
} from "@/utils/auth-api";
import { ensureDriverSignup } from "@/utils/profile-api";

// ─── Vehicle catalogue (matches vehicle-selection.tsx ids) ───────────────────

export const V3_VEHICLES = [
  { id: "two_wheeler",          name: "Two Wheeler"          },
  { id: "loader_three_wheeler", name: "Three Wheeler"        },
  { id: "tata_ace",             name: "Tata Ace"             },
  { id: "mini_truck",           name: "Mini Truck"           },
  { id: "mahindra_pickup",      name: "Mahindra Pickup"      },
  { id: "tata_407",             name: "Tata 407"             },
  { id: "canter",               name: "Canter"               },
] as const;

export type V3VehicleId = (typeof V3_VEHICLES)[number]["id"];

// ─── Result types ─────────────────────────────────────────────────────────────

export type V3OtpSendResult =
  | { ok: true;  otpId: string }
  | { ok: false; error: string };

export type V3OtpVerifyResult =
  | { ok: true;  token: string; sessionId: string | null }
  | { ok: false; error: string };

export type V3PinVerifyResult =
  | { ok: true;  token: string; sessionId: string | null }
  | { ok: false; error: string };

export type V3SetPinResult =
  | { ok: true }
  | { ok: false; error: string };

export type V3SignupResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── API call wrappers ────────────────────────────────────────────────────────

/**
 * Send OTP to the given +91 phone number.
 * Used by: Forgot PIN flow, New Signup flow.
 * NOT used for normal login — normal login uses PIN.
 */
export async function v3SendOtp(phone: string): Promise<V3OtpSendResult> {
  const r = await sendOtp(phone);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, otpId: r.otpId ?? "" };
}

/**
 * Verify OTP code.
 * Returns custom auth token + session ID from the backend.
 */
export async function v3VerifyOtp(phone: string, otp: string): Promise<V3OtpVerifyResult> {
  const r = await verifyOtpApi(phone, otp);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, token: r.token, sessionId: r.sessionId ?? null };
}

/**
 * Verify driver PIN — the primary daily login method.
 * Returns a custom auth token + session ID if PIN is correct.
 * Returns error if PIN is wrong or account is locked.
 */
export async function v3VerifyPin(phone: string, pin: string): Promise<V3PinVerifyResult> {
  const r = await verifyPinApi(phone, pin);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, token: r.token, sessionId: r.sessionId ?? null };
}

/**
 * Save a new PIN using an explicit Firebase ID token + session ID.
 * Used after OTP verification (forgot-PIN path and signup path), immediately
 * after signInWithCustomToken so we have the freshly-issued idToken in hand
 * rather than relying on the module-level cache which may lag.
 */
export async function v3SetPin(
  pin: string,
  idToken: string,
  sessionId: string | null,
): Promise<V3SetPinResult> {
  const r = await setPinWithToken(pin, idToken, sessionId ?? undefined);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

/**
 * Create a new driver account after OTP verification.
 * Wraps ensureDriverSignup — creates or upserts the driver row.
 */
export type V3SignupParams = {
  phone:         string;
  name:          string;
  city:          string;
  gender:        string;
  vehicleId:     string;
  vehicleName:   string;
  licenseNumber?: string;
  vehicleNumber?: string;
};

export async function v3CreateDriverAccount(
  params: V3SignupParams,
): Promise<V3SignupResult> {
  try {
    await ensureDriverSignup(params);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signup failed.";
    return { ok: false, error: msg };
  }
}
