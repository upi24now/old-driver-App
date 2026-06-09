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
  Defs,
  Path,
  RadialGradient,
  Rect,
  Stop,
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
const CTRL_BG     = "rgba(18,22,38,0.92)";
const CTRL_BORDER = "rgba(255,255,255,0.10)";

// ─── Hot zone data ────────────────────────────────────────────────────────────
// Zone x/y are in SVG viewBox coords (0–400 × 0–220).
// With xMidYMid slice + mapWrap height 260, the visible SVG x range is
// approximately 42–358. All zones and their labels must stay within that band.
type Tier = "very_high" | "high" | "medium" | "low";

type HotZone = {
  label:  string;
  orders: number;
  tier:   Tier;
  x:      number;
  y:      number;
  r:      number;  // outer gradient radius
};

export const TIER_COLOR: Record<Tier, string> = {
  very_high: "#FF3B30",
  high:      "#FF9500",
  medium:    "#FFCC00",
  low:       "#34C759",
};

// Positions chosen to stay within the clipped-visible x range (≈ 48–352).
// Label text extends ±35 SVG units from cx, so cx must stay in 83–317.
const HOT_ZONES: HotZone[] = [
  { label: "Railway Station", orders: 18, tier: "very_high", x: 115, y: 80,  r: 30 },
  { label: "Bus Stand",       orders: 12, tier: "high",      x: 285, y: 88,  r: 26 },
  { label: "Market Area",     orders:  6, tier: "medium",    x: 200, y: 148, r: 24 },
  { label: "Hospital Zone",   orders:  4, tier: "low",       x: 290, y: 160, r: 20 },
];

// ─── HotZoneStrip — premium two-line chips ────────────────────────────────────
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
          {/* coloured left accent bar */}
          <View style={[styles.stripBar, { backgroundColor: TIER_COLOR[z.tier] }]} />
          <View style={styles.stripBody}>
            <Text style={styles.stripName} numberOfLines={1}>{z.label}</Text>
            <Text style={[styles.stripOrders, { color: TIER_COLOR[z.tier] }]}>
              {z.orders} Orders
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── DemandSummary — HIGH DEMAND NOW list ────────────────────────────────────
export function DemandSummary() {
  return (
    <View style={styles.demandWrap}>
      <Text style={styles.demandHeading}>HIGH DEMAND NOW</Text>
      {HOT_ZONES.map((z, i) => (
        <View
          key={z.label}
          style={[
            styles.demandRow,
            i < HOT_ZONES.length - 1 && styles.demandRowBorder,
          ]}
        >
          <View style={[styles.demandDot, { backgroundColor: TIER_COLOR[z.tier] }]} />
          <Text style={styles.demandName}>{z.label}</Text>
          <Text style={[styles.demandCount, { color: TIER_COLOR[z.tier] }]}>
            {z.orders} Orders
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── LiveMap ──────────────────────────────────────────────────────────────────
export default function LiveMap({ online }: { online: boolean }) {
  // Primary pulse ring
  const pulse1 = useRef(new Animated.Value(0)).current;
  // Secondary pulse ring — staggered 700 ms behind
  const pulse2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!online) {
      pulse1.setValue(0);
      pulse2.setValue(0);
      return;
    }

    const loop1 = Animated.loop(
      Animated.timing(pulse1, {
        toValue:         1,
        duration:        1800,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );

    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(pulse2, {
          toValue:         1,
          duration:        1800,
          easing:          Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    loop1.start();
    loop2.start();
    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [online, pulse1, pulse2]);

  return (
    <View style={styles.mapWrap}>

      {/* ── Night-style SVG map ──────────────────────────────────────────── */}
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* ── Gradient definitions for heat zones ──────────────────────── */}
        <Defs>
          {HOT_ZONES.map((z, i) => (
            <RadialGradient
              key={z.label}
              id={`hz_rg_${i}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <Stop offset="0%"   stopColor={TIER_COLOR[z.tier]} stopOpacity="0.78" />
              <Stop offset="30%"  stopColor={TIER_COLOR[z.tier]} stopOpacity="0.50" />
              <Stop offset="60%"  stopColor={TIER_COLOR[z.tier]} stopOpacity="0.20" />
              <Stop offset="85%"  stopColor={TIER_COLOR[z.tier]} stopOpacity="0.06" />
              <Stop offset="100%" stopColor={TIER_COLOR[z.tier]} stopOpacity="0"    />
            </RadialGradient>
          ))}
          {/* Blue driver-pin glow gradient */}
          <RadialGradient id="hz_pin_glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor={PIN_BLUE} stopOpacity="0.55" />
            <Stop offset="100%" stopColor={PIN_BLUE} stopOpacity="0"    />
          </RadialGradient>
        </Defs>

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

        {/* Highlighted main road — blue when online, muted when offline */}
        <Rect
          x="0" y="78" width="400" height="2"
          fill={MAP_ROAD_HI}
          opacity={online ? 0.85 : 0.30}
        />

        {/* ── Heat zone blobs (radial gradient = realistic heatmap glow) ── */}
        {HOT_ZONES.map((z, i) => (
          <Fragment key={z.label}>
            {/* Soft heatmap blob — single gradient circle, no hard rings */}
            <Circle
              cx={z.x}
              cy={z.y}
              r={z.r}
              fill={`url(#hz_rg_${i})`}
            />
            {/* Small bright centre dot */}
            <Circle
              cx={z.x}
              cy={z.y}
              r={z.r * 0.16}
              fill={TIER_COLOR[z.tier]}
              opacity={1}
            />
            {/* Zone name */}
            <SvgText
              x={z.x}
              y={z.y + z.r + 11}
              fontSize={8}
              fontWeight="600"
              fill="rgba(255,255,255,0.82)"
              textAnchor="middle"
            >
              {z.label}
            </SvgText>
            {/* Order count */}
            <SvgText
              x={z.x}
              y={z.y + z.r + 21}
              fontSize={7}
              fontWeight="700"
              fill={TIER_COLOR[z.tier]}
              textAnchor="middle"
            >
              {z.orders} orders
            </SvgText>
          </Fragment>
        ))}

        {/* Driver-pin SVG glow halo (behind the View-layer pin) */}
        <Circle cx="200" cy="110" r="22" fill="url(#hz_pin_glow)" />

      </Svg>

      {/* ── Driver location pin — dominant visual element ─────────────── */}
      <View style={styles.mapPinWrap} pointerEvents="none">
        {/* Outer pulse ring */}
        {online && (
          <Animated.View
            style={[
              styles.mapPulseRing,
              {
                borderColor: PIN_BLUE,
                opacity: pulse1.interpolate({
                  inputRange:  [0, 1],
                  outputRange: [0.60, 0],
                }),
                transform: [{
                  scale: pulse1.interpolate({
                    inputRange:  [0, 1],
                    outputRange: [0.55, 3.2],
                  }),
                }],
              },
            ]}
          />
        )}
        {/* Staggered inner pulse ring */}
        {online && (
          <Animated.View
            style={[
              styles.mapPulseRing,
              {
                borderColor: PIN_BLUE,
                opacity: pulse2.interpolate({
                  inputRange:  [0, 1],
                  outputRange: [0.45, 0],
                }),
                transform: [{
                  scale: pulse2.interpolate({
                    inputRange:  [0, 1],
                    outputRange: [0.55, 2.2],
                  }),
                }],
              },
            ]}
          />
        )}
        {/* Pin body */}
        <View style={[
          styles.mapPin,
          { backgroundColor: online ? PIN_BLUE : "#3a4058" },
        ]}>
          <View style={styles.mapPinInner} />
        </View>
      </View>

      {/* ── Zoom controls — dark glass ────────────────────────────────── */}
      <View style={styles.mapZoom}>
        <View style={styles.mapZoomBtn}>
          <Feather name="plus"  size={14} color="rgba(255,255,255,0.82)" />
        </View>
        <View style={[styles.mapZoomBtn, styles.mapZoomBtnBorder]}>
          <Feather name="minus" size={14} color="rgba(255,255,255,0.82)" />
        </View>
      </View>

      {/* ── Locate button — dark glass ────────────────────────────────── */}
      <View style={styles.mapLocate}>
        <Feather
          name="navigation"
          size={14}
          color={online ? PIN_BLUE : "rgba(255,255,255,0.40)"}
        />
      </View>

      {/* ── Location chip — "Current Zone" avoids fake city name ─────── */}
      <View style={styles.mapLocChip}>
        <Feather
          name="map-pin"
          size={11}
          color={online ? PIN_BLUE : "rgba(255,255,255,0.38)"}
        />
        <Text style={styles.mapLocText}>Current Zone</Text>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // ── Map container ──────────────────────────────────────────────────────────
  mapWrap: {
    height:          260,
    borderRadius:    12,
    overflow:        "hidden",
    backgroundColor: MAP_BG,
    position:        "relative",
    marginTop:       4,
  },

  // ── Driver pin — larger and more prominent than heat zones ─────────────────
  mapPinWrap: {
    position:       "absolute",
    top:            "50%" as unknown as number,
    left:           "50%" as unknown as number,
    marginLeft:     -14,   // half of 28px pin
    marginTop:      -14,
    alignItems:     "center",
    justifyContent: "center",
  },
  mapPulseRing: {
    position:     "absolute",
    width:        28,
    height:       28,
    borderRadius: 14,
    borderWidth:  2,
  },
  mapPin: {
    width:        28,
    height:       28,
    borderRadius: 14,
    borderWidth:  3,
    borderColor:  "rgba(255,255,255,0.95)",
    alignItems:   "center",
    justifyContent: "center",
    // iOS shadow
    shadowColor:   PIN_BLUE,
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.90,
    shadowRadius:  10,
    // Android elevation
    elevation:     8,
  },
  mapPinInner: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: "#ffffff",
  },

  // ── Zoom controls ──────────────────────────────────────────────────────────
  mapZoom: {
    position:        "absolute",
    right:           10,
    top:             10,
    backgroundColor: CTRL_BG,
    borderRadius:    7,
    borderWidth:     1,
    borderColor:     CTRL_BORDER,
    overflow:        "hidden",
  },
  mapZoomBtn: {
    width:          30,
    height:         30,
    alignItems:     "center",
    justifyContent: "center",
  },
  mapZoomBtnBorder: {
    borderTopWidth: 1,
    borderTopColor: CTRL_BORDER,
  },

  // ── Locate button ──────────────────────────────────────────────────────────
  mapLocate: {
    position:        "absolute",
    right:           10,
    bottom:          10,
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: CTRL_BG,
    borderWidth:     1,
    borderColor:     CTRL_BORDER,
    alignItems:      "center",
    justifyContent:  "center",
  },

  // ── Location chip ──────────────────────────────────────────────────────────
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
    paddingHorizontal: 9,
    paddingVertical:   6,
    borderRadius:      16,
  },
  mapLocText: {
    fontSize:   11,
    color:      "rgba(255,255,255,0.88)",
    fontWeight: "600" as const,
    letterSpacing: 0.2,
  },

  // ── Hot zone strip ─────────────────────────────────────────────────────────
  stripScroll: {
    marginTop: 12,
  },
  stripContent: {
    paddingHorizontal: 2,
    paddingBottom:     2,
    gap:               8,
    flexDirection:     "row",
  },
  stripChip: {
    flexDirection:   "row",
    alignItems:      "stretch",
    width:           120,
    backgroundColor: "rgba(18,22,38,0.92)",
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     "rgba(255,255,255,0.09)",
    overflow:        "hidden",
  },
  stripBar: {
    width: 3,
  },
  stripBody: {
    flex:              1,
    paddingHorizontal: 10,
    paddingVertical:   6,
    gap:               2,
  },
  stripName: {
    fontSize:      12,
    color:         "rgba(255,255,255,0.93)",
    fontWeight:    "600" as const,
    letterSpacing: 0.1,
  },
  stripOrders: {
    fontSize:   11,
    fontWeight: "700" as const,
  },

  // ── Demand summary section ─────────────────────────────────────────────────
  demandWrap: {
    marginTop:         12,
    backgroundColor:   "rgba(18,22,38,0.88)",
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingTop:        10,
    paddingBottom:     6,
  },
  demandHeading: {
    fontSize:      10,
    fontWeight:    "700" as const,
    letterSpacing: 1.4,
    color:         "rgba(255,255,255,0.38)",
    marginBottom:  8,
  },
  demandRow: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            10,
    paddingVertical: 6,
  },
  demandRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  demandDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    flexShrink:   0,
  },
  demandName: {
    flex:       1,
    fontSize:   13,
    color:      "rgba(255,255,255,0.88)",
    fontWeight: "500" as const,
  },
  demandCount: {
    fontSize:   13,
    fontWeight: "700" as const,
  },
});
