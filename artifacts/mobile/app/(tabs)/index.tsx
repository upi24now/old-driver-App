import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import IncomingOrderModal, {
  TEST_ORDERS,
  type TestOrder,
} from "@/components/IncomingOrderModal";

function RadarPulse({ color }: { color: string }) {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 2400,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      );
    const l1 = make(a1, 0);
    const l2 = make(a2, 800);
    const l3 = make(a3, 1600);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, []);

  const ring = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.radarRing,
        {
          borderColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
          transform: [
            {
              scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.9] }),
            },
          ],
        },
      ]}
    />
  );

  return (
    <View style={styles.radarWrap}>
      {ring(a1)}
      {ring(a2)}
      {ring(a3)}
      <View style={[styles.radarCore, { backgroundColor: color }]}>
        <Feather name="navigation" size={22} color="#fff" />
      </View>
    </View>
  );
}

function LiveMap({ online, color }: { online: boolean; color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!online) return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [online]);

  const pinColor = online ? color : "#9E9E9E";

  return (
    <View style={styles.mapWrap}>
      <Svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice">
        <Rect x="0" y="0" width="400" height="220" fill="#e8eef3" />
        {/* parks */}
        <Rect x="20" y="20" width="80" height="50" rx="6" fill="#d4ead4" />
        <Rect x="300" y="140" width="90" height="60" rx="6" fill="#d4ead4" />
        {/* water */}
        <Path d="M0,180 Q80,160 160,180 T320,180 L400,180 L400,220 L0,220 Z" fill="#cfe3f3" />
        {/* blocks */}
        <Rect x="120" y="30" width="60" height="40" rx="3" fill="#f7f4ee" />
        <Rect x="200" y="20" width="80" height="50" rx="3" fill="#f7f4ee" />
        <Rect x="120" y="90" width="60" height="40" rx="3" fill="#f7f4ee" />
        <Rect x="200" y="90" width="80" height="40" rx="3" fill="#f7f4ee" />
        <Rect x="20" y="90" width="80" height="40" rx="3" fill="#f7f4ee" />
        <Rect x="300" y="30" width="80" height="90" rx="3" fill="#f7f4ee" />
        {/* roads */}
        <Rect x="0" y="75" width="400" height="8" fill="#ffffff" />
        <Rect x="0" y="135" width="400" height="8" fill="#ffffff" />
        <Rect x="105" y="0" width="8" height="180" fill="#ffffff" />
        <Rect x="185" y="0" width="8" height="180" fill="#ffffff" />
        <Rect x="285" y="0" width="8" height="180" fill="#ffffff" />
        {/* highlighted road (driver's street) */}
        <Rect x="0" y="78" width="400" height="2" fill="#FFC107" opacity={online ? 0.9 : 0.4} />
      </Svg>

      {/* driver pin in center */}
      <View style={styles.mapPinWrap} pointerEvents="none">
        {online && (
          <Animated.View
            style={[
              styles.mapPulse,
              {
                borderColor: pinColor,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) },
                ],
              },
            ]}
          />
        )}
        <View style={[styles.mapPin, { backgroundColor: pinColor }]}>
          <View style={styles.mapPinInner} />
        </View>
      </View>

      {/* zoom controls (decorative) */}
      <View style={styles.mapZoom}>
        <View style={styles.mapZoomBtn}>
          <Feather name="plus" size={14} color="#444" />
        </View>
        <View style={[styles.mapZoomBtn, { borderTopWidth: 1, borderTopColor: "#eee" }]}>
          <Feather name="minus" size={14} color="#444" />
        </View>
      </View>

      {/* locate button */}
      <View style={styles.mapLocate}>
        <Feather name="navigation" size={14} color={pinColor} />
      </View>

      {/* location chip */}
      <View style={styles.mapLocChip}>
        <Feather name="map-pin" size={11} color={pinColor} />
        <Text style={styles.mapLocText}>Indiranagar, Bengaluru</Text>
      </View>
    </View>
  );
}

function StatusPulseDot({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.statusDotWrap}>
      <Animated.View
        style={[
          styles.statusDotPulse,
          {
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [
              { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) },
            ],
          },
        ]}
      />
      <View style={[styles.statusDotCore, { backgroundColor: color }]} />
    </View>
  );
}

// ─── Custom online/offline toggle ────────────────────────────────────────────
const TRACK_W    = 68;
const TRACK_H    = 36;
const THUMB_D    = 30;
const THUMB_EDGE = (TRACK_H - THUMB_D) / 2; // 3 — gap between thumb and track edge

function OnlineSwitch({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue:         value ? 1 : 0,
      useNativeDriver: false,
      tension:         100,
      friction:        11,
    }).start();
  }, [value]);

  const thumbLeft  = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [THUMB_EDGE, TRACK_W - THUMB_D - THUMB_EDGE],
  });
  const trackColor = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: ["#EF4444", "#16A34A"],
  });

  return (
    <TouchableOpacity onPress={() => onValueChange(!value)} activeOpacity={0.85}>
      <Animated.View style={[styles.onlineTrack, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.onlineThumb, { left: thumbLeft }]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    isOnline: online,
    setOnline: setDriverOnline,
    subscriptionActive,
    subscriptionPlan,
    planExpiredNoOrders,
    planExpiredWithOrders,
    todayEarnings,
    tripsToday,
    activeRide,
    currentOrderId,
    activeOrderCount,
    incomingRide,
  } = useDriver();

  function setOnline(v: boolean) {
    const r = setDriverOnline(v);
    if (!r.ok && r.reason) {
      Alert.alert("Can't go online", r.reason, [
        { text: "Not now", style: "cancel" },
        { text: "View plans", onPress: () => router.push("/subscription") },
      ]);
    }
  }

  const weeklyEarned = 4280;
  const weeklyGoal = 7000;
  const weeklyPct = Math.min(weeklyEarned / weeklyGoal, 1);

  // ── Test order simulation ────────────────────────────────────
  const [testOrder, setTestOrder] = useState<TestOrder | null>(null);
  const lastOrderIndex = useRef(-1);

  function fireTestOrder() {
    let idx: number;
    do { idx = Math.floor(Math.random() * TEST_ORDERS.length); }
    while (idx === lastOrderIndex.current && TEST_ORDERS.length > 1);
    lastOrderIndex.current = idx;
    setTestOrder(TEST_ORDERS[idx]);
  }

  function handleOrderAccept(order: TestOrder) {
    setTestOrder(null);
    const earning = order.surge
      ? Math.round(order.earning * (order.surgeMultiplier ?? 1))
      : order.earning;
    router.push({
      pathname: "/active-delivery",
      params: {
        customer:    order.customer,
        phone:       order.phone,
        parcelType:  order.parcelType,
        parcelEmoji: order.parcelEmoji,
        pickup:      order.pickup,
        pickupCity:  order.pickupCity,
        drop:        order.drop,
        dropCity:    order.dropCity,
        distanceKm:  String(order.distanceKm),
        durationMin: String(order.durationMin),
        earning:     String(earning),
        weight:      order.weight ?? "",
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: 16,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* TOP BAR */}
        <View style={styles.topBar}>
          <TouchableOpacity activeOpacity={0.8} style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>RK</Text>
              <View style={[styles.avatarRing, { borderColor: colors.primary }]} />
            </View>
            <View>
              <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
                Good morning
              </Text>
              <Text style={[styles.driverName, { color: colors.foreground }]}>
                Rohit K. <Feather name="chevron-down" size={14} color="#999" />
              </Text>
            </View>
          </TouchableOpacity>
          <View style={styles.topActions}>
            {/* Active plan pill — only when subscription is live */}
            {subscriptionActive && subscriptionPlan && (
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.planPill}
                onPress={() => router.push("/subscription")}
              >
                <LinearGradient
                  colors={["#22C55E", "#16A34A"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.planPillGrad}
                >
                  <View style={styles.planPillDot} />
                  <Text style={styles.planPillText}>
                    {subscriptionPlan === "daily"
                      ? "Daily"
                      : subscriptionPlan === "weekly"
                        ? "Weekly"
                        : "Monthly"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            <OnlineSwitch value={online} onValueChange={setOnline} />
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: "#fff", borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Feather name="bell" size={17} color="#0a0a0a" />
              <View style={[styles.notifBadge, { backgroundColor: "#FF3B30" }]}>
                <Text style={styles.notifBadgeText}>3</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── PLAN EXPIRY BANNERS — only shown when plan has lapsed ────────── */}
        {planExpiredWithOrders ? (
          // Amber banner — expired but active deliveries in progress
          <TouchableOpacity
            style={styles.bannerAmber}
            activeOpacity={0.88}
            onPress={() => router.push("/subscription")}
          >
            <View style={styles.bannerInner}>
              <Feather name="clock" size={15} color="#fff" style={{ flexShrink: 0 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Plan Expired</Text>
                <Text style={styles.bannerSub}>
                  Finish current deliveries. Renew plan to receive new orders.
                </Text>
              </View>
              <View style={styles.bannerCta}>
                <Text style={styles.bannerCtaText}>Renew Plan</Text>
              </View>
            </View>
          </TouchableOpacity>
        ) : planExpiredNoOrders ? (
          // Red banner — expired, no active orders
          <TouchableOpacity
            style={styles.bannerRed}
            activeOpacity={0.88}
            onPress={() => router.push("/subscription")}
          >
            <View style={styles.bannerInner}>
              <Feather name="alert-circle" size={15} color="#fff" style={{ flexShrink: 0 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Plan Expired</Text>
                <Text style={styles.bannerSub}>Renew to continue receiving orders</Text>
              </View>
              <View style={styles.bannerCta}>
                <Text style={styles.bannerCtaText}>Renew Plan</Text>
              </View>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* ACTION CARDS — always visible; orange = availability, blue = command center */}
        <View style={styles.actionCardsRow}>

          {/* Card 1 — Available Deliveries (orange) */}
          <TouchableOpacity
            style={styles.actionCardWrap}
            activeOpacity={0.82}
            onPress={() => {
              if (incomingRide) {
                router.push("/ride-request");
              } else {
                Alert.alert(
                  "No orders right now",
                  "You'll be notified as soon as a nearby order arrives.",
                  [{ text: "OK" }],
                );
              }
            }}
          >
            <LinearGradient
              colors={["#FF8C42", "#E04E00"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionCard}
            >
              {/* Glass shimmer highlight */}
              <View style={styles.actionCardGlass} pointerEvents="none" />

              {/* Static notification dot — signals availability */}
              <View style={styles.actionCardBadgeDot} />

              {/* Icon pill */}
              <View style={styles.actionCardIconWrap}>
                <Feather name="bell" size={16} color="#fff" />
              </View>

              {/* Text */}
              <View style={styles.actionCardContent}>
                <Text style={styles.actionCardTitle}>Available Deliveries</Text>
                <Text style={styles.actionCardSub}>New orders nearby</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Card 2 — My Deliveries (blue) → Command Center */}
          <TouchableOpacity
            style={styles.actionCardWrap}
            activeOpacity={0.82}
            onPress={() => router.push("/delivery-command-center")}
          >
            <LinearGradient
              colors={["#4A90E2", "#1A56DB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionCard}
            >
              {/* Glass shimmer highlight */}
              <View style={styles.actionCardGlass} pointerEvents="none" />

              {/* Count badge — only when there are active orders */}
              {activeOrderCount > 0 && (
                <View style={styles.actionCardBadgeCount}>
                  <Text style={styles.actionCardBadgeText}>{activeOrderCount}</Text>
                </View>
              )}

              {/* Icon pill */}
              <View style={styles.actionCardIconWrap}>
                <Feather name="layers" size={16} color="#fff" />
              </View>

              {/* Text */}
              <View style={styles.actionCardContent}>
                <Text style={styles.actionCardTitle}>My Deliveries</Text>
                <Text style={styles.actionCardSub}>Active & multiple orders</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

        </View>

        {/* EARNINGS HERO */}
        <LinearGradient
          colors={["#00C853", "#00A847"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.earningsCard}
        >
          <View style={styles.earningsTop}>
            <View>
              <Text style={styles.earningsLabel}>TODAY'S EARNINGS</Text>
              <View style={styles.earningsAmountRow}>
                <Text style={styles.earningsCurrency}>₹</Text>
                <Text style={styles.earningsAmount}>{todayEarnings.toLocaleString()}</Text>
                <View style={styles.earningsDelta}>
                  <Feather name="trending-up" size={11} color="#fff" />
                  <Text style={styles.earningsDeltaText}>+18%</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.cashoutBtn}
              onPress={() => router.push("/wallet")}
              activeOpacity={0.8}
            >
              <Feather name="zap" size={12} color="#0a0a0a" />
              <Text style={styles.cashoutText}>Cash out</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.earningsBreakdown}>
            <View style={styles.breakdownItem}>
              <Feather name="navigation" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>{tripsToday}</Text>
              <Text style={styles.breakdownLabel}>Trips</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Feather name="clock" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>6h 42m</Text>
              <Text style={styles.breakdownLabel}>Online</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Feather name="map-pin" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>87 km</Text>
              <Text style={styles.breakdownLabel}>Distance</Text>
            </View>
          </View>
        </LinearGradient>

        {/* QUICK STATS ROW */}
        <View style={styles.quickStats}>
          {[
            { icon: "star", value: "4.92", label: "Rating", color: "#FFB300" },
            { icon: "check-circle", value: "96%", label: "Acceptance", color: colors.primary },
            { icon: "award", value: "Gold", label: "Tier", color: "#9C27B0" },
          ].map((s) => (
            <View
              key={s.label}
              style={[styles.qStatCard, { borderColor: colors.border }]}
            >
              <View style={[styles.qStatIcon, { backgroundColor: s.color + "1a" }]}>
                <Feather name={s.icon as any} size={14} color={s.color} />
              </View>
              <Text style={[styles.qStatValue, { color: colors.foreground }]}>
                {s.value}
              </Text>
              <Text style={[styles.qStatLabel, { color: colors.mutedForeground }]}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        {/* RIDE REQUEST AREA */}
        <View
          style={[
            styles.requestCard,
            {
              borderColor: online ? colors.primary : colors.border,
              backgroundColor: "#fff",
              borderWidth: online ? 1.5 : 1,
            },
          ]}
        >
          <View style={styles.requestHeader}>
            <Text style={[styles.requestTitle, { color: colors.foreground }]}>
              Ride Requests
            </Text>
            <View
              style={[
                styles.requestBadge,
                {
                  backgroundColor: online ? "#f0fdf4" : "#f5f5f5",
                },
              ]}
            >
              <View
                style={[
                  styles.requestBadgeDot,
                  { backgroundColor: online ? colors.primary : "#9E9E9E" },
                ]}
              />
              <Text
                style={[
                  styles.requestBadgeText,
                  { color: online ? colors.primary : colors.mutedForeground },
                ]}
              >
                {online ? "Live" : "Paused"}
              </Text>
            </View>
          </View>

          <LiveMap online={online} color={colors.primary} />

        </View>

        {/* WEEKLY GOAL */}
        <View style={[styles.goalCard, { borderColor: colors.border }]}>
          <View style={styles.goalHeader}>
            <View>
              <Text style={[styles.goalLabel, { color: colors.mutedForeground }]}>
                WEEKLY GOAL
              </Text>
              <Text style={[styles.goalTitle, { color: colors.foreground }]}>
                ₹{weeklyEarned.toLocaleString()}{" "}
                <Text style={[styles.goalTotal, { color: colors.mutedForeground }]}>
                  / ₹{weeklyGoal.toLocaleString()}
                </Text>
              </Text>
            </View>
            <View style={[styles.goalPctChip, { backgroundColor: "#f0fdf4" }]}>
              <Text style={[styles.goalPctText, { color: colors.primary }]}>
                {Math.round(weeklyPct * 100)}%
              </Text>
            </View>
          </View>
          <View style={[styles.goalTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.goalFill,
                {
                  width: `${weeklyPct * 100}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <View style={styles.goalFooter}>
            <Text style={[styles.goalFooterText, { color: colors.mutedForeground }]}>
              ₹{(weeklyGoal - weeklyEarned).toLocaleString()} to go
            </Text>
            <Text style={[styles.goalFooterText, { color: colors.mutedForeground }]}>
              3 days left
            </Text>
          </View>
        </View>

        {/* QUICK ACTIONS */}
        <View style={styles.quickActions}>
          {[
            { icon: "credit-card", label: "Wallet", path: "/wallet", color: "#00C853" },
            { icon: "zap", label: "Plans", path: "/subscription", color: "#FF6F00" },
            { icon: "list", label: "History", path: "/(tabs)/trips", color: "#1976D2" },
            { icon: "user", label: "Profile", path: "/(tabs)/profile", color: "#673AB7" },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionTile, { borderColor: colors.border }]}
              onPress={() => a.path && router.push(a.path as any)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.actionIcon,
                  { backgroundColor: a.color + "1a" },
                ]}
              >
                <Feather name={a.icon as any} size={16} color={a.color} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.foreground }]}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Test Order button + modal — dev builds only ── */}
      {__DEV__ && (
        <>
          <TouchableOpacity
            onPress={fireTestOrder}
            activeOpacity={0.85}
            style={[
              styles.testOrderBtn,
              { bottom: insets.bottom + 90 },
            ]}
          >
            <LinearGradient
              colors={["#7C3AED", "#4F46E5"]}
              style={styles.testOrderGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.testOrderIcon}>🧪</Text>
              <Text style={styles.testOrderLabel}>Test{"\n"}Order</Text>
            </LinearGradient>
          </TouchableOpacity>

          <IncomingOrderModal
            order={testOrder}
            onClose={() => setTestOrder(null)}
            onAccept={handleOrderAccept}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  avatarText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  greeting: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3 },
  driverName: { fontSize: 16, fontWeight: "800", marginTop: 1 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 9 },

  // Custom online/offline toggle
  onlineTrack: {
    width:        TRACK_W,
    height:       TRACK_H,
    borderRadius: TRACK_H / 2,
    shadowColor:  "#000",
    shadowOpacity: 0.14,
    shadowRadius:  5,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     4,
  },
  onlineThumb: {
    position:        "absolute",
    width:           THUMB_D,
    height:          THUMB_D,
    borderRadius:    THUMB_D / 2,
    backgroundColor: "#fff",
    top:             THUMB_EDGE,
    shadowColor:     "#000",
    shadowOpacity:   0.20,
    shadowRadius:    4,
    shadowOffset:    { width: 0, height: 2 },
    elevation:       5,
  },

  // Active plan pill — sits in the header next to the online toggle
  planPill: {
    borderRadius:  20,
    shadowColor:   "#16A34A",
    shadowOpacity: 0.30,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     4,
  },
  planPillGrad: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              5,
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:     20,
  },
  planPillDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: "rgba(255,255,255,0.80)",
  },
  planPillText: {
    fontSize:      11,
    fontWeight:    "800" as const,
    color:         "#fff",
    letterSpacing: 0.1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  notifBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  notifBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 18,
  },
  statusLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  statusDotWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotPulse: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusDotCore: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  statusValue: { fontSize: 22, fontWeight: "800", marginTop: 2, letterSpacing: -0.3 },
  statusSub: { fontSize: 11, marginTop: 2 },

  earningsCard: {
    borderRadius: 20,
    padding: 18,
    gap: 16,
    shadowColor: "#00C853",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  earningsTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  earningsLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.8)", letterSpacing: 0.6 },
  earningsAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 4 },
  earningsCurrency: { fontSize: 20, fontWeight: "700", color: "#fff", marginBottom: 4 },
  earningsAmount: { fontSize: 36, fontWeight: "800", color: "#fff", letterSpacing: -1, lineHeight: 40 },
  earningsDelta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
    marginBottom: 6,
  },
  earningsDeltaText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  cashoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 11,
  },
  cashoutText: { color: "#0a0a0a", fontSize: 12, fontWeight: "700" },
  earningsBreakdown: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
  },
  breakdownItem: { flex: 1, alignItems: "center", gap: 2 },
  breakdownValue: { fontSize: 15, fontWeight: "800", color: "#fff" },
  breakdownLabel: { fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: "500" },
  breakdownDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)" },

  quickStats: { flexDirection: "row", gap: 10 },
  qStatCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: "flex-start",
    gap: 6,
  },
  qStatIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  qStatValue: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  qStatLabel: { fontSize: 11, fontWeight: "500" },

  requestCard: {
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  requestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  requestTitle: { fontSize: 15, fontWeight: "700" },
  requestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  requestBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  requestBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  requestActive: { alignItems: "center", gap: 8, paddingVertical: 14 },
  requestOffline: { alignItems: "center", gap: 4, paddingVertical: 6 },
  mapWrap: {
    height: 260,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e8eef3",
    position: "relative",
    marginTop: 4,
  },
  mapPinWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -11,
    marginTop: -11,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPulse: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  mapPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
  },
  mapPinInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  mapZoom: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: "#fff",
    borderRadius: 6,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  },
  mapZoomBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  mapLocate: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  },
  mapLocChip: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
  },
  mapLocText: {
    fontSize: 11,
    color: "#333",
    fontWeight: "600" as const,
  },
  radarWrap: {
    width: 110,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  radarRing: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
  },
  radarCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  offlineIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  requestActiveTitle: { fontSize: 16, fontWeight: "700", marginTop: 4 },
  requestActiveSub: { fontSize: 12, textAlign: "center", lineHeight: 17, paddingHorizontal: 16 },
  requestStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    backgroundColor: "#fafafa",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  requestStat: { flex: 1, alignItems: "center", gap: 2 },
  requestStatNum: { fontSize: 15, fontWeight: "800" },
  requestStatLbl: { fontSize: 10, fontWeight: "500" },
  requestVDivider: { width: 1, height: 26 },
  goOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 2,
  },
  goOnlineText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  simulateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 8,
  },
  simulateText: { fontSize: 11, fontWeight: "700" },

  goalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  goalLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  goalTitle: { fontSize: 18, fontWeight: "800", marginTop: 3, letterSpacing: -0.3 },
  goalTotal: { fontSize: 13, fontWeight: "600" },
  goalPctChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  goalPctText: { fontSize: 13, fontWeight: "800" },
  goalTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  goalFill: { height: "100%", borderRadius: 4 },
  goalFooter: { flexDirection: "row", justifyContent: "space-between" },
  goalFooterText: { fontSize: 11, fontWeight: "600" },

  quickActions: { flexDirection: "row", gap: 10 },
  actionTile: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 11, fontWeight: "700" },

  // Floating test-order button
  testOrderBtn: {
    position: "absolute",
    right: 16,
    width: 64,
    height: 64,
    borderRadius: 20,
    shadowColor: "#4F46E5",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  testOrderGrad: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  testOrderIcon:  { fontSize: 20 },
  testOrderLabel: { fontSize: 9, fontWeight: "800", color: "#fff", textAlign: "center", lineHeight: 11 },

  // Action cards row — always visible, 50/50, compact 3D glass style
  actionCardsRow: {
    flexDirection: "row",
    gap:           13,
  },
  actionCardWrap: {
    flex:          1,
    borderRadius:  18,
    overflow:      "hidden",
    // 3D floating shadow
    shadowColor:   "#000",
    shadowOpacity: 0.28,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 6 },
    elevation:     8,
  },
  actionCard: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingVertical:   13,
    paddingHorizontal: 13,
    gap:               11,
    minHeight:         62,
  },
  // ── Plan expiry banners (active state moved to header pill) ─────────────
  bannerRed: {
    backgroundColor: "#DC2626",
    borderRadius:    12,
    overflow:        "hidden" as const,
  },
  bannerAmber: {
    backgroundColor: "#D97706",
    borderRadius:    12,
    overflow:        "hidden" as const,
  },
  bannerInner: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  bannerTitle: {
    fontSize:   13,
    fontWeight: "700" as const,
    color:      "#fff",
    marginBottom: 1,
  },
  bannerSub: {
    fontSize:   11,
    fontWeight: "500" as const,
    color:      "rgba(255,255,255,0.88)",
    lineHeight: 15,
  },
  bannerCta: {
    backgroundColor:  "rgba(255,255,255,0.22)",
    borderRadius:     8,
    paddingHorizontal: 10,
    paddingVertical:  6,
    flexShrink:       0,
  },
  bannerCtaText: {
    fontSize:   11,
    fontWeight: "700" as const,
    color:      "#fff",
    letterSpacing: -0.1,
  },
  // Frosted glass top-highlight (absolute overlay)
  actionCardGlass: {
    position:        "absolute",
    top:             0,
    left:            0,
    right:           0,
    height:          "50%",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderTopLeftRadius:  18,
    borderTopRightRadius: 18,
  },
  // Icon pill
  actionCardIconWrap: {
    width:           32,
    height:          32,
    borderRadius:    9,
    backgroundColor: "rgba(255,255,255,0.20)",
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  // Text column
  actionCardContent: {
    flex: 1,
    gap:  2,
  },
  actionCardTitle: {
    fontSize:      13,
    fontWeight:    "800",
    color:         "#fff",
    letterSpacing: -0.1,
  },
  actionCardSub: {
    fontSize:   10,
    fontWeight: "500",
    color:      "rgba(255,255,255,0.78)",
  },
  // Orange card: static red availability dot (top-right corner)
  actionCardBadgeDot: {
    position:        "absolute",
    top:             9,
    right:           9,
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: "#FF3B30",
    borderWidth:     1.5,
    borderColor:     "rgba(255,255,255,0.6)",
  },
  // Blue card: count badge (top-right corner, only when activeOrderCount > 0)
  actionCardBadgeCount: {
    position:        "absolute",
    top:             7,
    right:           9,
    minWidth:        18,
    height:          18,
    borderRadius:    9,
    backgroundColor: "#FF3B30",
    alignItems:      "center",
    justifyContent:  "center",
    paddingHorizontal: 4,
    borderWidth:     1.5,
    borderColor:     "rgba(255,255,255,0.55)",
  },
  actionCardBadgeText: {
    fontSize:   10,
    fontWeight: "800",
    color:      "#fff",
    lineHeight: 12,
  },
});
