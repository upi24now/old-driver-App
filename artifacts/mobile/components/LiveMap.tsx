import { Feather } from "@expo/vector-icons";
import { Fragment, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

// ─── Night-map colour constants ───────────────────────────────────────────────
// Map illustration values — intentionally outside the semantic token system.
// Do not replace with useColors() tokens.
const MAP_BG      = "#181e2e";
const MAP_ROAD    = "#252e45";
const MAP_ROAD_HI = "#3d7aed";
const MAP_PARK    = "#1b2d1e";
const MAP_WATER   = "#141d2e";
const MAP_BLOCK   = "#222840";
const PIN_BLUE    = "#4A9EFF";
const CTRL_BG     = "rgba(18,22,38,0.90)";
const CTRL_BORDER = "rgba(255,255,255,0.10)";

// ─── Hot zone data ────────────────────────────────────────────────────────────
type Tier = "very_high" | "high" | "medium" | "low";

type HotZone = {
  label:  string;
  orders: number;
  tier:   Tier;
  x:      number;  // SVG viewBox x (0–400)
  y:      number;  // SVG viewBox y (0–220)
  r:      number;  // outer glow radius
};

export const TIER_COLOR: Record<Tier, string> = {
  very_high: "#FF3B30",
  high:      "#FF9500",
  medium:    "#FFCC00",
  low:       "#34C759",
};

const TIER_LABEL: Record<Tier, string> = {
  very_high: "Very High",
  high:      "High",
  medium:    "Medium",
  low:       "Low",
};

const HOT_ZONES: HotZone[] = [
  { label: "Railway Station", orders: 18, tier: "very_high", x: 78,  y: 65,  r: 34 },
  { label: "Bus Stand",       orders: 12, tier: "high",      x: 308, y: 95,  r: 28 },
  { label: "Market Area",     orders:  6, tier: "medium",    x: 195, y: 148, r: 24 },
  { label: "Hospital Zone",   orders:  4, tier: "low",       x: 350, y: 165, r: 18 },
];

const LEGEND_TIERS: Tier[] = ["very_high", "high", "medium", "low"];

// ─── Hot Zone Strip ───────────────────────────────────────────────────────────
export function HotZoneStrip() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.stripScroll}
      contentContainerStyle={styles.stripContent}
    >
      {HOT_ZONES.map((z) => (
        <View key={z.label} style={styles.stripChip}>
          <View style={[styles.stripDot, { backgroundColor: TIER_COLOR[z.tier] }]} />
          <Text style={styles.stripLabel} numberOfLines={1}>{z.label}</Text>
          <Text style={styles.stripCount}>{z.orders}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── LiveMap ──────────────────────────────────────────────────────────────────
export default function LiveMap({ online }: { online: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!online) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue:         1,
        duration:        1800,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [online, pulse]);

  return (
    <View style={styles.mapWrap}>

      {/* ── Night-style SVG map ──────────────────────────────────────────── */}
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Background */}
        <Rect x="0" y="0" width="400" height="220" fill={MAP_BG} />

        {/* Parks */}
        <Rect x="20"  y="20"  width="80" height="50" rx="6" fill={MAP_PARK} />
        <Rect x="300" y="140" width="90" height="60" rx="6" fill={MAP_PARK} />

        {/* Water */}
        <Path
          d="M0,180 Q80,160 160,180 T320,180 L400,180 L400,220 L0,220 Z"
          fill={MAP_WATER}
        />

        {/* Building blocks */}
        <Rect x="120" y="30"  width="60" height="40" rx="3" fill={MAP_BLOCK} />
        <Rect x="200" y="20"  width="80" height="50" rx="3" fill={MAP_BLOCK} />
        <Rect x="120" y="90"  width="60" height="40" rx="3" fill={MAP_BLOCK} />
        <Rect x="200" y="90"  width="80" height="40" rx="3" fill={MAP_BLOCK} />
        <Rect x="20"  y="90"  width="80" height="40" rx="3" fill={MAP_BLOCK} />
        <Rect x="300" y="30"  width="80" height="90" rx="3" fill={MAP_BLOCK} />

        {/* Roads */}
        <Rect x="0"   y="75"  width="400" height="8"   fill={MAP_ROAD} />
        <Rect x="0"   y="135" width="400" height="8"   fill={MAP_ROAD} />
        <Rect x="105" y="0"   width="8"   height="180" fill={MAP_ROAD} />
        <Rect x="185" y="0"   width="8"   height="180" fill={MAP_ROAD} />
        <Rect x="285" y="0"   width="8"   height="180" fill={MAP_ROAD} />

        {/* Highlighted main road — blue when online */}
        <Rect
          x="0" y="78" width="400" height="2"
          fill={MAP_ROAD_HI}
          opacity={online ? 0.9 : 0.35}
        />

        {/* ── Heat zone overlays ─────────────────────────────────────────── */}
        {HOT_ZONES.map((z) => {
          const c = TIER_COLOR[z.tier];
          return (
            <Fragment key={z.label}>
              {/* Outer glow */}
              <Circle cx={z.x} cy={z.y} r={z.r}        fill={c} opacity={0.13} />
              {/* Mid ring */}
              <Circle cx={z.x} cy={z.y} r={z.r * 0.65} fill={c} opacity={0.22} />
              {/* Inner fill */}
              <Circle cx={z.x} cy={z.y} r={z.r * 0.38} fill={c} opacity={0.50} />
              {/* Centre dot */}
              <Circle cx={z.x} cy={z.y} r={z.r * 0.14} fill={c} opacity={1}    />
              {/* Zone name */}
              <SvgText
                x={z.x}
                y={z.y + z.r + 11}
                fontSize={8}
                fontWeight="600"
                fill="rgba(255,255,255,0.85)"
                textAnchor="middle"
              >
                {z.label}
              </SvgText>
              {/* Order count */}
              <SvgText
                x={z.x}
                y={z.y + z.r + 20}
                fontSize={7}
                fill={c}
                textAnchor="middle"
              >
                {z.orders} orders
              </SvgText>
            </Fragment>
          );
        })}

        {/* ── Legend (top-right) ─────────────────────────────────────────── */}
        <Rect x="316" y="4" width="80" height="58" rx="4"
          fill="rgba(10,14,26,0.76)"
        />
        {LEGEND_TIERS.map((t, i) => (
          <Fragment key={t}>
            <Circle
              cx={325} cy={14 + i * 13}
              r={3.5}
              fill={TIER_COLOR[t]}
            />
            <SvgText
              x={332} y={18 + i * 13}
              fontSize={7.5}
              fontWeight="500"
              fill="rgba(255,255,255,0.78)"
            >
              {TIER_LABEL[t]}
            </SvgText>
          </Fragment>
        ))}
      </Svg>

      {/* ── Driver location pin (always centred) ─────────────────────────── */}
      <View style={styles.mapPinWrap} pointerEvents="none">
        {online && (
          <Animated.View
            style={[
              styles.mapPulse,
              {
                borderColor: PIN_BLUE,
                opacity: pulse.interpolate({
                  inputRange:  [0, 1],
                  outputRange: [0.55, 0],
                }),
                transform: [{
                  scale: pulse.interpolate({
                    inputRange:  [0, 1],
                    outputRange: [0.6, 2.8],
                  }),
                }],
              },
            ]}
          />
        )}
        <View style={[
          styles.mapPin,
          { backgroundColor: online ? PIN_BLUE : "#4a5060" },
        ]}>
          <View style={styles.mapPinInner} />
        </View>
      </View>

      {/* ── Zoom controls ────────────────────────────────────────────────── */}
      <View style={styles.mapZoom}>
        <View style={styles.mapZoomBtn}>
          <Feather name="plus"  size={14} color="rgba(255,255,255,0.80)" />
        </View>
        <View style={[styles.mapZoomBtn, styles.mapZoomBtnBorder]}>
          <Feather name="minus" size={14} color="rgba(255,255,255,0.80)" />
        </View>
      </View>

      {/* ── Locate button ────────────────────────────────────────────────── */}
      <View style={styles.mapLocate}>
        <Feather
          name="navigation"
          size={14}
          color={online ? PIN_BLUE : "rgba(255,255,255,0.45)"}
        />
      </View>

      {/* ── Location chip ────────────────────────────────────────────────── */}
      <View style={styles.mapLocChip}>
        <Feather
          name="map-pin"
          size={11}
          color={online ? PIN_BLUE : "rgba(255,255,255,0.40)"}
        />
        <Text style={styles.mapLocText}>Indiranagar, Bengaluru</Text>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // Map container
  mapWrap: {
    height:          260,
    borderRadius:    12,
    overflow:        "hidden",
    backgroundColor: MAP_BG,
    position:        "relative",
    marginTop:       4,
  },

  // Driver pin
  mapPinWrap: {
    position:       "absolute",
    top:            "50%" as unknown as number,
    left:           "50%" as unknown as number,
    marginLeft:     -11,
    marginTop:      -11,
    alignItems:     "center",
    justifyContent: "center",
  },
  mapPulse: {
    position:     "absolute",
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  2,
  },
  mapPin: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:    3,
    borderColor:    "rgba(255,255,255,0.90)",
    alignItems:     "center",
    justifyContent: "center",
    shadowColor:    PIN_BLUE,
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.6,
    shadowRadius:   6,
    elevation:      4,
  },
  mapPinInner: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: "#fff",
  },

  // Zoom controls
  mapZoom: {
    position:        "absolute",
    right:           10,
    top:             10,
    backgroundColor: CTRL_BG,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     CTRL_BORDER,
    overflow:        "hidden",
  },
  mapZoomBtn: {
    width:          28,
    height:         28,
    alignItems:     "center",
    justifyContent: "center",
  },
  mapZoomBtnBorder: {
    borderTopWidth:  1,
    borderTopColor:  CTRL_BORDER,
  },

  // Locate button
  mapLocate: {
    position:        "absolute",
    right:           10,
    bottom:          10,
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: CTRL_BG,
    borderWidth:     1,
    borderColor:     CTRL_BORDER,
    alignItems:      "center",
    justifyContent:  "center",
  },

  // Location chip
  mapLocChip: {
    position:          "absolute",
    left:              10,
    bottom:            10,
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    backgroundColor:   CTRL_BG,
    borderWidth:       1,
    borderColor:       CTRL_BORDER,
    paddingHorizontal: 8,
    paddingVertical:   5,
    borderRadius:      14,
  },
  mapLocText: {
    fontSize:   11,
    color:      "rgba(255,255,255,0.85)",
    fontWeight: "600" as const,
  },

  // Hot zone strip
  stripScroll: {
    marginTop: 10,
  },
  stripContent: {
    paddingHorizontal: 2,
    paddingBottom:     4,
    gap:               8,
    flexDirection:     "row",
  },
  stripChip: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    backgroundColor:   "rgba(18,22,38,0.85)",
    borderWidth:       1,
    borderColor:       "rgba(255,255,255,0.10)",
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:      20,
  },
  stripDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  stripLabel: {
    fontSize:   12,
    color:      "rgba(255,255,255,0.90)",
    fontWeight: "500" as const,
  },
  stripCount: {
    fontSize:   12,
    color:      "rgba(255,255,255,0.55)",
    fontWeight: "600" as const,
  },
});
