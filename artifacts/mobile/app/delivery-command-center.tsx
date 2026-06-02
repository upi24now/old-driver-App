import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver, type ActiveRide } from "@/contexts/DriverContext";

// ─── Status display metadata ──────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  accepted:  { label: "Accepted",  color: "#22C55E", bg: "#22C55E1A" },
  to_pickup: { label: "To Pickup", color: "#F97316", bg: "#F973161A" },
  at_pickup: { label: "At Pickup", color: "#EAB308", bg: "#EAB3081A" },
  to_drop:   { label: "En Route",  color: "#3B82F6", bg: "#3B82F61A" },
  at_drop:   { label: "At Drop",   color: "#A855F7", bg: "#A855F71A" },
  delivered: { label: "Delivered", color: "#22C55E", bg: "#22C55E1A" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, color: "#94A3B8", bg: "#94A3B81A" };
}

// ─── Route param builder (mirrors the index.tsx banner exactly) ───────────────
function rideToParams(ride: ActiveRide) {
  return {
    orderId:         ride.id,
    customer:        ride.passengerName,
    phone:           ride.customerPhone,
    parcelType:      ride.parcelType,
    parcelEmoji:     ride.parcelEmoji,
    pickup:          ride.pickup,
    pickupCity:      ride.pickupCity      ?? "",
    drop:            ride.drop,
    dropCity:        ride.dropCity        ?? "",
    distanceKm:      String(ride.distanceKm),
    durationMin:     String(ride.durationMin),
    earning:         String(ride.fareEstimate),
    weight:          ride.parcelWeight,
    paymentMode:     ride.paymentMode,
    surge:           String(ride.surge           ?? false),
    surgeMultiplier: String(ride.surgeMultiplier ?? 1),
  };
}

// ─── Detail cell component ────────────────────────────────────────────────────
function DetailCell({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailCell}>
      <Feather name={icon} size={14} color="#64748B" />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function DeliveryCommandCenter() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activeOrders,
    currentActiveOrderId,
    activeRide,
    activeOrderCount,
    maxActiveOrders,
    hasCapacity,
  } = useDriver();

  // Focused order: the currently highlighted one (backward-compat shim covers this)
  const focused: ActiveRide | null = activeRide;

  function handleContinue() {
    if (!focused) return;
    router.push({ pathname: "/active-delivery", params: rideToParams(focused) });
  }

  const remainingSlots = maxActiveOrders - activeOrderCount;

  return (
    <LinearGradient colors={["#0D0D18", "#1A1435"]} style={styles.root}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color="#CBD5E1" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Command Center</Text>
          <Text style={styles.headerSub}>Delivery Management</Text>
        </View>

        <View style={styles.countBadge}>
          <Text style={styles.countBadgeNum}>{activeOrderCount}</Text>
          <Text style={styles.countBadgeSep}>/</Text>
          <Text style={styles.countBadgeMax}>{maxActiveOrders}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Capacity Chips ──────────────────────────────────────────────── */}
        <View style={styles.capacityRow}>
          {Array.from({ length: maxActiveOrders }, (_, i) => {
            const occupied = i < activeOrderCount;
            const order    = activeOrders[i];
            const isFocused = order?.id === currentActiveOrderId;
            return (
              <View key={i} style={styles.slotChipWrapper}>
                {occupied ? (
                  <LinearGradient
                    colors={["#FF4D8D", "#FF7A3D"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.slotChip, styles.slotChipFilled]}
                  >
                    <Feather name="package" size={11} color="#fff" />
                    <Text style={styles.slotLabelFilled}>Slot {i + 1}</Text>
                    {isFocused && <View style={styles.focusDot} />}
                  </LinearGradient>
                ) : (
                  <View style={[styles.slotChip, styles.slotChipEmpty]}>
                    <Feather name="plus-circle" size={11} color="#3D4860" />
                    <Text style={styles.slotLabelEmpty}>Slot {i + 1}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Empty State ─────────────────────────────────────────────────── */}
        {activeOrderCount === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconRing}>
              <Feather name="inbox" size={42} color="#334155" />
            </View>
            <Text style={styles.emptyTitle}>No Active Deliveries</Text>
            <Text style={styles.emptySubtitle}>
              Accept an order from the dashboard to see it here.
            </Text>
            <TouchableOpacity
              style={styles.emptyBackBtn}
              activeOpacity={0.8}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={15} color="#94A3B8" />
              <Text style={styles.emptyBackText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 3D Order Stack ──────────────────────────────────────────────── */}
        {focused && (
          <>
            <Text style={styles.sectionLabel}>FOCUSED ORDER</Text>

            {/* Stack container — ghost cards peek from behind the focused card */}
            <View style={styles.stackContainer}>

              {/* Ghost card 3 — furthest back (phase 4: will hold 3rd order) */}
              <View
                pointerEvents="none"
                style={[styles.ghostCard, {
                  bottom: -18,
                  left:   22,
                  right:  22,
                  opacity: 0.22,
                }]}
              />

              {/* Ghost card 2 — one step back (phase 4: will hold 2nd order) */}
              <View
                pointerEvents="none"
                style={[styles.ghostCard, {
                  bottom: -10,
                  left:   12,
                  right:  12,
                  opacity: 0.42,
                }]}
              />

              {/* ── Main focused order card ──────────────────────────────── */}
              <View style={styles.orderCard}>

                {/* Customer + status row */}
                <View style={styles.cardTopRow}>
                  <View style={styles.customerBlock}>
                    <View style={styles.avatarRing}>
                      <Feather name="user" size={17} color="#FF4D8D" />
                    </View>
                    <View style={styles.customerText}>
                      <Text style={styles.customerName}>{focused.passengerName}</Text>
                      <Text style={styles.customerPhone}>{focused.customerPhone}</Text>
                    </View>
                  </View>
                  <View style={[
                    styles.statusChip,
                    { backgroundColor: statusMeta(focused.orderStatus).bg },
                  ]}>
                    <View style={[
                      styles.statusDot,
                      { backgroundColor: statusMeta(focused.orderStatus).color },
                    ]} />
                    <Text style={[
                      styles.statusLabel,
                      { color: statusMeta(focused.orderStatus).color },
                    ]}>
                      {statusMeta(focused.orderStatus).label}
                    </Text>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.divider} />

                {/* Route */}
                <View style={styles.routeSection}>
                  <View style={styles.routeRow}>
                    <View style={styles.routeIconCol}>
                      <View style={[styles.routeDot, styles.routeDotPickup]} />
                      <View style={styles.routeConnector} />
                    </View>
                    <View style={styles.routeTextCol}>
                      <Text style={styles.routeTypeLabel}>PICKUP</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {focused.pickup}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.routeRow}>
                    <View style={styles.routeIconCol}>
                      <View style={[styles.routeDot, styles.routeDotDrop]} />
                    </View>
                    <View style={styles.routeTextCol}>
                      <Text style={styles.routeTypeLabel}>DROP</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {focused.drop}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.divider} />

                {/* Details grid */}
                <View style={styles.detailsGrid}>
                  <DetailCell
                    icon="package"
                    label="Parcel"
                    value={`${focused.parcelEmoji} ${focused.parcelType}`}
                  />
                  <DetailCell
                    icon="disc"
                    label="Weight"
                    value={focused.parcelWeight}
                  />
                  <DetailCell
                    icon="dollar-sign"
                    label="Fare"
                    value={`₹${focused.fareEstimate}`}
                  />
                  <DetailCell
                    icon="credit-card"
                    label="Payment"
                    value={focused.paymentMode}
                  />
                </View>

                {/* CTA */}
                <TouchableOpacity
                  onPress={handleContinue}
                  activeOpacity={0.85}
                  style={styles.ctaWrapper}
                >
                  <LinearGradient
                    colors={["#FF4D8D", "#FF7A3D"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ctaBtn}
                  >
                    <Feather name="navigation" size={17} color="#fff" />
                    <Text style={styles.ctaText}>Continue Delivery</Text>
                    <Feather name="chevron-right" size={17} color="#fff" />
                  </LinearGradient>
                </TouchableOpacity>

              </View>
              {/* end focused card */}

            </View>
            {/* end stack container */}

            {/* Capacity hint — shows upcoming slot availability */}
            {hasCapacity && (
              <View style={styles.capacityHint}>
                <Feather name="info" size={13} color="#3D4860" />
                <Text style={styles.capacityHintText}>
                  {remainingSlots} more slot{remainingSlots !== 1 ? "s" : ""} available — multi-order support coming soon
                </Text>
              </View>
            )}
          </>
        )}

      </ScrollView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection:  "row",
    alignItems:     "flex-end",
    paddingHorizontal: 20,
    paddingBottom:  18,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFFFFF10",
    alignItems:      "center",
    justifyContent:  "center",
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontSize:   20,
    fontWeight: "800",
    color:      "#F1F5F9",
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize:   11,
    fontWeight: "600",
    color:      "#475569",
    marginTop:  2,
    letterSpacing: 0.5,
  },
  countBadge: {
    flexDirection:   "row",
    alignItems:      "baseline",
    backgroundColor: "#FFFFFF0D",
    borderWidth:     1,
    borderColor:     "#FFFFFF14",
    borderRadius:    10,
    paddingHorizontal: 10,
    paddingVertical:  6,
    gap: 3,
  },
  countBadgeNum: { fontSize: 18, fontWeight: "800", color: "#FF7A3D" },
  countBadgeSep: { fontSize: 13, fontWeight: "600", color: "#334155" },
  countBadgeMax: { fontSize: 14, fontWeight: "600", color: "#475569" },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop:        4,
    gap: 16,
  },

  // Capacity chips
  capacityRow: {
    flexDirection: "row",
    gap: 10,
  },
  slotChipWrapper: { flex: 1 },
  slotChip: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    borderRadius:    12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 5,
  },
  slotChipFilled: {
    shadowColor:   "#FF4D8D",
    shadowOpacity: 0.4,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     5,
  },
  slotChipEmpty: {
    backgroundColor: "#131829",
    borderWidth:     1,
    borderColor:     "#1E2640",
    borderStyle:     "dashed",
  },
  slotLabelFilled: { fontSize: 11, fontWeight: "700", color: "#fff" },
  slotLabelEmpty:  { fontSize: 11, fontWeight: "600", color: "#3D4860" },
  focusDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    backgroundColor: "#fff",
    marginLeft:   2,
  },

  // Empty state
  emptyState: {
    alignItems:     "center",
    paddingVertical: 64,
    gap: 12,
  },
  emptyIconRing: {
    width:           88,
    height:          88,
    borderRadius:    44,
    backgroundColor: "#0F1120",
    borderWidth:     1,
    borderColor:     "#1E2640",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    8,
  },
  emptyTitle: {
    fontSize:   18,
    fontWeight: "700",
    color:      "#CBD5E1",
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontSize:  13,
    color:     "#475569",
    textAlign: "center",
    maxWidth:  260,
    lineHeight: 19,
  },
  emptyBackBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             6,
    marginTop:       8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#0F1120",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#1E2640",
  },
  emptyBackText: {
    fontSize:   13,
    fontWeight: "600",
    color:      "#64748B",
  },

  // Section label
  sectionLabel: {
    fontSize:      10,
    fontWeight:    "800",
    color:         "#334155",
    letterSpacing: 1.2,
    marginBottom:  -4,
  },

  // 3D Stack
  stackContainer: {
    position:     "relative",
    marginBottom: 24,   // room for ghost cards to peek below
  },
  ghostCard: {
    position:        "absolute",
    height:          72,
    borderRadius:    20,
    backgroundColor: "#1E1645",
  },
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius:    20,
    padding:         20,
    shadowColor:     "#000",
    shadowOpacity:   0.35,
    shadowRadius:    24,
    shadowOffset:    { width: 0, height: 8 },
    elevation:       16,
    zIndex:          3,
  },

  // Card: top row
  cardTopRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   16,
  },
  customerBlock: {
    flexDirection: "row",
    alignItems:    "center",
    gap: 10,
    flex: 1,
  },
  avatarRing: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: "#FFF0F5",
    borderWidth:     1.5,
    borderColor:     "#FFB3CC",
    alignItems:      "center",
    justifyContent:  "center",
  },
  customerText: { flex: 1 },
  customerName: {
    fontSize:   15,
    fontWeight: "700",
    color:      "#0F172A",
    letterSpacing: -0.2,
  },
  customerPhone: {
    fontSize:  12,
    color:     "#64748B",
    marginTop: 2,
  },
  statusChip: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius:    20,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  statusLabel: {
    fontSize:   11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // Card: divider
  divider: {
    height:          1,
    backgroundColor: "#F1F5F9",
    marginVertical:  14,
  },

  // Card: route
  routeSection:   { gap: 0 },
  routeRow: {
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
  },
  routeIconCol: {
    alignItems: "center",
    width:      18,
    paddingTop: 4,
  },
  routeDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  routeDotPickup: { backgroundColor: "#FF4D8D" },
  routeDotDrop:   { backgroundColor: "#3B82F6" },
  routeConnector: {
    flex:            1,
    width:           2,
    backgroundColor: "#E2E8F0",
    marginVertical:  3,
  },
  routeTextCol:   { flex: 1, paddingBottom: 12 },
  routeTypeLabel: {
    fontSize:      9,
    fontWeight:    "800",
    color:         "#94A3B8",
    letterSpacing: 1.0,
    marginBottom:  3,
  },
  routeAddress: {
    fontSize:   13,
    fontWeight: "600",
    color:      "#1E293B",
    lineHeight: 19,
  },

  // Card: details grid
  detailsGrid: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    gap: 10,
  },
  detailCell: {
    flex:            1,
    minWidth:        "45%",
    backgroundColor: "#F8FAFC",
    borderRadius:    12,
    padding:         10,
    gap: 4,
  },
  detailLabel: {
    fontSize:      9,
    fontWeight:    "700",
    color:         "#94A3B8",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  detailValue: {
    fontSize:   13,
    fontWeight: "700",
    color:      "#0F172A",
  },

  // Card: CTA
  ctaWrapper: {
    marginTop:    16,
    borderRadius: 14,
    overflow:     "hidden",
    shadowColor:  "#FF4D8D",
    shadowOpacity: 0.38,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     8,
  },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             8,
    paddingVertical: 16,
  },
  ctaText: {
    fontSize:      16,
    fontWeight:    "800",
    color:         "#fff",
    letterSpacing: -0.2,
  },

  // Capacity hint
  capacityHint: {
    flexDirection: "row",
    alignItems:    "center",
    justifyContent:"center",
    gap:           6,
    marginTop:     -8,
  },
  capacityHintText: {
    fontSize:  11,
    color:     "#334155",
    fontWeight:"500",
  },
});
