// artifacts/mobile/components/LiveMap.tsx
//
// Nearby Hot Zones — real orders grouped by pickup locality.
//
// LiveMap (default export): clean light card with driver GPS status indicator.
// HotZoneStrip (named export): fetches live Firestore orders + driver GPS,
//   applies Haversine filtering (10 km radius), groups by pickup area, renders chips.
//
// No fake hardcoded zones. No dark SVG map. No demo order counts.

import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { db } from "@/utils/firebase";
import { useColors } from "@/hooks/useColors";

// ─── Visual constants ─────────────────────────────────────────────────────────
// Driver-pin blue — same universal convention used across the maps layer.
// Intentionally outside the semantic token system (visual encoding constant).
const PIN_BLUE = "#4A9EFF";

// Tier colour encoding — visual signal, not a theme token.
const TIER_VERY_HIGH = "#FF3B30";
const TIER_HIGH      = "#FF9500";
const TIER_MEDIUM    = "#FFCC00";
const TIER_LOW       = "#34C759";

function tierColor(orderCount: number): string {
  if (orderCount >= 10) return TIER_VERY_HIGH;
  if (orderCount >= 5)  return TIER_HIGH;
  if (orderCount >= 2)  return TIER_MEDIUM;
  return TIER_LOW;
}

// ─── Haversine distance formula ───────────────────────────────────────────────
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Extract pickup coordinates from a raw Firestore doc ─────────────────────
// The OrderDoc TypeScript type carries only address strings today; customer apps
// may also write lat/lng under several field shapes. We probe all known shapes
// at runtime without modifying the typed schema.
function getPickupCoords(
  raw: Record<string, unknown>,
): { lat: number; lng: number } | null {
  // Shape 1: flat fields — pickupLat / pickupLng
  if (typeof raw.pickupLat === "number" && typeof raw.pickupLng === "number") {
    return { lat: raw.pickupLat, lng: raw.pickupLng };
  }
  // Shape 2: nested pickupLocation object — { lat, lng } or { latitude, longitude }
  const loc = raw.pickupLocation;
  if (loc && typeof loc === "object" && !Array.isArray(loc)) {
    const l = loc as Record<string, unknown>;
    if (typeof l.lat === "number" && typeof l.lng === "number") {
      return { lat: l.lat, lng: l.lng };
    }
    if (typeof l.latitude === "number" && typeof l.longitude === "number") {
      return { lat: l.latitude, lng: l.longitude };
    }
  }
  // Shape 3: pickup field as object — { lat, lng } or { latitude, longitude }
  const pu = raw.pickup;
  if (pu && typeof pu === "object" && !Array.isArray(pu)) {
    const p = pu as Record<string, unknown>;
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      return { lat: p.lat, lng: p.lng };
    }
    if (typeof p.latitude === "number" && typeof p.longitude === "number") {
      return { lat: p.latitude, lng: p.longitude };
    }
  }
  return null;
}

// ─── Extract zone name from a raw Firestore doc ───────────────────────────────
// Priority: pickupArea → pickupLocality → pickupSub → first segment of pickup
//           string → pickupAddress first segment → pickupCity → "Nearby Zone"
function getZoneName(raw: Record<string, unknown>): string {
  const str = (v: unknown) =>
    typeof v === "string" ? v.trim() : "";

  if (str(raw.pickupArea))     return str(raw.pickupArea);
  if (str(raw.pickupLocality)) return str(raw.pickupLocality);
  if (str(raw.pickupSub))      return str(raw.pickupSub);

  const pickupStr = str(raw.pickup);
  if (pickupStr) {
    const first = pickupStr.split(",")[0]?.trim();
    if (first) return first;
  }

  const addrStr = str(raw.pickupAddress);
  if (addrStr) {
    const first = addrStr.split(",")[0]?.trim();
    if (first) return first;
  }

  if (str(raw.pickupCity)) return str(raw.pickupCity);
  return "Nearby Zone";
}

// ─── Zone type ────────────────────────────────────────────────────────────────
type Zone = {
  name:        string;
  orderCount:  number;
  distanceKm:  number | null;  // null when no coordinates found
};

// ─── HotZoneStrip ─────────────────────────────────────────────────────────────
// Named export — rendered directly below LiveMap in the Ride Requests card.
export function HotZoneStrip() {
  const colors                = useColors();
  const [zones, setZones]     = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchZones() {
      console.log("[HOTZONE_FETCH_START] beginning nearby hot zone fetch");

      // ── 1. Driver GPS ────────────────────────────────────────────────────
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
          console.log(
            "[HOTZONE_DRIVER_LOCATION] lat =",
            driverLat.toFixed(5),
            "lng =",
            driverLng.toFixed(5),
          );
        } else {
          console.log(
            "[HOTZONE_DRIVER_LOCATION] permission not granted — distance filtering skipped",
          );
        }
      } catch (locErr) {
        console.log("[HOTZONE_DRIVER_LOCATION] GPS error —", String(locErr));
      }

      // ── 2. Fetch available orders ────────────────────────────────────────
      let rawDocs: Record<string, unknown>[] = [];
      try {
        const q = query(
          collection(db, "orders"),
          where("status", "in", ["searching", "pending"]),
          limit(60),
        );
        const snap = await getDocs(q);
        rawDocs = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
        console.log(
          "[HOTZONE_ORDER_FILTERED] Firestore returned",
          rawDocs.length,
          "candidate orders",
        );
      } catch (fsErr) {
        console.log(
          "[HOTZONE_ORDER_FILTERED] Firestore query failed —",
          String(fsErr),
        );
        rawDocs = [];
      }

      if (cancelled) return;

      // ── 3. Filter by distance + group by zone ───────────────────────────
      const zoneMap = new Map<
        string,
        { orderCount: number; distKms: number[] }
      >();

      for (const raw of rawDocs) {
        const coords = getPickupCoords(raw);

        if (coords === null) {
          // Per spec: orders without pickup coordinates are excluded from zones.
          continue;
        }

        let distKm: number | null = null;
        if (driverLat !== null && driverLng !== null) {
          distKm = haversineKm(driverLat, driverLng, coords.lat, coords.lng);
          console.log(
            "[HOTZONE_DISTANCE_CALCULATED] orderId =",
            String(raw.id),
            "distKm =",
            distKm.toFixed(2),
          );
          if (distKm > 10) continue;   // outside 10 km radius — exclude
        }

        const zoneName = getZoneName(raw);
        const existing = zoneMap.get(zoneName);
        if (existing) {
          existing.orderCount += 1;
          if (distKm !== null) existing.distKms.push(distKm);
        } else {
          zoneMap.set(zoneName, {
            orderCount: 1,
            distKms:    distKm !== null ? [distKm] : [],
          });
        }
      }

      // Build + sort zones: nearest first, then by order count descending
      const result: Zone[] = [];
      for (const [name, { orderCount, distKms }] of zoneMap) {
        const distanceKm =
          distKms.length > 0
            ? distKms.reduce((a, b) => a + b, 0) / distKms.length
            : null;
        result.push({ name, orderCount, distanceKm });
      }
      result.sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        return b.orderCount - a.orderCount;
      });

      console.log(
        "[HOTZONE_GROUPED] zones =",
        result.length,
        result.map((z) => z.name).join(", ") || "(none)",
      );

      if (!cancelled) {
        setZones(result);
        setLoading(false);
        if (result.length === 0) {
          console.log(
            "[HOTZONE_RENDER_EMPTY] no nearby orders within 10 km with coordinates",
          );
        } else {
          console.log("[HOTZONE_RENDER_SUCCESS] rendering", result.length, "zones");
        }
      }
    }

    void fetchZones();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[strip.stateRow, { borderTopColor: colors.border }]}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={[strip.stateText, { color: colors.mutedForeground }]}>
          Finding nearby orders…
        </Text>
      </View>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (zones.length === 0) {
    return (
      <View style={[strip.stateRow, { borderTopColor: colors.border }]}>
        <Feather name="map-pin" size={15} color={colors.mutedForeground} />
        <Text style={[strip.stateText, { color: colors.mutedForeground }]}>
          No nearby orders right now
        </Text>
      </View>
    );
  }

  // ── Zone chips ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={strip.scroll}
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
            {/* Coloured left accent bar — heat tier indicator */}
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
                    ? `${Math.round(z.distanceKm * 1000)} m`
                    : `${z.distanceKm.toFixed(1)} km`}{" "}
                  away
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── LiveMap — default export ──────────────────────────────────────────────────
// Replaces the fake dark SVG map with a clean light card.
// Shows the driver's current GPS area (reverse-geocoded city/district) and an
// online/offline status indicator. No hardcoded city names or fake zones.
export default function LiveMap({ online }: { online: boolean }) {
  const colors                      = useColors();
  const [locationLabel, setLabel]   = useState<string | null>(null);

  useEffect(() => {
    if (!online) {
      setLabel(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || !active) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!active) return;
        const rev = await Location.reverseGeocodeAsync({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (!active) return;
        const r = rev[0];
        if (r) {
          const label =
            r.district ??
            r.subregion ??
            r.city ??
            r.region ??
            null;
          setLabel(label);
        }
      } catch {
        // Reverse-geocode unavailable — location chip stays generic
      }
    })();
    return () => {
      active = false;
    };
  }, [online]);

  return (
    <View
      style={[
        mapStyles.wrap,
        {
          backgroundColor: colors.surface,
          borderColor:     colors.border,
        },
      ]}
    >
      {/* Subtle dot-grid background — light, decorative */}
      <View style={mapStyles.dotGrid} pointerEvents="none">
        {DOT_POSITIONS.map(({ top, left }, i) => (
          <View
            key={i}
            style={[
              mapStyles.dot,
              {
                top,
                left,
                backgroundColor: colors.border,
              },
            ]}
          />
        ))}
      </View>

      {/* ── Driver location pin — centered ─────────────────────────────── */}
      <View style={mapStyles.pinWrap} pointerEvents="none">
        {/* Outer ring */}
        <View
          style={[
            mapStyles.pinRing,
            {
              borderColor: online
                ? PIN_BLUE + "55"
                : colors.border,
            },
          ]}
        />
        {/* Pin body */}
        <View
          style={[
            mapStyles.pinBody,
            {
              borderColor:     online ? PIN_BLUE : colors.border,
              backgroundColor: online ? PIN_BLUE : colors.surface,
            },
          ]}
        >
          <View
            style={[
              mapStyles.pinCore,
              {
                backgroundColor: online ? "#fff" : colors.mutedForeground,
              },
            ]}
          />
        </View>
      </View>

      {/* ── Location chip — bottom-left ─────────────────────────────────── */}
      <View
        style={[
          mapStyles.locChip,
          {
            backgroundColor: colors.card,
            borderColor:     colors.border,
          },
        ]}
      >
        <Feather
          name="map-pin"
          size={11}
          color={online ? PIN_BLUE : colors.mutedForeground}
        />
        <Text
          style={[
            mapStyles.locText,
            { color: online ? colors.foreground : colors.mutedForeground },
          ]}
          numberOfLines={1}
        >
          {online
            ? (locationLabel ?? "Locating…")
            : "Offline"}
        </Text>
      </View>

      {/* ── Live pill — top-right (only when online) ────────────────────── */}
      {online && (
        <View
          style={[mapStyles.livePill, { backgroundColor: colors.successSoft }]}
        >
          <View
            style={[mapStyles.liveDot, { backgroundColor: colors.success }]}
          />
          <Text style={[mapStyles.liveText, { color: colors.success }]}>
            Live
          </Text>
        </View>
      )}

      {/* ── "No map SDK" label — center-bottom ─────────────────────────── */}
      <Text style={[mapStyles.noMapNote, { color: colors.mutedForeground }]}>
        {online ? "Scanning nearby orders…" : "Go online to see nearby orders"}
      </Text>
    </View>
  );
}

// ─── Dot-grid positions for the light map background ─────────────────────────
// Pre-computed so they don't recalculate on every render.
const DOT_POSITIONS: Array<{ top: number; left: number }> = (() => {
  const rows   = 8;
  const cols   = 12;
  const height = 180;
  const width  = 400;   // approximate card width
  const pts: Array<{ top: number; left: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        top:  Math.round((r / (rows - 1)) * height),
        left: Math.round((c / (cols - 1)) * width),
      });
    }
  }
  return pts;
})();

// ─── Styles ───────────────────────────────────────────────────────────────────
const strip = StyleSheet.create({
  stateRow: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    paddingVertical: 18,
    borderTopWidth:  StyleSheet.hairlineWidth,
    marginTop:       12,
    gap:             8,
  },
  stateText: {
    fontSize:   13,
    fontWeight: "500",
  },
  scroll: {
    marginTop: 12,
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
    width:         130,
    borderRadius:  10,
    borderWidth:   1,
    overflow:      "hidden",
  },
  accentBar: {
    width: 3,
  },
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
});

const mapStyles = StyleSheet.create({
  wrap: {
    height:       180,
    borderRadius: 12,
    overflow:     "hidden",
    borderWidth:  StyleSheet.hairlineWidth,
    marginTop:    4,
    position:     "relative",
    alignItems:   "center",
    justifyContent: "center",
  },
  dotGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    position:     "absolute",
    width:        3,
    height:       3,
    borderRadius: 1.5,
    opacity:      0.5,
  },
  pinWrap: {
    alignItems:     "center",
    justifyContent: "center",
  },
  pinRing: {
    position:     "absolute",
    width:        42,
    height:       42,
    borderRadius: 21,
    borderWidth:  1.5,
  },
  pinBody: {
    width:          26,
    height:         26,
    borderRadius:   13,
    borderWidth:    2.5,
    alignItems:     "center",
    justifyContent: "center",
    // iOS shadow
    shadowColor:    PIN_BLUE,
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.45,
    shadowRadius:   8,
    // Android
    elevation:      5,
  },
  pinCore: {
    width:        8,
    height:       8,
    borderRadius: 4,
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
  liveDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  liveText: {
    fontSize:   11,
    fontWeight: "700",
  },
  noMapNote: {
    position:   "absolute",
    bottom:     10,
    right:      10,
    fontSize:   10,
    fontWeight: "500",
  },
});
