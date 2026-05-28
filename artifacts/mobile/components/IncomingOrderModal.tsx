/**
 * IncomingOrderModal — Multi-order swipeable slider
 *
 * Shows 3 nearby delivery requests in a compact horizontal carousel.
 * Driver can compare orders, swipe between them, and accept the best one.
 *
 *  • Animated.ScrollView with snap-to-card + center-card scale-up
 *  • Shared 15-second countdown on each card
 *  • Per-card decline (removes card from pool)
 *  • Accept navigates to active-delivery
 *  • expo-audio looping ringtone + Vibration repeating pattern
 *  • "Tap card to expand" reveals extra details
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

// ─── Brand ────────────────────────────────────────────────────────────────────
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";
const GREEN  = "#00C853";
const RED    = "#FF3B30";
const NAVY   = "#111827";

// ─── Layout ───────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W      = Math.round(SCREEN_W * 0.75);
const CARD_GAP    = 12;
const SNAP        = CARD_W + CARD_GAP;
const SIDE_PAD    = (SCREEN_W - CARD_W) / 2;

// ─── Countdown ────────────────────────────────────────────────────────────────
const COUNTDOWN   = 15;

// ─── Vibration pattern (repeating) ───────────────────────────────────────────
const VIB_PATTERN = [0, 600, 220, 600, 220, 600, 900];

// ─── Types ────────────────────────────────────────────────────────────────────
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
  { id:  1, customer: "Rahul Sharma",   parcelType: "Electronics", parcelEmoji: "📱",
    pickup: "Koramangala 5th Block",  pickupCity: "Bangalore",
    drop: "Indiranagar 100ft Road",   dropCity: "Bangalore",
    distanceKm: 3.2, durationMin: 12, earning: 185, surge: false, weight: "1.2 kg" },
  { id:  2, customer: "Priya Mehta",    parcelType: "Food",        parcelEmoji: "🍱",
    pickup: "HSR Layout Sector 6",    pickupCity: "Bangalore",
    drop: "Electronic City Phase 1",  dropCity: "Bangalore",
    distanceKm: 8.5, durationMin: 22, earning: 290, surge: true, surgeMultiplier: 1.4, weight: "2.5 kg" },
  { id:  3, customer: "Arjun Nair",     parcelType: "Documents",   parcelEmoji: "📄",
    pickup: "Andheri West, SV Road",  pickupCity: "Mumbai",
    drop: "Bandra Kurla Complex",     dropCity: "Mumbai",
    distanceKm: 5.1, durationMin: 18, earning: 220, surge: false, weight: "0.5 kg" },
  { id:  4, customer: "Sunita Reddy",   parcelType: "Grocery",     parcelEmoji: "🛒",
    pickup: "Jubilee Hills Road 36",  pickupCity: "Hyderabad",
    drop: "Gachibowli Financial Dist",dropCity: "Hyderabad",
    distanceKm: 11.3, durationMin: 28, earning: 340, surge: true, surgeMultiplier: 1.6, weight: "6.0 kg" },
  { id:  5, customer: "Vikram Patel",   parcelType: "Medicine",    parcelEmoji: "💊",
    pickup: "Borivali West Station",  pickupCity: "Mumbai",
    drop: "Goregaon East SEEPZ",      dropCity: "Mumbai",
    distanceKm: 4.7, durationMin: 15, earning: 165, surge: false, weight: "0.3 kg" },
  { id:  6, customer: "Ananya Singh",   parcelType: "Clothing",    parcelEmoji: "👗",
    pickup: "Lajpat Nagar Market",    pickupCity: "Delhi",
    drop: "Saket Select City Walk",   dropCity: "Delhi",
    distanceKm: 6.8, durationMin: 20, earning: 245, surge: false, weight: "1.8 kg" },
  { id:  7, customer: "Karthik Rajan",  parcelType: "Electronics", parcelEmoji: "💻",
    pickup: "Anna Nagar 2nd Avenue",  pickupCity: "Chennai",
    drop: "OMR Perungudi Roundabout", dropCity: "Chennai",
    distanceKm: 14.2, durationMin: 35, earning: 410, surge: true, surgeMultiplier: 1.3, weight: "3.2 kg" },
  { id:  8, customer: "Meera Iyer",     parcelType: "Gift",        parcelEmoji: "🎁",
    pickup: "Viman Nagar Clover Ctr", pickupCity: "Pune",
    drop: "Hinjewadi Phase 3",        dropCity: "Pune",
    distanceKm: 9.6, durationMin: 25, earning: 305, surge: false, weight: "2.1 kg" },
  { id:  9, customer: "Rohit Gupta",    parcelType: "Books",       parcelEmoji: "📚",
    pickup: "Salt Lake Sector V",     pickupCity: "Kolkata",
    drop: "Park Street AJC Bose Rd",  dropCity: "Kolkata",
    distanceKm: 7.4, durationMin: 22, earning: 215, surge: false, weight: "4.0 kg" },
  { id: 10, customer: "Deepa Krishnan", parcelType: "Fragile",     parcelEmoji: "🏺",
    pickup: "MG Road Brigade Road",   pickupCity: "Bangalore",
    drop: "Whitefield Prestige Park", dropCity: "Bangalore",
    distanceKm: 17.8, durationMin: 42, earning: 520, surge: true, surgeMultiplier: 2.0, weight: "3.5 kg" },
];

// ─── Mini countdown ring ───────────────────────────────────────────────────────
const RING = 18;
const RING_R = 7;
const RING_CIRC = 2 * Math.PI * RING_R;

function MiniTimer({ seconds, total }: { seconds: number; total: number }) {
  const pct  = seconds / total;
  const off  = RING_CIRC * (1 - pct);
  const col  = seconds <= 5 ? RED : seconds <= 9 ? ORANGE : GREEN;
  return (
    <View style={s.miniTimer}>
      <Svg width={RING} height={RING}>
        <Circle cx={RING/2} cy={RING/2} r={RING_R} stroke="#E5E7EB" strokeWidth={2.5} fill="none" />
        <Circle cx={RING/2} cy={RING/2} r={RING_R}
          stroke={col} strokeWidth={2.5} fill="none"
          strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
          strokeDashoffset={off}
          strokeLinecap="round"
          rotation={-90} originX={RING/2} originY={RING/2} />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={s.miniTimerCenter}>
          <Text style={[s.miniTimerNum, { color: col }]}>{seconds}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────
function LiveDot() {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.7, duration: 600, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ width: 9, height: 9, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{
        position: "absolute", width: 9, height: 9, borderRadius: 4.5,
        backgroundColor: GREEN + "50", transform: [{ scale: anim }],
      }} />
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: GREEN }} />
    </View>
  );
}

// ─── Compact Order Card ────────────────────────────────────────────────────────
type CardProps = {
  order: TestOrder;
  seconds: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onAccept: () => void;
  onDecline: () => void;
};

function OrderCard({ order, seconds, expanded, onToggleExpand, onAccept, onDecline }: CardProps) {
  const earning = order.surge
    ? Math.round(order.earning * (order.surgeMultiplier ?? 1))
    : order.earning;

  // Accept button pulse
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Pressable onPress={onToggleExpand} style={s.card}>
      {/* ── Card top strip ── */}
      <LinearGradient
        colors={[NAVY, "#1F2937"]}
        style={s.cardTop}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      >
        <View style={s.cardTopLeft}>
          <Text style={s.parcelEmoji}>{order.parcelEmoji}</Text>
          <View>
            <Text style={s.parcelType}>{order.parcelType}</Text>
            <View style={s.livePill}>
              <LiveDot />
              <Text style={s.liveText}>Live nearby</Text>
            </View>
          </View>
        </View>
        <View style={s.cardTopRight}>
          {order.surge && (
            <View style={s.surgeBadge}>
              <Text style={s.surgeText}>⚡{order.surgeMultiplier}x</Text>
            </View>
          )}
          <MiniTimer seconds={seconds} total={COUNTDOWN} />
        </View>
      </LinearGradient>

      {/* ── Card body ── */}
      <View style={s.cardBody}>
        {/* Route */}
        <View style={s.routeBlock}>
          <View style={s.routeRow}>
            <View style={s.dotGreen} />
            <View style={{ flex: 1 }}>
              <Text style={s.routeLabel}>PICKUP</Text>
              <Text style={s.routeAddr} numberOfLines={1}>{order.pickup}</Text>
              {expanded && <Text style={s.routeCity}>{order.pickupCity}</Text>}
            </View>
          </View>
          <View style={s.routeConn}><View style={s.connLine} /></View>
          <View style={s.routeRow}>
            <View style={s.dotRed} />
            <View style={{ flex: 1 }}>
              <Text style={s.routeLabel}>DROP</Text>
              <Text style={s.routeAddr} numberOfLines={1}>{order.drop}</Text>
              {expanded && <Text style={s.routeCity}>{order.dropCity}</Text>}
            </View>
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Feather name="navigation" size={11} color={PINK} />
            <Text style={s.statVal}>{order.distanceKm}km</Text>
          </View>
          <View style={s.statDot} />
          <View style={s.statItem}>
            <Feather name="clock" size={11} color={ORANGE} />
            <Text style={s.statVal}>{order.durationMin}min</Text>
          </View>
          {expanded && (
            <>
              <View style={s.statDot} />
              <View style={s.statItem}>
                <Feather name="package" size={11} color="#6B7280" />
                <Text style={s.statVal}>{order.weight}</Text>
              </View>
            </>
          )}
          <View style={{ flex: 1 }} />
          <LinearGradient
            colors={[PINK + "22", ORANGE + "14"]}
            style={s.earningBadge}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          >
            <Text style={s.earningAmt}>₹{earning}</Text>
          </LinearGradient>
        </View>

        {/* Customer row */}
        <View style={s.customerRow}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{order.customer.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.customerName} numberOfLines={1}>{order.customer}</Text>
            <Text style={s.customerSub}>✓ Verified</Text>
          </View>
          {expanded && (
            <View style={s.expandHint}>
              <Feather name="chevron-up" size={13} color="#9CA3AF" />
            </View>
          )}
          {!expanded && (
            <View style={s.expandHint}>
              <Feather name="chevron-down" size={13} color="#9CA3AF" />
              <Text style={s.expandHintText}>Details</Text>
            </View>
          )}
        </View>

        {/* ── Action buttons ── */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.declineBtn} onPress={onDecline} activeOpacity={0.8}>
            <Feather name="x" size={16} color={RED} />
            <Text style={s.declineText}>Skip</Text>
          </TouchableOpacity>

          <Animated.View style={[s.acceptWrap, { transform: [{ scale: pulse }] }]}>
            <TouchableOpacity onPress={onAccept} activeOpacity={0.85} style={{ flex: 1 }}>
              <LinearGradient
                colors={[GREEN, "#00E676"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.acceptBtn}
              >
                <Feather name="check" size={16} color="#fff" />
                <Text style={s.acceptText}>Accept ₹{earning}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Pagination dots ──────────────────────────────────────────────────────────
function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={s.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            s.dot,
            i === active
              ? { width: 18, backgroundColor: GREEN }
              : { width: 6, backgroundColor: "#D1D5DB" },
          ]}
        />
      ))}
    </View>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
type Props = {
  order: TestOrder | null;
  onClose: () => void;
  onAccept: (order: TestOrder) => void;
};

export default function IncomingOrderModal({ order, onClose, onAccept }: Props) {
  // ── Sheet animation ────────────────────────────────────────────────────────
  const slideY = useRef(new Animated.Value(600)).current;
  const bgOpac = useRef(new Animated.Value(0)).current;

  // ── Audio (hook must be unconditional) ─────────────────────────────────────
  const player = useAudioPlayer(null);

  // ── Slider scroll tracking ─────────────────────────────────────────────────
  const scrollX  = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // ── Order pool ─────────────────────────────────────────────────────────────
  const [pool, setPool]         = useState<TestOrder[]>([]);
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [seconds, setSeconds]   = useState(COUNTDOWN);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const visibleOrders = pool.filter((o) => !declined.has(o.id));

  // ── Audio helpers ──────────────────────────────────────────────────────────
  async function startRingtone() {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      player.pause();
      player.loop   = true;
      player.volume = 1.0;
      player.muted  = false;
      player.replace(require("../assets/ringtone.wav") as number);
      player.play();
    } catch {}
  }

  function stopRingtone() {
    try { player.pause(); } catch {}
  }

  // ── Lifecycle: new order triggers slider ───────────────────────────────────
  useEffect(() => {
    if (!order) return;

    // Build a pool of 3 orders: the triggered one + 2 random others
    const others = TEST_ORDERS
      .filter((o) => o.id !== order.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    const newPool = [order, ...others];

    setPool(newPool);
    setDeclined(new Set());
    setExpanded(new Set());
    setSeconds(COUNTDOWN);
    setActiveIdx(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });

    // Animate sheet in
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
      Animated.timing(bgOpac, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();

    startRingtone();

    if (Platform.OS !== "web") {
      Vibration.vibrate(VIB_PATTERN, true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          slideOut(onClose);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timerRef.current!);
      Vibration.cancel();
      stopRingtone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  // ── Auto-close when all cards declined ────────────────────────────────────
  useEffect(() => {
    if (pool.length > 0 && visibleOrders.length === 0) {
      slideOut(onClose);
    }
  }, [declined, pool]);

  // ── Slide-out helper ──────────────────────────────────────────────────────
  function slideOut(cb: () => void) {
    clearInterval(timerRef.current!);
    Vibration.cancel();
    stopRingtone();
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 280, useNativeDriver: true }),
      Animated.timing(bgOpac, { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start(() => {
      slideY.setValue(600);
      bgOpac.setValue(0);
      cb();
    });
  }

  function handleDecline(id: number) {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setDeclined((prev) => new Set([...prev, id]));
  }

  function handleAccept(o: TestOrder) {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    slideOut(() => onAccept(o));
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Scroll → active index ─────────────────────────────────────────────────
  function handleScrollEnd(e: { nativeEvent: { contentOffset: { x: number } } }) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP);
    setActiveIdx(Math.max(0, Math.min(idx, visibleOrders.length - 1)));
  }

  if (!order || pool.length === 0) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent>
      {/* Backdrop */}
      <Animated.View style={[s.backdrop, { opacity: bgOpac }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => slideOut(onClose)} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[s.sheet, { transform: [{ translateY: slideY }] }]}>
        {/* Handle */}
        <View style={s.handle} />

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <LinearGradient colors={[PINK, ORANGE]} style={s.headerIcon}>
              <Feather name="bell" size={15} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={s.headerTitle}>New Orders Nearby</Text>
              <View style={s.headerSub}>
                <LiveDot />
                <Text style={s.headerSubText}>
                  {visibleOrders.length} request{visibleOrders.length !== 1 ? "s" : ""} · {seconds}s remaining
                </Text>
              </View>
            </View>
          </View>

          {/* Progress bar */}
          <View style={s.timerBar}>
            <View
              style={[
                s.timerFill,
                {
                  width: `${(seconds / COUNTDOWN) * 100}%` as any,
                  backgroundColor: seconds <= 5 ? RED : seconds <= 9 ? ORANGE : GREEN,
                },
              ]}
            />
          </View>
        </View>

        {/* ── Swipeable cards ── */}
        <Animated.ScrollView
          ref={scrollRef as any}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SNAP}
          decelerationRate="fast"
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingHorizontal: SIDE_PAD,
            paddingVertical: 4,
            gap: CARD_GAP,
          }}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          onMomentumScrollEnd={handleScrollEnd}
        >
          {visibleOrders.map((o, i) => {
            // Scale: centered card = 1.0, adjacent = 0.93
            const inputRange = [(i - 1) * SNAP, i * SNAP, (i + 1) * SNAP];
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [0.93, 1.0, 0.93],
              extrapolate: "clamp",
            });
            const shadowOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.06, 0.18, 0.06],
              extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={o.id}
                style={[
                  { width: CARD_W, transform: [{ scale }] },
                  Platform.OS !== "web" && { shadowOpacity } as any,
                ]}
              >
                <OrderCard
                  order={o}
                  seconds={seconds}
                  expanded={expanded.has(o.id)}
                  onToggleExpand={() => toggleExpand(o.id)}
                  onAccept={() => handleAccept(o)}
                  onDecline={() => handleDecline(o.id)}
                />
              </Animated.View>
            );
          })}
        </Animated.ScrollView>

        {/* ── Pagination dots ── */}
        <Dots count={visibleOrders.length} active={activeIdx} />

        {/* ── Bottom hint ── */}
        <Text style={s.swipeHint}>
          Swipe to compare · Tap card for more details
        </Text>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    backgroundColor: "#F8FAFC",
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: 10,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 14,
  },

  // Header
  header: {
    paddingHorizontal: 18,
    marginBottom: 12,
    gap: 8,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 15, fontWeight: "800", color: NAVY, letterSpacing: -0.2 },
  headerSub:   { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  headerSubText: { fontSize: 11, color: "#6B7280", fontWeight: "500" },
  timerBar: {
    height: 3, backgroundColor: "#E5E7EB",
    borderRadius: 2, overflow: "hidden",
  },
  timerFill: {
    height: "100%", borderRadius: 2,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F0F0F0",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  // Card top strip (dark)
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  cardTopLeft:  { flexDirection: "row", alignItems: "center", gap: 9 },
  cardTopRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  parcelEmoji: { fontSize: 22 },
  parcelType:  { fontSize: 13, fontWeight: "700", color: "#fff" },
  livePill:    { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  liveText:    { fontSize: 10, color: "rgba(255,255,255,0.65)", fontWeight: "500" },
  surgeBadge: {
    backgroundColor: ORANGE + "E0",
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7,
  },
  surgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },

  // Mini timer
  miniTimer:       { width: RING, height: RING },
  miniTimerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  miniTimerNum:    { fontSize: 8, fontWeight: "800", lineHeight: 9 },

  // Card body
  cardBody: { padding: 13, gap: 11 },

  // Route
  routeBlock: { gap: 0 },
  routeRow:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dotGreen:   { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN, marginTop: 3 },
  dotRed:     { width: 10, height: 10, borderRadius: 5, backgroundColor: RED,   marginTop: 3 },
  routeLabel: { fontSize: 8, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.7 },
  routeAddr:  { fontSize: 12, fontWeight: "700", color: "#111", marginTop: 1 },
  routeCity:  { fontSize: 10, color: "#6B7280", marginTop: 1 },
  routeConn:  { paddingLeft: 4, paddingVertical: 2 },
  connLine:   { width: 2, height: 14, backgroundColor: "#E5E7EB", marginLeft: 4, borderRadius: 1 },

  // Stats
  statsRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  statItem:     { flexDirection: "row", alignItems: "center", gap: 3 },
  statVal:      { fontSize: 11, fontWeight: "700", color: "#374151" },
  statDot:      { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#D1D5DB" },
  earningBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9,
    borderWidth: 1, borderColor: PINK + "25",
  },
  earningAmt:   { fontSize: 14, fontWeight: "900", color: PINK },

  // Customer
  customerRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: PINK + "20", alignItems: "center", justifyContent: "center",
  },
  avatarText:   { fontSize: 13, fontWeight: "800", color: PINK },
  customerName: { fontSize: 12, fontWeight: "700", color: "#111" },
  customerSub:  { fontSize: 10, color: "#10B981", fontWeight: "600" },
  expandHint: {
    flexDirection: "row", alignItems: "center", gap: 2,
    paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: "#F3F4F6", borderRadius: 6,
  },
  expandHintText: { fontSize: 9, fontWeight: "600", color: "#9CA3AF" },

  // Buttons
  actionRow: { flexDirection: "row", gap: 9 },
  declineBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    borderWidth: 1.5, borderColor: RED + "40", borderRadius: 13,
    paddingVertical: 11, paddingHorizontal: 14, backgroundColor: RED + "07",
  },
  declineText: { fontSize: 13, fontWeight: "700", color: RED },
  acceptWrap: {
    flex: 1, borderRadius: 13, overflow: "hidden",
    shadowColor: GREEN, shadowOpacity: 0.4,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  acceptBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 11, borderRadius: 13,
  },
  acceptText: { fontSize: 13, fontWeight: "800", color: "#fff" },

  // Pagination
  dotsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 12 },
  dot:     { height: 6, borderRadius: 3 },

  // Swipe hint
  swipeHint: {
    textAlign: "center", fontSize: 11, color: "#9CA3AF",
    fontWeight: "500", marginTop: 8,
  },
});
