import { SafeInlineIcon, SafeIconName, PremiumButton3D } from "@/components/SafeIcon";
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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { callSupport } from "@/utils/support";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:           "#F6F7FB",
  white:        "#FFFFFF",
  textPrimary:  "#0F172A",
  textMuted:    "#6B7280",
  border:       "#E5E7EB",
  primary:      "#E8336C",
  primarySoft:  "#FFF0F5",
  muted:        "#F3F4F6",
  mutedFg:      "#9CA3AF",
  chipSelected: "#E8336C",
} as const;

// ─── Categories ───────────────────────────────────────────────────────────────
type Category = "All" | "2 Wheeler" | "3 Wheeler" | "4 Wheeler" | "Cargo" | "Heavy";
const CATEGORIES: Category[] = ["All", "2 Wheeler", "3 Wheeler", "4 Wheeler", "Cargo", "Heavy"];

// ─── Vehicle definitions ──────────────────────────────────────────────────────
type VehicleOption = {
  id:           string;
  name:         string;
  tagline:      string;
  capacity:     string;
  price:        string;
  safeIcon:     SafeIconName;
  capacityType: "passenger" | "cargo";
  category:     Exclude<Category, "All">;
  popular?:     boolean;
  gradStart:    string;
  gradEnd:      string;
  gradMid?:     string;
};

const VEHICLES: VehicleOption[] = [
  {
    id: "bike",        name: "Bike Delivery",  tagline: "Quick parcel rides",
    capacity: "1 Parcel",  price: "₹6/km",   safeIcon: "bike",    capacityType: "cargo",
    category: "2 Wheeler", popular: true,
    gradStart: "#FF6B9D",  gradMid: "#E8336C",  gradEnd: "#9B59B6",
  },
  {
    id: "scooter",     name: "Scooter",        tagline: "Light delivery rides",
    capacity: "1 Parcel",  price: "₹5/km",   safeIcon: "scooter", capacityType: "cargo",
    category: "2 Wheeler",
    gradStart: "#FF8C69",  gradEnd: "#FFA726",
  },
  {
    id: "auto-pass",   name: "Auto Passenger", tagline: "3-seater city rides",
    capacity: "3 Seats",   price: "₹10/km",  safeIcon: "auto",    capacityType: "passenger",
    category: "3 Wheeler",
    gradStart: "#FFD43B",  gradEnd: "#FFA726",
  },
  {
    id: "auto-cargo",  name: "Auto Cargo",     tagline: "Small goods delivery",
    capacity: "300 kg",    price: "₹12/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "3 Wheeler",
    gradStart: "#FB923C",  gradEnd: "#F59E0B",
  },
  {
    id: "mini-car",    name: "Mini Car",       tagline: "Compact comfort",
    capacity: "4 Seats",   price: "₹14/km",  safeIcon: "car",     capacityType: "passenger",
    category: "4 Wheeler",
    gradStart: "#38BDF8",  gradEnd: "#2563EB",
  },
  {
    id: "sedan",       name: "Sedan",          tagline: "Premium comfort",
    capacity: "4 Seats",   price: "₹18/km",  safeIcon: "car",     capacityType: "passenger",
    category: "4 Wheeler",
    gradStart: "#818CF8",  gradEnd: "#4338CA",
  },
  {
    id: "suv",         name: "SUV",            tagline: "Family rides",
    capacity: "6 Seats",   price: "₹22/km",  safeIcon: "car",     capacityType: "passenger",
    category: "4 Wheeler",
    gradStart: "#2DD4BF",  gradEnd: "#0D9488",
  },
  {
    id: "tata-ace",    name: "Tata Ace",       tagline: "Mini goods carrier",
    capacity: "750 kg",    price: "₹16/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "Cargo",
    gradStart: "#4ADE80",  gradEnd: "#16A34A",
  },
  {
    id: "pickup",      name: "Pickup Truck",   tagline: "Heavy parcel delivery",
    capacity: "1 Ton",     price: "₹20/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "Cargo",
    gradStart: "#A3E635",  gradEnd: "#65A30D",
  },
  {
    id: "mini-truck",  name: "Mini Truck",     tagline: "Bulk goods transport",
    capacity: "1.5 Ton",   price: "₹24/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "Cargo",
    gradStart: "#22D3EE",  gradEnd: "#0EA5E9",
  },
  {
    id: "eicher",      name: "Eicher Truck",   tagline: "Commercial transport",
    capacity: "3 Ton",     price: "₹32/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "Heavy",
    gradStart: "#94A3B8",  gradEnd: "#3B82F6",
  },
  {
    id: "truck-14ft",  name: "14 Feet Truck",  tagline: "Large goods movement",
    capacity: "5 Ton",     price: "₹40/km",  safeIcon: "truck",   capacityType: "cargo",
    category: "Heavy",
    gradStart: "#C084FC",  gradEnd: "#6D28D9",
  },
];

// ─── Vehicle Card ─────────────────────────────────────────────────────────────
function VehicleCard({
  vehicle,
  selected,
  onPress,
  cardWidth,
}: {
  vehicle:   VehicleOption;
  selected:  boolean;
  onPress:   () => void;
  cardWidth: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev  = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.045, friction: 4, tension: 290, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1,     friction: 5, tension: 220, useNativeDriver: true }),
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
          width:         cardWidth,
          shadowColor:   selected ? D.primary : "#000",
          shadowOpacity: selected ? 0.22      : 0.07,
          shadowRadius:  selected ? 16        : 8,
          shadowOffset:  { width: 0, height: selected ? 7 : 3 },
          elevation:     selected ? 10        : 3,
          transform:     [{ scale }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={[
          styles.card,
          {
            borderColor:     selected ? D.primary : D.border,
            borderWidth:     selected ? 2         : 1.5,
            backgroundColor: selected ? D.primarySoft : D.white,
          },
        ]}
      >
        {/* ── Gradient top ── */}
        <LinearGradient
          colors={gradColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradTop}
        >
          {vehicle.popular && (
            <View style={styles.badge}>
              <SafeInlineIcon name="star" size={8} color="#fff" />
              <Text style={styles.badgeText}>Popular</Text>
            </View>
          )}

          {selected && (
            <View style={styles.checkCircle}>
              <SafeInlineIcon name="check" size={10} color={D.white} />
            </View>
          )}

          <View style={styles.emojiWrap}>
            <SafeInlineIcon name={vehicle.safeIcon} size={22} color="#fff" />
          </View>
        </LinearGradient>

        {/* ── Text bottom ── */}
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
            <SafeInlineIcon
              name="package"
              size={9}
              color={selected ? D.primary : D.textMuted}
            />
            <Text
              style={[styles.infoText, { color: selected ? D.primary : D.textMuted }]}
              numberOfLines={1}
            >
              {vehicle.capacity}
            </Text>
            <View style={styles.infoDot} />
            <Text
              style={[styles.priceText, { color: selected ? D.primary : "#374151" }]}
            >
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
      {filled && <SafeInlineIcon name="check" size={9} color={D.white} />}
    </View>
  );
}

// ─── Category Chip ────────────────────────────────────────────────────────────
function CategoryChip({
  label,
  active,
  onPress,
}: {
  label:   string;
  active:  boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        active
          ? { backgroundColor: D.chipSelected, borderColor: D.chipSelected }
          : { backgroundColor: D.white,        borderColor: D.border },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? D.white : D.textMuted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function VehicleSelectionScreen() {
  console.log("[SCREEN_MOUNT] vehicle-selection");
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setVehicle } = useDriver();
  const { width: screenW } = useWindowDimensions();

  const [selectedId,      setSelectedId]      = useState<string | null>(null);
  const [activeCategory,  setActiveCategory]  = useState<Category>("All");

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId) ?? null;

  // 2-column card width
  const H_PAD    = 14;
  const COL_GAP  = 12;
  const cardWidth = Math.floor((screenW - H_PAD * 2 - COL_GAP) / 2);

  // Filter + pair into rows
  const filtered =
    activeCategory === "All"
      ? VEHICLES
      : VEHICLES.filter((v) => v.category === activeCategory);

  const rows: VehicleOption[][] = [];
  for (let i = 0; i < filtered.length; i += 2) rows.push(filtered.slice(i, i + 2));

  function handleContinue() {
    if (!selectedId || !selectedVehicle) return;
    setVehicle({ id: selectedVehicle.id, name: selectedVehicle.name });
    router.push({ pathname: "/profile-setup", params: { vehicle: selectedId } });
  }

  return (
    <View style={[styles.root, { backgroundColor: D.bg }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <SafeInlineIcon name="back" size={18} color={D.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Choose Vehicle</Text>
          <Text style={styles.headerSub}>Step 2 of 3</Text>
        </View>

        <TouchableOpacity
          style={styles.helpBtn}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <SafeInlineIcon name="support" size={15} color={D.primary} />
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

      {/* ── Category chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipContent}
      >
        {CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat}
            label={cat}
            active={activeCategory === cat}
            onPress={() => {
              setActiveCategory(cat);
              // clear selection if selected vehicle doesn't belong to new category
              if (
                cat !== "All" &&
                selectedVehicle &&
                selectedVehicle.category !== cat
              ) {
                setSelectedId(null);
              }
            }}
          />
        ))}
      </ScrollView>

      {/* ── Grid ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 188 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {rows.length === 0 ? (
          <View style={styles.emptyState}>
            <SafeInlineIcon name="search" size={40} color="#9CA3AF" />
            <Text style={styles.emptyText}>No vehicles in this category</Text>
          </View>
        ) : (
          rows.map((row, ri) => (
            <View key={ri} style={[styles.row, { gap: COL_GAP }]}>
              {row.map((v) => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  selected={selectedId === v.id}
                  onPress={() => setSelectedId(v.id)}
                  cardWidth={cardWidth}
                />
              ))}
              {/* spacer so odd last card stays left-aligned */}
              {row.length === 1 && <View style={{ width: cardWidth }} />}
            </View>
          ))
        )}
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
        {/* Summary card */}
        <View style={styles.summaryCard}>
          {selectedVehicle ? (
            <>
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
                <SafeInlineIcon name={selectedVehicle.safeIcon} size={22} color="#fff" />
              </LinearGradient>

              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Selected</Text>
                <Text style={styles.summaryName} numberOfLines={1}>
                  {selectedVehicle.name}
                </Text>
              </View>

              <View style={styles.summaryRight}>
                <Text style={styles.summaryCap}>{selectedVehicle.capacity}</Text>
                <Text style={styles.summaryPrice}>{selectedVehicle.price}</Text>
              </View>
            </>
          ) : (
            <View style={styles.summaryEmpty}>
              <SafeInlineIcon name="package" size={16} color={D.mutedFg} />
              <Text style={styles.summaryEmptyText}>No vehicle selected</Text>
            </View>
          )}
        </View>

        {/* Continue button */}
        <PremiumButton3D
          title="Continue"
          disabled={!selectedId}
          onPress={handleContinue}
          rightIcon="arrow"
          style={styles.ctaWrap}
        />
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
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: "#0F172A",
  },
  headerSub: {
    fontSize: 11,
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
    paddingVertical: 6,
    borderRadius: 11,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  helpText: { fontSize: 12, fontWeight: "700", color: "#E8336C" },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 12,
    paddingTop: 2,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  progressLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginHorizontal: -2,
  },

  // Category chips
  chipScroll: { maxHeight: 44 },
  chipContent: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "700" },

  // Grid
  scroll:      { paddingHorizontal: 14, paddingTop: 6, gap: 12 },
  row:         { flexDirection: "row" },

  // Card outer
  cardWrap: {
    borderRadius: 18,
  },
  card: {
    borderRadius: 18,
    overflow: "hidden",
  },

  // Gradient top
  gradTop: {
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 7,
    left: 7,
    backgroundColor: "rgba(255,255,255,0.28)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  checkCircle: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#E8336C",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#E8336C",
    shadowOpacity: 0.55,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  emojiWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { /* replaced by MaterialCommunityIcons */ },

  // Text zone
  textZone: {
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 10,
    gap: 3,
  },
  cardName: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  cardTagline: {
    fontSize: 10,
    fontWeight: "500",
    color: "#6B7280",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 4,
  },
  infoText:  { fontSize: 9,  fontWeight: "600", flex: 1 },
  infoDot:   { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#D1D5DB" },
  priceText: { fontSize: 10, fontWeight: "800" },

  // Empty state
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 10,
  },
  emptyEmoji: { /* replaced by Feather icon */ },
  emptyText:  { fontSize: 14, fontWeight: "600", color: "#9CA3AF" },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } as object }),
  },

  // Summary card
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    minHeight: 56,
  },
  summaryThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryEmoji: { /* replaced by MaterialCommunityIcons */ },
  summaryLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: "#6B7280",
  },
  summaryName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  summaryRight: { alignItems: "flex-end", gap: 1 },
  summaryCap:   { fontSize: 10, fontWeight: "600", color: "#6B7280" },
  summaryPrice: { fontSize: 14, fontWeight: "800", color: "#E8336C" },
  summaryEmpty: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  summaryEmptyText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#9CA3AF",
  },

  // CTA
  ctaWrap: {
    borderRadius: 14,
    shadowColor: "#E8336C",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  ctaGradient: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
