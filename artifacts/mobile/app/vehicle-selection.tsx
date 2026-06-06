import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { callSupport } from "@/utils/support";
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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

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
  tagline: string;
  seatLabel: string;
  seatIcon: "user" | "users" | "package";
  price: string;
  badge?: string;      // display text only — colors come from tokens
  imageKey?: string;
  emoji?: string;
};

const VEHICLES: VehicleOption[] = [
  {
    id: "bike",
    name: "Bike",
    tagline: "Quick, agile rides",
    seatLabel: "1 Seat",
    seatIcon: "user",
    price: "₹6/km",
    badge: "⭐ Popular",
    imageKey: "bike",
  },
  {
    id: "auto",
    name: "Auto",
    tagline: "3-seater, in-city",
    seatLabel: "3 Seats",
    seatIcon: "users",
    price: "₹10/km",
    imageKey: "auto",
  },
  {
    id: "mini",
    name: "Mini Car",
    tagline: "Compact, economy",
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹14/km",
    imageKey: "mini",
  },
  {
    id: "sedan",
    name: "Sedan",
    tagline: "Premium comfort",
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹18/km",
    imageKey: "sedan",
  },
  {
    id: "ev",
    name: "EV",
    tagline: "Electric, eco-friendly",
    seatLabel: "4 Seats",
    seatIcon: "users",
    price: "₹12/km",
    badge: "⚡ New",
    imageKey: "ev",
  },
  {
    id: "truck",
    name: "Truck",
    tagline: "Goods delivery",
    seatLabel: "Up to 8 Ton",
    seatIcon: "package",
    price: "₹22/km",
    imageKey: "truck",
  },
  {
    id: "scooter",
    name: "Scooter",
    tagline: "Zippy city rides",
    seatLabel: "1 Seat",
    seatIcon: "user",
    price: "₹7/km",
    emoji: "🛵",
  },
  {
    id: "suv",
    name: "SUV",
    tagline: "Spacious, comfortable",
    seatLabel: "6 Seats",
    seatIcon: "users",
    price: "₹22/km",
    emoji: "🚙",
  },
  {
    id: "pickup",
    name: "Pickup",
    tagline: "Light freight",
    seatLabel: "500 kg",
    seatIcon: "package",
    price: "₹20/km",
    emoji: "🛻",
  },
  {
    id: "mini-truck",
    name: "Mini Truck",
    tagline: "Urban freight",
    seatLabel: "1 Ton",
    seatIcon: "package",
    price: "₹25/km",
    emoji: "🚚",
  },
];

// ─── Per-vehicle token family ────────────────────────────────────
// Bike/scooter = primary/info (two-wheelers)
// Auto/pickup/mini-truck = warning (loaders)
// Mini/sedan/suv = navigation/pending (four-wheelers)
// EV = success (eco)
// Truck = pending (heavy)

type VehicleAccent = { accent: string; soft: string };

function useVehicleAccent(id: string): VehicleAccent {
  const colors = useColors();
  switch (id) {
    case "bike":       return { accent: colors.primary,    soft: colors.primarySoft };
    case "scooter":    return { accent: colors.info,       soft: colors.infoSoft };
    case "ev":         return { accent: colors.success,    soft: colors.successSoft };
    case "auto":       return { accent: colors.warning,    soft: colors.warningSoft };
    case "pickup":     return { accent: colors.warning,    soft: colors.warningSoft };
    case "mini-truck": return { accent: colors.warning,    soft: colors.warningSoft };
    case "mini":       return { accent: colors.navigation, soft: colors.navigationSoft };
    case "sedan":      return { accent: colors.pending,    soft: colors.pendingSoft };
    case "suv":        return { accent: colors.pending,    soft: colors.pendingSoft };
    case "truck":      return { accent: colors.pending,    soft: colors.pendingSoft };
    default:           return { accent: colors.primary,    soft: colors.primarySoft };
  }
}

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
  const colors = useColors();
  const { accent, soft } = useVehicleAccent(vehicle.id);

  const scale = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;
  const prev  = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.parallel([
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.04, friction: 4, tension: 260, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1,    friction: 5, tension: 200, useNativeDriver: true }),
        ]),
        Animated.timing(glow, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    }
    if (!selected && prev.current) {
      Animated.timing(glow, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
    prev.current = selected;
  }, [selected]);

  // Emoji circle / thumb bg per vehicle family
  const emojiBg = (() => {
    switch (vehicle.id) {
      case "scooter":    return colors.infoSoft;
      case "suv":        return colors.pendingSoft;
      case "pickup":     return colors.successSoft;
      case "mini-truck": return colors.warningSoft;
      default:           return colors.muted;
    }
  })();

  // Badge bg per vehicle (Popular → primary, New → success)
  const badgeBg = vehicle.badge?.includes("Popular")
    ? colors.primary
    : vehicle.badge?.includes("New")
    ? colors.success
    : colors.primary;

  return (
    <Animated.View
      style={[
        styles.cardWrap,
        {
          shadowColor:   selected ? accent : "#000",
          shadowOpacity: selected ? 0.22   : 0.08,
          shadowRadius:  selected ? 18     : 10,
          shadowOffset:  { width: 0, height: selected ? 7 : 3 },
          elevation:     selected ? 10     : 4,
          transform: [{ scale }],
        },
      ]}
    >
      {/* Glow layer — animates in when card is selected */}
      <Animated.View
        style={[styles.cardGlow, { opacity: glow, shadowColor: accent }]}
        pointerEvents="none"
      />

      <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.cardTouchable}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: selected ? soft              : colors.surfaceElevated,
              borderColor:     selected ? accent            : colors.border,
              borderWidth:     selected ? 2                 : 1.5,
            },
          ]}
        >
          {/* ── IMAGE ZONE ── */}
          <View style={[styles.imageZone, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            {vehicle.imageKey ? (
              <Image
                source={IMAGES[vehicle.imageKey]}
                style={styles.vehicleImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.emojiCircle, { backgroundColor: emojiBg }]}>
                <Text style={styles.emojiText}>{vehicle.emoji}</Text>
              </View>
            )}

            {vehicle.badge && (
              <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                <Text style={styles.badgeText}>{vehicle.badge}</Text>
              </View>
            )}

            {selected && (
              <View style={[styles.checkCircle, { backgroundColor: accent, shadowColor: accent }]}>
                <Feather name="check" size={11} color="#fff" />
              </View>
            )}
          </View>

          {/* ── TEXT ZONE ── */}
          <View style={styles.textZone}>
            <Text style={[styles.cardName, { color: selected ? accent : colors.foreground }]} numberOfLines={1}>
              {vehicle.name}
            </Text>
            <Text style={[styles.cardTagline, { color: colors.mutedForeground }]} numberOfLines={1}>
              {vehicle.tagline}
            </Text>

            <View style={[
              styles.infoRow,
              {
                backgroundColor: selected ? soft            : colors.surface,
                borderColor:     selected ? accent          : colors.border,
              },
            ]}>
              <Feather name={vehicle.seatIcon} size={11} color={selected ? accent : colors.mutedForeground} />
              <Text
                style={[styles.infoText, { color: selected ? accent : colors.mutedForeground }]}
                numberOfLines={1}
              >
                {vehicle.seatLabel}
              </Text>
              <View style={[styles.infoDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.priceText, { color: selected ? accent : colors.textSecondary }]}>
                {vehicle.price}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Progress Step Dot ──────────────────────────────────────────
function StepDot({ filled }: { filled: boolean }) {
  const colors = useColors();
  return (
    <View style={[
      styles.stepDot,
      filled
        ? { backgroundColor: colors.primary }
        : { backgroundColor: colors.border, borderWidth: 2, borderColor: colors.borderStrong },
    ]}>
      {filled && <Feather name="check" size={9} color="#fff" />}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────
export default function VehicleSelectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setVehicle } = useDriver();
  const { width: screenW } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId) ?? null;

  // 2-column responsive card width
  const H_PAD    = 14;
  const COL_GAP  = 12;
  const cardWidth = Math.floor((screenW - H_PAD * 2 - COL_GAP) / 2);

  const rows: VehicleOption[][] = [];
  for (let i = 0; i < VEHICLES.length; i += 2) {
    rows.push(VEHICLES.slice(i, i + 2));
  }

  function handleContinue() {
    if (!selectedId || !selectedVehicle) return;
    setVehicle({ id: selectedVehicle.id, name: selectedVehicle.name });
    router.push({ pathname: "/profile-setup", params: { vehicle: selectedId } });
  }

  // Summary thumb placeholder bg for when no vehicle selected yet
  const summaryThumbBg = selectedVehicle
    ? (() => {
        switch (selectedVehicle.id) {
          case "scooter":    return colors.infoSoft;
          case "suv":        return colors.pendingSoft;
          case "pickup":     return colors.successSoft;
          case "mini-truck": return colors.warningSoft;
          default:           return colors.primarySoft;
        }
      })()
    : colors.primarySoft;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Choose Vehicle 🚗</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Step 2 of 3</Text>
        </View>

        <TouchableOpacity
          style={[styles.helpBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <Feather name="help-circle" size={15} color={colors.primary} />
          <Text style={[styles.helpText, { color: colors.primary }]}>Help</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ── */}
      <View style={styles.progressRow}>
        <StepDot filled />
        <View style={[styles.progressLine, { backgroundColor: colors.primary }]} />
        <StepDot filled />
        <View style={[styles.progressLineEmpty, { backgroundColor: colors.border }]} />
        <StepDot filled={false} />
      </View>

      {/* ── Scrollable 2-col grid ── */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 178 }]}
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
            {/* spacer so an odd last card stays left-aligned at correct width */}
            {row.length === 1 && <View style={{ width: cardWidth }} />}
          </View>
        ))}
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 14,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            shadowColor: selectedId ? colors.primary : "#000",
          },
        ]}
      >
        {/* Selection summary */}
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.summaryThumbWrap, { backgroundColor: summaryThumbBg }]}>
            {selectedVehicle?.imageKey ? (
              <Image
                source={IMAGES[selectedVehicle.imageKey]}
                style={styles.summaryThumb}
                resizeMode="contain"
              />
            ) : selectedVehicle?.emoji ? (
              <View style={styles.summaryEmojiWrap}>
                <Text style={styles.summaryEmoji}>{selectedVehicle.emoji}</Text>
              </View>
            ) : (
              <View style={[styles.summaryThumbPlaceholder, { backgroundColor: colors.primarySoft }]}>
                <Feather name="truck" size={20} color={colors.primary} />
              </View>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              {selectedVehicle ? "You have selected" : "No vehicle selected"}
            </Text>
            {selectedVehicle && (
              <Text style={[styles.summaryName, { color: colors.foreground }]}>
                {selectedVehicle.name}
              </Text>
            )}
          </View>

          {selectedVehicle && (
            <Text style={[styles.summaryPrice, { color: colors.primary }]}>
              {selectedVehicle.price}
            </Text>
          )}
        </View>

        {/* Continue button */}
        <TouchableOpacity
          activeOpacity={selectedId ? 0.82 : 1}
          onPress={handleContinue}
          disabled={!selectedId}
          style={[
            styles.ctaTouchable,
            {
              shadowColor:   selectedId ? colors.primary : "transparent",
              shadowOpacity: selectedId ? 0.35 : 0,
            },
          ]}
        >
          <View
            style={[
              styles.ctaBtn,
              { backgroundColor: selectedId ? colors.primary : colors.muted },
            ]}
          >
            <Text style={[styles.ctaText, { color: selectedId ? "#fff" : colors.mutedForeground }]}>
              Continue
            </Text>
            <Feather
              name="arrow-right"
              size={20}
              color={selectedId ? "#fff" : colors.mutedForeground}
            />
          </View>
        </TouchableOpacity>
      </View>
    </View>
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
    borderWidth: 1,
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
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 1,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  helpText: { fontSize: 12, fontWeight: "700" },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 12,
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
  progressLineEmpty: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginHorizontal: -2,
  },

  // Grid — 2 columns
  scroll: { paddingHorizontal: 14, paddingTop: 4, gap: 12 },
  row:    { flexDirection: "row", gap: 12 },

  // Card outer — flex:1 so both columns are equal width
  cardWrap: {
    flex: 1,
    borderRadius: 20,
  },
  // Glow layer — shadowColor injected inline per-vehicle accent
  cardGlow: {
    position: "absolute",
    inset: -3,
    borderRadius: 23,
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  cardTouchable: {
    borderRadius: 20,
    overflow: "hidden",
    flex: 1,
    alignSelf: "stretch",
  },
  // Card bg/border/borderWidth all injected inline
  card: {
    borderRadius: 20,
    overflow: "hidden",
    flex: 1,
  },

  // IMAGE ZONE — bg + border injected inline
  imageZone: {
    width: "100%",
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderBottomWidth: 1,
  },
  vehicleImage: {
    width: "100%",
    height: "100%",
  },

  // Emoji fallback — large centered circle
  emojiCircle: {
    width: "62%",
    aspectRatio: 1,
    borderRadius: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: 44 },

  // Badge — top-left inside imageZone
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2, color: "#fff" },

  // Check circle — top-right inside imageZone, bg+shadow injected inline
  checkCircle: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  // TEXT ZONE
  textZone: {
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 11,
    gap: 4,
  },
  cardName:    { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  cardTagline: { fontSize: 11, fontWeight: "500" },
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
  infoText:    { fontSize: 10, fontWeight: "600", flex: 1 },
  infoDivider: { width: 1, height: 10 },
  priceText:   { fontSize: 11, fontWeight: "800" },

  // Footer — bg+border injected inline
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    shadowOpacity: 0.10,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } }),
  },

  // Summary card — bg+border injected inline
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
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
  },
  summaryThumb:            { width: "100%", height: "100%" },
  summaryEmojiWrap:        { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  summaryEmoji:            { fontSize: 24 },
  summaryThumbPlaceholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  summaryLabel: { fontSize: 11, fontWeight: "500" },
  summaryName:  { fontSize: 16, fontWeight: "800", marginTop: 1 },
  summaryPrice: { fontSize: 18, fontWeight: "800" },

  // CTA — bg injected inline; shadowColor injected inline
  ctaTouchable: {
    borderRadius: 16,
    overflow: "hidden",
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
