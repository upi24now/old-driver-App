/**
 * IncomingOrderModal — Premium 3D Multi-Order Slider
 *
 * Fast, live, urgent, 3D — Uber Driver × Porter × fintech energy.
 *
 * SPEED:   Sheet snaps in with spring(friction:5, tension:160).
 *          Backdrop fades in 120ms. Cards are rendered instantly.
 *
 * 3D:      Active card scale 0.86→1.0→0.86 + rotateY tilt.
 *          Layered neon shadow driven by scroll position.
 *          Floating glass card header with inner highlight stripe.
 *
 * URGENCY: Burst ring expands + fades on every new order.
 *          Breathing neon glow at sheet top edge.
 *          Pulsing accept button with outer glow ring.
 *          Animated countdown ring with color-coded urgency.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { memo, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

// ─── Brand ────────────────────────────────────────────────────────────────────
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";
const GREEN  = "#00C853";
const RED    = "#EF4444";
const NAVY   = "#0F172A";

// ─── Layout ───────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W   = Math.round(SCREEN_W * 0.76);
const CARD_GAP = 10;
const SNAP     = CARD_W + CARD_GAP;
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;

const COUNTDOWN   = 15;
const VIB_PATTERN = [0, 700, 200, 700, 200, 700, 1000];

// ─── Types ────────────────────────────────────────────────────────────────────
export type TestOrder = {
  id: number;
  customer: string;
  phone: string;       // 10-digit Indian mobile, no country code
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
  { id: 1, customer: "Rahul Sharma",   phone: "9876543210", parcelType: "Electronics", parcelEmoji: "📱",
    pickup: "Koramangala 5th Block",    pickupCity: "Bangalore",
    drop: "Indiranagar 100ft Road",     dropCity: "Bangalore",
    distanceKm: 3.2, durationMin: 12, earning: 185, surge: false, weight: "1.2 kg" },
  { id: 2, customer: "Priya Mehta",    phone: "9845012345", parcelType: "Food",        parcelEmoji: "🍱",
    pickup: "HSR Layout Sector 6",      pickupCity: "Bangalore",
    drop: "Electronic City Phase 1",    dropCity: "Bangalore",
    distanceKm: 8.5, durationMin: 22, earning: 290, surge: true, surgeMultiplier: 1.4, weight: "2.5 kg" },
  { id: 3, customer: "Arjun Nair",     phone: "9920111222", parcelType: "Documents",   parcelEmoji: "📄",
    pickup: "Andheri West, SV Road",    pickupCity: "Mumbai",
    drop: "Bandra Kurla Complex",       dropCity: "Mumbai",
    distanceKm: 5.1, durationMin: 18, earning: 220, surge: false, weight: "0.5 kg" },
  { id: 4, customer: "Sunita Reddy",   phone: "9440033044", parcelType: "Grocery",     parcelEmoji: "🛒",
    pickup: "Jubilee Hills Road 36",    pickupCity: "Hyderabad",
    drop: "Gachibowli Financial Dist",  dropCity: "Hyderabad",
    distanceKm: 11.3, durationMin: 28, earning: 340, surge: true, surgeMultiplier: 1.6, weight: "6.0 kg" },
  { id: 5, customer: "Vikram Patel",   phone: "9867055678", parcelType: "Medicine",    parcelEmoji: "💊",
    pickup: "Borivali West Station",    pickupCity: "Mumbai",
    drop: "Goregaon East SEEPZ",        dropCity: "Mumbai",
    distanceKm: 4.7, durationMin: 15, earning: 165, surge: false, weight: "0.3 kg" },
  { id: 6, customer: "Ananya Singh",   phone: "9810234567", parcelType: "Clothing",    parcelEmoji: "👗",
    pickup: "Lajpat Nagar Market",      pickupCity: "Delhi",
    drop: "Saket Select City Walk",     dropCity: "Delhi",
    distanceKm: 6.8, durationMin: 20, earning: 245, surge: false, weight: "1.8 kg" },
  { id: 7, customer: "Karthik Rajan",  phone: "9444456789", parcelType: "Electronics", parcelEmoji: "💻",
    pickup: "Anna Nagar 2nd Avenue",    pickupCity: "Chennai",
    drop: "OMR Perungudi Roundabout",   dropCity: "Chennai",
    distanceKm: 14.2, durationMin: 35, earning: 410, surge: true, surgeMultiplier: 1.3, weight: "3.2 kg" },
  { id: 8, customer: "Meera Iyer",     phone: "9822098220", parcelType: "Gift",        parcelEmoji: "🎁",
    pickup: "Viman Nagar Clover Ctr",   pickupCity: "Pune",
    drop: "Hinjewadi Phase 3",          dropCity: "Pune",
    distanceKm: 9.6, durationMin: 25, earning: 305, surge: false, weight: "2.1 kg" },
  { id: 9, customer: "Rohit Gupta",    phone: "9830099300", parcelType: "Books",       parcelEmoji: "📚",
    pickup: "Salt Lake Sector V",       pickupCity: "Kolkata",
    drop: "Park Street AJC Bose Rd",    dropCity: "Kolkata",
    distanceKm: 7.4, durationMin: 22, earning: 215, surge: false, weight: "4.0 kg" },
  { id: 10, customer: "Deepa Krishnan",phone: "9886700001", parcelType: "Fragile",     parcelEmoji: "🏺",
    pickup: "MG Road Brigade Road",     pickupCity: "Bangalore",
    drop: "Whitefield Prestige Park",   dropCity: "Bangalore",
    distanceKm: 17.8, durationMin: 42, earning: 520, surge: true, surgeMultiplier: 2.0, weight: "3.5 kg" },
];

// ─── Burst ring (urgency flash on new order) ──────────────────────────────────
function BurstRing({ trigger }: { trigger: number }) {
  const scale = useRef(new Animated.Value(0.2)).current;
  const opac  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!trigger) return;
    scale.setValue(0.2);
    opac.setValue(0.9);
    Animated.parallel([
      Animated.timing(scale, { toValue: 2.4, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(opac,  { toValue: 0,   duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [trigger]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[s.burstRing, { transform: [{ scale }], opacity: opac }]}
    />
  );
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────
function LiveDot({ color = GREEN }: { color?: string }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.8, duration: 550, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 550, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ width: 9, height: 9, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: 9, height: 9, borderRadius: 4.5, backgroundColor: color + "44", transform: [{ scale: anim }] }} />
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
    </View>
  );
}

// ─── Animated SVG countdown timer ────────────────────────────────────────────
const TR = 13; // ring radius
const TC = 32; // container size
const TCIRC = 2 * Math.PI * TR;

function NeonTimer({ seconds, total }: { seconds: number; total: number }) {
  const pct  = seconds / total;
  const off  = TCIRC * (1 - pct);
  const col  = seconds <= 4 ? RED : seconds <= 8 ? ORANGE : GREEN;

  // Pulse on urgency
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (seconds > 8) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 300, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 300, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [seconds <= 8]);

  return (
    <Animated.View style={[s.timerWrap, { transform: [{ scale: pulse }] }]}>
      <Svg width={TC} height={TC}>
        {/* Glow base circle */}
        <Circle cx={TC / 2} cy={TC / 2} r={TR} stroke={col + "25"} strokeWidth={6} fill="none" />
        {/* Track */}
        <Circle cx={TC / 2} cy={TC / 2} r={TR} stroke="rgba(255,255,255,0.12)" strokeWidth={3} fill="none" />
        {/* Progress arc */}
        <Circle cx={TC / 2} cy={TC / 2} r={TR}
          stroke={col} strokeWidth={3} fill="none"
          strokeDasharray={`${TCIRC} ${TCIRC}`}
          strokeDashoffset={off}
          strokeLinecap="round"
          rotation={-90} originX={TC / 2} originY={TC / 2}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={s.timerCenter}>
          <Text style={[s.timerNum, { color: col }]}>{seconds}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Accept button with outer glow ring ──────────────────────────────────────
function AcceptGlowButton({ onPress, label }: { onPress: () => void; label: string }) {
  const scale     = useRef(new Animated.Value(1)).current;
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpac  = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    // Rhythmic button breathe
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.03, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
    // Outer glow ring expanding pulse
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, { toValue: 1.12, duration: 900, useNativeDriver: true }),
          Animated.timing(ringOpac,  { toValue: 0,    duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale, { toValue: 1,    duration: 0, useNativeDriver: true }),
          Animated.timing(ringOpac,  { toValue: 0.7,  duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(200),
      ])
    ).start();
  }, []);

  return (
    <View style={s.acceptOuter}>
      {/* Expanding glow ring */}
      <Animated.View style={[s.acceptGlowRing, { transform: [{ scale: ringScale }], opacity: ringOpac }]} />
      {/* Button */}
      <Animated.View style={[s.acceptWrap, { transform: [{ scale }] }]}>
        <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={{ flex: 1 }}>
          <LinearGradient
            colors={["#00C853", "#00E676", "#00C853"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.acceptBtn}
          >
            <View style={s.acceptCheckCircle}>
              <Feather name="check" size={13} color={GREEN} />
            </View>
            <Text style={s.acceptText}>{label}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Compact 3D Order Card ────────────────────────────────────────────────────
type CardProps = {
  order: TestOrder;
  seconds: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onAccept: () => void;
  onDecline: () => void;
};

const OrderCard = memo(function OrderCard({
  order, seconds, expanded, onToggleExpand, onAccept, onDecline,
}: CardProps) {
  const earning = order.surge
    ? Math.round(order.earning * (order.surgeMultiplier ?? 1))
    : order.earning;
  const glowColor = order.surge ? ORANGE : GREEN;

  return (
    <Pressable onPress={onToggleExpand} style={s.card}>
      {/* ── Glass dark header ── */}
      <LinearGradient
        colors={[NAVY, "#1E293B", "#0F172A"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.cardHeader}
      >
        {/* Shimmer highlight strip */}
        <View style={s.shimmerStrip} />

        <View style={s.cardHeaderLeft}>
          {/* Parcel icon glow */}
          <View style={[s.emojiWrap, { shadowColor: glowColor }]}>
            <Text style={s.parcelEmoji}>{order.parcelEmoji}</Text>
          </View>
          <View>
            <Text style={s.parcelType}>{order.parcelType}</Text>
            <View style={s.livePill}>
              <LiveDot color={glowColor} />
              <Text style={s.liveText}>Live nearby</Text>
            </View>
          </View>
        </View>

        <View style={s.cardHeaderRight}>
          {order.surge && (
            <LinearGradient
              colors={[ORANGE, "#FF9F45"]}
              style={s.surgeBadge}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              <Text style={s.surgeText}>⚡ {order.surgeMultiplier}×</Text>
            </LinearGradient>
          )}
          <NeonTimer seconds={seconds} total={COUNTDOWN} />
        </View>

        {/* Bottom inner-shadow edge */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.18)"]}
          style={s.headerBottomGrad}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          pointerEvents="none"
        />
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

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Feather name="navigation" size={11} color={PINK} />
            <Text style={s.statVal}>{order.distanceKm} km</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Feather name="clock" size={11} color={ORANGE} />
            <Text style={s.statVal}>{order.durationMin} min</Text>
          </View>
          {expanded && (
            <>
              <View style={s.statSep} />
              <View style={s.statItem}>
                <Feather name="package" size={11} color="#6B7280" />
                <Text style={s.statVal}>{order.weight}</Text>
              </View>
            </>
          )}
          <View style={{ flex: 1 }} />
          {/* Earning badge */}
          <LinearGradient
            colors={[PINK + "28", ORANGE + "18"]}
            style={s.earningBadge}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          >
            <Text style={s.earningAmt}>₹{earning}</Text>
          </LinearGradient>
        </View>

        {/* Customer */}
        <View style={s.customerRow}>
          <LinearGradient colors={[PINK + "30", PINK + "15"]} style={s.avatar}>
            <Text style={s.avatarText}>{order.customer.charAt(0)}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={s.customerName} numberOfLines={1}>{order.customer}</Text>
            <Text style={s.customerSub}>✓ Verified</Text>
          </View>
          <View style={s.expandToggle}>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={12} color="#9CA3AF" />
            {!expanded && <Text style={s.expandText}>More</Text>}
          </View>
        </View>

        {/* Actions */}
        <View style={s.actionRow}>
          {/* Glass decline button */}
          <TouchableOpacity style={s.declineBtn} onPress={onDecline} activeOpacity={0.75}>
            <View style={s.declineBtnInner}>
              <Feather name="x" size={15} color={RED} />
              <Text style={s.declineText}>Skip</Text>
            </View>
          </TouchableOpacity>

          <AcceptGlowButton
            onPress={onAccept}
            label={`Accept  ₹${earning}`}
          />
        </View>
      </View>
    </Pressable>
  );
});

// ─── Dots ─────────────────────────────────────────────────────────────────────
function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={s.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[
          s.dot,
          i === active
            ? { width: 20, backgroundColor: GREEN }
            : { width: 6,  backgroundColor: "#D1D5DB" },
        ]} />
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
  // ── Sheet animations (native driver) ──────────────────────────────────────
  const slideY     = useRef(new Animated.Value(580)).current;
  const sheetScale = useRef(new Animated.Value(0.92)).current;
  const bgOpac     = useRef(new Animated.Value(0)).current;

  // Breathing top glow
  const glowOpac = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpac, { toValue: 1,   duration: 900, useNativeDriver: true }),
        Animated.timing(glowOpac, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ── Scroll (JS driver — needed for shadow + rotateY interpolation) ─────────
  const scrollX   = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // ── Audio ─────────────────────────────────────────────────────────────────
  const player = useAudioPlayer(null);

  // ── Order pool ────────────────────────────────────────────────────────────
  const [pool,     setPool]     = useState<TestOrder[]>([]);
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [seconds,  setSeconds]  = useState(COUNTDOWN);
  const [burstKey, setBurstKey] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visible  = pool.filter((o) => !declined.has(o.id));

  // ── Audio helpers ─────────────────────────────────────────────────────────
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
  function stopRingtone() { try { player.pause(); } catch {} }

  // ── New order arrives ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!order) return;

    const others = TEST_ORDERS
      .filter((o) => o.id !== order.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);

    setPool([order, ...others]);
    setDeclined(new Set());
    setExpanded(new Set());
    setSeconds(COUNTDOWN);
    setActiveIdx(0);
    setBurstKey((k) => k + 1);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
    scrollX.setValue(0);

    // ── Fast snap-in animation ────────────────────────────────────────────
    slideY.setValue(580);
    sheetScale.setValue(0.92);
    bgOpac.setValue(0);

    Animated.parallel([
      // Backdrop — 120ms
      Animated.timing(bgOpac, {
        toValue: 1, duration: 120, useNativeDriver: true,
      }),
      // Sheet slides up with tight spring — instant feel
      Animated.spring(slideY, {
        toValue: 0, friction: 5, tension: 160, useNativeDriver: true,
      }),
      // Sheet pops from 0.92→1.0
      Animated.spring(sheetScale, {
        toValue: 1, friction: 5, tension: 160, useNativeDriver: true,
      }),
    ]).start();

    startRingtone();

    if (Platform.OS !== "web") {
      Vibration.vibrate(VIB_PATTERN, true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) { clearInterval(timerRef.current!); slideOut(onClose); return 0; }
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

  // ── Auto-close when all skipped ───────────────────────────────────────────
  useEffect(() => {
    if (pool.length > 0 && visible.length === 0) slideOut(onClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declined, pool]);

  // ── Slide-out ─────────────────────────────────────────────────────────────
  function slideOut(cb: () => void) {
    clearInterval(timerRef.current!);
    Vibration.cancel();
    stopRingtone();
    Animated.parallel([
      Animated.timing(slideY, { toValue: 580, duration: 240, useNativeDriver: true }),
      Animated.timing(sheetScale, { toValue: 0.94, duration: 200, useNativeDriver: true }),
      Animated.timing(bgOpac,  { toValue: 0,   duration: 180, useNativeDriver: true }),
    ]).start(() => {
      slideY.setValue(580); sheetScale.setValue(0.92); bgOpac.setValue(0);
      cb();
    });
  }

  function handleDecline(id: number) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDeclined((p) => new Set([...p, id]));
  }

  function handleAccept(o: TestOrder) {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    slideOut(() => onAccept(o));
  }

  function toggleExpand(id: number) {
    setExpanded((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleScrollEnd(e: { nativeEvent: { contentOffset: { x: number } } }) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP);
    setActiveIdx(Math.max(0, Math.min(idx, visible.length - 1)));
  }

  if (!order || pool.length === 0) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent>
      {/* ── Backdrop ── */}
      <Animated.View style={[s.backdrop, { opacity: bgOpac }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => slideOut(onClose)} />
      </Animated.View>

      {/* ── Sheet ── */}
      <Animated.View style={[
        s.sheet,
        { transform: [{ translateY: slideY }, { scale: sheetScale }] },
      ]}>
        {/* Breathing neon glow at top edge */}
        <Animated.View style={[s.topGlow, { opacity: glowOpac }]} />

        {/* Burst ring on new order */}
        <View style={s.burstContainer} pointerEvents="none">
          <BurstRing trigger={burstKey} />
        </View>

        {/* Handle */}
        <View style={s.handle} />

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <LinearGradient colors={[PINK, ORANGE, "#FF6B35"]} style={s.bellIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Feather name="bell" size={14} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={s.headerTitle}>New Orders Nearby</Text>
              <View style={s.headerSub}>
                <LiveDot />
                <Text style={s.headerSubText}>{visible.length} request{visible.length !== 1 ? "s" : ""} · {seconds}s left</Text>
              </View>
            </View>
          </View>

          {/* Countdown progress bar */}
          <View style={s.timerBarTrack}>
            <View style={[
              s.timerBarFill,
              {
                width: `${(seconds / COUNTDOWN) * 100}%` as any,
                backgroundColor: seconds <= 4 ? RED : seconds <= 8 ? ORANGE : GREEN,
              },
            ]} />
          </View>
        </View>

        {/* ── Card slider ── */}
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SNAP}
          decelerationRate="fast"
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: SIDE_PAD, paddingVertical: 6, gap: CARD_GAP }}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          onMomentumScrollEnd={handleScrollEnd}
        >
          {visible.map((o, i) => {
            const inputRange = [(i - 1) * SNAP, i * SNAP, (i + 1) * SNAP];

            // 3D card transforms (JS driver — driven by scrollX)
            const cardScale = scrollX.interpolate({
              inputRange, outputRange: [0.86, 1.0, 0.86], extrapolate: "clamp",
            });
            const cardRotY = scrollX.interpolate({
              inputRange, outputRange: ["5deg", "0deg", "-5deg"], extrapolate: "clamp",
            });
            const cardOpacity = scrollX.interpolate({
              inputRange, outputRange: [0.72, 1, 0.72], extrapolate: "clamp",
            });
            // Neon shadow driven by distance from center
            const shadowGlow = scrollX.interpolate({
              inputRange, outputRange: [0.0, 0.55, 0.0], extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={o.id}
                style={[
                  s.cardWrapper,
                  {
                    width: CARD_W,
                    opacity: cardOpacity,
                    transform: [
                      { perspective: 900 },
                      { scale: cardScale },
                      { rotateY: cardRotY },
                    ],
                    shadowOpacity: shadowGlow as any,
                    shadowColor: o.surge ? ORANGE : GREEN,
                    shadowRadius: 22,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 18,
                  },
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

        {/* ── Dots ── */}
        <Dots count={visible.length} active={activeIdx} />

        <Text style={s.swipeHint}>Swipe to compare · Tap for details</Text>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,7,15,0.72)",
  },

  // ── Sheet ──────────────────────────────────────────────────────────────────
  sheet: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    backgroundColor: "#F0F4F8",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingBottom: 30,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -12 },
    elevation: 28,
    overflow: "hidden",
  },

  // Breathing neon top edge glow
  topGlow: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 2.5,
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },

  // Burst ring anchor
  burstContainer: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    alignItems: "center",
    overflow: "visible",
    zIndex: 10,
  },
  burstRing: {
    width: 80, height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: GREEN + "CC",
    marginTop: -20,
  },

  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: { paddingHorizontal: 18, marginBottom: 10, gap: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  bellIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    shadowColor: PINK, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  headerTitle:   { fontSize: 15, fontWeight: "800", color: NAVY, letterSpacing: -0.3 },
  headerSub:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  headerSubText: { fontSize: 11, color: "#64748B", fontWeight: "500" },

  timerBarTrack: { height: 3, backgroundColor: "#E2E8F0", borderRadius: 2, overflow: "hidden" },
  timerBarFill:  { height: "100%", borderRadius: 2 },

  // ── Card wrapper (holds 3D transforms + shadow) ────────────────────────────
  cardWrapper: {
    shadowColor: GREEN,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: "#fff",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },

  // Glass dark header
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 14,
    position: "relative",
  },
  shimmerStrip: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  headerBottomGrad: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: 6,
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },

  emojiWrap: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
    shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  parcelEmoji: { fontSize: 20 },
  parcelType:  { fontSize: 13, fontWeight: "700", color: "#fff", letterSpacing: -0.2 },
  livePill:    { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  liveText:    { fontSize: 9,  color: "rgba(255,255,255,0.6)", fontWeight: "600" },

  surgeBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    shadowColor: ORANGE, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  surgeText: { fontSize: 10, fontWeight: "900", color: "#fff" },

  // Timer
  timerWrap:   { width: TC, height: TC },
  timerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  timerNum:    { fontSize: 9, fontWeight: "900", lineHeight: 10 },

  // ── Body ──────────────────────────────────────────────────────────────────
  cardBody: { padding: 13, gap: 10 },

  routeBlock: {},
  routeRow:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dotGreen:   { width: 9, height: 9, borderRadius: 4.5, backgroundColor: GREEN, marginTop: 3 },
  dotRed:     { width: 9, height: 9, borderRadius: 4.5, backgroundColor: RED,   marginTop: 3 },
  routeLabel: { fontSize: 8, fontWeight: "800", color: "#94A3B8", letterSpacing: 0.8 },
  routeAddr:  { fontSize: 12, fontWeight: "700", color: "#0F172A", marginTop: 1 },
  routeCity:  { fontSize: 10, color: "#6B7280", marginTop: 1 },
  routeConn:  { paddingLeft: 4, paddingVertical: 2 },
  connLine:   { width: 2, height: 12, backgroundColor: "#E2E8F0", marginLeft: 3.5, borderRadius: 1 },

  statsRow:  { flexDirection: "row", alignItems: "center", gap: 5 },
  statItem:  { flexDirection: "row", alignItems: "center", gap: 3 },
  statVal:   { fontSize: 11, fontWeight: "700", color: "#334155" },
  statSep:   { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#CBD5E1" },
  earningBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: PINK + "30",
  },
  earningAmt: { fontSize: 14, fontWeight: "900", color: PINK },

  customerRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  avatarText:   { fontSize: 12, fontWeight: "800", color: PINK },
  customerName: { fontSize: 12, fontWeight: "700", color: "#0F172A" },
  customerSub:  { fontSize: 9,  color: "#10B981", fontWeight: "700", marginTop: 1 },
  expandToggle: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#F1F5F9", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  expandText:   { fontSize: 9, fontWeight: "600", color: "#94A3B8" },

  // ── Buttons ───────────────────────────────────────────────────────────────
  actionRow: { flexDirection: "row", gap: 8 },

  declineBtn: {
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: RED + "35",
    backgroundColor: RED + "08",
  },
  declineBtnInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 11, paddingHorizontal: 16,
  },
  declineText: { fontSize: 13, fontWeight: "700", color: RED },

  // Accept with outer glow
  acceptOuter: { flex: 1, alignItems: "stretch" },
  acceptGlowRing: {
    position: "absolute",
    top: -3, bottom: -3, left: -3, right: -3,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: GREEN + "80",
    backgroundColor: "transparent",
  },
  acceptWrap: {
    flex: 1, borderRadius: 13, overflow: "hidden",
    shadowColor: GREEN, shadowOpacity: 0.6,
    shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  acceptBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, paddingVertical: 11, borderRadius: 13,
  },
  acceptCheckCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
  },
  acceptText: { fontSize: 13, fontWeight: "800", color: "#fff" },

  // ── Pagination ────────────────────────────────────────────────────────────
  dotsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10 },
  dot:     { height: 5, borderRadius: 3 },

  swipeHint: { textAlign: "center", fontSize: 10, color: "#94A3B8", fontWeight: "500", marginTop: 6 },
});
