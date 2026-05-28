import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  ImageSourcePropType,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";

// ─── Brand tokens ──────────────────────────────────────────────
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";
const TEXT_PRIMARY = "#111111";
const TEXT_MUTED   = "#6B7280";
const BORDER       = "#F0E6EC";

// ─── Vehicle image assets ───────────────────────────────────────
const IMAGES: Record<string, ImageSourcePropType> = {
  bike:  require("../assets/vehicles/bike.png"),
  auto:  require("../assets/vehicles/auto.png"),
  mini:  require("../assets/vehicles/mini.png"),
  sedan: require("../assets/vehicles/sedan.png"),
  ev:    require("../assets/vehicles/ev.png"),
  truck: require("../assets/vehicles/truck.png"),
};

// ─── Vehicle data ───────────────────────────────────────────────
type VehicleOption = {
  id: string;
  name: string;
  cardBg: [string, string];
  capacity: string;
  capacityIcon: "user" | "users" | "package";
  price: string;
  badge?: { text: string; bg: string; fg: string };
  imageKey?: string;
  emoji?: string;
  emojiBg?: string;
};

const VEHICLES: VehicleOption[] = [
  {
    id: "bike",
    name: "Bike",
    cardBg: ["#F5F3FF", "#FAF5FF"],
    capacity: "1 Seat",
    capacityIcon: "user",
    price: "₹6/km",
    badge: { text: "⭐ Popular", bg: "#A855F7", fg: "#fff" },
    imageKey: "bike",
  },
  {
    id: "scooter",
    name: "Scooter",
    cardBg: ["#FFF1F2", "#FFF5F6"],
    capacity: "1 Seat",
    capacityIcon: "user",
    price: "₹7/km",
    emoji: "🛵",
    emojiBg: "#FFE4E6",
  },
  {
    id: "ev",
    name: "EV",
    cardBg: ["#ECFDF5", "#F0FFF8"],
    capacity: "4 Seats",
    capacityIcon: "users",
    price: "₹12/km",
    badge: { text: "⚡ New", bg: "#10B981", fg: "#fff" },
    imageKey: "ev",
  },
  {
    id: "auto",
    name: "Auto",
    cardBg: ["#FFFBEB", "#FEFCE8"],
    capacity: "3 Seats",
    capacityIcon: "users",
    price: "₹10/km",
    imageKey: "auto",
  },
  {
    id: "mini",
    name: "Mini Car",
    cardBg: ["#EFF6FF", "#F0F9FF"],
    capacity: "4 Seats",
    capacityIcon: "users",
    price: "₹14/km",
    imageKey: "mini",
  },
  {
    id: "sedan",
    name: "Sedan",
    cardBg: ["#FDF2F8", "#FFF0F6"],
    capacity: "4 Seats",
    capacityIcon: "users",
    price: "₹18/km",
    imageKey: "sedan",
  },
  {
    id: "suv",
    name: "SUV",
    cardBg: ["#FFF7ED", "#FFFBF5"],
    capacity: "6 Seats",
    capacityIcon: "users",
    price: "₹22/km",
    emoji: "🚙",
    emojiBg: "#FFEDD5",
  },
  {
    id: "pickup",
    name: "Pickup",
    cardBg: ["#F0FDF4", "#F0FFF4"],
    capacity: "500 kg",
    capacityIcon: "package",
    price: "₹20/km",
    emoji: "🛻",
    emojiBg: "#DCFCE7",
  },
  {
    id: "truck",
    name: "Truck",
    cardBg: ["#F1F5F9", "#F8FAFC"],
    capacity: "2 Ton",
    capacityIcon: "package",
    price: "₹35/km",
    imageKey: "truck",
  },
  {
    id: "mini-truck",
    name: "Mini Truck",
    cardBg: ["#FFF8F0", "#FFFAF5"],
    capacity: "1 Ton",
    capacityIcon: "package",
    price: "₹25/km",
    emoji: "🚚",
    emojiBg: "#FEF3C7",
  },
];

// ─── Vehicle Card (3-column compact) ───────────────────────────
function VehicleCard({
  vehicle,
  selected,
  onPress,
  cardWidth,
}: {
  vehicle: VehicleOption;
  selected: boolean;
  onPress: () => void;
  cardWidth: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;
  const prev  = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.parallel([
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.04, friction: 4, tension: 280, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1,    friction: 5, tension: 200, useNativeDriver: true }),
        ]),
        Animated.timing(glow, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    if (!selected && prev.current) {
      Animated.timing(glow, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
    prev.current = selected;
  }, [selected]);

  const imgZoneH = Math.round(cardWidth * 0.74); // ~74% of card width for image zone

  return (
    <Animated.View style={[styles.cardWrap, { width: cardWidth, transform: [{ scale }] }]}>
      <Animated.View style={[styles.cardGlow, { opacity: glow }]} pointerEvents="none" />

      <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.cardTouchable}>
        <LinearGradient
          colors={selected ? ["#FFF0F6", "#FDF2F8"] : vehicle.cardBg}
          style={[styles.card, selected && styles.cardSelected]}
        >
          {/* IMAGE ZONE */}
          <View style={[styles.imageZone, { height: imgZoneH }]}>
            {vehicle.imageKey ? (
              <Image
                source={IMAGES[vehicle.imageKey]}
                style={styles.vehicleImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.emojiWrap, { backgroundColor: vehicle.emojiBg ?? "#F3F4F6" }]}>
                <Text style={styles.emojiText}>{vehicle.emoji}</Text>
              </View>
            )}

            {vehicle.badge && (
              <View style={[styles.badge, { backgroundColor: vehicle.badge.bg }]}>
                <Text style={[styles.badgeText, { color: vehicle.badge.fg }]}>
                  {vehicle.badge.text}
                </Text>
              </View>
            )}

            {selected && (
              <LinearGradient
                colors={[PINK, ORANGE]}
                style={styles.checkCircle}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Feather name="check" size={9} color="#fff" />
              </LinearGradient>
            )}
          </View>

          {/* TEXT ZONE */}
          <View style={styles.textZone}>
            <Text style={[styles.cardName, selected && { color: PINK }]} numberOfLines={1}>
              {vehicle.name}
            </Text>
            <View style={[styles.metaRow, selected && styles.metaRowSelected]}>
              <Feather
                name={vehicle.capacityIcon}
                size={9}
                color={selected ? PINK : TEXT_MUTED}
              />
              <Text style={[styles.metaCapacity, selected && { color: PINK }]} numberOfLines={1}>
                {vehicle.capacity}
              </Text>
              <View style={styles.metaDot} />
              <Text style={[styles.metaPrice, selected && { color: PINK }]}>
                {vehicle.price}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Progress Step Dot ──────────────────────────────────────────
function StepDot({ filled }: { filled: boolean }) {
  return (
    <View style={[styles.stepDot, filled ? { backgroundColor: PINK } : { backgroundColor: "#E5E7EB", borderWidth: 2, borderColor: "#D1D5DB" }]}>
      {filled && <Feather name="check" size={9} color="#fff" />}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────
export default function VehicleSelectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setVehicle } = useDriver();
  const { width: screenW } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId) ?? null;

  // Responsive 3-column sizing
  const COLS        = 3;
  const H_PAD       = 14;
  const COL_GAP     = 10;
  const totalGap    = COL_GAP * (COLS - 1);
  const cardWidth   = Math.floor((screenW - H_PAD * 2 - totalGap) / COLS);

  // Build rows of 3
  const rows: VehicleOption[][] = [];
  for (let i = 0; i < VEHICLES.length; i += COLS) {
    rows.push(VEHICLES.slice(i, i + COLS));
  }

  function handleContinue() {
    if (!selectedId || !selectedVehicle) return;
    setVehicle({ id: selectedVehicle.id, name: selectedVehicle.name });
    router.push({ pathname: "/profile-setup", params: { vehicle: selectedId } });
  }

  return (
    <LinearGradient colors={["#FFF5F8", "#FFFAF5", "#FFF8FC"]} style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={18} color={TEXT_PRIMARY} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Choose Vehicle 🚗</Text>
          <Text style={styles.headerSub}>Step 2 of 3 · Pick your vehicle type</Text>
        </View>

        <TouchableOpacity style={styles.helpBtn} activeOpacity={0.7}>
          <Feather name="help-circle" size={14} color={PINK} />
          <Text style={styles.helpText}>Help</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress ── */}
      <View style={styles.progressRow}>
        <StepDot filled />
        <LinearGradient colors={[PINK, ORANGE]} style={styles.progressLine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
        <StepDot filled />
        <View style={styles.progressLineEmpty} />
        <StepDot filled={false} />
      </View>

      {/* ── Vehicle count label ── */}
      <View style={styles.countRow}>
        <Text style={styles.countText}>{VEHICLES.length} vehicle types available</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>All India</Text>
        </View>
      </View>

      {/* ── Scrollable 3-col grid ── */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 170 }]}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row, ri) => (
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
            {/* Fill remaining columns in last row with invisible spacers */}
            {row.length < COLS &&
              Array.from({ length: COLS - row.length }).map((_, i) => (
                <View key={`spacer-${i}`} style={{ width: cardWidth }} />
              ))}
          </View>
        ))}
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {/* Selection summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryThumbWrap}>
            {selectedVehicle?.imageKey ? (
              <Image source={IMAGES[selectedVehicle.imageKey]} style={styles.summaryThumb} resizeMode="contain" />
            ) : selectedVehicle?.emoji ? (
              <View style={[styles.summaryEmojiWrap, { backgroundColor: selectedVehicle.emojiBg ?? "#F3F4F6" }]}>
                <Text style={styles.summaryEmoji}>{selectedVehicle.emoji}</Text>
              </View>
            ) : (
              <LinearGradient colors={[PINK + "30", ORANGE + "18"]} style={styles.summaryThumbPlaceholder}>
                <Feather name="truck" size={20} color={PINK} />
              </LinearGradient>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.summaryLabel}>
              {selectedVehicle ? "Selected vehicle" : "No vehicle selected"}
            </Text>
            {selectedVehicle && (
              <Text style={styles.summaryName}>{selectedVehicle.name}</Text>
            )}
          </View>

          {selectedVehicle && (
            <View style={styles.summaryPriceWrap}>
              <Text style={styles.summaryPrice}>{selectedVehicle.price}</Text>
              <Text style={styles.summaryCapacity}>{selectedVehicle.capacity}</Text>
            </View>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity
          activeOpacity={selectedId ? 0.82 : 1}
          onPress={handleContinue}
          disabled={!selectedId}
          style={styles.ctaTouchable}
        >
          <LinearGradient
            colors={selectedId ? [PINK, ORANGE] : ["#E5E7EB", "#E5E7EB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaBtn}
          >
            <Text style={[styles.ctaText, { color: selectedId ? "#fff" : TEXT_MUTED }]}>
              Continue
            </Text>
            <Feather name="arrow-right" size={20} color={selectedId ? "#fff" : TEXT_MUTED} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: "500",
    marginTop: 1,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fff",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 11,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  helpText: { fontSize: 11, fontWeight: "700", color: PINK },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingBottom: 10,
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
  progressLineEmpty: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    marginHorizontal: -2,
  },

  // Count label
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 8,
  },
  countText: { fontSize: 11, color: TEXT_MUTED, fontWeight: "600", flex: 1 },
  countPill: {
    backgroundColor: PINK + "18",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  countPillText: { fontSize: 10, color: PINK, fontWeight: "700" },

  // Grid
  scroll:  { paddingHorizontal: 14, paddingTop: 2, gap: 10 },
  row:     { flexDirection: "row" },

  // Card outer
  cardWrap: {
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardGlow: {
    position: "absolute",
    inset: -3,
    borderRadius: 19,
    shadowColor: PINK,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 0,
  },
  cardTouchable: {
    borderRadius: 16,
    overflow: "hidden",
  },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
  },
  cardSelected: {
    borderColor: PINK,
    borderWidth: 2,
  },

  // Image zone — white bg, responsive height
  imageZone: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  vehicleImage: {
    width: "100%",
    height: "100%",
  },

  // Emoji fallback — centered in imageZone
  emojiWrap: {
    width: "72%",
    aspectRatio: 1,
    borderRadius: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: 36 },

  // Badge
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    zIndex: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.2 },

  // Check circle
  checkCircle: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
    shadowColor: PINK,
    shadowOpacity: 0.4,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },

  // Text zone
  textZone: {
    paddingHorizontal: 8,
    paddingTop: 7,
    paddingBottom: 8,
    gap: 4,
  },
  cardName: {
    fontSize: 12,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.07)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  metaRowSelected: {
    backgroundColor: "rgba(255,77,141,0.09)",
    borderColor: "rgba(255,77,141,0.22)",
  },
  metaCapacity: {
    fontSize: 9,
    fontWeight: "600",
    color: TEXT_MUTED,
    flex: 1,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#D1D5DB",
  },
  metaPrice: {
    fontSize: 10,
    fontWeight: "800",
    color: ORANGE,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    backgroundColor: "rgba(255,248,252,0.97)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: BORDER,
    shadowColor: PINK,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } }),
  },

  // Summary card
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryThumbWrap: {
    width: 54,
    height: 40,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#FFF0F6",
  },
  summaryThumb: { width: "100%", height: "100%" },
  summaryEmojiWrap: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryEmoji: { fontSize: 22 },
  summaryThumbPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: { fontSize: 10, color: TEXT_MUTED, fontWeight: "500" },
  summaryName:  { fontSize: 15, fontWeight: "800", color: TEXT_PRIMARY, marginTop: 1 },
  summaryPriceWrap: { alignItems: "flex-end" },
  summaryPrice: { fontSize: 16, fontWeight: "800", color: PINK },
  summaryCapacity: { fontSize: 10, color: TEXT_MUTED, fontWeight: "500" },

  // CTA
  ctaTouchable: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: PINK,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  ctaBtn: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
  },
  ctaText: { fontSize: 17, fontWeight: "800", letterSpacing: 0.2 },
});
