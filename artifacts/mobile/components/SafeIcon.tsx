// FILE: artifacts/mobile/components/SafeIcon.tsx
// PURPOSE: No Feather, no MaterialCommunityIcons, no emoji, no broken box glyph.
// This uses plain text labels + View shapes only, so it works on web, Expo Go, Android browser.

import React from "react";
import { View, Text, StyleSheet, ViewStyle, Pressable, ActivityIndicator } from "react-native";

export type SafeIconName =
  | "bike"
  | "scooter"
  | "auto"
  | "truck"
  | "user"
  | "camera"
  | "gallery"
  | "id"
  | "doc"
  | "license"
  | "rc"
  | "shield"
  | "lock"
  | "check"
  | "clock"
  | "bell"
  | "support"
  | "book"
  | "car"
  | "package"
  | "rupee"
  | "arrow"
  | "back"
  | "hash"
  | "star"
  | "warning"
  | "info"
  | "refresh"
  | "close"
  | "profile"
  | "search";

export const LABELS: Record<SafeIconName, string> = {
  bike:    "2W",
  scooter: "SC",
  auto:    "3W",
  truck:   "4W",
  user:    "US",
  camera:  "CAM",
  gallery: "IMG",
  id:      "ID",
  doc:     "DOC",
  license: "DL",
  rc:      "RC",
  shield:  "SAFE",
  lock:    "LOCK",
  check:   "OK",
  clock:   "TIME",
  bell:    "NOTI",
  support: "HELP",
  book:    "BOOK",
  car:     "CAR",
  package: "PKG",
  rupee:   "₹",
  arrow:   ">",
  back:    "<",
  hash:    "#",
  star:    "POP",
  warning: "!",
  info:    "i",
  refresh: "R",
  close:   "X",
  profile: "DR",
  search:  "SRC",
};

type Props = {
  name: SafeIconName;
  size?: number;
  color?: string;
  bg?: string;
  rounded?: number;
  style?: ViewStyle;
  textSize?: number;
};

export function SafeIcon({
  name,
  size = 48,
  color = "#E83272",
  bg = "#FCE7F3",
  rounded = 16,
  style,
  textSize,
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
          {
            color,
            fontSize: textSize ?? Math.max(10, size * 0.28),
          },
        ]}
      >
        {LABELS[name]}
      </Text>
    </View>
  );
}

export function SafeInlineIcon({
  name,
  color = "#E83272",
  size = 18,
}: {
  name: SafeIconName;
  color?: string;
  size?: number;
}) {
  return (
    <Text
      numberOfLines={1}
      style={{
        color,
        fontSize: Math.max(10, size * 0.72),
        fontWeight: "900",
        includeFontPadding: false,
      }}
    >
      {LABELS[name]}
    </Text>
  );
}

// ─── SafeIcon3D ────────────────────────────────────────────────────────────────

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
      pointerEvents="none"
      style={[
        styles.icon3dShadow,
        { shadowColor: glow, borderRadius: rounded },
        style,
      ]}
    >
      <View
        style={[
          styles.icon3dTile,
          { width: size, height: size, borderRadius: rounded, backgroundColor: bg },
        ]}
      >
        <View style={styles.icon3dHighlight} />
        <View style={[styles.icon3dInner, { borderRadius: Math.max(8, rounded - 5) }]}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.label,
              { color, fontSize: textSize ?? Math.max(10, size * 0.27) },
            ]}
          >
            {LABELS[name]}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── PremiumButton3D ──────────────────────────────────────────────────────────

type PremiumButton3DProps = {
  title: string;
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
  leftIcon?: SafeIconName;
  rightIcon?: SafeIconName;
  bg?: string;
  bgDark?: string;
  textColor?: string;
  style?: ViewStyle;
};

export function PremiumButton3D({
  title,
  disabled,
  loading,
  onPress,
  leftIcon,
  rightIcon = "arrow",
  bg = "#E83272",
  bgDark = "#BE185D",
  textColor = "#FFFFFF",
  style,
}: PremiumButton3DProps) {
  const isOff      = disabled || loading;
  const activeBg   = isOff ? "#E5E7EB" : bg;
  const activeDark = isOff ? "#CBD5E1" : bgDark;
  const activeText = isOff ? "#9CA3AF" : textColor;

  return (
    <Pressable
      disabled={isOff}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button3dWrap,
        {
          opacity:       isOff ? 0.9 : 1,
          transform:     [{ translateY: pressed && !isOff ? 3 : 0 }],
          shadowOpacity: isOff ? 0.05 : pressed ? 0.12 : 0.28,
        },
        style,
      ]}
    >
      <View style={[styles.button3dBase, { backgroundColor: activeDark }]}>
        <View style={[styles.button3dFace, { backgroundColor: activeBg }]}>
          <View
            style={[
              styles.button3dGloss,
              {
                backgroundColor: isOff
                  ? "rgba(255,255,255,0.25)"
                  : "rgba(255,255,255,0.22)",
              },
            ]}
          />
          <View style={styles.button3dContent}>
            {loading ? (
              <ActivityIndicator size="small" color={textColor} />
            ) : (
              <>
                {leftIcon ? (
                  <SafeInlineIcon name={leftIcon} color={activeText} size={17} />
                ) : null}
                <Text numberOfLines={1} style={[styles.button3dText, { color: activeText }]}>
                  {title}
                </Text>
                {rightIcon ? (
                  <SafeInlineIcon name={rightIcon} color={activeText} size={17} />
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "900",
    textAlign: "center",
    includeFontPadding: false,
    letterSpacing: 0.2,
  },

  icon3dShadow: {
    shadowOffset:  { width: 0, height: 10 },
    shadowRadius:  18,
    shadowOpacity: 1,
    elevation:     8,
  },
  icon3dTile: {
    alignItems:     "center",
    justifyContent: "center",
    overflow:       "hidden",
    borderWidth:    1,
    borderColor:    "rgba(255,255,255,0.75)",
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
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "center",
    gap:              10,
    paddingHorizontal: 18,
  },
  button3dText: {
    fontSize:      18,
    fontWeight:    "900",
    letterSpacing: 0.2,
  },
});
