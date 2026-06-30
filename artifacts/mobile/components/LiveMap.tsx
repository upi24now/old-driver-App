// artifacts/mobile/components/LiveMap.tsx
//
// Nearby Hot Zones — real orders grouped by pickup locality.
//
// LiveMap (default export) : clean light card with driver GPS status indicator.
// HotZoneStrip (named export): smart-cached zone list driven by real Firestore orders.
//
// Refresh schedule (ONLY these events cause a Firestore read):
//   • Component mount (cold start)
//   • Driver turns duty ON (online: false → true)
//   • 10-minute automatic interval
//   • Driver moves > 2 km from last-fetch position (checked every 2 min, no Firestore read)
//   • Manual "Refresh" button
//
// All GPS tracking, dispatch, FCM, and order-assignment logic is untouched.

import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import { firebaseAuth } from "@/utils/firebase";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";

const _DOMAIN      = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const _HOTZONE_URL = (_DOMAIN ? `https://${_DOMAIN}/api` : "/api") + "/orders/hotzone";

// ─── Visual constants ─────────────────────────────────────────────────────────
// Driver-pin blue — visual encoding constant, intentionally outside token system.
const PIN_BLUE = "#4A9EFF";

// Tier colour encoding — heat-map signal constants, not theme tokens.
const TIER_VERY_HIGH = "#FF3B30";
const TIER_HIGH      = "#FF9500";
const TIER_MEDIUM    = "#FFCC00";
const TIER_LOW       = "#34C759";

function tierColor(count: number): string {
  if (count >= 10) return TIER_VERY_HIGH;
  if (count >= 5)  return TIER_HIGH;
  if (count >= 2)  return TIER_MEDIUM;
  return TIER_LOW;
}

// ─── Refresh timing constants ─────────────────────────────────────────────────
const FETCH_INTERVAL_MS   = 10 * 60 * 1000;  // 10 minutes between auto-fetches
const POSITION_CHECK_MS   =  2 * 60 * 1000;  // every 2 min: GPS check (no Firestore)
const EARLY_REFRESH_KM    = 2;               // trigger early fetch if moved > 2 km
// ─── Module-level hot-zone cache ─────────────────────────────────────────────
// Persists across re-renders and component unmount/remount cycles so the card
// never re-fetches unnecessarily. Updated only by fetchZones().
interface CachedZone {
  name:        string;
  orderCount:  number;
  distanceKm:  number | null;
  lat:         number | null;  // average pickup lat across orders in this zone
  lng:         number | null;  // average pickup lng across orders in this zone
}

const cache: {
  zones:     CachedZone[];
  fetchedAt: number;          // epoch ms — 0 means never fetched
  fetchLat:  number | null;
  fetchLng:  number | null;
} = {
  zones:     [],
  fetchedAt: 0,
  fetchLat:  null,
  fetchLng:  null,
};

// ─── Haversine distance ───────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const toR  = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Relative time label ──────────────────────────────────────────────────────
function relativeTime(epochMs: number): string {
  if (epochMs === 0) return "";
  const mins = Math.floor((Date.now() - epochMs) / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

// ─── Core fetch function ──────────────────────────────────────────────────────
// Phase 5J-Tier-1: Reads REST endpoint, updates the module-level cache,
// and returns the new zones.  No Firestore reads here.
async function fetchZones(reason: string): Promise<CachedZone[]> {
  console.log("[HOTZONE_FETCH_START] reason =", reason);

  // ── 1. Driver GPS (kept for cache-invalidation distance check) ────────────
  let driverLat: number | null = null;
  let driverLng: number | null = null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      driverLat = pos.coords.latitude;
      driverLng = pos.coords.longitude;
      console.log("[HOTZONE_DRIVER_LOCATION] lat =", driverLat.toFixed(5), "lng =", driverLng.toFixed(5));
    } else {
      console.log("[HOTZONE_DRIVER_LOCATION] permission not granted");
    }
  } catch (err) {
    console.log("[HOTZONE_DRIVER_LOCATION] GPS error —", String(err));
  }

  // ── 2. REST fetch — GET /api/orders/hotzone ───────────────────────────────
  let result: CachedZone[] = [];
  try {
    const user  = firebaseAuth.currentUser;
    const token = user ? await user.getIdToken() : null;
    if (token) {
      const res = await fetch(_HOTZONE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          ok?: boolean;
          zones?: Array<{ name: string; orderCount: number }>;
        };
        if (json.ok && Array.isArray(json.zones)) {
          result = json.zones.map((z) => ({
            name:       z.name,
            orderCount: z.orderCount,
            distanceKm: null,
            lat:        null,
            lng:        null,
          }));
        }
      } else {
        console.log("[HOTZONE_REST_ERROR] status =", res.status);
      }
    } else {
      console.log("[HOTZONE_FETCH] no auth token — skipping fetch");
    }
  } catch (err) {
    console.log("[HOTZONE_REST_ERROR] fetch failed —", String(err));
  }

  // ── 3. Update cache ────────────────────────────────────────────────────────
  cache.zones     = result;
  cache.fetchedAt = Date.now();
  cache.fetchLat  = driverLat;
  cache.fetchLng  = driverLng;

  if (result.length === 0) {
    console.log("[HOTZONE_FETCH_EMPTY] groupedZones=0");
  } else {
    console.log(
      "[HOTZONE_FETCH_SUCCESS]",
      `groupedZones=${result.length}`,
      "→", result.map((z) => z.name).join(", "),
    );
  }
  console.log("[HOTZONE_LAST_UPDATED] at", new Date(cache.fetchedAt).toLocaleTimeString());

  return result;
}

// ─── Google Maps navigation ───────────────────────────────────────────────────
// Opens Google Maps native app (google.navigation deep link) if installed,
// otherwise falls back to browser directions URL.
async function navigateToZone(zone: CachedZone): Promise<void> {
  if (zone.lat === null || zone.lng === null) {
    console.log("[NAVIGATE_HOTZONE_FAIL] no coordinates for zone:", zone.name);
    return;
  }

  console.log(
    "[NAVIGATE_HOTZONE_START]",
    "zone =", zone.name,
    "lat =", zone.lat.toFixed(5),
    "lng =", zone.lng.toFixed(5),
  );

  const googleMapsDeepLink = `google.navigation:q=${zone.lat},${zone.lng}&mode=d`;
  const webFallbackUrl     = `https://www.google.com/maps/dir/?api=1&destination=${zone.lat},${zone.lng}&travelmode=driving`;

  try {
    const canOpen = await Linking.canOpenURL(googleMapsDeepLink);
    if (canOpen) {
      console.log("[NAVIGATE_HOTZONE_GOOGLE_MAPS] opening native Google Maps for zone:", zone.name);
      await Linking.openURL(googleMapsDeepLink);
    } else {
      console.log("[NAVIGATE_HOTZONE_WEB_FALLBACK] Google Maps not installed — opening browser for zone:", zone.name);
      await Linking.openURL(webFallbackUrl);
    }
  } catch (err) {
    console.log("[NAVIGATE_HOTZONE_FAIL] deep link failed for zone:", zone.name, "—", String(err));
    try {
      await Linking.openURL(webFallbackUrl);
    } catch {
      // Web fallback also failed — nothing more we can do
    }
  }
}

// ─── HotZoneStrip ─────────────────────────────────────────────────────────────
// Named export — rendered below LiveMap inside the Ride Requests card.
// Accepts `online` so it can trigger a refresh when duty turns ON.
export function HotZoneStrip({ online }: { online: boolean }) {
  const colors = useColors();

  // Local UI state driven by the module-level cache
  const [zones,      setZones]      = useState<CachedZone[]>(cache.zones);
  const [loading,    setLoading]    = useState(cache.fetchedAt === 0);
  const [updatedAt,  setUpdatedAt]  = useState(cache.fetchedAt);
  const [refreshing, setRefreshing] = useState(false);

  const prevOnline  = useRef(online);
  const destroyed   = useRef(false);

  // ── Wrapper: fetch → update state ────────────────────────────────────────
  async function doFetch(reason: string) {
    if (destroyed.current) return;
    const wasEmpty = cache.fetchedAt === 0;
    if (!wasEmpty) setRefreshing(true);
    try {
      const zones = await fetchZones(reason);
      if (!destroyed.current) {
        setZones(zones);
        setUpdatedAt(cache.fetchedAt);
        setLoading(false);
        setRefreshing(false);
      }
    } catch {
      if (!destroyed.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  // ── Mount: initial fetch ──────────────────────────────────────────────────
  useEffect(() => {
    destroyed.current = false;
    if (cache.fetchedAt === 0) {
      void doFetch("mount");
    } else {
      // Stale cache — refresh if > 10 min old
      if (Date.now() - cache.fetchedAt > FETCH_INTERVAL_MS) {
        void doFetch("mount-stale");
      } else {
        console.log("[HOTZONE_FETCH_SKIPPED_CACHE] using cached data from", relativeTime(cache.fetchedAt));
      }
    }
    return () => { destroyed.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Duty ON transition: trigger fetch ────────────────────────────────────
  useEffect(() => {
    if (online && !prevOnline.current) {
      void doFetch("duty-on");
    }
    prevOnline.current = online;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ── 2-minute position check + 10-minute auto-refresh ─────────────────────
  // Every 2 minutes: read GPS position cheaply (no Firestore).
  //   → If driver moved > 2 km from last fetch location → early refresh.
  //   → If 10 minutes have elapsed since last fetch → refresh.
  //   → Otherwise → skip.
  // The "last updated" label also re-renders here so it stays accurate.
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (destroyed.current) return;

      // Always re-render "X min ago" label from cache
      if (cache.fetchedAt > 0) setUpdatedAt(cache.fetchedAt);

      const now = Date.now();

      // Always fetch if 10 minutes elapsed
      if (now - cache.fetchedAt >= FETCH_INTERVAL_MS) {
        void doFetch("10-min-interval");
        return;
      }

      // Check if driver has moved > 2 km since last fetch (GPS only — no Firestore)
      if (cache.fetchLat !== null && cache.fetchLng !== null) {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === "granted") {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            const moved = haversineKm(
              cache.fetchLat,
              cache.fetchLng,
              pos.coords.latitude,
              pos.coords.longitude,
            );
            if (moved > EARLY_REFRESH_KM) {
              console.log("[HOTZONE_DRIVER_MOVED_REFRESH] moved", moved.toFixed(2), "km — refreshing early");
              void doFetch("driver-moved");
              return;
            }
          }
        } catch {
          // GPS read failed — skip early-refresh check
        }
      }

      console.log("[HOTZONE_FETCH_SKIPPED_CACHE] within 10-min window, driver stationary");
    }, POSITION_CHECK_MS);

    return () => clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Manual refresh ────────────────────────────────────────────────────────
  function handleManualRefresh() {
    void doFetch("manual");
  }

  // ── "Last updated" display (computed from updatedAt) ──────────────────────
  const lastUpdatedLabel = updatedAt > 0 ? relativeTime(updatedAt) : "";

  // ── Loading state (first ever fetch) ─────────────────────────────────────
  if (loading) {
    return (
      <View style={[strip.wrap, { borderTopColor: colors.border }]}>
        <View style={strip.header}>
          <Feather name="zap" size={13} color={colors.mutedForeground} />
          <Text style={[strip.headerLabel, { color: colors.mutedForeground }]}>
            Nearby Hot Zones
          </Text>
        </View>
        <View style={strip.stateRow}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[strip.stateText, { color: colors.mutedForeground }]}>
            Scanning nearby orders…
          </Text>
        </View>
      </View>
    );
  }

  // ── Shared header (used in both empty + populated states) ─────────────────
  const Header = (
    <View style={strip.header}>
      <Feather name="zap" size={13} color={colors.primary} />
      <Text style={[strip.headerLabel, { color: colors.foreground }]}>
        Nearby Hot Zones
      </Text>
      <View style={strip.headerRight}>
        {lastUpdatedLabel !== "" && (
          <Text style={[strip.updatedAt, { color: colors.mutedForeground }]}>
            {lastUpdatedLabel}
          </Text>
        )}
        <TouchableOpacity
          onPress={handleManualRefresh}
          activeOpacity={0.65}
          disabled={refreshing}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ width: 16, height: 16 }} />
          ) : (
            <Feather name="refresh-cw" size={14} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  if (zones.length === 0) {
    return (
      <View style={[strip.wrap, { borderTopColor: colors.border }]}>
        {Header}
        <View style={strip.stateRow}>
          <Feather name="map-pin" size={15} color={colors.mutedForeground} />
          <Text style={[strip.stateText, { color: colors.mutedForeground }]}>
            No nearby orders right now
          </Text>
        </View>
      </View>
    );
  }

  // ── Zone list ─────────────────────────────────────────────────────────────
  return (
    <View style={[strip.wrap, { borderTopColor: colors.border }]}>
      {Header}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={strip.scrollContent}
      >
        {zones.map((z) => {
          const accent = tierColor(z.orderCount);
          return (
            <View
              key={z.name}
              style={[
                strip.chip,
                {
                  backgroundColor: colors.surface,
                  borderColor:     colors.border,
                },
              ]}
            >
              {/* Heat-tier accent bar */}
              <View style={[strip.accentBar, { backgroundColor: accent }]} />
              <View style={strip.chipBody}>
                <Text
                  style={[strip.chipName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {z.name}
                </Text>
                <Text style={[strip.chipOrders, { color: accent }]}>
                  {z.orderCount} {z.orderCount === 1 ? "Order" : "Orders"}
                </Text>
                {z.distanceKm !== null && (
                  <Text style={[strip.chipDist, { color: colors.mutedForeground }]}>
                    {z.distanceKm < 1
                      ? `${Math.round(z.distanceKm * 1000)} m away`
                      : `${z.distanceKm.toFixed(1)} km away`}
                  </Text>
                )}
                {z.lat !== null && z.lng !== null && (
                  <TouchableOpacity
                    onPress={() => { void navigateToZone(z); }}
                    activeOpacity={0.7}
                    style={[strip.navBtn, { backgroundColor: accent + "22", borderColor: accent + "55" }]}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Feather name="navigation" size={9} color={accent} />
                    <Text style={[strip.navBtnText, { color: accent }]}>Navigate</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Coordinate projection ────────────────────────────────────────────────────
// Maps a zone lat/lng → pixel (x, y) on the card, with the driver at centre.
// Linear approximation — accurate to < 0.5 % within 15 km at Indian latitudes.
const MAP_VISIBLE_RADIUS_KM = 12;  // km from card centre to each edge

function coordsToXY(
  driverLat: number, driverLng: number,
  zoneLat:   number, zoneLng:   number,
  cardW:     number, cardH:     number,
): { x: number; y: number } {
  const KM_PER_DEG = 111.32;
  const dLat = (zoneLat - driverLat) * KM_PER_DEG;
  const dLng = (zoneLng - driverLng) * KM_PER_DEG * Math.cos((driverLat * Math.PI) / 180);
  return {
    x: cardW / 2 + dLng * ((cardW / 2) / MAP_VISIBLE_RADIUS_KM),
    y: cardH / 2 - dLat * ((cardH / 2) / MAP_VISIBLE_RADIUS_KM),
  };
}

// ─── Premium map canvas palette ───────────────────────────────────────────────
// Pure-visual styling for the SVG road network. Theme-aware (light/dark).
// Roads are light grey on a soft land tint; major roads read darker/wider than
// minor roads. No SDK, no API key, no network — fully static, GPU-friendly.
type MapPalette = {
  land: string; landTop: string; block: string; park: string; water: string;
  minor: string; minorCasing: string; major: string; majorCasing: string; label: string;
};
const MAP_LIGHT: MapPalette = {
  land:        "#F1F3F6",  // soft land tint (intentionally not pure white)
  landTop:     "#F7F8FA",
  block:       "#E9ECF1",
  park:        "#DDE8DC",
  water:       "#D5E4F1",
  minor:       "#E2E5EB",  // minor roads — lighter
  minorCasing: "#ECEEF2",
  major:       "#CFD5DE",  // major roads — slightly darker
  majorCasing: "#E4E7EC",
  label:       "#9AA1AC",  // muted grey street labels
};
const MAP_DARK: MapPalette = {
  land:        "#14161B",
  landTop:     "#181B21",
  block:       "#181B21",
  park:        "#16221A",
  water:       "#142231",
  minor:       "#23272F",
  minorCasing: "#1B1E24",
  major:       "#2F343E",
  majorCasing: "#23272F",
  label:       "#5C636E",
};

// Static geometry (viewBox 0..360 × 0..190) — module-level, zero per-render cost.
const MINOR_H = [30, 100, 165];
const MINOR_V = [55, 185, 310];
const MAJOR_H = [68, 132];
const MAJOR_V = [120, 245];
const BLOCKS = [
  { x: 18,  y: 80,  w: 80, h: 38 },
  { x: 135, y: 42,  w: 92, h: 42 },
  { x: 135, y: 108, w: 92, h: 40 },
  { x: 262, y: 42,  w: 80, h: 42 },
  { x: 18,  y: 140, w: 82, h: 40 },
];

// Static premium road network. Memoised — only re-renders on theme change.
const RoadNetwork = React.memo(function RoadNetwork({ p }: { p: MapPalette }) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 360 190"
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <RadialGradient id="landGlow" cx="50%" cy="36%" r="78%">
          <Stop offset="0" stopColor={p.landTop} stopOpacity={1} />
          <Stop offset="1" stopColor={p.land} stopOpacity={1} />
        </RadialGradient>
        <RadialGradient id="vignette" cx="50%" cy="50%" r="72%">
          <Stop offset="0.62" stopColor="#000000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.07} />
        </RadialGradient>
      </Defs>

      {/* Land + soft top-light for depth */}
      <Rect x={0} y={0} width={360} height={190} fill="url(#landGlow)" />

      {/* Park / green space + river for realism */}
      <Rect x={262} y={120} width={120} height={92} rx={14} fill={p.park} opacity={0.9} />
      <Path
        d="M -10 16 Q 70 38 120 24 T 250 34 T 380 22 L 380 -10 L -10 -10 Z"
        fill={p.water}
        opacity={0.5}
      />

      {/* City blocks */}
      {BLOCKS.map((b, i) => (
        <Rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={5} fill={p.block} opacity={0.65} />
      ))}

      {/* ── Minor roads (casing then top) ── */}
      {MINOR_H.map((y, i) => (
        <Line key={`mhc${i}`} x1={0} y1={y} x2={360} y2={y} stroke={p.minorCasing} strokeWidth={4} />
      ))}
      {MINOR_V.map((x, i) => (
        <Line key={`mvc${i}`} x1={x} y1={0} x2={x} y2={190} stroke={p.minorCasing} strokeWidth={4} />
      ))}
      <Path d="M -10 55 Q 90 95 185 62 T 372 78" stroke={p.minorCasing} strokeWidth={4} fill="none" />
      {MINOR_H.map((y, i) => (
        <Line key={`mh${i}`} x1={0} y1={y} x2={360} y2={y} stroke={p.minor} strokeWidth={2.5} />
      ))}
      {MINOR_V.map((x, i) => (
        <Line key={`mv${i}`} x1={x} y1={0} x2={x} y2={190} stroke={p.minor} strokeWidth={2.5} />
      ))}
      <Path d="M -10 55 Q 90 95 185 62 T 372 78" stroke={p.minor} strokeWidth={2.5} fill="none" />

      {/* ── Major roads (wider + darker, drawn last for hierarchy) ── */}
      <Path d="M -10 178 L 372 40" stroke={p.majorCasing} strokeWidth={8} strokeLinecap="round" />
      {MAJOR_H.map((y, i) => (
        <Line key={`Mhc${i}`} x1={0} y1={y} x2={360} y2={y} stroke={p.majorCasing} strokeWidth={8} />
      ))}
      {MAJOR_V.map((x, i) => (
        <Line key={`Mvc${i}`} x1={x} y1={0} x2={x} y2={190} stroke={p.majorCasing} strokeWidth={8} />
      ))}
      <Path d="M -10 178 L 372 40" stroke={p.major} strokeWidth={5} strokeLinecap="round" />
      {MAJOR_H.map((y, i) => (
        <Line key={`Mh${i}`} x1={0} y1={y} x2={360} y2={y} stroke={p.major} strokeWidth={5} />
      ))}
      {MAJOR_V.map((x, i) => (
        <Line key={`Mv${i}`} x1={x} y1={0} x2={x} y2={190} stroke={p.major} strokeWidth={5} />
      ))}

      {/* Muted street labels */}
      <SvgText x={150} y={63} fill={p.label} fontSize={7.5} fontWeight="600" opacity={0.95}>MG Road</SvgText>
      <SvgText x={236} y={70} fill={p.label} fontSize={7} fontWeight="600" opacity={0.9} transform="rotate(-20 236 70)">Outer Ring Rd</SvgText>
      <SvgText x={124} y={152} fill={p.label} fontSize={7} fontWeight="600" opacity={0.9} transform="rotate(-90 124 152)">1st Cross</SvgText>
      <SvgText x={28} y={127} fill={p.label} fontSize={7} fontWeight="600" opacity={0.9}>Market St</SvgText>

      {/* Soft edge vignette for depth */}
      <Rect x={0} y={0} width={360} height={190} fill="url(#vignette)" />
    </Svg>
  );
});

// 3-band heat colour for the map blobs (green → orange → red).
function heatColor(count: number): string {
  if (count >= 8) return "#FF3B30"; // high demand
  if (count >= 3) return "#FF9500"; // medium demand
  return "#34C759";                 // low demand
}

// Deterministic delivery-marker offsets scattered inside each hot area (px).
const ORDER_OFFSETS = [
  { x: -19, y: -8 },
  { x: 17,  y: 3  },
  { x: -5,  y: 17 },
];

// ─── LiveMap — default export ─────────────────────────────────────────────────
// Free OSM-style light map card — no SDK, no API key, works in Expo Go.
// • Driver pin at centre (real GPS) with a soft pulse + accuracy halo.
// • Zone demand shown as soft, blurred-edge heat-map blobs + small markers.
// • Premium Google-Maps-style road network (static SVG canvas, no SDK).
// • "Tap Navigate for directions" hint when zones are visible.
// • HotZoneStrip (below) owns the fetch cycle; LiveMap reads the module-level
//   cache and re-syncs every 15 s — no extra Firestore reads.
export default function LiveMap({ online }: { online: boolean }) {
  const colors = useColors();
  const { isDark } = useTheme();
  // Theme-aware map palette driven by the in-app Dark mode toggle.
  const mapP = isDark ? MAP_DARK : MAP_LIGHT;

  const [locationLabel, setLabel] = useState<string | null>(null);
  const [driverCoords,  setDriver] = useState<{ lat: number; lng: number } | null>(null);
  const [mapZones,      setMapZones] = useState<CachedZone[]>(cache.zones);
  const [cardSize,      setCardSize] = useState({ w: 360, h: 180 });

  // GPS + reverse-geocode — re-runs when duty flips
  useEffect(() => {
    if (!online) { setLabel(null); setDriver(null); return; }
    let active = true;
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || !active) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        setDriver({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const rev = await Location.reverseGeocodeAsync({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (!active) return;
        const r = rev[0];
        if (r) setLabel(r.district ?? r.subregion ?? r.city ?? r.region ?? null);
      } catch {
        // GPS unavailable — chip stays generic
      }
    })();
    // Sync zone pins from module-level cache every 15 s (HotZoneStrip owns fetch)
    const syncId = setInterval(() => {
      if (active) setMapZones([...cache.zones]);
    }, 15_000);
    return () => { active = false; clearInterval(syncId); };
  }, [online]);

  // Pull latest zones immediately on mount (cache may already be warm)
  useEffect(() => { setMapZones([...cache.zones]); }, []);

  // Driver-dot soft pulse — runs on the UI thread (60fps), only while online.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (online) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.55 + pulse.value * 1.35 }],
    opacity:   0.45 * (1 - pulse.value),
  }));

  // Zones that have real coordinates — only rendered when driver GPS is known
  type ZoneWithCoords = CachedZone & { lat: number; lng: number };
  const zonePins: ZoneWithCoords[] = driverCoords !== null
    ? (mapZones.filter((z) => z.lat !== null && z.lng !== null) as ZoneWithCoords[])
    : [];

  return (
    <View
      style={[mapStyles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setCardSize({ w: width, h: height });
      }}
    >
      {/* Premium Google-Maps-style road network (static SVG canvas) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <RoadNetwork p={mapP} />
      </View>

      {/* Heat-map demand overlays — soft, blurred-edge radial blobs (not solid) */}
      {zonePins.length > 0 && (
        <Svg
          width={cardSize.w}
          height={cardSize.h}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            {zonePins.map((z, i) => {
              const c = heatColor(z.orderCount);
              return (
                <RadialGradient key={`hg${i}`} id={`heat${i}`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0"    stopColor={c} stopOpacity={0.3} />
                  <Stop offset="0.55" stopColor={c} stopOpacity={0.15} />
                  <Stop offset="1"    stopColor={c} stopOpacity={0} />
                </RadialGradient>
              );
            })}
          </Defs>
          {zonePins.map((z, i) => {
            const { x, y } = coordsToXY(
              driverCoords!.lat, driverCoords!.lng,
              z.lat, z.lng,
              cardSize.w, cardSize.h,
            );
            const r = Math.max(40, Math.min(82, 46 + z.orderCount * 3));
            return <Circle key={`hc${i}`} cx={x} cy={y} r={r} fill={`url(#heat${i})`} />;
          })}
        </Svg>
      )}

      {/* Zone markers — small delivery markers + name, projected from real lat/lng */}
      {zonePins.map((z) => {
        const { x, y } = coordsToXY(
          driverCoords!.lat, driverCoords!.lng,
          z.lat, z.lng,
          cardSize.w, cardSize.h,
        );
        const c = heatColor(z.orderCount);
        return (
          <React.Fragment key={z.name}>
            {/* Scattered delivery dots inside the hot area */}
            {ORDER_OFFSETS.map((o, k) => (
              <View
                key={k}
                pointerEvents="none"
                style={[mapStyles.orderDot, { left: x + o.x, top: y + o.y, backgroundColor: c }]}
              />
            ))}
            {/* Primary order-count marker */}
            <View
              pointerEvents="none"
              style={[mapStyles.marker, { left: x - 16, top: y - 12, backgroundColor: colors.card, borderColor: c }]}
            >
              <View style={[mapStyles.markerDot, { backgroundColor: c }]} />
              <Text style={[mapStyles.markerCount, { color: colors.foreground }]}>{z.orderCount}</Text>
            </View>
            {/* Zone name label */}
            <Text
              pointerEvents="none"
              numberOfLines={1}
              style={[
                mapStyles.markerLabel,
                {
                  left:            x - 40,
                  top:             y + 16,
                  color:           colors.mutedForeground,
                  backgroundColor: colors.card + "E6",
                  borderColor:     colors.border,
                },
              ]}
            >
              {z.name}
            </Text>
          </React.Fragment>
        );
      })}

      {/* Driver location pin — centred, Google-Maps blue dot with soft pulse */}
      <View style={mapStyles.pinWrap} pointerEvents="none">
        {online && (
          <>
            {/* Static accuracy halo */}
            <View style={[mapStyles.accuracy, { backgroundColor: PIN_BLUE + "14", borderColor: PIN_BLUE + "33" }]} />
            {/* Animated soft pulse ring (UI-thread, 60fps) */}
            <Animated.View style={[mapStyles.pulseRing, pulseStyle, { backgroundColor: PIN_BLUE + "22", borderColor: PIN_BLUE + "66" }]} />
          </>
        )}
        <View
          style={[
            mapStyles.pinBody,
            {
              borderColor:     online ? "#FFFFFF" : colors.border,
              backgroundColor: online ? PIN_BLUE : colors.surface,
              shadowColor:     online ? PIN_BLUE : "#000",
            },
          ]}
        >
          <View style={[mapStyles.pinCore, { backgroundColor: online ? "#fff" : colors.mutedForeground }]} />
        </View>
      </View>

      {/* Location chip — bottom-left */}
      <View style={[mapStyles.locChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="map-pin" size={11} color={online ? PIN_BLUE : colors.mutedForeground} />
        <Text
          style={[mapStyles.locText, { color: online ? colors.foreground : colors.mutedForeground }]}
          numberOfLines={1}
        >
          {online ? (locationLabel ?? "Locating…") : "Offline"}
        </Text>
      </View>

      {/* Live pill — top-right */}
      {online && (
        <View style={[mapStyles.livePill, { backgroundColor: colors.successSoft }]}>
          <View style={[mapStyles.liveDot, { backgroundColor: colors.success }]} />
          <Text style={[mapStyles.liveText, { color: colors.success }]}>Live</Text>
        </View>
      )}

      {/* Bottom-right context note */}
      <Text style={[mapStyles.noMapNote, { color: colors.mutedForeground }]}>
        {zonePins.length > 0
          ? "Tap Navigate for directions"
          : online ? "Scanning nearby orders…" : "Go online to see nearby orders"}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const strip = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop:      12,
    paddingTop:     10,
  },
  header: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            6,
    marginBottom:   10,
    paddingHorizontal: 2,
  },
  headerLabel: {
    flex:       1,
    fontSize:   12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
  },
  updatedAt: {
    fontSize:   10,
    fontWeight: "500",
  },
  stateRow: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    paddingVertical: 14,
    gap:             8,
  },
  stateText: {
    fontSize:   13,
    fontWeight: "500",
  },
  scrollContent: {
    paddingHorizontal: 2,
    paddingBottom:     2,
    gap:               8,
    flexDirection:     "row",
  },
  chip: {
    flexDirection: "row",
    alignItems:    "stretch",
    width:         132,
    borderRadius:  10,
    borderWidth:   1,
    overflow:      "hidden",
  },
  accentBar: { width: 3 },
  chipBody: {
    flex:              1,
    paddingHorizontal: 10,
    paddingVertical:   8,
    gap:               2,
  },
  chipName: {
    fontSize:      12,
    fontWeight:    "600",
    letterSpacing: 0.1,
  },
  chipOrders: {
    fontSize:   11,
    fontWeight: "700",
  },
  chipDist: {
    fontSize:   10,
    fontWeight: "500",
    marginTop:  1,
  },
  navBtn: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               3,
    marginTop:         5,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderRadius:      6,
    borderWidth:       1,
    alignSelf:         "flex-start",
  },
  navBtnText: {
    fontSize:   9,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});

const mapStyles = StyleSheet.create({
  wrap: {
    height:         190,
    borderRadius:   12,
    overflow:       "hidden",
    borderWidth:    StyleSheet.hairlineWidth,
    marginTop:      4,
    position:       "relative",
    alignItems:     "center",
    justifyContent: "center",
  },
  // Small scattered delivery dots inside a hot area
  orderDot: {
    position:     "absolute",
    width:        5,
    height:       5,
    borderRadius: 2.5,
    borderWidth:  StyleSheet.hairlineWidth,
    borderColor:  "#FFFFFF",
    opacity:      0.9,
  },
  // Primary order-count marker chip
  marker: {
    position:       "absolute",
    flexDirection:  "row",
    alignItems:     "center",
    gap:            3,
    height:         24,
    paddingHorizontal: 7,
    borderRadius:   12,
    borderWidth:    1.5,
    shadowColor:    "#000",
    shadowOffset:   { width: 0, height: 1 },
    shadowOpacity:  0.18,
    shadowRadius:   3,
    elevation:      3,
  },
  markerDot: {
    width:        7,
    height:       7,
    borderRadius: 3.5,
  },
  markerCount: {
    fontSize:   11,
    fontWeight: "800",
  },
  markerLabel: {
    position:          "absolute",
    width:             80,
    fontSize:          8,
    fontWeight:        "600",
    paddingVertical:   1.5,
    borderRadius:      5,
    borderWidth:       StyleSheet.hairlineWidth,
    textAlign:         "center",
    overflow:          "hidden",
  },
  pinWrap: { alignItems: "center", justifyContent: "center" },
  // Static Google-Maps-style accuracy halo
  accuracy: {
    position:     "absolute",
    width:        92,
    height:       92,
    borderRadius: 46,
    borderWidth:  StyleSheet.hairlineWidth,
  },
  // Animated soft pulse ring
  pulseRing: {
    position:     "absolute",
    width:        44,
    height:       44,
    borderRadius: 22,
    borderWidth:  1.5,
  },
  pinBody: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:    3,
    alignItems:     "center",
    justifyContent: "center",
    shadowOffset:   { width: 0, height: 1 },
    shadowOpacity:  0.5,
    shadowRadius:   6,
    elevation:      6,
  },
  pinCore: {
    width:        7,
    height:       7,
    borderRadius: 3.5,
  },
  locChip: {
    position:          "absolute",
    left:              10,
    bottom:            10,
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    borderWidth:       1,
    paddingHorizontal: 9,
    paddingVertical:   5,
    borderRadius:      16,
    maxWidth:          "55%",
  },
  locText: {
    fontSize:      11,
    fontWeight:    "600",
    letterSpacing: 0.1,
  },
  livePill: {
    position:          "absolute",
    right:             10,
    top:               10,
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:      12,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontWeight: "700" },
  noMapNote: {
    position:   "absolute",
    bottom:     10,
    right:      10,
    fontSize:   10,
    fontWeight: "500",
  },
});
