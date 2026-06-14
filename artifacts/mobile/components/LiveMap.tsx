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
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { db } from "@/utils/firebase";
import { useColors } from "@/hooks/useColors";

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
const MAX_ORDERS          = 60;             // Firestore limit per fetch

// ─── Module-level hot-zone cache ─────────────────────────────────────────────
// Persists across re-renders and component unmount/remount cycles so the card
// never re-fetches unnecessarily. Updated only by fetchZones().
interface CachedZone {
  name:        string;
  orderCount:  number;
  distanceKm:  number | null;
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

// ─── Pickup coordinate extraction ────────────────────────────────────────────
// OrderDoc carries only address strings in its TypeScript type; customer apps may
// write lat/lng under several field shapes. All known shapes are probed at runtime.
function getPickupCoords(raw: Record<string, unknown>): { lat: number; lng: number } | null {
  // Shape 1: flat — pickupLat / pickupLng
  if (typeof raw.pickupLat === "number" && typeof raw.pickupLng === "number") {
    return { lat: raw.pickupLat, lng: raw.pickupLng };
  }
  // Shape 2: nested pickupLocation — { lat, lng } or { latitude, longitude }
  const loc = raw.pickupLocation;
  if (loc && typeof loc === "object" && !Array.isArray(loc)) {
    const l = loc as Record<string, unknown>;
    if (typeof l.lat === "number" && typeof l.lng === "number")           return { lat: l.lat, lng: l.lng };
    if (typeof l.latitude === "number" && typeof l.longitude === "number") return { lat: l.latitude, lng: l.longitude };
  }
  // Shape 3: pickup as object — { lat, lng } or { latitude, longitude }
  const pu = raw.pickup;
  if (pu && typeof pu === "object" && !Array.isArray(pu)) {
    const p = pu as Record<string, unknown>;
    if (typeof p.lat === "number" && typeof p.lng === "number")           return { lat: p.lat, lng: p.lng };
    if (typeof p.latitude === "number" && typeof p.longitude === "number") return { lat: p.latitude, lng: p.longitude };
  }
  return null;
}

// ─── Zone name extraction ─────────────────────────────────────────────────────
// Priority: pickupArea → pickupLocality → pickupSub → first comma-segment of
//           pickup string → first segment of pickupAddress → pickupCity → fallback
function getZoneName(raw: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const firstSeg = (str: string) => str.split(",")[0]?.trim() ?? "";

  if (s(raw.pickupArea))                   return s(raw.pickupArea);
  if (s(raw.pickupLocality))               return s(raw.pickupLocality);
  if (s(raw.pickupSub))                    return s(raw.pickupSub);
  const ps = firstSeg(s(raw.pickup));
  if (ps)                                  return ps;
  const as_ = firstSeg(s(raw.pickupAddress));
  if (as_)                                 return as_;
  if (s(raw.pickupCity))                   return s(raw.pickupCity);
  return "Nearby Zone";
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
// Reads Firestore, updates the module-level cache, and returns the new zones.
// All Firestore reads for hot zones happen exclusively here.
async function fetchZones(reason: string): Promise<CachedZone[]> {
  console.log("[HOTZONE_FETCH_START] reason =", reason);

  // ── 1. Driver GPS ──────────────────────────────────────────────────────────
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
      console.log("[HOTZONE_DRIVER_LOCATION] permission not granted — distance filtering skipped");
    }
  } catch (err) {
    console.log("[HOTZONE_DRIVER_LOCATION] GPS error —", String(err));
  }

  // ── 2. Firestore fetch — only required fields ──────────────────────────────
  let rawDocs: Record<string, unknown>[] = [];
  try {
    const q = query(
      collection(db, "orders"),
      where("status", "in", ["searching", "pending"]),
      limit(MAX_ORDERS),
    );
    const snap = await getDocs(q);
    rawDocs = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
    );
    console.log("[HOTZONE_ORDER_FILTERED] Firestore returned", rawDocs.length, "candidate orders");
  } catch (err) {
    console.log("[HOTZONE_ORDER_FILTERED] Firestore query failed —", String(err));
  }

  // ── 3. Filter by 10-km radius + group by locality ─────────────────────────
  const zoneMap = new Map<string, { orderCount: number; distKms: number[] }>();

  for (const raw of rawDocs) {
    const coords = getPickupCoords(raw);
    if (coords === null) continue;   // no coordinates — skip per spec

    let distKm: number | null = null;
    if (driverLat !== null && driverLng !== null) {
      distKm = haversineKm(driverLat, driverLng, coords.lat, coords.lng);
      console.log("[HOTZONE_DISTANCE_CALCULATED] orderId =", String(raw.id), "distKm =", distKm.toFixed(2));
      if (distKm > 10) continue;    // outside radius — exclude
    }

    const zoneName = getZoneName(raw);
    const existing = zoneMap.get(zoneName);
    if (existing) {
      existing.orderCount += 1;
      if (distKm !== null) existing.distKms.push(distKm);
    } else {
      zoneMap.set(zoneName, { orderCount: 1, distKms: distKm !== null ? [distKm] : [] });
    }
  }

  // ── 4. Build sorted zones ──────────────────────────────────────────────────
  const result: CachedZone[] = [];
  for (const [name, { orderCount, distKms }] of zoneMap) {
    const avg = distKms.length > 0
      ? distKms.reduce((a, b) => a + b, 0) / distKms.length
      : null;
    result.push({ name, orderCount, distanceKm: avg });
  }
  result.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    return b.orderCount - a.orderCount;
  });

  // ── 5. Update cache ────────────────────────────────────────────────────────
  cache.zones     = result;
  cache.fetchedAt = Date.now();
  cache.fetchLat  = driverLat;
  cache.fetchLng  = driverLng;

  if (result.length === 0) {
    console.log("[HOTZONE_FETCH_EMPTY] no nearby orders within 10 km with coordinates");
  } else {
    console.log("[HOTZONE_FETCH_SUCCESS] zones =", result.length, result.map((z) => z.name).join(", "));
  }
  console.log("[HOTZONE_LAST_UPDATED] at", new Date(cache.fetchedAt).toLocaleTimeString());

  return result;
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
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── LiveMap — default export ─────────────────────────────────────────────────
// Clean light card replacing the fake dark SVG map.
// Shows driver GPS area (reverse-geocoded) and live/offline status.
// No fake city names, no hardcoded zones, no dark background.
export default function LiveMap({ online }: { online: boolean }) {
  const colors                    = useColors();
  const [locationLabel, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!online) { setLabel(null); return; }
    let active = true;
    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || !active) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        const rev = await Location.reverseGeocodeAsync({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (!active) return;
        const r = rev[0];
        if (r) setLabel(r.district ?? r.subregion ?? r.city ?? r.region ?? null);
      } catch {
        // Reverse-geocode unavailable — chip stays generic
      }
    })();
    return () => { active = false; };
  }, [online]);

  return (
    <View
      style={[
        mapStyles.wrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* Dot-grid decorative background */}
      <View style={mapStyles.dotGrid} pointerEvents="none">
        {DOT_POSITIONS.map(({ top, left }, i) => (
          <View
            key={i}
            style={[mapStyles.dot, { top, left, backgroundColor: colors.border }]}
          />
        ))}
      </View>

      {/* Driver location pin — centred */}
      <View style={mapStyles.pinWrap} pointerEvents="none">
        <View
          style={[
            mapStyles.pinRing,
            { borderColor: online ? PIN_BLUE + "55" : colors.border },
          ]}
        />
        <View
          style={[
            mapStyles.pinBody,
            {
              borderColor:     online ? PIN_BLUE : colors.border,
              backgroundColor: online ? PIN_BLUE : colors.surface,
              shadowColor:     online ? PIN_BLUE : "transparent",
            },
          ]}
        >
          <View
            style={[
              mapStyles.pinCore,
              { backgroundColor: online ? "#fff" : colors.mutedForeground },
            ]}
          />
        </View>
      </View>

      {/* Location chip — bottom-left */}
      <View
        style={[
          mapStyles.locChip,
          { backgroundColor: colors.card, borderColor: colors.border },
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
          {online ? (locationLabel ?? "Locating…") : "Offline"}
        </Text>
      </View>

      {/* Live pill — top-right (online only) */}
      {online && (
        <View style={[mapStyles.livePill, { backgroundColor: colors.successSoft }]}>
          <View style={[mapStyles.liveDot, { backgroundColor: colors.success }]} />
          <Text style={[mapStyles.liveText, { color: colors.success }]}>Live</Text>
        </View>
      )}

      {/* Status note — bottom-right */}
      <Text style={[mapStyles.noMapNote, { color: colors.mutedForeground }]}>
        {online ? "Scanning nearby orders…" : "Go online to see nearby orders"}
      </Text>
    </View>
  );
}

// ─── Dot-grid positions (pre-computed — no per-render allocation) ─────────────
const DOT_POSITIONS: Array<{ top: number; left: number }> = (() => {
  const rows = 7; const cols = 11;
  const h = 180; const w = 380;
  return Array.from({ length: rows * cols }, (_, idx) => ({
    top:  Math.round(((idx / cols | 0) / (rows - 1)) * h),
    left: Math.round(((idx % cols)     / (cols - 1)) * w),
  }));
})();

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
});

const mapStyles = StyleSheet.create({
  wrap: {
    height:         180,
    borderRadius:   12,
    overflow:       "hidden",
    borderWidth:    StyleSheet.hairlineWidth,
    marginTop:      4,
    position:       "relative",
    alignItems:     "center",
    justifyContent: "center",
  },
  dotGrid: { ...StyleSheet.absoluteFillObject },
  dot: {
    position:     "absolute",
    width:        3,
    height:       3,
    borderRadius: 1.5,
    opacity:      0.45,
  },
  pinWrap: { alignItems: "center", justifyContent: "center" },
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
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.45,
    shadowRadius:   8,
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
