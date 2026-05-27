import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

type VehicleOption = {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  pillLabel: string;
  badge?: string;
};

const VEHICLES: VehicleOption[] = [
  {
    id: "bike",
    name: "Bike",
    tagline: "Quick, agile rides",
    icon: "wind",
    pillLabel: "₹6/km",
    badge: "Popular",
  },
  {
    id: "auto",
    name: "Auto",
    tagline: "3-seater, in-city",
    icon: "truck",
    pillLabel: "₹10/km",
  },
  {
    id: "mini",
    name: "Mini Car",
    tagline: "Compact, economy",
    icon: "navigation",
    pillLabel: "₹14/km",
  },
  {
    id: "sedan",
    name: "Sedan",
    tagline: "Premium comfort",
    icon: "star",
    pillLabel: "₹18/km",
  },
  {
    id: "ev",
    name: "EV",
    tagline: "Electric, eco",
    icon: "zap",
    pillLabel: "₹12/km",
    badge: "New",
  },
  {
    id: "truck",
    name: "Truck",
    tagline: "Goods delivery",
    icon: "package",
    pillLabel: "₹22/km",
  },
];

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
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(selected);

  useEffect(() => {
    if (selected && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.04,
          friction: 4,
          tension: 220,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prev.current = selected;
  }, [selected]);

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        <View
          style={[
            styles.card,
            {
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? "#f0fdf4" : "#fff",
              borderWidth: selected ? 2 : 1.5,
              shadowOpacity: selected ? 0.18 : 0.05,
              shadowColor: selected ? colors.primary : "#000",
              shadowRadius: selected ? 14 : 6,
              shadowOffset: { width: 0, height: selected ? 6 : 2 },
            },
          ]}
        >
          {vehicle.badge && (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: selected ? colors.primary : "#ffe082",
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: selected ? "#fff" : "#7a5c00" },
                ]}
              >
                {vehicle.badge}
              </Text>
            </View>
          )}

          {selected && (
            <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
              <Feather name="check" size={12} color="#fff" />
            </View>
          )}

          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: selected
                  ? "rgba(0, 200, 83, 0.15)"
                  : colors.muted,
                borderColor: selected ? colors.primary : "transparent",
              },
            ]}
          >
            <Feather
              name={vehicle.icon as any}
              size={28}
              color={selected ? colors.primary : "#555"}
            />
          </View>

          <Text
            style={[
              styles.cardName,
              { color: selected ? colors.primary : "#0a0a0a" },
            ]}
          >
            {vehicle.name}
          </Text>
          <Text
            style={[
              styles.cardTagline,
              { color: colors.mutedForeground },
            ]}
          >
            {vehicle.tagline}
          </Text>

          <View
            style={[
              styles.pricePill,
              {
                backgroundColor: selected ? colors.primary : "#f5f5f5",
              },
            ]}
          >
            <Text
              style={[
                styles.pricePillText,
                { color: selected ? "#fff" : "#333" },
              ]}
            >
              {vehicle.pillLabel}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function VehicleSelectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setVehicle } = useDriver();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVehicle = VEHICLES.find((v) => v.id === selectedId);

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
    <View style={[styles.root, { backgroundColor: "#fff" }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: "#f5f5f5" }]}
          >
            <Feather name="arrow-left" size={19} color="#0a0a0a" />
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Text style={styles.headerLabel}>Choose Vehicle</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Step 2 of 3
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.stepBar}>
          <View style={[styles.stepSegment, { backgroundColor: colors.primary }]} />
          <View style={[styles.stepSegment, { backgroundColor: colors.primary }]} />
          <View style={[styles.stepSegment, { backgroundColor: colors.border }]} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>What do you drive?</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Pick your vehicle category to start receiving matching ride requests.
          </Text>
        </View>

        <View style={styles.grid}>
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
        </View>

        <View
          style={[
            styles.helpBox,
            { backgroundColor: "#f8fafc", borderColor: colors.border },
          ]}
        >
          <Feather name="help-circle" size={15} color={colors.mutedForeground} />
          <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
            You can add more vehicles later from your profile settings.
          </Text>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
          },
        ]}
      >
        {selectedVehicle ? (
          <View style={styles.selectionRow}>
            <View
              style={[
                styles.selectionIcon,
                { backgroundColor: "rgba(0, 200, 83, 0.12)" },
              ]}
            >
              <Feather
                name={selectedVehicle.icon as any}
                size={16}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.selectionLabel, { color: colors.mutedForeground }]}>
                Selected
              </Text>
              <Text style={[styles.selectionName, { color: colors.foreground }]}>
                {selectedVehicle.name}
              </Text>
            </View>
            <Text style={[styles.selectionPrice, { color: colors.primary }]}>
              {selectedVehicle.pillLabel}
            </Text>
          </View>
        ) : (
          <View style={styles.hintRow}>
            <Feather name="info" size={13} color={colors.mutedForeground} />
            <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
              Tap a vehicle to continue
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.continueBtn,
            { backgroundColor: selectedId ? colors.primary : colors.muted },
          ]}
          onPress={handleContinue}
          activeOpacity={0.85}
          disabled={!selectedId}
        >
          <Text
            style={[
              styles.continueBtnText,
              { color: selectedId ? "#fff" : colors.mutedForeground },
            ]}
          >
            Continue
          </Text>
          <Feather
            name="arrow-right"
            size={18}
            color={selectedId ? "#fff" : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { alignItems: "center" },
  headerLabel: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
  headerSub: { fontSize: 12 },
  stepBar: {
    flexDirection: "row",
    gap: 5,
    height: 4,
  },
  stepSegment: { flex: 1, height: 4, borderRadius: 2 },

  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 18 },
  heroSection: { paddingHorizontal: 4, gap: 6 },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0a0a0a",
    letterSpacing: -0.3,
  },
  heroSub: {
    fontSize: 14,
    lineHeight: 20,
  },

  grid: { gap: 12 },
  row: { flexDirection: "row", gap: 12 },

  card: {
    borderRadius: 18,
    padding: 16,
    gap: 8,
    alignItems: "flex-start",
    position: "relative",
    elevation: 2,
    minHeight: 168,
  },
  badge: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    zIndex: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  checkBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 2,
    borderWidth: 1.5,
  },
  cardName: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  cardTagline: {
    fontSize: 12,
    fontWeight: "500",
  },
  pricePill: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
  },
  pricePillText: { fontSize: 12, fontWeight: "700" },

  helpBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  helpText: { fontSize: 12, flex: 1 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 12,
    backgroundColor: "#fff",
  },
  selectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
  },
  selectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.4 },
  selectionName: { fontSize: 15, fontWeight: "700" },
  selectionPrice: { fontSize: 15, fontWeight: "800" },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  hintText: { fontSize: 13 },
  continueBtn: {
    height: 56,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: { fontSize: 17, fontWeight: "700" },
});
