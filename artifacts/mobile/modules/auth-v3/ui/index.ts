/**
 * COMPARTMENT 8 — UI Layer  (Public Contract)
 *
 * This is the ONLY file other compartments and screens may import from this
 * directory. Internal files (FlowContext.tsx, NumPad.tsx, PinDots.tsx) must
 * not be imported directly.
 *
 * Screens are the primary consumers. They import from here exclusively.
 *
 * Rules:
 *   ✓ Screens import UI primitives and FlowContext from this barrel.
 *   ✗ No compartment outside UI may import from ui/context/* or ui/components/*
 *     directly — use this index instead.
 *
 * Replaceability: swap any component (e.g. NumPad for an animated variant)
 *   by changing the internal file and updating this barrel export only.
 */

// Flow context — inter-screen transient state
export { V3FlowProvider, useV3Flow }    from "./context/FlowContext";
export type { V3SignupData }            from "./context/FlowContext";

// UI components — pure presentation
export { NumPad }                       from "./components/NumPad";
export { PinDots }                      from "./components/PinDots";
