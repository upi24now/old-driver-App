import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { callSupport } from "@/utils/support";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:          "#F6F7FB",
  white:       "#FFFFFF",
  textPrimary: "#0F172A",
  textMuted:   "#6B7280",
  border:      "#E5E7EB",
  primary:     "#E8336C",
  primarySoft: "#FFF0F5",
  muted:       "#F3F4F6",
  mutedFg:     "#9CA3AF",
} as const;

// ─── Vehicle definitions ──────────────────────────────────────────────────────
type VehicleOption = {
  id:        string;
  name:      string;
  tagline:   string;
  seatLabel: string;
  price:     string;
  emoji:     string;
  badge?:    string;
  gradStart: string;
  gradEnd:   string;
  gradMid?:  string;
};

const VEHICLES: VehicleOption[] = [
  {
    id:        "bike",
    name:      "Bike",
    tagline:   "Quick delivery rides",
    seatLabel: "1 Seat",
    price:     "₹6/km",
    emoji:     "🏍",
    badge:     "⭐ Popular",
    gradStart: "#FF6B9D",
    gradMid:   "#E8336C",
    gradEnd:   "#9B59B6",
  },
  {
    id:        "auto",
    name:      "Auto",
    tagline:   "3-seater city rides",
    seatLabel: "3 Seats",
    price:     "₹10/km",
    emoji:     "🛺",
    gradStart: "#FFD43B",
    gradEnd:   "#FFA726",
  },
  {
    id:        "mini-truck",
    name:      "Mini Truck",
    tagline:   "Light goods transport",
    seatLabel: "1 Ton",
    price:     "₹14/km",
    emoji:     "🚚",
    gradStart: "#60A5FA",
    gradEnd:   "#2563EB",
  },
  {
    id:        "pickup",
    name:      "Pickup Truck",
    tagline:   "Heavy delivery transport",
    seatLabel: "2 Ton",
    price:     "₹18/km",
    emoji:     "🛻",
    gradStart: "#4ADE80",
    gradEnd:   "#16A34A",
  },
];

// ─── Vehicle Card ─────────────────────────────────────────────────────────────
function VehicleCard({
  vehicle,
  selected,
  onPress,
}: {
  vehicle:  VehicleOption;
  selected: boolean;
  onPress:  () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev  = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.04, friction: 4, tension: 280, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1,    friction: 5, tension: 220, useNativeDriver: true }),
      ]).start();
    }
    prev.current = selected;
  }, [selected]);

  const gradColors = vehicle.gradMid
    ? ([vehicle.gradStart, vehicle.gradMid, vehicle.gradEnd] as const)
    : ([vehicle.gradStart, vehicle.gradEnd] as const);

  return (
    <Animated.View
      style={[
        styles.cardWrap,
        {
          shadowColor:   selected ? D.primary : "#000",
          shadowOpacity: selected ? 0.22      : 0.07,
          shadowRadius:  selected ? 18        : 10,
          shadowOffset:  { width: 0, height: selected ? 8 : 3 },
          elevation:     selected ? 12        : 4,
          transform:     [{ scale }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={[
          styles.card,
          {
            borderColor: selected ? D.primary : D.border,
            borderWidth: selected ? 2         : 1.5,
            backgroundColor: selected ? D.primarySoft : D.white,
          },
        ]}
      >
        {/* ── Gradient top area ── */}
        <LinearGradient
          colors={gradColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientTop}
        >
          {/* Badge */}
          {vehicle.badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{vehicle.badge}</Text>
            </View>
          )}

          {/* Checkmark */}
          {selected && (
            <View style={styles.checkCircle}>
              <Feather name="check" size={11} color={D.white} />
            </View>
          )}

          {/* Vehicle emoji — large, centered with frosted circle */}
          <View style={styles.emojiWrap}>
            <Text style={styles.emojiText}>{vehicle.emoji}</Text>
          </View>
        </LinearGradient>

        {/* ── Text bottom area ── */}
        <View style={styles.textZone}>
          <Text
            style={[styles.cardName, { color: selected ? D.primary : D.textPrimary }]}
            numberOfLines={1}
          >
            {vehicle.name}
          </Text>
          <Text style={styles.cardTagline} numberOfLines={1}>
            {vehicle.tagline}
          </Text>

          <View
            style={[
              styles.infoRow,
              {
                backgroundColor: selected ? "#FFE4EE" : D.muted,
                borderColor:     selected ? "#FFB8CC" : D.border,
              },
            ]}
          >
            <Feather
              name="tag"
              size={10}
              color={selected ? D.primary : D.textMuted}
            />
            <Text
              style={[styles.infoText, { color: selected ? D.primary : D.textMuted }]}
              numberOfLines={1}
            >
              {vehicle.seatLabel}
            </Text>
            <View style={styles.infoDivider} />
            <Text style={[styles.priceText, { color: selected ? D.primary : "#374151" }]}>
              {vehicle.price}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Step Dot ─────────────────────────────────────────────────────────────────
function StepDot({ filled }: { filled: boolean }) {
  return (
    <View
      style={[
        styles.stepDot,
        filled
          ? { backgroundColor: D.primary }
          : { backgroundColor: D.border, borderWidth: 2, borderColor: "#D1D5DB" },
      ]}
    >
      {filled && <Feather name="check" size={9} color={D.white} />}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function VehicleSelectionScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { setVehicle } = useDriver();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId) ?? null;

  function handleContinue() {
    if (!selectedId || !selectedVehicle) return;
    setVehicle({ id: selectedVehicle.id, name: selectedVehicle.name });
    router.push({ pathname: "/profile-setup", params: { vehicle: selectedId } });
  }

  // Build 2-column rows
  const rows: VehicleOption[][] = [];
  for (let i = 0; i < VEHICLES.length; i += 2) rows.push(VEHICLES.slice(i, i + 2));

  return (
    <View style={[styles.root, { backgroundColor: D.bg }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={D.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Choose Vehicle 🚗</Text>
          <Text style={styles.headerSub}>Step 2 of 3</Text>
        </View>

        <TouchableOpacity
          style={styles.helpBtn}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <Feather name="help-circle" size={15} color={D.primary} />
          <Text style={styles.helpText}>Help</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ── */}
      <View style={styles.progressRow}>
        <StepDot filled />
        <View style={[styles.progressLine, { backgroundColor: D.primary }]} />
        <StepDot filled />
        <View style={[styles.progressLine, { backgroundColor: D.border }]} />
        <StepDot filled={false} />
      </View>

      {/* ── Grid ── */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 190 }]}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                selected={selectedId === v.id}
                onPress={() => setSelectedId(v.id)}
              />
            ))}
            {row.length === 1 && <View style={styles.cardWrap} />}
          </View>
        ))}
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 14,
            shadowColor:   selectedId ? D.primary : "#000",
          },
        ]}
      >
        {/* Selection summary */}
        <View style={styles.summaryCard}>
          {selectedVehicle ? (
            <>
              {/* Gradient mini badge */}
              <LinearGradient
                colors={
                  selectedVehicle.gradMid
                    ? [selectedVehicle.gradStart, selectedVehicle.gradMid, selectedVehicle.gradEnd]
                    : [selectedVehicle.gradStart, selectedVehicle.gradEnd]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.summaryThumb}
              >
                <Text style={styles.summaryEmoji}>{selectedVehicle.emoji}</Text>
              </LinearGradient>

              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Selected</Text>
                <Text style={styles.summaryName}>{selectedVehicle.name}</Text>
              </View>

              <View style={styles.summaryRight}>
                <Text style={styles.summarySeat}>{selectedVehicle.seatLabel}</Text>
                <Text style={styles.summaryPrice}>{selectedVehicle.price}</Text>
              </View>
            </>
          ) : (
            <View style={styles.summaryEmpty}>
              <Feather name="grid" size={18} color={D.mutedFg} />
              <Text style={styles.summaryEmptyText}>Select a vehicle to continue</Text>
            </View>
          )}
        </View>

        {/* Continue button */}
        <Pressable
          onPress={handleContinue}
          disabled={!selectedId}
          style={({ pressed }) => [
            styles.ctaWrap,
            { opacity: pressed && selectedId ? 0.88 : 1 },
          ]}
        >
          <LinearGradient
            colors={selectedId ? ["#FF6B9D", "#E8336C"] : ["#E5E7EB", "#E5E7EB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            <Text style={[styles.ctaText, !selectedId && { color: D.mutedFg }]}>
              Continue
            </Text>
            <Feather
              name="arrow-right"
              size={20}
              color={selectedId ? D.white : D.mutedFg}
            />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: "#0F172A",
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 1,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  helpText: { fontSize: 12, fontWeight: "700", color: "#E8336C" },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 14,
    paddingTop: 2,
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  progressLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginHorizontal: -2,
  },

  // Grid
  scroll:       { paddingHorizontal: 14, paddingTop: 6, gap: 14 },
  row:          { flexDirection: "row", gap: 14 },

  // Card
  cardWrap: {
    flex: 1,
    borderRadius: 20,
    shadowOffset: { width: 0, height: 3 },
  },
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
  },

  // Gradient top
  gradientTop: {
    height: 130,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 9,
    left: 9,
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  checkCircle: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#E8336C",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#E8336C",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  emojiWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: 38 },

  // Text zone
  textZone: {
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
    gap: 4,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  cardTagline: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  infoText:    { fontSize: 10, fontWeight: "600", flex: 1 },
  infoDivider: { width: 1, height: 10, backgroundColor: "#E5E7EB" },
  priceText:   { fontSize: 11, fontWeight: "800" },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    shadowOpacity: 0.10,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } as object }),
  },

  // Summary card
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
    minHeight: 60,
  },
  summaryThumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryEmoji: { fontSize: 24 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 1,
  },
  summaryName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  summaryRight: { alignItems: "flex-end", gap: 2 },
  summarySeat:  { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  summaryPrice: { fontSize: 15, fontWeight: "800", color: "#E8336C" },
  summaryEmpty: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  summaryEmptyText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#9CA3AF",
  },

  // CTA button
  ctaWrap: {
    borderRadius: 16,
    shadowColor: "#E8336C",
    shadowOpacity: 0.30,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  ctaGradient: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
