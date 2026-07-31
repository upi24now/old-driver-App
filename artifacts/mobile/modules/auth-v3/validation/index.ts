/**
 * COMPARTMENT 7 — Validation Layer
 *
 * Single responsibility: validate user inputs (PIN, phone, OTP).
 * Returns typed results — never throws, never shows UI, never calls APIs.
 *
 * Rules:
 *   ✓ Pure functions only
 *   ✓ May import from: Config
 *   ✗ No API calls, no storage, no Firebase, no React, no navigation
 *
 * Replaceability: swap validation rules without touching any other compartment.
 * Debugging scope: if an input is wrongly accepted or rejected → this file.
 */

import { PIN_LENGTH, OTP_LENGTH, PHONE_DIGITS } from "../config";

// ─── Result type ──────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validate a PIN string.
 * Accepts exactly PIN_LENGTH digits, no letters or spaces.
 */
export function validatePin(pin: string): ValidationResult {
  if (pin.length !== PIN_LENGTH) {
    return { valid: false, message: `PIN must be ${PIN_LENGTH} digits.` };
  }
  if (!/^\d+$/.test(pin)) {
    return { valid: false, message: "PIN must contain digits only." };
  }
  return { valid: true };
}

/**
 * Validate the raw digit string entered by the user (without country prefix).
 * Accepts exactly PHONE_DIGITS numeric characters.
 */
export function validatePhoneDigits(digits: string): ValidationResult {
  if (digits.length !== PHONE_DIGITS) {
    return { valid: false, message: `Mobile number must be ${PHONE_DIGITS} digits.` };
  }
  if (!/^\d+$/.test(digits)) {
    return { valid: false, message: "Mobile number must contain digits only." };
  }
  return { valid: true };
}

/**
 * Validate a full E.164 phone number (+91XXXXXXXXXX).
 */
export function validatePhone(phone: string): ValidationResult {
  if (!phone.startsWith("+")) {
    return { valid: false, message: "Phone number must include a country code." };
  }
  const digits = phone.replace(/^\+\d{1,3}/, "");
  return validatePhoneDigits(digits);
}

/**
 * Validate a 6-digit OTP string.
 */
export function validateOtp(otp: string): ValidationResult {
  if (otp.length !== OTP_LENGTH) {
    return { valid: false, message: `OTP must be ${OTP_LENGTH} digits.` };
  }
  if (!/^\d+$/.test(otp)) {
    return { valid: false, message: "OTP must contain digits only." };
  }
  return { valid: true };
}

/**
 * Check that two PIN strings match.
 * Call this after both validatePin() checks have passed.
 */
export function pinsMatch(pin: string, confirm: string): ValidationResult {
  if (pin !== confirm) {
    return { valid: false, message: "PINs don't match. Please try again." };
  }
  return { valid: true };
}
