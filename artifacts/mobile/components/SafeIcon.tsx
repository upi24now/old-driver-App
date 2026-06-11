/**
 * SafeIcon.tsx
 *
 * Emoji-based icon tiles that render without any icon-font dependency.
 * All glyphs are native Unicode / emoji — zero glyph-square risk on Android.
 *
 * Exports
 *   SafeIcon          — square tile with coloured background
 *   SafeInlineIcon    — bare glyph, no tile (for use inside buttons / rows)
 *   SafeIcon3D        — premium 3D-effect tile with gloss + glow shadow
 *   PremiumButton3D   — chunky 3D press-effect CTA button
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

// ─────────────────────────────────────────────────────────────────
// Icon name registry
// ─────────────────────────────────────────────────────────────────

export const LABELS = {
  // Navigation / actions
  arrow:       "→",
  back:        "←",
  check:       "✓",
  close:       "✕",
  refresh:     "↺",
  search:      "🔍",
  filter:      "⊟",
  edit:        "✎",
  share:       "↗",

  // Auth / security
  lock:        "🔒",
  shield:      "🛡",
  otp:         "🔑",
  verified:    "✅",
  eye:         "👁",

  // Vehicles
  bike:        "🏍",
  scooter:     "🛵",
  auto:        "🚗",
  truck:       "🚚",
  cargo:       "📦",
  cycle:       "🚲",

  // Delivery / orders
  package:     "📦",
  location:    "📍",
  delivery:    "🚀",
  pickup:      "🏪",
  route:       "🗺",
  timer:       "⏱",

  // Documents / profile
  camera:      "📷",
  document:    "📄",
  id:          "🪪",
  license:     "📋",
  selfie:      "🤳",
  profile:     "👤",

  // UI / status
  star:        "⭐",
  bell:        "🔔",
  support:     "🎧",
  wallet:      "💳",
  earnings:    "💰",
  info:        "ℹ",
  warning:     "⚠",
  success:     "🎉",
  trophy:      "🏆",
  fire:        "🔥",
} as const;

export type SafeIconName = keyof typeof LABELS;

// ─────────────────────────────────────────────────────────────────
// Shared prop type
// ─────────────────────────────────────────────────────────────────

type Props = {
  name: SafeIconName;
  size?: number;
  color?: string;
  bg?: string;
  rounded?: number;
  textSize?: number;
  style?: ViewStyle;
};

// ─────────────────────────────────────────────────────────────────
// SafeIcon — simple flat tile
// ─────────────────────────────────────────────────────────────────

export function SafeIcon({
  name,
  size = 44,
  bg = "#F3F4F6",
  rounded = 12,
  textSize,
  style,
}: Props) {
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: bg,
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.label,
          { fontSize: textSize ?? Math.max(10, size * 0.45) },
        ]}
      >
        {LABELS[name]}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────
// SafeInlineIcon — bare glyph, no background tile
// ─────────────────────────────────────────────────────────────────

export function SafeInlineIcon({
  name,
  size = 18,
  color = "#111827",
  style,
}: Props) {
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.inline,
        { fontSize: size, color },
        style as object,
      ]}
    >
      {LABELS[name]}
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────
// SafeIcon3D — premium 3D-effect tile (gloss highlight + glow)
// ─────────────────────────────────────────────────────────────────

export function SafeIcon3D({
  name,
  size = 54,
  color = "#E83272",
  bg = "#FCE7F3",
  glow = "rgba(232, 50, 114, 0.22)",
  rounded = 18,
  textSize,
  style,
}: Props & { glow?: string }) {
  return (
    <View
      style={[
        styles.icon3dShadow,
        {
          shadowColor: glow,
          borderRadius: rounded,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.icon3dTile,
          {
            width: size,
            height: size,
            borderRadius: rounded,
            backgroundColor: bg,
          },
        ]}
      >
        <View style={styles.icon3dHighlight} />
        <View
          style={[
            styles.icon3dInner,
            {
              borderRadius: Math.max(8, rounded - 5),
            },
          ]}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.label,
              {
                color,
                fontSize: textSize ?? Math.max(10, size * 0.27),
              },
            ]}
          >
            {LABELS[name]}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────
// PremiumButton3D — chunky 3D press-effect CTA button
// ─────────────────────────────────────────────────────────────────

type PremiumButton3DProps = {
  title: string;
  disabled?: boolean;
  onPress?: () => void;
  leftIcon?: SafeIconName;
  rightIcon?: SafeIconName;
  bg?: string;
  bg2?: string;
  textColor?: string;
  style?: ViewStyle;
};

export function PremiumButton3D({
  title,
  disabled,
  onPress,
  leftIcon,
  rightIcon = "arrow",
  bg = "#E83272",
  bg2 = "#F97316",
  textColor = "#FFFFFF",
  style,
}: PremiumButton3DProps) {
  const activeBg   = disabled ? "#E5E7EB" : bg;
  const activeText = disabled ? "#9CA3AF" : textColor;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button3dWrap,
        {
          opacity:       disabled ? 0.9 : 1,
          transform:     [{ translateY: pressed && !disabled ? 3 : 0 }],
          shadowOpacity: disabled ? 0.05 : pressed ? 0.12 : 0.28,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.button3dBase,
          {
            backgroundColor: disabled ? "#CBD5E1" : "#BE185D",
          },
        ]}
      >
        <View
          style={[
            styles.button3dFace,
            {
              backgroundColor: activeBg,
            },
          ]}
        >
          <View
            style={[
              styles.button3dGloss,
              {
                backgroundColor: disabled
                  ? "rgba(255,255,255,0.25)"
                  : "rgba(255,255,255,0.22)",
              },
            ]}
          />
          <View style={styles.button3dContent}>
            {leftIcon ? (
              <SafeInlineIcon name={leftIcon} color={activeText} size={17} />
            ) : null}

            <Text
              numberOfLines={1}
              style={[styles.button3dText, { color: activeText }]}
            >
              {title}
            </Text>

            {rightIcon ? (
              <SafeInlineIcon name={rightIcon} color={activeText} size={17} />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // SafeIcon (flat tile)
  tile: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  // SafeInlineIcon (bare glyph)
  inline: {
    includeFontPadding: false,
    textAlignVertical: "center",
  },

  // Shared label (used by SafeIcon, SafeIcon3D inner text)
  label: {
    includeFontPadding: false,
    textAlignVertical: "center",
    textAlign: "center",
  },

  // SafeIcon3D
  icon3dShadow: {
    shadowOffset:  { width: 0, height: 10 },
    shadowRadius:  18,
    shadowOpacity: 1,
    elevation:     8,
  },
  icon3dTile: {
    alignItems:      "center",
    justifyContent:  "center",
    overflow:        "hidden",
    borderWidth:     1,
    borderColor:     "rgba(255,255,255,0.75)",
  },
  icon3dHighlight: {
    position:        "absolute",
    top:             0,
    left:            0,
    right:           0,
    height:          "42%",
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  icon3dInner: {
    minWidth:        "68%",
    minHeight:       "58%",
    alignItems:      "center",
    justifyContent:  "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth:     1,
    borderColor:     "rgba(255,255,255,0.35)",
  },

  // PremiumButton3D
  button3dWrap: {
    shadowColor:  "#E83272",
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 22,
    elevation:    10,
  },
  button3dBase: {
    borderRadius:  24,
    paddingBottom: 5,
  },
  button3dFace: {
    minHeight:      62,
    borderRadius:   24,
    alignItems:     "center",
    justifyContent: "center",
    overflow:       "hidden",
    borderWidth:    1,
    borderColor:    "rgba(255,255,255,0.35)",
  },
  button3dGloss: {
    position: "absolute",
    top:      0,
    left:     0,
    right:    0,
    height:   "46%",
  },
  button3dContent: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingHorizontal: 18,
  },
  button3dText: {
    fontSize:      18,
    fontWeight:    "900",
    letterSpacing: 0.2,
  },
});
