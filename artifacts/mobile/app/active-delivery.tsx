/**
 * active-delivery.tsx
 *
 * Shown after driver accepts an order.
 * Realistic active delivery experience:
 *  - "Navigating to pickup" with step tracker
 *  - Pickup details card (address, customer, parcel)
 *  - Call / Chat buttons
 *  - Live status pill
 *  - "Arrived at Pickup" CTA → transitions to "Picked Up" → "Delivered"
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Brand ───────────────────────────────────────────────────────
const GREEN  = "#00C853";
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";

// ─── Delivery stages ──────────────────────────────────────────────
type Stage = "navigating" | "arrived" | "picked_up" | "delivered";

const STAGE_META: Record<Stage, { label: string; sub: string; emoji: string; cta: string; nextStage: Stage | null }> = {
  navigating: {
    label: "Navigating to Pickup",
    sub: "Head to the pickup location",
    emoji: "🛵",
    cta: "Arrived at Pickup",
    nextStage: "arrived",
  },
  arrived: {
    label: "Arrived at Pickup",
    sub: "Collect the parcel from customer",
    emoji: "📦",
    cta: "Parcel Picked Up",
    nextStage: "picked_up",
  },
  picked_up: {
    label: "Heading to Drop",
    sub: "Navigate to drop-off location",
    emoji: "🚀",
    cta: "Order Delivered",
    nextStage: "delivered",
  },
  delivered: {
    label: "Order Delivered!",
    sub: "Great job! Earning credited.",
    emoji: "✅",
    cta: "Back to Home",
    nextStage: null,
  },
};

const STEPS: { id: Stage; label: string }[] = [
  { id: "navigating", label: "To Pickup" },
  { id: "arrived",    label: "Arrived"   },
  { id: "picked_up",  label: "Picked Up" },
  { id: "delivered",  label: "Delivered" },
];

function stepIndex(s: Stage) {
  return STEPS.findIndex((x) => x.id === s);
}

// ─── Pulsing live dot ─────────────────────────────────────────────
function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{
        position: "absolute", width: 12, height: 12, borderRadius: 6,
        backgroundColor: GREEN + "50", transform: [{ scale: pulse }],
      }} />
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: GREEN }} />
    </View>
  );
}

// ─── Step tracker ─────────────────────────────────────────────────
function StepTracker({ current }: { current: Stage }) {
  const idx = stepIndex(current);
  return (
    <View style={styles.stepRow}>
      {STEPS.map((step, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <View key={step.id} style={styles.stepItem}>
            <View style={[
              styles.stepCircle,
              done   && { backgroundColor: GREEN, borderColor: GREEN },
              active && { borderColor: GREEN },
              !done && !active && { borderColor: "#E5E7EB" },
            ]}>
              {done ? (
                <Feather name="check" size={10} color="#fff" />
              ) : (
                <View style={[
                  styles.stepDot,
                  { backgroundColor: active ? GREEN : "#E5E7EB" },
                ]} />
              )}
            </View>
            <Text style={[
              styles.stepLabel,
              { color: active ? GREEN : done ? "#374151" : "#9CA3AF" },
            ]}>
              {step.label}
            </Text>
            {i < STEPS.length - 1 && (
              <View style={[styles.stepLine, { backgroundColor: done ? GREEN : "#E5E7EB" }]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Timer (elapsed) ─────────────────────────────────────────────
function ElapsedTimer({ running }: { running: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  return <Text style={styles.elapsedText}>{m}:{s}</Text>;
}

// ─── Main screen ──────────────────────────────────────────────────
export default function ActiveDeliveryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    customer: string;
    parcelType: string;
    parcelEmoji: string;
    pickup: string;
    pickupCity: string;
    drop: string;
    dropCity: string;
    distanceKm: string;
    durationMin: string;
    earning: string;
    weight: string;
  }>();

  const [stage, setStage] = useState<Stage>("navigating");
  const meta = STAGE_META[stage];
  const isDelivered = stage === "delivered";

  // Slide-up animation for CTA button
  const btnY = useRef(new Animated.Value(80)).current;
  useEffect(() => {
    Animated.spring(btnY, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }).start();
  }, [stage]);

  function advance() {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    if (!meta.nextStage) {
      // delivered → home
      router.replace("/(tabs)");
      return;
    }
    btnY.setValue(80);
    setStage(meta.nextStage);
  }

  function handleCall() {
    Alert.alert("Calling customer", `Connecting to ${params.customer ?? "customer"}…`, [
      { text: "End call", style: "destructive" }, { text: "OK" },
    ]);
  }

  function handleChat() {
    Alert.alert("Chat", "In-app chat opening…", [{ text: "OK" }]);
  }

  const earning   = params.earning   ? `₹${params.earning}`   : "₹—";
  const distance  = params.distanceKm ? `${params.distanceKm} km` : "—";
  const duration  = params.durationMin ? `${params.durationMin} min` : "—";
  const weight    = params.weight ?? "—";
  const customer  = params.customer ?? "Customer";
  const pickup    = params.pickup   ?? "Pickup location";
  const pickupCity = params.pickupCity ?? "";
  const drop      = params.drop     ?? "Drop location";
  const dropCity  = params.dropCity ?? "";
  const emoji     = params.parcelEmoji ?? "📦";
  const parcel    = params.parcelType  ?? "Parcel";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Top status bar ── */}
      <LinearGradient
        colors={isDelivered ? ["#00C853", "#00E676"] : ["#111827", "#1F2937"]}
        style={styles.topBar}
      >
        <View style={styles.topBarLeft}>
          {!isDelivered && <LiveDot />}
          <Text style={styles.topBarTitle}>{meta.label}</Text>
        </View>
        <View style={styles.topBarRight}>
          {!isDelivered && <ElapsedTimer running={!isDelivered} />}
          {isDelivered && <Text style={styles.topBarEmoji}>🎉</Text>}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Step tracker */}
        <View style={styles.section}>
          <StepTracker current={stage} />
        </View>

        {/* Map placeholder */}
        <View style={styles.mapPlaceholder}>
          <LinearGradient
            colors={["#E8F5E9", "#F0FDF4"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.mapInner}>
            <Text style={styles.mapEmoji}>{meta.emoji}</Text>
            <Text style={styles.mapLabel}>{meta.sub}</Text>
            <View style={styles.mapRouteRow}>
              <View style={styles.mapDotGreen} />
              <View style={styles.mapDashes} />
              <View style={styles.mapDotRed} />
            </View>
          </View>
        </View>

        {/* Order info card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{customer.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.customerName}>{customer}</Text>
              <Text style={styles.customerSub}>✓ Verified customer</Text>
            </View>
            <View style={styles.parcelBadge}>
              <Text style={{ fontSize: 16 }}>{emoji}</Text>
              <Text style={styles.parcelType}>{parcel}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Route */}
          <View style={styles.routeBlock}>
            <View style={styles.routeRow}>
              <View style={styles.routeDotGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeAddress}>{pickup}</Text>
                <Text style={styles.routeCity}>{pickupCity}</Text>
              </View>
            </View>
            <View style={styles.routeConnector}>
              <View style={styles.connectorLine} />
            </View>
            <View style={styles.routeRow}>
              <View style={styles.routeDotRed} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>DROP</Text>
                <Text style={styles.routeAddress}>{drop}</Text>
                <Text style={styles.routeCity}>{dropCity}</Text>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { icon: "map-pin",  color: PINK,   val: distance, lbl: "Distance" },
              { icon: "clock",    color: ORANGE,  val: duration, lbl: "Est. Time" },
              { icon: "package",  color: "#6B7280", val: weight, lbl: "Weight"   },
            ].map((s) => (
              <View key={s.lbl} style={styles.statItem}>
                <Feather name={s.icon as any} size={13} color={s.color} />
                <Text style={styles.statVal}>{s.val}</Text>
                <Text style={styles.statLbl}>{s.lbl}</Text>
              </View>
            ))}
            <LinearGradient
              colors={[PINK + "18", ORANGE + "12"]}
              style={styles.earningChip}
            >
              <Text style={styles.earningAmt}>{earning}</Text>
              <Text style={styles.earningLbl}>Earning</Text>
            </LinearGradient>
          </View>

          {/* Call / Chat (only before delivery) */}
          {!isDelivered && (
            <View style={styles.contactRow}>
              <TouchableOpacity style={styles.contactBtn} onPress={handleCall} activeOpacity={0.8}>
                <LinearGradient colors={["#E8F5E9", "#D1FAE5"]} style={styles.contactGrad}>
                  <Feather name="phone" size={18} color={GREEN} />
                  <Text style={[styles.contactText, { color: GREEN }]}>Call</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.contactBtn} onPress={handleChat} activeOpacity={0.8}>
                <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={styles.contactGrad}>
                  <Feather name="message-circle" size={18} color="#3B82F6" />
                  <Text style={[styles.contactText, { color: "#3B82F6" }]}>Chat</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Delivered celebration */}
        {isDelivered && (
          <View style={styles.celebrationCard}>
            <Text style={styles.celebrationEmoji}>🎉</Text>
            <Text style={styles.celebrationTitle}>Delivery Complete!</Text>
            <Text style={styles.celebrationSub}>
              {earning} has been credited to your wallet.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <Animated.View
        style={[
          styles.ctaWrap,
          {
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: btnY }],
          },
        ]}
      >
        <TouchableOpacity onPress={advance} activeOpacity={0.88} style={{ borderRadius: 16, overflow: "hidden" }}>
          <LinearGradient
            colors={isDelivered ? ["#00C853", "#00E676"] : [GREEN, "#00E676"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.ctaBtn}
          >
            <Feather
              name={isDelivered ? "home" : "check-circle"}
              size={20} color="#fff"
            />
            <Text style={styles.ctaText}>{meta.cta}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F9FAFB" },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
  },
  topBarLeft:  { flexDirection: "row", alignItems: "center", gap: 8 },
  topBarTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  topBarRight: { alignItems: "flex-end" },
  elapsedText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.75)", fontVariant: ["tabular-nums"] },
  topBarEmoji: { fontSize: 24 },

  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },

  // Step tracker
  section:  { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#F0F0F0", padding: 16 },
  stepRow:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  stepItem: { flex: 1, alignItems: "center", position: "relative" },
  stepCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", zIndex: 1,
  },
  stepDot:   { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: 10, fontWeight: "600", marginTop: 5, textAlign: "center" },
  stepLine: {
    position: "absolute", top: 11, left: "50%", right: "-50%",
    height: 2, zIndex: 0,
  },

  // Map placeholder
  mapPlaceholder: {
    height: 160, borderRadius: 16, overflow: "hidden",
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  mapInner:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  mapEmoji:    { fontSize: 40 },
  mapLabel:    { fontSize: 14, fontWeight: "600", color: "#374151" },
  mapRouteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mapDotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  mapDashes:   { flex: 1, height: 2, backgroundColor: "#D1FAE5", maxWidth: 80 },
  mapDotRed:   { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF3B30" },

  // Card
  card: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#F0F0F0",
    padding: 16, gap: 14,
  },
  cardHeader:   { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: PINK + "20", alignItems: "center", justifyContent: "center",
  },
  avatarText:   { fontSize: 18, fontWeight: "800", color: PINK },
  customerName: { fontSize: 15, fontWeight: "700", color: "#111" },
  customerSub:  { fontSize: 11, color: "#10B981", fontWeight: "600", marginTop: 1 },
  parcelBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  parcelType:  { fontSize: 12, fontWeight: "700", color: "#374151" },
  divider:     { height: 1, backgroundColor: "#F3F4F6" },

  // Route
  routeBlock:    { gap: 0 },
  routeRow:      { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  routeDotGreen: { width: 12, height: 12, borderRadius: 6, backgroundColor: GREEN, marginTop: 2 },
  routeDotRed:   { width: 12, height: 12, borderRadius: 6, backgroundColor: "#FF3B30", marginTop: 2 },
  routeLabel:    { fontSize: 9, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.8 },
  routeAddress:  { fontSize: 13, fontWeight: "700", color: "#111" },
  routeCity:     { fontSize: 11, color: "#6B7280", fontWeight: "500", marginTop: 1 },
  routeConnector: { paddingLeft: 5, paddingVertical: 3 },
  connectorLine:  { width: 2, height: 16, backgroundColor: "#E5E7EB", marginLeft: 5, borderRadius: 1 },

  // Stats
  statsRow:   { flexDirection: "row", alignItems: "center" },
  statItem:   { flex: 1, alignItems: "center", gap: 3 },
  statVal:    { fontSize: 13, fontWeight: "800", color: "#111" },
  statLbl:    { fontSize: 9, fontWeight: "600", color: "#9CA3AF" },
  earningChip: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: PINK + "22",
  },
  earningAmt: { fontSize: 15, fontWeight: "900", color: PINK },
  earningLbl: { fontSize: 9,  fontWeight: "700", color: ORANGE },

  // Contact
  contactRow: { flexDirection: "row", gap: 10 },
  contactBtn: { flex: 1, borderRadius: 12, overflow: "hidden" },
  contactGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  contactText: { fontSize: 14, fontWeight: "700" },

  // Celebration
  celebrationCard: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: "#b9f6ca",
    padding: 24, alignItems: "center", gap: 8,
  },
  celebrationEmoji: { fontSize: 48 },
  celebrationTitle: { fontSize: 20, fontWeight: "800", color: "#111" },
  celebrationSub:   { fontSize: 14, color: "#6B7280", textAlign: "center" },

  // CTA
  ctaWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14,
    backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: "#F0F0F0",
    shadowColor: "#000", shadowOpacity: 0.06,
    shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8,
  },
  ctaBtn: {
    height: 58, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 10, borderRadius: 16,
  },
  ctaText: { fontSize: 17, fontWeight: "800", color: "#fff" },
});
