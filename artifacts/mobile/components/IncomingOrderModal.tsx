import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

// ─── Brand ─────────────────────────────────────────────────────
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";
const GREEN  = "#00C853";
const RED    = "#FF3B30";

// ─── Dummy orders ───────────────────────────────────────────────
export type TestOrder = {
  id: number;
  customer: string;
  parcelType: string;
  parcelEmoji: string;
  pickup: string;
  pickupCity: string;
  drop: string;
  dropCity: string;
  distanceKm: number;
  durationMin: number;
  earning: number;
  surge: boolean;
  surgeMultiplier?: number;
  weight?: string;
};

export const TEST_ORDERS: TestOrder[] = [
  {
    id: 1,
    customer: "Rahul Sharma",
    parcelType: "Electronics",
    parcelEmoji: "📱",
    pickup: "Koramangala 5th Block",
    pickupCity: "Bangalore",
    drop: "Indiranagar 100ft Road",
    dropCity: "Bangalore",
    distanceKm: 3.2,
    durationMin: 12,
    earning: 185,
    surge: false,
    weight: "1.2 kg",
  },
  {
    id: 2,
    customer: "Priya Mehta",
    parcelType: "Food",
    parcelEmoji: "🍱",
    pickup: "HSR Layout Sector 6",
    pickupCity: "Bangalore",
    drop: "Electronic City Phase 1",
    dropCity: "Bangalore",
    distanceKm: 8.5,
    durationMin: 22,
    earning: 290,
    surge: true,
    surgeMultiplier: 1.4,
    weight: "2.5 kg",
  },
  {
    id: 3,
    customer: "Arjun Nair",
    parcelType: "Documents",
    parcelEmoji: "📄",
    pickup: "Andheri West, SV Road",
    pickupCity: "Mumbai",
    drop: "Bandra Kurla Complex",
    dropCity: "Mumbai",
    distanceKm: 5.1,
    durationMin: 18,
    earning: 220,
    surge: false,
    weight: "0.5 kg",
  },
  {
    id: 4,
    customer: "Sunita Reddy",
    parcelType: "Grocery",
    parcelEmoji: "🛒",
    pickup: "Jubilee Hills Road 36",
    pickupCity: "Hyderabad",
    drop: "Gachibowli Financial District",
    dropCity: "Hyderabad",
    distanceKm: 11.3,
    durationMin: 28,
    earning: 340,
    surge: true,
    surgeMultiplier: 1.6,
    weight: "6.0 kg",
  },
  {
    id: 5,
    customer: "Vikram Patel",
    parcelType: "Medicine",
    parcelEmoji: "💊",
    pickup: "Borivali West Station",
    pickupCity: "Mumbai",
    drop: "Goregaon East SEEPZ",
    dropCity: "Mumbai",
    distanceKm: 4.7,
    durationMin: 15,
    earning: 165,
    surge: false,
    weight: "0.3 kg",
  },
  {
    id: 6,
    customer: "Ananya Singh",
    parcelType: "Clothing",
    parcelEmoji: "👗",
    pickup: "Lajpat Nagar Central Market",
    pickupCity: "Delhi",
    drop: "Saket Select City Walk",
    dropCity: "Delhi",
    distanceKm: 6.8,
    durationMin: 20,
    earning: 245,
    surge: false,
    weight: "1.8 kg",
  },
  {
    id: 7,
    customer: "Karthik Rajan",
    parcelType: "Electronics",
    parcelEmoji: "💻",
    pickup: "Anna Nagar 2nd Avenue",
    pickupCity: "Chennai",
    drop: "OMR Perungudi Roundabout",
    dropCity: "Chennai",
    distanceKm: 14.2,
    durationMin: 35,
    earning: 410,
    surge: true,
    surgeMultiplier: 1.3,
    weight: "3.2 kg",
  },
  {
    id: 8,
    customer: "Meera Iyer",
    parcelType: "Gift",
    parcelEmoji: "🎁",
    pickup: "Viman Nagar Clover Centre",
    pickupCity: "Pune",
    drop: "Hinjewadi Phase 3",
    dropCity: "Pune",
    distanceKm: 9.6,
    durationMin: 25,
    earning: 305,
    surge: false,
    weight: "2.1 kg",
  },
  {
    id: 9,
    customer: "Rohit Gupta",
    parcelType: "Books",
    parcelEmoji: "📚",
    pickup: "Salt Lake Sector V",
    pickupCity: "Kolkata",
    drop: "Park Street AJC Bose Road",
    dropCity: "Kolkata",
    distanceKm: 7.4,
    durationMin: 22,
    earning: 215,
    surge: false,
    weight: "4.0 kg",
  },
  {
    id: 10,
    customer: "Deepa Krishnan",
    parcelType: "Fragile",
    parcelEmoji: "🏺",
    pickup: "MG Road Brigade Road",
    pickupCity: "Bangalore",
    drop: "Whitefield Prestige Tech Park",
    dropCity: "Bangalore",
    distanceKm: 17.8,
    durationMin: 42,
    earning: 520,
    surge: true,
    surgeMultiplier: 2.0,
    weight: "3.5 kg",
  },
];

// ─── Circular countdown timer ───────────────────────────────────
const TIMER_SIZE  = 56;
const TIMER_R     = 22;
const CIRCUMF     = 2 * Math.PI * TIMER_R;
const COUNTDOWN_S = 20;

function TimerCircle({ seconds, total }: { seconds: number; total: number }) {
  const pct      = seconds / total;
  const dashOff  = CIRCUMF * (1 - pct);
  const color    = seconds <= 6 ? RED : seconds <= 12 ? ORANGE : GREEN;

  return (
    <View style={styles.timerWrap}>
      <Svg width={TIMER_SIZE} height={TIMER_SIZE}>
        {/* Track */}
        <Circle
          cx={TIMER_SIZE / 2}
          cy={TIMER_SIZE / 2}
          r={TIMER_R}
          stroke="#E5E7EB"
          strokeWidth={3.5}
          fill="none"
        />
        {/* Progress */}
        <Circle
          cx={TIMER_SIZE / 2}
          cy={TIMER_SIZE / 2}
          r={TIMER_R}
          stroke={color}
          strokeWidth={3.5}
          fill="none"
          strokeDasharray={`${CIRCUMF} ${CIRCUMF}`}
          strokeDashoffset={dashOff}
          strokeLinecap="round"
          rotation={-90}
          originX={TIMER_SIZE / 2}
          originY={TIMER_SIZE / 2}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.timerCenter}>
          <Text style={[styles.timerNum, { color }]}>{seconds}</Text>
          <Text style={styles.timerSec}>sec</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Pulsing dot ────────────────────────────────────────────────
function PulseDot({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.4, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          width: 10, height: 10, borderRadius: 5,
          backgroundColor: color + "40",
          transform: [{ scale: pulse }],
          position: "absolute",
        }}
      />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────
type Props = {
  order: TestOrder | null;
  onClose: () => void;
  onAccept: (order: TestOrder) => void;
};

export default function IncomingOrderModal({ order, onClose, onAccept }: Props) {
  const slideY  = useRef(new Animated.Value(600)).current;
  const bgOpac  = useRef(new Animated.Value(0)).current;
  const [seconds, setSeconds] = useState(COUNTDOWN_S);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Animate in + haptics + vibration on order arrival ──
  useEffect(() => {
    if (!order) return;

    setSeconds(COUNTDOWN_S);

    // Slide up + fade backdrop
    Animated.parallel([
      Animated.spring(slideY, {
        toValue: 0,
        friction: 9,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(bgOpac, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();

    // Haptics + vibration — notification feel
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Vibration.vibrate([0, 400, 200, 400, 200, 400]);
    }

    // Countdown
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          handleClose();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      Vibration.cancel();
    };
  }, [order?.id]);

  function handleClose() {
    if (timerRef.current) clearInterval(timerRef.current);
    Vibration.cancel();
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 300, useNativeDriver: true }),
      Animated.timing(bgOpac, { toValue: 0,   duration: 220, useNativeDriver: true }),
    ]).start(() => {
      slideY.setValue(600);
      bgOpac.setValue(0);
      onClose();
    });
  }

  function handleAccept() {
    if (!order) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    if (timerRef.current) clearInterval(timerRef.current);
    Vibration.cancel();
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 300, useNativeDriver: true }),
      Animated.timing(bgOpac, { toValue: 0,   duration: 220, useNativeDriver: true }),
    ]).start(() => {
      slideY.setValue(600);
      bgOpac.setValue(0);
      onAccept(order);
    });
  }

  function handleReject() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    handleClose();
  }

  if (!order) return null;

  const earningDisplay = order.surge
    ? Math.round(order.earning * (order.surgeMultiplier ?? 1))
    : order.earning;

  return (
    <Modal transparent visible={!!order} animationType="none" statusBarTranslucent>
      {/* ── Dim backdrop ── */}
      <Animated.View style={[styles.backdrop, { opacity: bgOpac }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleReject} />
      </Animated.View>

      {/* ── Bottom sheet ── */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideY }] }]}
        pointerEvents="box-none"
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header row */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.bellWrap}>
              <LinearGradient colors={[PINK, ORANGE]} style={styles.bellGrad}>
                <Feather name="bell" size={18} color="#fff" />
              </LinearGradient>
            </View>
            <View>
              <Text style={styles.headerTitle}>New Delivery Request</Text>
              <View style={styles.liveDot}>
                <PulseDot color={GREEN} />
                <Text style={styles.liveText}>Live order · Just now</Text>
              </View>
            </View>
          </View>
          <TimerCircle seconds={seconds} total={COUNTDOWN_S} />
        </View>

        <View style={styles.divider} />

        {/* Customer info */}
        <View style={styles.customerRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {order.customer.charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.customerName}>{order.customer}</Text>
            <Text style={styles.customerSub}>Verified customer</Text>
          </View>
          <View style={styles.parcelBadge}>
            <Text style={styles.parcelEmoji}>{order.parcelEmoji}</Text>
            <Text style={styles.parcelType}>{order.parcelType}</Text>
          </View>
        </View>

        {/* Route card */}
        <View style={styles.routeCard}>
          {/* Pickup */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.routeAddress} numberOfLines={1}>{order.pickup}</Text>
              <Text style={styles.routeCity}>{order.pickupCity}</Text>
            </View>
          </View>

          {/* Connector line */}
          <View style={styles.routeConnector}>
            <View style={styles.connectorLine} />
          </View>

          {/* Drop */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotRed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>DROP</Text>
              <Text style={styles.routeAddress} numberOfLines={1}>{order.drop}</Text>
              <Text style={styles.routeCity}>{order.dropCity}</Text>
            </View>
          </View>
        </View>

        {/* Stats bar */}
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <Feather name="map-pin" size={14} color={PINK} />
            <Text style={styles.statValue}>{order.distanceKm} km</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Feather name="clock" size={14} color={ORANGE} />
            <Text style={styles.statValue}>{order.durationMin} min</Text>
            <Text style={styles.statLabel}>Est. time</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Feather name="package" size={14} color="#6B7280" />
            <Text style={styles.statValue}>{order.weight}</Text>
            <Text style={styles.statLabel}>Weight</Text>
          </View>
          <View style={styles.statDivider} />
          {/* Earning — highlighted */}
          <LinearGradient
            colors={[PINK + "18", ORANGE + "12"]}
            style={styles.earningChip}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {order.surge && (
              <View style={styles.surgeTag}>
                <Text style={styles.surgeText}>⚡ {order.surgeMultiplier}x</Text>
              </View>
            )}
            <Text style={styles.earningAmt}>₹{earningDisplay}</Text>
            <Text style={styles.earningLabel}>Earning</Text>
          </LinearGradient>
        </View>

        {/* Expiry hint */}
        <Text style={styles.expiryHint}>
          Request auto-expires in {seconds}s · Tap outside to decline
        </Text>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={handleReject}
            activeOpacity={0.8}
          >
            <Feather name="x" size={20} color={RED} />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.acceptBtnWrap}
            onPress={handleAccept}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[GREEN, "#00E676"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.acceptBtn}
            >
              <Feather name="check" size={20} color="#fff" />
              <Text style={styles.acceptText}>Accept  ₹{earningDisplay}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 24,
  },

  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginBottom: 16,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  bellWrap:   { borderRadius: 14, overflow: "hidden", shadowColor: PINK, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  bellGrad:   { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#111", letterSpacing: -0.2 },
  liveDot:    { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  liveText:   { fontSize: 11, color: "#6B7280", fontWeight: "500" },

  // Timer
  timerWrap:  { width: TIMER_SIZE, height: TIMER_SIZE, position: "relative" },
  timerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  timerNum:   { fontSize: 15, fontWeight: "800", lineHeight: 17 },
  timerSec:   { fontSize: 8, color: "#9CA3AF", fontWeight: "600", lineHeight: 10 },

  divider: { height: 1, backgroundColor: "#F3F4F6", marginBottom: 14 },

  // Customer
  customerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  avatarCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: PINK + "20",
    alignItems: "center", justifyContent: "center",
  },
  avatarText:  { fontSize: 18, fontWeight: "800", color: PINK },
  customerName: { fontSize: 15, fontWeight: "700", color: "#111" },
  customerSub:  { fontSize: 11, color: "#10B981", fontWeight: "600", marginTop: 1 },
  parcelBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10,
  },
  parcelEmoji: { fontSize: 16 },
  parcelType:  { fontSize: 12, fontWeight: "700", color: "#374151" },

  // Route
  routeCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#F0F0F0",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 0,
  },
  routeRow:       { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  routeDotGreen:  { width: 12, height: 12, borderRadius: 6, backgroundColor: GREEN, marginTop: 2 },
  routeDotRed:    { width: 12, height: 12, borderRadius: 6, backgroundColor: RED,   marginTop: 2 },
  routeLabel:     { fontSize: 9, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.8, marginBottom: 1 },
  routeAddress:   { fontSize: 13, fontWeight: "700", color: "#111" },
  routeCity:      { fontSize: 11, color: "#6B7280", fontWeight: "500", marginTop: 1 },
  routeConnector: { paddingLeft: 5, paddingVertical: 3 },
  connectorLine:  { width: 2, height: 18, backgroundColor: "#E5E7EB", marginLeft: 5, borderRadius: 1 },

  // Stats
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F0F0F0",
    padding: 12,
    marginBottom: 10,
    gap: 0,
  },
  statItem:   { flex: 1, alignItems: "center", gap: 3 },
  statValue:  { fontSize: 13, fontWeight: "800", color: "#111" },
  statLabel:  { fontSize: 9, fontWeight: "600", color: "#9CA3AF" },
  statDivider: { width: 1, height: 32, backgroundColor: "#E5E7EB" },
  earningChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PINK + "22",
    gap: 2,
    position: "relative",
  },
  earningAmt:   { fontSize: 16, fontWeight: "900", color: PINK },
  earningLabel: { fontSize: 9,  fontWeight: "700", color: ORANGE },
  surgeTag: {
    position: "absolute",
    top: -8,
    backgroundColor: ORANGE,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  surgeText: { fontSize: 9, fontWeight: "800", color: "#fff" },

  expiryHint: {
    textAlign: "center",
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
    marginBottom: 14,
  },

  // Buttons
  actionRow: { flexDirection: "row", gap: 12 },
  rejectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 2,
    borderColor: RED + "40",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: RED + "08",
    minWidth: 110,
  },
  rejectText: { fontSize: 15, fontWeight: "800", color: RED },
  acceptBtnWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GREEN,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  acceptText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
