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

// ─── Status metadata ──────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  accepted:  { label: "Accepted",  color: "#22C55E", bg: "#22C55E18", icon: "check-circle" },
  to_pickup: { label: "To Pickup", color: "#F97316", bg: "#F9731618", icon: "navigation"   },
  at_pickup: { label: "At Pickup", color: "#EAB308", bg: "#EAB30818", icon: "map-pin"      },
  to_drop:   { label: "En Route",  color: "#3B82F6", bg: "#3B82F618", icon: "navigation"   },
  at_drop:   { label: "At Drop",   color: "#A855F7", bg: "#A855F718", icon: "map-pin"      },
  delivered: { label: "Delivered", color: "#22C55E", bg: "#22C55E18", icon: "check-circle" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? {
    label: status,
    color: "#94A3B8",
    bg:    "#94A3B818",
    icon:  "circle" as React.ComponentProps<typeof Feather>["name"],
  };
}

// ─── Route param builder — mirrors index.tsx banner exactly ──────────────────
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailCell({
  icon,
  label,
  value,
}: {
  icon:  React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailCell}>
      <View style={styles.detailCellHead}>
        <Feather name={icon} size={10} color="#6366F1" />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SlotChip({
  index,
  occupied,
  isFocused,
  order,
  onPress,
}: {
  index:     number;
  occupied:  boolean;
  isFocused: boolean;
  order?:    ActiveRide;
  onPress?:  () => void;
}) {
  if (occupied) {
    return (
      <TouchableOpacity
        style={styles.slotChip}
        activeOpacity={isFocused ? 1 : 0.78}
        onPress={onPress}
      >
        <LinearGradient
          colors={isFocused ? ["#FF4D8D", "#FF7A3D"] : ["#7C3AED", "#4F46E5"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        >
          <View style={styles.slotChipInner}>
            <View style={styles.slotChipIconWrap}>
              <Feather name="package" size={12} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.slotChipTitle} numberOfLines={1}>
                {order?.passengerName?.split(" ")[0] ?? `Slot ${index + 1}`}
              </Text>
              <Text style={styles.slotChipSubFilled}>
                {isFocused ? "● Focused" : "● Tap to focus"}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.slotChipEmpty}>
      <View style={styles.slotChipInner}>
        <View style={styles.slotEmptyIconWrap}>
          <Feather name="plus" size={12} color="#334155" />
        </View>
        <View>
          <Text style={styles.slotChipTitleEmpty}>Slot {index + 1}</Text>
          <Text style={styles.slotChipSubEmpty}>Available</Text>
        </View>
      </View>
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
    focusOrder,
  } = useDriver();

  const focused: ActiveRide | null = activeRide;
  const secondaryOrders = activeOrders.filter((o) => o.id !== focused?.id);
  const remainingSlots = maxActiveOrders - activeOrderCount;
  const sm = focused ? statusMeta(focused.orderStatus) : null;

  function handleContinue() {
    if (!focused) return;
    router.push({ pathname: "/active-delivery", params: rideToParams(focused) });
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#080B14", "#101425"]} style={StyleSheet.absoluteFillObject} />

      {/* ── Subtle radial glow behind header ─────────────────────────────── */}
      <View style={[styles.headerGlow, { top: insets.top - 20 }]} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={20} color="#94A3B8" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerEyebrow}>COMMAND CENTER</Text>
          <Text style={styles.headerTitle}>Delivery Hub</Text>
        </View>

        {/* Live count badge */}
        <View style={styles.countPill}>
          <View style={styles.countPillDot} />
          <Text style={styles.countPillText}>
            {activeOrderCount}
            <Text style={styles.countPillMax}> / {maxActiveOrders}</Text>
          </Text>
        </View>
      </View>

      {/* ── Divider line ───────────────────────────────────────────────────── */}
      <View style={styles.headerDivider} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Slot row ───────────────────────────────────────────────────── */}
        <View style={styles.slotsSection}>
          <Text style={styles.sectionEyebrow}>ORDER SLOTS</Text>
          <View style={styles.slotsRow}>
            {Array.from({ length: maxActiveOrders }, (_, i) => {
              const slotOrder = activeOrders[i];
              return (
                <View key={i} style={styles.slotWrapper}>
                  <SlotChip
                    index={i}
                    occupied={i < activeOrderCount}
                    isFocused={slotOrder?.id === currentActiveOrderId}
                    order={slotOrder}
                    onPress={slotOrder ? () => focusOrder(slotOrder.id) : undefined}
                  />
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {activeOrderCount === 0 && (
          <View style={styles.emptyState}>
            {/* Icon ring stack */}
            <View style={styles.emptyRingOuter}>
              <View style={styles.emptyRingInner}>
                <Feather name="package" size={36} color="#1E293B" />
              </View>
            </View>
            <Text style={styles.emptyTitle}>No Active Deliveries</Text>
            <Text style={styles.emptySubtitle}>
              Accept an incoming order request to{"\n"}see it here.
            </Text>
            {/* Slot availability hint */}
            <View style={styles.emptySlotHint}>
              <Feather name="layers" size={13} color="#334155" />
              <Text style={styles.emptySlotHintText}>
                {maxActiveOrders} slots ready · Accept up to {maxActiveOrders} at once
              </Text>
            </View>
            <TouchableOpacity
              style={styles.emptyBackBtn}
              activeOpacity={0.8}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={14} color="#64748B" />
              <Text style={styles.emptyBackText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 3D Order Stack ─────────────────────────────────────────────── */}
        {focused && sm && (
          <>
            {/* Section header */}
            <View style={styles.stackHeader}>
              <Text style={styles.sectionEyebrow}>FOCUSED ORDER</Text>
              <View style={[styles.statusPill, { backgroundColor: sm.bg }]}>
                <Feather name={sm.icon} size={11} color={sm.color} />
                <Text style={[styles.statusPillText, { color: sm.color }]}>
                  {sm.label}
                </Text>
              </View>
            </View>

            {/* Stack container */}
            <View style={styles.stackContainer}>

              {/* ── Ghost card 3 — furthest back ──────────────────────── */}
              {secondaryOrders[1] ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.ghostCard, styles.ghost3, styles.ghostOccupied]}
                  onPress={() => focusOrder(secondaryOrders[1]!.id)}
                >
                  <View style={{ flex: 1 }} />
                  <View style={styles.ghostOccupiedRow}>
                    <Feather name="package" size={10} color="#7C3AED" />
                    <Text style={styles.ghostOccupiedLabel} numberOfLines={1}>
                      {secondaryOrders[1]!.passengerName.split(" ")[0]} · ₹{secondaryOrders[1]!.fareEstimate}
                    </Text>
                    <Feather name="chevron-up" size={10} color="#3B2060" />
                  </View>
                </TouchableOpacity>
              ) : (
                <View pointerEvents="none" style={[styles.ghostCard, styles.ghost3]}>
                  <View style={styles.ghostCardInner}>
                    <Feather name="plus-circle" size={13} color="#1E293B" />
                    <Text style={styles.ghostCardLabel}>Slot 3 · Available</Text>
                  </View>
                </View>
              )}

              {/* ── Ghost card 2 — one step back ──────────────────────── */}
              {secondaryOrders[0] ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.ghostCard, styles.ghost2, styles.ghostOccupied]}
                  onPress={() => focusOrder(secondaryOrders[0]!.id)}
                >
                  <View style={{ flex: 1 }} />
                  <View style={styles.ghostOccupiedRow}>
                    <Feather name="package" size={10} color="#7C3AED" />
                    <Text style={styles.ghostOccupiedLabel} numberOfLines={1}>
                      {secondaryOrders[0]!.passengerName.split(" ")[0]} · ₹{secondaryOrders[0]!.fareEstimate}
                    </Text>
                    <Feather name="chevron-up" size={10} color="#3B2060" />
                  </View>
                </TouchableOpacity>
              ) : (
                <View pointerEvents="none" style={[styles.ghostCard, styles.ghost2]}>
                  <View style={styles.ghostCardInner}>
                    <Feather name="plus-circle" size={13} color="#263352" />
                    <Text style={[styles.ghostCardLabel, { color: "#263352" }]}>
                      Slot 2 · Available
                    </Text>
                  </View>
                </View>
              )}

              {/* ── Main focused card ─────────────────────────────────── */}
              <View style={styles.orderCard}>

                {/* Card top accent stripe */}
                <LinearGradient
                  colors={["#FF4D8D", "#FF7A3D"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.cardAccentStripe}
                />

                {/* Customer block */}
                <View style={styles.customerBlock}>
                  <LinearGradient
                    colors={["#FFF0F5", "#FFE4EE"]}
                    style={styles.avatarRing}
                  >
                    <Text style={styles.avatarInitial}>
                      {(focused.passengerName || "?")[0].toUpperCase()}
                    </Text>
                  </LinearGradient>
                  <View style={styles.customerText}>
                    <Text style={styles.customerName}>{focused.passengerName}</Text>
                    <View style={styles.customerPhoneRow}>
                      <Feather name="phone" size={11} color="#94A3B8" />
                      <Text style={styles.customerPhone}>{focused.customerPhone}</Text>
                    </View>
                  </View>
                  <View style={styles.fareCallout}>
                    <Text style={styles.fareCalloutCurrency}>₹</Text>
                    <Text style={styles.fareCalloutAmount}>{focused.fareEstimate}</Text>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.cardDivider} />

                {/* Route section */}
                <View style={styles.routeSection}>
                  {/* Pickup */}
                  <View style={styles.routeRow}>
                    <View style={styles.routeTimeline}>
                      <View style={[styles.routeNode, styles.routeNodePickup]} />
                      <View style={styles.routeConnectorLine} />
                    </View>
                    <View style={styles.routeText}>
                      <Text style={styles.routeTag}>PICKUP</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {focused.pickup}
                      </Text>
                    </View>
                  </View>
                  {/* Drop */}
                  <View style={styles.routeRow}>
                    <View style={styles.routeTimeline}>
                      <View style={[styles.routeNode, styles.routeNodeDrop]} />
                    </View>
                    <View style={styles.routeText}>
                      <Text style={styles.routeTag}>DROP</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {focused.drop}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.cardDivider} />

                {/* Details grid 2 × 2 */}
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

                {/* Continue Delivery CTA */}
                <TouchableOpacity
                  onPress={handleContinue}
                  activeOpacity={0.84}
                  style={styles.ctaWrapper}
                >
                  <LinearGradient
                    colors={["#FF4D8D", "#FF7A3D"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ctaBtn}
                  >
                    <Feather name="navigation" size={16} color="#fff" />
                    <Text style={styles.ctaText}>Continue Delivery</Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </LinearGradient>
                </TouchableOpacity>

              </View>
              {/* end main card */}
            </View>
            {/* end stack container */}

            {/* ── Secondary order cards ───────────────────────────────── */}
            {secondaryOrders.length > 0 && (
              <View style={styles.secondarySection}>
                <Text style={styles.sectionEyebrow}>QUEUED ORDERS</Text>
                {secondaryOrders.map((order) => {
                  const sm2 = statusMeta(order.orderStatus);
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.secondaryCard}
                      activeOpacity={0.82}
                      onPress={() => focusOrder(order.id)}
                    >
                      <View style={[styles.secondaryAccent, { backgroundColor: sm2.color }]} />
                      <View style={styles.secondaryContent}>
                        <View style={[styles.secondaryInitial, { borderColor: sm2.color + "44" }]}>
                          <Text style={[styles.secondaryInitialText, { color: sm2.color }]}>
                            {(order.passengerName || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.secondaryName} numberOfLines={1}>
                            {order.passengerName}
                          </Text>
                          <Text style={styles.secondaryDrop} numberOfLines={1}>
                            → {order.drop}
                          </Text>
                        </View>
                        <View style={styles.secondaryRight}>
                          <Text style={styles.secondaryFare}>₹{order.fareEstimate}</Text>
                          <View style={[styles.secondaryStatusPill, { backgroundColor: sm2.bg }]}>
                            <Feather name={sm2.icon} size={9} color={sm2.color} />
                            <Text style={[styles.secondaryStatusText, { color: sm2.color }]}>
                              {sm2.label}
                            </Text>
                          </View>
                        </View>
                        <Feather name="chevron-right" size={14} color="#253050" />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── Multi-order capacity hint ───────────────────────────── */}
            {hasCapacity && (
              <View style={styles.capacityHintRow}>
                <LinearGradient
                  colors={["#0F172A", "#131C35"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.capacityHintCard}
                >
                  <View style={styles.capacityHintIconWrap}>
                    <Feather name="zap" size={14} color="#6366F1" />
                  </View>
                  <View style={styles.capacityHintText}>
                    <Text style={styles.capacityHintTitle}>
                      {remainingSlots} order slot{remainingSlots !== 1 ? "s" : ""} available
                    </Text>
                    <Text style={styles.capacityHintSub}>
                      Tap a slot chip above to switch focus
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={14} color="#1E293B" />
                </LinearGradient>
              </View>
            )}
          </>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CARD_RADIUS = 22;

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header glow (decorative radial)
  headerGlow: {
    position:        "absolute",
    left:            "20%",
    right:           "20%",
    height:          180,
    borderRadius:    90,
    backgroundColor: "#6366F1",
    opacity:         0.07,
    transform:       [{ scaleX: 2.5 }],
  },

  // Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 20,
    paddingBottom:     16,
    gap:               12,
  },
  backBtn: {
    width:           36,
    height:          36,
    borderRadius:    11,
    backgroundColor: "#0F1626",
    borderWidth:     1,
    borderColor:     "#1E2A45",
    alignItems:      "center",
    justifyContent:  "center",
  },
  headerCenter: { flex: 1 },
  headerEyebrow: {
    fontSize:      9,
    fontWeight:    "800",
    color:         "#334155",
    letterSpacing: 1.8,
    marginBottom:  2,
  },
  headerTitle: {
    fontSize:      22,
    fontWeight:    "800",
    color:         "#F1F5F9",
    letterSpacing: -0.6,
  },
  countPill: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    backgroundColor:   "#0C1120",
    borderWidth:       1,
    borderColor:       "#1E2A45",
    borderRadius:      12,
    paddingHorizontal: 12,
    paddingVertical:   8,
  },
  countPillDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: "#FF4D8D",
  },
  countPillText: {
    fontSize:   17,
    fontWeight: "800",
    color:      "#F1F5F9",
  },
  countPillMax: {
    fontSize:   13,
    fontWeight: "500",
    color:      "#334155",
  },
  headerDivider: {
    height:          1,
    marginHorizontal: 20,
    backgroundColor: "#0F1626",
    marginBottom:    4,
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop:        20,
    gap:               20,
  },

  // Section eyebrow
  sectionEyebrow: {
    fontSize:      9,
    fontWeight:    "800",
    color:         "#1E2A45",
    letterSpacing: 1.8,
  },

  // Slots
  slotsSection: { gap: 10 },
  slotsRow: {
    flexDirection: "row",
    gap:           8,
  },
  slotWrapper: { flex: 1 },

  // Slot chip — filled
  slotChip: {
    borderRadius: 14,
    overflow:     "hidden",
    shadowColor:  "#FF4D8D",
    shadowOpacity: 0.28,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     5,
  },
  slotChipInner: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
    padding:       11,
  },
  slotChipIconWrap: {
    width:           26,
    height:          26,
    borderRadius:    8,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  slotChipTitle: {
    fontSize:   11,
    fontWeight: "800",
    color:      "#fff",
  },
  slotChipSubFilled: {
    fontSize:   9,
    fontWeight: "600",
    color:      "rgba(255,255,255,0.7)",
    marginTop:  1,
  },

  // Slot chip — empty
  slotChipEmpty: {
    borderRadius:    14,
    backgroundColor: "#080D1A",
    borderWidth:     1,
    borderColor:     "#121E33",
    borderStyle:     "dashed",
  },
  slotEmptyIconWrap: {
    width:           26,
    height:          26,
    borderRadius:    8,
    backgroundColor: "#0F1626",
    alignItems:      "center",
    justifyContent:  "center",
  },
  slotChipTitleEmpty: {
    fontSize:   11,
    fontWeight: "700",
    color:      "#253050",
  },
  slotChipSubEmpty: {
    fontSize:   9,
    fontWeight: "600",
    color:      "#1A2640",
    marginTop:  1,
  },

  // Empty state
  emptyState: {
    alignItems:      "center",
    paddingVertical: 52,
    gap:             14,
  },
  emptyRingOuter: {
    width:           100,
    height:          100,
    borderRadius:    50,
    backgroundColor: "#060A14",
    borderWidth:     1.5,
    borderColor:     "#0F1A2E",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    6,
  },
  emptyRingInner: {
    width:           72,
    height:          72,
    borderRadius:    36,
    backgroundColor: "#0A0F1E",
    borderWidth:     1,
    borderColor:     "#131D35",
    alignItems:      "center",
    justifyContent:  "center",
  },
  emptyTitle: {
    fontSize:      20,
    fontWeight:    "800",
    color:         "#1E2A45",
    letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontSize:   13,
    color:      "#141E33",
    textAlign:  "center",
    lineHeight: 20,
  },
  emptySlotHint: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    backgroundColor:   "#070C18",
    borderWidth:       1,
    borderColor:       "#0F1626",
    borderRadius:      10,
    paddingHorizontal: 14,
    paddingVertical:   8,
    marginTop:         2,
  },
  emptySlotHintText: {
    fontSize:   11,
    fontWeight: "600",
    color:      "#1A2640",
  },
  emptyBackBtn: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    marginTop:         6,
    paddingHorizontal: 20,
    paddingVertical:   11,
    backgroundColor:   "#070C18",
    borderRadius:      13,
    borderWidth:       1,
    borderColor:       "#0F1A2E",
  },
  emptyBackText: {
    fontSize:   13,
    fontWeight: "700",
    color:      "#253050",
  },

  // Stack header row
  stackHeader: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   -6,
  },
  statusPill: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      20,
  },
  statusPillText: {
    fontSize:   11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // 3D Stack
  stackContainer: {
    position:     "relative",
    marginBottom: 28,
  },

  // Ghost cards
  ghostCard: {
    position:     "absolute",
    borderRadius: CARD_RADIUS,
  },
  ghost3: {
    bottom:          -20,
    left:            22,
    right:           22,
    height:          72,
    backgroundColor: "#0D1628",
    borderWidth:     1,
    borderColor:     "rgba(255,255,255,0.07)",
    shadowColor:     "#000",
    shadowOpacity:   0.12,
    shadowRadius:    6,
    shadowOffset:    { width: 0, height: 2 },
    elevation:       2,
  },
  ghost2: {
    bottom:          -11,
    left:            11,
    right:           11,
    height:          72,
    backgroundColor: "#101B32",
    borderWidth:     1,
    borderColor:     "rgba(255,255,255,0.10)",
    shadowColor:     "#000",
    shadowOpacity:   0.15,
    shadowRadius:    8,
    shadowOffset:    { width: 0, height: 3 },
    elevation:       4,
  },
  ghostCardInner: {
    flex:          1,
    flexDirection: "row",
    alignItems:    "center",
    justifyContent: "center",
    gap:           7,
    paddingTop:    12,
  },
  ghostCardLabel: {
    fontSize:   11,
    fontWeight: "600",
    color:      "#111E36",
    letterSpacing: 0.3,
  },

  // Main order card
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius:    CARD_RADIUS,
    overflow:        "hidden",
    shadowColor:     "#000",
    shadowOpacity:   0.5,
    shadowRadius:    32,
    shadowOffset:    { width: 0, height: 12 },
    elevation:       20,
    zIndex:          3,
  },

  // Accent stripe at top of card
  cardAccentStripe: {
    height: 4,
  },

  // Customer block
  customerBlock: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
    paddingHorizontal: 14,
    paddingTop:    12,
    paddingBottom: 10,
  },
  avatarRing: {
    width:         38,
    height:        38,
    borderRadius:  19,
    alignItems:    "center",
    justifyContent:"center",
    shadowColor:   "#FF4D8D",
    shadowOpacity: 0.15,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 2 },
  },
  avatarInitial: {
    fontSize:   15,
    fontWeight: "800",
    color:      "#FF4D8D",
  },
  customerText: { flex: 1 },
  customerName: {
    fontSize:      15,
    fontWeight:    "800",
    color:         "#0F172A",
    letterSpacing: -0.2,
  },
  customerPhoneRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           4,
    marginTop:     3,
  },
  customerPhone: {
    fontSize:   12,
    color:      "#94A3B8",
    fontWeight: "500",
  },
  fareCallout: {
    flexDirection: "row",
    alignItems:    "baseline",
    gap:           1,
  },
  fareCalloutCurrency: {
    fontSize:   12,
    fontWeight: "700",
    color:      "#475569",
  },
  fareCalloutAmount: {
    fontSize:   20,
    fontWeight: "800",
    color:      "#0F172A",
    letterSpacing: -0.4,
  },

  // Card divider
  cardDivider: {
    height:            1,
    backgroundColor:   "#F1F5F9",
    marginHorizontal:  14,
  },

  // Route
  routeSection: {
    paddingHorizontal: 14,
    paddingVertical:   10,
    gap:               0,
  },
  routeRow: {
    flexDirection: "row",
    gap:           12,
    minHeight:     36,
  },
  routeTimeline: {
    alignItems:  "center",
    width:       16,
    paddingTop:  3,
  },
  routeNode: {
    width:        9,
    height:       9,
    borderRadius: 5,
  },
  routeNodePickup: {
    backgroundColor: "#FF4D8D",
    shadowColor:   "#FF4D8D",
    shadowOpacity: 0.5,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 0 },
  },
  routeNodeDrop: {
    backgroundColor: "#3B82F6",
    shadowColor:   "#3B82F6",
    shadowOpacity: 0.5,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 0 },
  },
  routeConnectorLine: {
    flex:            1,
    width:           2,
    backgroundColor: "#E2E8F0",
    marginVertical:  4,
  },
  routeText: {
    flex:          1,
    paddingBottom: 6,
  },
  routeTag: {
    fontSize:      8,
    fontWeight:    "800",
    color:         "#CBD5E1",
    letterSpacing: 1.2,
    marginBottom:  2,
  },
  routeAddress: {
    fontSize:   12,
    fontWeight: "700",
    color:      "#0F172A",
    lineHeight: 17,
  },

  // Details grid
  detailsGrid: {
    flexDirection:     "row",
    flexWrap:          "wrap",
    gap:               6,
    paddingHorizontal: 14,
    paddingTop:        6,
    paddingBottom:     12,
  },
  detailCell: {
    flex:            1,
    minWidth:        "46%",
    backgroundColor: "#F8FAFC",
    borderRadius:    10,
    paddingHorizontal: 10,
    paddingVertical:   8,
    gap:             2,
    borderWidth:     1,
    borderColor:     "#F1F5F9",
  },
  detailCellHead: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           4,
    marginBottom:  1,
  },
  detailLabel: {
    fontSize:      8,
    fontWeight:    "800",
    color:         "#CBD5E1",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  detailValue: {
    fontSize:   12,
    fontWeight: "800",
    color:      "#0F172A",
  },

  // CTA
  ctaWrapper: {
    margin:       14,
    marginTop:    2,
    borderRadius: 14,
    overflow:     "hidden",
    shadowColor:  "#FF4D8D",
    shadowOpacity: 0.45,
    shadowRadius:  16,
    shadowOffset:  { width: 0, height: 6 },
    elevation:     10,
  },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 14,
  },
  ctaText: {
    fontSize:      16,
    fontWeight:    "800",
    color:         "#fff",
    letterSpacing: -0.2,
  },

  // Ghost cards — occupied state
  ghostOccupied: {
    backgroundColor: "#0F1B30",
    borderColor:     "rgba(255,255,255,0.11)",
    overflow:        "hidden",
  },
  ghostOccupiedRow: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    paddingHorizontal: 14,
    paddingBottom:     8,
  },
  ghostOccupiedLabel: {
    flex:       1,
    fontSize:   10,
    fontWeight: "700",
    color:      "rgba(139, 92, 246, 0.65)",
  },

  // Secondary order cards (QUEUED ORDERS section below stack)
  secondarySection: { gap: 10 },
  secondaryCard: {
    flexDirection:  "row",
    backgroundColor: "#0A0F1C",
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     "#111E35",
    overflow:        "hidden",
    shadowColor:     "#000",
    shadowOpacity:   0.3,
    shadowRadius:    8,
    shadowOffset:    { width: 0, height: 3 },
    elevation:       4,
  },
  secondaryAccent: {
    width: 4,
  },
  secondaryContent: {
    flex:          1,
    flexDirection: "row",
    alignItems:    "center",
    gap:           12,
    paddingHorizontal: 12,
    paddingVertical:   12,
  },
  secondaryInitial: {
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: "#0D1525",
    borderWidth:     1.5,
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  secondaryInitialText: {
    fontSize:   14,
    fontWeight: "800",
  },
  secondaryName: {
    fontSize:      13,
    fontWeight:    "700",
    color:         "#CBD5E1",
    letterSpacing: -0.1,
  },
  secondaryDrop: {
    fontSize:  11,
    fontWeight: "500",
    color:     "#334155",
    marginTop: 2,
  },
  secondaryRight: {
    alignItems: "flex-end",
    gap:        5,
    flexShrink: 0,
  },
  secondaryFare: {
    fontSize:   15,
    fontWeight: "800",
    color:      "#94A3B8",
  },
  secondaryStatusPill: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               4,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderRadius:      8,
  },
  secondaryStatusText: {
    fontSize:      9,
    fontWeight:    "700",
    letterSpacing: 0.2,
  },

  // Capacity hint card
  capacityHintRow: { marginTop: -8 },
  capacityHintCard: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               12,
    borderRadius:      16,
    paddingHorizontal: 16,
    paddingVertical:   13,
    borderWidth:       1,
    borderColor:       "#0F1A2E",
  },
  capacityHintIconWrap: {
    width:           32,
    height:          32,
    borderRadius:    10,
    backgroundColor: "#0D1220",
    borderWidth:     1,
    borderColor:     "#1A2540",
    alignItems:      "center",
    justifyContent:  "center",
  },
  capacityHintText: { flex: 1 },
  capacityHintTitle: {
    fontSize:   13,
    fontWeight: "700",
    color:      "#1E3A5F",
  },
  capacityHintSub: {
    fontSize:  11,
    color:     "#0F1E30",
    marginTop: 2,
  },
});
