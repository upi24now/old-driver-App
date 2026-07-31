/**
 * COMPARTMENT 10 — Configuration
 *
 * Single responsibility: own every constant, limit, timeout, and flag used
 * across the V3 authentication module.
 *
 * Rules:
 *   ✓ May export constants only
 *   ✗ No imports from other compartments
 *   ✗ No React, no RN, no async
 *
 * Replaceability: swap values here to change behaviour globally.
 * Debugging scope: if a limit/timeout behaves wrong → this file.
 */

// ─── Input constraints ────────────────────────────────────────────────────────

export const PIN_LENGTH         = 6;
export const OTP_LENGTH         = 6;
export const PHONE_DIGITS       = 10;       // digits after the country prefix
export const PHONE_PREFIX       = "+91";

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const SESSION_KEY        = "@v3/auth/session";

// ─── Timing ───────────────────────────────────────────────────────────────────

export const OTP_RESEND_COOLDOWN_MS = 30_000;

// ─── Brand palette (shared by all UI screens) ─────────────────────────────────

export const COLORS = {
  primary:     "#FF6B00",
  primaryPress:"#E55A00",
  bg:          "#FFFFFF",
  bgAlt:       "#F5F4F2",
  text:        "#111111",
  sub:         "#374151",
  muted:       "#6B7280",
  placeholder: "#9CA3AF",
  border:      "#E5E7EB",
  error:       "#DC2626",
  success:     "#059669",
  tint:        "#FFF3EC",
  tintBorder:  "#FDE68A",
  inputBg:     "#F9FAFB",
} as const;

// ─── Vehicle catalogue ────────────────────────────────────────────────────────

export const VEHICLES = [
  { id: "two_wheeler",          name: "Two Wheeler"          },
  { id: "loader_three_wheeler", name: "Three Wheeler"        },
  { id: "tata_ace",             name: "Tata Ace"             },
  { id: "mini_truck",           name: "Mini Truck"           },
  { id: "mahindra_pickup",      name: "Mahindra Pickup"      },
  { id: "tata_407",             name: "Tata 407"             },
  { id: "canter",               name: "Canter"               },
] as const;

export type VehicleId = (typeof VEHICLES)[number]["id"];
