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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";

// ─── Brand tokens ──────────────────────────────────────────────
const PINK = "#FF4D8D";
const ORANGE = "#FF7A3D";
const TEXT_PRIMARY = "#111111";
const TEXT_MUTED = "#6B7280";
const BORDER = "#F0E6EC";

// ─── Vehicle image sources (cropped from reference) ─────────────
const IMAGES: Record<string, ImageSourcePropType> = {
  bike:  require("../assets/vehicles/bike.png"),
  auto:  require("../assets/vehicles/auto.png"),
  mini:  require("../assets/vehicles/mini.png"),
  sedan: require("../assets/vehicles/sedan.png"),
  ev:    require("../assets/vehicles/ev.png"),
  truck: require("../assets/vehicles/truck.png"),
};

type VehicleOption = {
  id: string;
  name: string;
  tagline: string;
  cardBg: [string, string];
  seatLabel: string;
  seatIcon: "user" | "users" | "package";
  price: string;
  badge?: { text: string; bg: string; fg: string };
};

const VEHICLES: VehicleOption[] = [
  {
    id: "bike",
    name: "Bike",
    tagline: "Quick, agile rides",
    cardBg: ["#F5F3FF", "#FAF5FF"],
    seatLabel: "1 Seat",
    seatIcon: "user",
    price: "₹6/km",
    badge: { text: "⭐ Popular", bg: "#A855F7", fg: "#fff" },
  },
  {
    id: "auto",
    name: "Auto",
    tagline: "3-seater, in-city",
    cardBg: ["#FFFBEB", "#FEFCE8"],
    seatLabel: "3 Seats",
    seatIcon: "users",
    price: "₹10/km",
  },
  {
    id: "mini",
    name: "Mini Car",
    tagline: "Compact, economy",
    cardBg: ["#EFF6FF", "#F0F9FF"],
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹14/km",
  },
  {
    id: "sedan",
    name: "Sedan",
    tagline: "Premium comfort",
    cardBg: ["#FDF2F8", "#FFF0F6"],
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹18/km",
  },
  {
    id: "ev",
    name: "EV",
    tagline: "Electric, eco-friendly",
    cardBg: ["#ECFDF5", "#F0FFF8"],
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹12/km",
    badge: { text: "⚡ New", bg: "#10B981", fg: "#fff" },
  },
  {
    id: "truck",
    name: "Truck",
    tagline: "Goods delivery",
    cardBg: ["#F1F5F9", "#F8FAFC"],
    seatLabel: "Up to 8 Ton",
    seatIcon: "package",
    price: "₹22/km",
  },
];

// ─── Vehicle Card ───────────────────────────────────────────────
function VehicleCard({
  vehicle,
  selected,
  onPress,
}: {
  vehicle: VehicleOption;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;
  const prev  = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.parallel([
        Animated.sequence([
          Animated.spring(scale, {
            toValue: 1.05,
            friction: 4,
            tension: 260,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            friction: 5,
            tension: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(glow, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
    if (!selected && prev.current) {
      Animated.timing(glow, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }
    prev.current = selected;
  }, [selected]);

  return (
    <Animated.View style={[styles.cardWrap, { transform: [{ scale }] }]}>
      {/* Pink glow bloom behind selected card */}
      <Animated.View
        style={[styles.cardGlow, { opacity: glow }]}
        pointerEvents="none"
      />

      <TouchableOpacity
        activeOpacity={0.88}
        onPress={onPress}
        style={styles.cardTouchable}
      >
        {selected ? (
          <LinearGradient
            colors={["#FFF0F6", "#FDF2F8"]}
            style={[styles.card, styles.cardSelected]}
          >
            <CardContent vehicle={vehicle} selected={selected} />
          </LinearGradient>
        ) : (
          <LinearGradient colors={vehicle.cardBg} style={styles.card}>
            <CardContent vehicle={vehicle} selected={selected} />
          </LinearGradient>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function CardContent({
  vehicle,
  selected,
}: {
  vehicle: VehicleOption;
  selected: boolean;
}) {
  return (
    <>
      {/* Badge top-left */}
      {vehicle.badge && (
        <View style={[styles.badge, { backgroundColor: vehicle.badge.bg }]}>
          <Text style={[styles.badgeText, { color: vehicle.badge.fg }]}>
            {vehicle.badge.text}
          </Text>
        </View>
      )}

      {/* Check circle top-right */}
      {selected && (
        <LinearGradient
          colors={[PINK, ORANGE]}
          style={styles.checkCircle}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Feather name="check" size={11} color="#fff" />
        </LinearGradient>
      )}

      {/* Reference vehicle image */}
      <View style={styles.imageWrap}>
        <Image
          source={IMAGES[vehicle.id]}
          style={styles.vehicleImage}
          resizeMode="cover"
        />
      </View>

      {/* Name + tagline */}
      <Text style={styles.cardName}>{vehicle.name}</Text>
      <Text style={styles.cardTagline}>{vehicle.tagline}</Text>

      {/* Info row */}
      <View
        style={[
          styles.infoRow,
          {
            backgroundColor: selected
              ? "rgba(255,77,141,0.08)"
              : "rgba(255,255,255,0.7)",
            borderColor: selected
              ? "rgba(255,77,141,0.2)"
              : "rgba(0,0,0,0.06)",
          },
        ]}
      >
        <Feather
          name={vehicle.seatIcon}
          size={11}
          color={selected ? PINK : TEXT_MUTED}
        />
        <Text
          style={[styles.infoText, { color: selected ? PINK : TEXT_MUTED }]}
        >
          {vehicle.seatLabel}
        </Text>
        <View style={styles.infoDivider} />
        <Text style={[styles.priceText, { color: selected ? PINK : ORANGE }]}>
          {vehicle.price}
        </Text>
      </View>
    </>
  );
}

// ─── Progress Step Dot ──────────────────────────────────────────
function StepDot({ filled }: { filled: boolean }) {
  return (
    <View
      style={[
        styles.stepDot,
        filled
          ? { backgroundColor: PINK }
          : { backgroundColor: "#E5E7EB", borderWidth: 2, borderColor: "#D1D5DB" },
      ]}
    >
      {filled && <Feather name="check" size={9} color="#fff" />}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────
export default function VehicleSelectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setVehicle } = useDriver();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId) ?? null;

  function handleContinue() {
    if (!selectedId || !selectedVehicle) return;
    setVehicle({ id: selectedVehicle.id, name: selectedVehicle.name });
    router.push({
      pathname: "/profile-setup",
      params: { vehicle: selectedId },
    });
  }

  const rows: VehicleOption[][] = [];
  for (let i = 0; i < VEHICLES.length; i += 2) {
    rows.push(VEHICLES.slice(i, i + 2));
  }

  return (
    <LinearGradient
      colors={["#FFF5F8", "#FFFAF5", "#FFF8FC"]}
      style={styles.root}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={TEXT_PRIMARY} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Choose Vehicle 🚗</Text>
          <Text style={styles.headerSub}>Step 2 of 3</Text>
        </View>

        <TouchableOpacity style={styles.helpBtn} activeOpacity={0.7}>
          <Feather name="help-circle" size={15} color={PINK} />
          <Text style={styles.helpText}>Help</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ── */}
      <View style={styles.progressRow}>
        <StepDot filled />
        <LinearGradient
          colors={[PINK, ORANGE]}
          style={styles.progressLine}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        />
        <StepDot filled />
        <View style={styles.progressLineEmpty} />
        <StepDot filled={false} />
      </View>

      {/* ── Scrollable grid ── */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 184 },
        ]}
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
            {row.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {/* Selection summary */}
        <View style={styles.summaryCard}>
          {/* Thumbnail of selected vehicle */}
          <View style={styles.summaryThumbWrap}>
            {selectedVehicle ? (
              <Image
                source={IMAGES[selectedVehicle.id]}
                style={styles.summaryThumb}
                resizeMode="cover"
              />
            ) : (
              <LinearGradient
                colors={[PINK + "30", ORANGE + "18"]}
                style={styles.summaryThumbPlaceholder}
              >
                <Feather name="truck" size={20} color={PINK} />
              </LinearGradient>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.summaryLabel}>
              {selectedVehicle ? "You have selected" : "No vehicle selected"}
            </Text>
            {selectedVehicle && (
              <Text style={styles.summaryName}>{selectedVehicle.name}</Text>
            )}
          </View>

          {selectedVehicle && (
            <Text style={styles.summaryPrice}>{selectedVehicle.price}</Text>
          )}
        </View>

        {/* Continue button */}
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
            <Text
              style={[
                styles.ctaText,
                { color: selectedId ? "#fff" : TEXT_MUTED },
              ]}
            >
              Continue
            </Text>
            <Feather
              name="arrow-right"
              size={20}
              color={selectedId ? "#fff" : TEXT_MUTED}
            />
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
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#fff",
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
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: "500",
    marginTop: 1,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  helpText: { fontSize: 12, fontWeight: "700", color: PINK },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 14,
    paddingTop: 4,
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
  progressLineEmpty: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    marginHorizontal: -2,
  },

  // Grid
  scroll: { paddingHorizontal: 14, paddingTop: 4, gap: 12 },
  row:    { flexDirection: "row", gap: 12 },

  // Card outer
  cardWrap: {
    flex: 1,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardGlow: {
    position: "absolute",
    inset: -3,
    borderRadius: 23,
    shadowColor: PINK,
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  cardTouchable: {
    borderRadius: 20,
    overflow: "hidden",
  },
  card: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 5,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
  },
  cardSelected: {
    borderColor: PINK,
    borderWidth: 2,
  },

  // Badge
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },

  // Check circle
  checkCircle: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: PINK,
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  // Vehicle image area
  imageWrap: {
    width: "100%",
    height: 100,
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  },
  vehicleImage: {
    width: "100%",
    height: "100%",
  },

  // Card text
  cardName: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  cardTagline: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: "500",
    marginTop: -2,
  },

  // Info row
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  infoText:    { fontSize: 11, fontWeight: "600", flex: 1 },
  infoDivider: { width: 1, height: 10, backgroundColor: "#E5E7EB" },
  priceText:   { fontSize: 12, fontWeight: "800" },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
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
    ...Platform.select({
      web: { backdropFilter: "blur(12px)" },
    }),
  },

  // Summary card
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
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
    width: 58,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#FFF0F6",
  },
  summaryThumb: {
    width: "100%",
    height: "100%",
  },
  summaryThumbPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: "500" },
  summaryName: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    marginTop: 1,
  },
  summaryPrice: {
    fontSize: 18,
    fontWeight: "800",
    color: PINK,
  },

  // CTA
  ctaTouchable: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: PINK,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  ctaBtn: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
  },
  ctaText: { fontSize: 18, fontWeight: "800", letterSpacing: 0.2 },
});
