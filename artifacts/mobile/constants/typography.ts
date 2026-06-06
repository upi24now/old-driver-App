/**
 * Typography scale for Bike Courier Driver App.
 *
 * Pair with Inter font family (loaded via expo-google-fonts or expo-font).
 * Font family names match the Inter_* exports from @expo-google-fonts/inter.
 *
 * Usage:
 *   import { TS } from "@/constants/typography";
 *   <Text style={TS.h2}>Heading</Text>
 *   <Text style={[TS.body, { color: colors.textMuted }]}>Body</Text>
 */

type TextStyle = {
  fontSize: number;
  fontWeight: "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";
  letterSpacing?: number;
  lineHeight?: number;
  textTransform?: "uppercase" | "none";
};

const TS: Record<string, TextStyle> = {
  // ── Display ────────────────────────────────────────────────────────────────
  display: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.8,
  },

  // ── Headings ───────────────────────────────────────────────────────────────
  h1: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },

  // ── Body ───────────────────────────────────────────────────────────────────
  bodyLg: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 24,
  },
  body: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 21,
  },
  bodySm: {
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 19,
  },

  // ── Labels (uppercase caps) ────────────────────────────────────────────────
  labelLg: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // ── Numbers / amounts ──────────────────────────────────────────────────────
  numHero: {
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: -1.5,
  },
  numLg: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  numMd: {
    fontSize: 18,
    fontWeight: "600",
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  btnLg: {
    fontSize: 15,
    fontWeight: "600",
  },
  btnMd: {
    fontSize: 13,
    fontWeight: "600",
  },
  btnSm: {
    fontSize: 11,
    fontWeight: "600",
  },
};

/** Individual size constants — use when you need just the number. */
export const FontSize = {
  display: 32,
  h1: 24,
  h2: 20,
  h3: 17,
  bodyLg: 16,
  body: 14,
  bodySm: 13,
  labelLg: 12,
  label: 10,
  numHero: 36,
  numLg: 24,
  numMd: 18,
  btnLg: 15,
  btnMd: 13,
  btnSm: 11,
} as const;

/** Individual weight constants — use where fontWeight is needed standalone. */
export const FontWeight = {
  regular: "400",
  medium: "500",
  semiBold: "600",
  bold: "700",
  extraBold: "800",
} as const satisfies Record<string, TextStyle["fontWeight"]>;

export { TS };
