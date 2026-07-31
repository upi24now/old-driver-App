/**
 * COMPARTMENT 1 — Navigation
 *
 * Single responsibility: own all route constants and navigation actions for
 * the V3 authentication flow. This is the only place that knows route strings.
 *
 * Rules:
 *   ✓ May import from: Config (for any config-driven route behaviour)
 *   ✓ Receives an Expo Router `router` instance as a parameter — never imports
 *     useRouter() itself (that belongs to the UI layer)
 *   ✗ No authentication logic, no API calls, no session logic, no storage
 *   ✗ No React state
 *
 * Replaceability: swap the router library (e.g. React Navigation) by
 *   changing only this file. Screens depend on navTo* functions, not on
 *   expo-router directly for navigation actions.
 * Debugging scope: if the app navigates to the wrong screen → this file.
 */

// ─── Route registry ───────────────────────────────────────────────────────────

export const ROUTES = {
  WELCOME:      "/auth-v3/welcome",
  LOGIN:        "/auth-v3/login",
  PIN:          "/auth-v3/pin",
  SIGNUP_FORM:  "/auth-v3/signup-form",
  OTP:          "/auth-v3/otp",
  CREATE_PIN:   "/auth-v3/create-pin",
  CONFIRM_PIN:  "/auth-v3/confirm-pin",
  FORGOT_PIN:   "/auth-v3/forgot-pin",
  HOME:         "/auth-v3/home",
} as const;

export type OtpIntent    = "signup" | "forgot";
export type PinIntent    = "signup" | "forgot";

// ─── Router type ─────────────────────────────────────────────────────────────
//
// The Navigation compartment is the only V3 file permitted to import from
// expo-router. We import the Router type so all nav functions are correctly
// typed without any casting in the UI screens.

import type { Router, Href } from "expo-router";

export type { Router };
export type NavRouter = Router;

// Internal helper — casts a string route to the Href type that expo-router
// requires. This cast is intentional and safe: all ROUTES values are valid
// paths registered in the app's file-based routing.
function href(path: string): Href {
  return path as Href;
}

// ─── Navigation actions ───────────────────────────────────────────────────────

export function navToWelcome(router: NavRouter): void {
  router.replace(href(ROUTES.WELCOME));
}

export function navToLogin(router: NavRouter): void {
  router.push(href(ROUTES.LOGIN));
}

export function navToPin(router: NavRouter): void {
  router.push(href(ROUTES.PIN));
}

export function navToSignupForm(router: NavRouter): void {
  router.push(href(ROUTES.SIGNUP_FORM));
}

export function navToOtp(router: NavRouter, intent: OtpIntent): void {
  router.push(href(`${ROUTES.OTP}?intent=${intent}`));
}

export function navToCreatePin(router: NavRouter, intent: PinIntent): void {
  router.push(href(`${ROUTES.CREATE_PIN}?intent=${intent}`));
}

export function navToConfirmPin(router: NavRouter, intent: PinIntent): void {
  router.push(href(`${ROUTES.CONFIRM_PIN}?intent=${intent}`));
}

export function navToForgotPin(router: NavRouter): void {
  router.push(href(ROUTES.FORGOT_PIN));
}

export function navToHome(router: NavRouter): void {
  router.replace(href(ROUTES.HOME));
}

export function navBack(router: NavRouter): void {
  router.back();
}
