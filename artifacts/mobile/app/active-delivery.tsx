/**
 * active-delivery.tsx — Real logistics delivery flow
 *
 * Ride flow (navigate → mark → payment → OTP):
 *   to_pickup → "Navigate to Pickup" (Maps) then "Mark Pickup"
 *   at_pickup → "Navigate to Drop"   (Maps) then "Mark Drop"
 *   at_drop   → Payment Collection sheet, THEN OTP bottom sheet (OTP never shows
 *               before payment is confirmed) + "Deliver Parcel" button
 *   delivered → Celebration + earnings
 * Stage writes are unchanged (to_pickup/at_pickup/to_drop/at_drop mirrored to the
 * backend); only OTP success completes the order via the existing complete API.
 *
 * Call: Linking.openURL("tel:+91XXXXXXXXXX") — opens Android dialer, no permission needed.
 * Maps: Linking.openURL("https://www.google.com/maps/dir/?api=1&destination=…")
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDriver } from "@/contexts/DriverContext";
import { useEffect, useRef, useState } from "react";
import { driverCancelOrder, type DeliveryStage } from "@/utils/firestore";
import { completeDelivery, updateOrderStageViaApi, updateOrderLocationViaApi } from "@/utils/delivery-api";
import { callSupport } from "@/utils/support";
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Brand constants (unchanged — map 1:1 to semantic tokens) ─────────────────
const GREEN  = "#059669";
const PINK   = "#E8336C";
const ORANGE = "#D97706";
const BLUE   = "#2563EB";
const NAVY   = "#0F172A";
const RED    = "#DC2626";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#F8FAFC";
const CARD    = "#FFFFFF";
const PRIMARY = "#FF6B00";
const TEXT    = "#0F172A";
const MUTED   = "#64748B";
const BORDER  = "#E2E8F0";

// ─── Stage machine ────────────────────────────────────────────────────────────
type Stage = "to_pickup" | "at_pickup" | "to_drop" | "at_drop" | "delivered";
const STAGE_ORDER: Stage[] = ["to_pickup", "at_pickup", "to_drop", "at_drop", "delivered"];

function firestoreStatusToStage(status: string | undefined): Stage {
  switch (status) {
    case "at_pickup": return "at_pickup";
    case "to_drop":   return "to_drop";
    case "at_drop":   return "at_drop";
    case "delivered": return "delivered";
    default:          return "to_pickup";
  }
}
function nextStage(s: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(s);
  return i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

const STEPS = [
  { id: "to_pickup" as Stage, label: "To Pickup", icon: "navigation" as const },
  { id: "at_pickup" as Stage, label: "Picked Up", icon: "package"    as const },
  { id: "to_drop"   as Stage, label: "To Drop",   icon: "map-pin"    as const },
  { id: "delivered" as Stage, label: "Delivered",  icon: "check"      as const },
];
function stageToStep(s: Stage): number {
  return ({ to_pickup: 0, at_pickup: 1, to_drop: 2, at_drop: 3, delivered: 3 } as Record<Stage, number>)[s];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function haptic(type: "success" | "light" = "success") {
  if (Platform.OS === "web") return;
  if (type === "success")
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "Number unavailable";
  if (d.length < 7) return `+91 ${d}`;
  return `+91 ${d.slice(0, 2)}XXXX${d.slice(-3)}`;
}

function callNumber(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (!d) { Alert.alert("No number", "Customer phone number is unavailable for this order."); return; }
  Linking.openURL(`tel:+91${d}`).catch(() => {
    Alert.alert("Dialer unavailable", "Unable to open phone app on this device.");
  });
}

function openGoogleMaps(address: string, city: string) {
  const dest       = encodeURIComponent(`${address}, ${city}, India`);
  const nativeUrl  = `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
  const browserUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  Linking.canOpenURL(nativeUrl)
    .then((hasNativeApp) => Linking.openURL(hasNativeApp ? nativeUrl : browserUrl))
    .catch(() => Linking.openURL(browserUrl))
    .catch(() => Alert.alert("Maps unavailable", "Could not open maps. Please navigate manually."));
}

// ─── Live dot ─────────────────────────────────────────────────────────────────
function LiveDot({ color = GREEN, size = 10 }: { color?: string; size?: number }) {
  const p = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1.8, duration: 700, useNativeDriver: true }),
      Animated.timing(p, { toValue: 1,   duration: 700, useNativeDriver: true }),
    ])).start();
  }, []);
  const half = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: half, backgroundColor: color + "44", transform: [{ scale: p }] }} />
      <View style={{ width: half + 1, height: half + 1, borderRadius: (half + 1) / 2, backgroundColor: color }} />
    </View>
  );
}

// ─── Elapsed timer ────────────────────────────────────────────────────────────
function ElapsedTimer({ startSec = 0 }: { startSec?: number }) {
  const [n, setN] = useState(startSec);
  useEffect(() => { const t = setInterval(() => setN((v) => v + 1), 1000); return () => clearInterval(t); }, []);
  const m = Math.floor(n / 60).toString().padStart(2, "0");
  const s = (n % 60).toString().padStart(2, "0");
  return <Text style={st.elapsed}>{m}:{s}</Text>;
}

// ─── Step tracker ─────────────────────────────────────────────────────────────
function StepTracker({ stage }: { stage: Stage }) {
  const active = stageToStep(stage);
  return (
    <View style={st.stepRow}>
      {STEPS.map((step, i) => {
        const done = i < active, cur = i === active;
        const col  = done || cur ? GREEN : "#CBD5E1";
        return (
          <View key={step.id} style={st.stepItem}>
            {i > 0 && <View style={[st.stepLine, { backgroundColor: i <= active ? GREEN : BORDER }]} />}
            <View style={[st.stepCircle, { borderColor: col, backgroundColor: done ? GREEN : cur ? "#D1FAE5" : BG }]}>
              {done
                ? <Feather name="check" size={9} color="#fff" />
                : <Feather name={step.icon} size={9} color={cur ? GREEN : "#CBD5E1"} />}
            </View>
            <Text style={[st.stepLbl, { color: cur ? GREEN : done ? "#374151" : "#94A3B8" }]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Route card (light theme) ─────────────────────────────────────────────────
function RouteCard({ pickup, pickupCity, drop, dropCity, distanceKm, durationMin, leg }: {
  pickup: string; pickupCity: string; drop: string; dropCity: string;
  distanceKm: string; durationMin: string; leg: "pickup" | "drop";
}) {
  const pulse = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.35, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.9,  duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  const activeColor = leg === "pickup" ? GREEN : ORANGE;
  const activeDot   = leg === "pickup" ? GREEN : ORANGE;
  return (
    <View style={[st.routeCard, { borderColor: activeColor + "40" }]}>
      {/* Top chips */}
      <View style={st.routeChips}>
        <View style={[st.chip, { backgroundColor: activeColor + "15", borderColor: activeColor + "40" }]}>
          <Feather name="navigation" size={10} color={activeColor} />
          <Text style={[st.chipTxt, { color: activeColor }]}>{distanceKm} km</Text>
        </View>
        <View style={[st.chip, { backgroundColor: "#F1F5F9", borderColor: BORDER }]}>
          <Feather name="clock" size={10} color={MUTED} />
          <Text style={[st.chipTxt, { color: MUTED }]}>{durationMin} min ETA</Text>
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <LiveDot color={activeColor} size={8} />
        </View>
      </View>

      {/* Route viz */}
      <View style={st.routeViz}>
        <View style={st.pinCol}>
          <Animated.View style={[st.pinDot, { backgroundColor: GREEN, transform: [{ scale: leg === "pickup" ? pulse : new Animated.Value(1) }] }]} />
          <View style={st.pinLine} />
          <Animated.View style={[st.pinDot, { backgroundColor: RED, transform: [{ scale: leg === "drop" ? pulse : new Animated.Value(1) }] }]} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View>
            <Text style={[st.pinTag, { color: GREEN }]}>PICKUP</Text>
            <Text style={st.pinAddr} numberOfLines={1}>{pickup}</Text>
            <Text style={st.pinCity}>{pickupCity}</Text>
          </View>
          <View style={st.dashes}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={i} style={[st.dash, { backgroundColor: activeColor + "45" }]} />
            ))}
          </View>
          <View>
            <Text style={[st.pinTag, { color: RED }]}>DROP</Text>
            <Text style={st.pinAddr} numberOfLines={1}>{drop}</Text>
            <Text style={st.pinCity}>{dropCity}</Text>
          </View>
        </View>
      </View>

      {/* Status row */}
      <View style={[st.routeStatusRow, { backgroundColor: activeColor + "10", borderRadius: 8 }]}>
        <Feather name={leg === "pickup" ? "navigation" : "map-pin"} size={12} color={activeColor} />
        <Text style={[st.routeStatusTxt, { color: activeColor }]}>
          {leg === "pickup" ? "Navigate to pickup point" : "Navigate to drop point"}
        </Text>
      </View>
    </View>
  );
}

// ─── Action row: Call + Navigate ──────────────────────────────────────────────
function ActionRow({ onCall, onNavigate, navigateLabel }: {
  onCall: () => void; onNavigate: () => void; navigateLabel: string;
}) {
  const callScale = useRef(new Animated.Value(1)).current;
  const navScale  = useRef(new Animated.Value(1)).current;

  function pressIn(v: Animated.Value) {
    Animated.spring(v, { toValue: 0.95, useNativeDriver: true, friction: 8 }).start();
  }
  function pressOut(v: Animated.Value, cb: () => void) {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    cb();
  }

  return (
    <View style={st.actionRow}>
      <Animated.View style={[{ flex: 1 }, { transform: [{ scale: callScale }] }]}>
        <TouchableOpacity
          onPressIn={() => pressIn(callScale)}
          onPressOut={() => pressOut(callScale, onCall)}
          activeOpacity={1}
          style={st.callBtn}
        >
          <Feather name="phone" size={16} color={GREEN} />
          <Text style={st.callTxt}>Call</Text>
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ scale: navScale }] }]}>
        <TouchableOpacity
          onPressIn={() => pressIn(navScale)}
          onPressOut={() => pressOut(navScale, onNavigate)}
          activeOpacity={1}
          style={st.navBtn}
        >
          <Feather name="map-pin" size={14} color="#fff" />
          <Text style={st.navTxt} numberOfLines={1}>{navigateLabel}</Text>
          <Feather name="external-link" size={11} color="rgba(255,255,255,0.75)" />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Customer info card ───────────────────────────────────────────────────────
function CustomerCard({ customer, phone, pickup, pickupCity, emoji, parcel, weight }: {
  customer: string; phone: string; pickup: string; pickupCity: string;
  emoji: string; parcel: string; weight: string;
}) {
  return (
    <View style={st.card}>
      <View style={st.cardHeaderRow}>
        <View style={[st.avatar, { backgroundColor: PINK + "20" }]}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custPhone}>{maskPhone(phone)}</Text>
          <Text style={st.custVerified}>✓ Verified customer</Text>
        </View>
        <View style={st.parcelChip}>
          <Text style={{ fontSize: 18 }}>{emoji}</Text>
          <View>
            <Text style={st.parcelName}>{parcel}</Text>
            <Text style={st.parcelWeight}>{weight}</Text>
          </View>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.addrBlock}>
        <View style={st.addrDotGreen} />
        <View style={{ flex: 1 }}>
          <Text style={st.addrTag}>PICKUP ADDRESS</Text>
          <Text style={st.addrMain}>{pickup}</Text>
          <Text style={st.addrSub}>{pickupCity}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Pickup confirm card ──────────────────────────────────────────────────────
function PickupConfirmCard({ pickup, pickupCity, customer, phone, emoji, parcel, weight }: {
  pickup: string; pickupCity: string; customer: string; phone: string;
  emoji: string; parcel: string; weight: string;
}) {
  return (
    <View style={[st.card, { borderColor: GREEN + "40" }]}>
      <View style={[st.confirmBanner, { backgroundColor: GREEN + "15" }]}>
        <View style={[st.confirmIcon, { backgroundColor: GREEN + "25" }]}>
          <Feather name="package" size={22} color={GREEN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.confirmTitle, { color: "#065F46" }]}>Collect Parcel from Customer</Text>
          <Text style={st.confirmSub}>Verify parcel before confirming pickup</Text>
        </View>
      </View>
      <View style={st.parcelDetailRow}>
        <Text style={{ fontSize: 32 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.parcelDetailName}>{parcel}</Text>
          <Text style={st.parcelDetailMeta}>Weight: {weight}</Text>
        </View>
        <View style={st.verifyBadge}>
          <Feather name="check-circle" size={12} color={GREEN} />
          <Text style={st.verifyTxt}>Ready</Text>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.addrBlock}>
        <View style={st.addrDotGreen} />
        <View style={{ flex: 1 }}>
          <Text style={st.addrTag}>PICKUP LOCATION</Text>
          <Text style={st.addrMain}>{pickup}</Text>
          <Text style={st.addrSub}>{pickupCity}</Text>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.cardHeaderRow}>
        <View style={[st.avatar, { backgroundColor: PINK + "20" }]}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custPhone}>{maskPhone(phone)}</Text>
          <Text style={st.custVerified}>✓ Verified</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Drop info card ───────────────────────────────────────────────────────────
function DropInfoCard({ drop, dropCity, customer, phone }: {
  drop: string; dropCity: string; customer: string; phone: string;
}) {
  return (
    <View style={st.card}>
      <View style={st.cardHeaderRow}>
        <View style={[st.avatar, { backgroundColor: PINK + "20" }]}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custPhone}>{maskPhone(phone)}</Text>
          <Text style={st.custVerified}>✓ Verified customer</Text>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.addrBlock}>
        <View style={st.addrDotRed} />
        <View style={{ flex: 1 }}>
          <Text style={st.addrTag}>DROP ADDRESS</Text>
          <Text style={st.addrMain}>{drop}</Text>
          <Text style={st.addrSub}>{dropCity}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── At-drop delivery card (no OTP — OTP is in bottom sheet) ─────────────────
function DeliverCard({ drop, dropCity, customer, phone, earning, emoji, parcel, otp, onOtpChange, otpError }: {
  drop: string; dropCity: string; customer: string; phone: string;
  earning: string; emoji: string; parcel: string;
  otp: string; onOtpChange: (v: string) => void; otpError?: string;
}) {
  return (
    <View style={[st.card, { borderColor: "#8B5CF640" }]}>
      <View style={[st.confirmBanner, { backgroundColor: "#EDE9FE" }]}>
        <View style={[st.confirmIcon, { backgroundColor: "#8B5CF620" }]}>
          <Feather name="check-circle" size={22} color="#8B5CF6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.confirmTitle, { color: "#4C1D95" }]}>Deliver Parcel to Customer</Text>
          <Text style={st.confirmSub}>Confirm delivery once handed over</Text>
        </View>
      </View>
      <View style={st.parcelDetailRow}>
        <Text style={{ fontSize: 32 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.parcelDetailName}>{parcel}</Text>
          <Text style={st.parcelDetailMeta}>Earning: {earning}</Text>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.addrBlock}>
        <View style={st.addrDotRed} />
        <View style={{ flex: 1 }}>
          <Text style={st.addrTag}>DROP ADDRESS</Text>
          <Text style={st.addrMain}>{drop}</Text>
          <Text style={st.addrSub}>{dropCity}</Text>
        </View>
      </View>
      <View style={st.divider} />
      <View style={st.cardHeaderRow}>
        <View style={[st.avatar, { backgroundColor: PINK + "20" }]}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custPhone}>{maskPhone(phone)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Celebration card ─────────────────────────────────────────────────────────
function CelebrationCard({ earning, customer, distKm }: { earning: string; customer: string; distKm: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={st.celebCard}>
      <Animated.Text style={[{ fontSize: 60 }, { transform: [{ rotate }] }]}>🎉</Animated.Text>
      <Text style={st.celebTitle}>Delivery Complete!</Text>
      <Text style={st.celebSub}>You delivered to {customer} and earned</Text>
      <View style={[st.celebEarning, { backgroundColor: PRIMARY }]}>
        <Text style={st.celebAmt}>{earning}</Text>
      </View>
      <View style={st.celebStats}>
        {[
          { icon: "navigation" as const, color: GREEN,  val: `${distKm} km`, lbl: "Travelled" },
          { icon: "star"       as const, color: ORANGE, val: "5.0",          lbl: "Rating"    },
          { icon: "check"      as const, color: GREEN,  val: "1",            lbl: "Delivery"  },
        ].map((s, i, arr) => (
          <View key={s.lbl} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={st.celebStat}>
              <Feather name={s.icon} size={14} color={s.color} />
              <Text style={st.celebStatVal}>{s.val}</Text>
              <Text style={st.celebStatLbl}>{s.lbl}</Text>
            </View>
            {i < arr.length - 1 && <View style={st.celebSep} />}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function ActiveDeliveryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    orderId: string;
    customer: string; phone: string; parcelType: string; parcelEmoji: string;
    pickup: string; pickupCity: string; drop: string; dropCity: string;
    distanceKm: string; durationMin: string; earning: string; weight: string;
    paymentMode: string; surge: string; surgeMultiplier: string;
  }>();

  const { activeOrders, activeRide, endRide, orderRemovalReasons, driverUid, applyWalletUpdate } = useDriver();

  const orderId   = params.orderId ?? activeRide?.id ?? null;
  const thisOrder = activeOrders.find((o) => o.id === orderId) ?? activeRide;

  const didEndSelf    = useRef(false);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const [stage, setStage] = useState<Stage>(() =>
    firestoreStatusToStage(thisOrder?.orderStatus),
  );
  const [otp,            setOtp]            = useState("");
  const [otpError,       setOtpError]       = useState<string | null>(null);
  const [cancelVisible,  setCancelVisible]  = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otpSheetVisible, setOtpSheetVisible] = useState(false);
  // New ride-flow UI state (navigate → mark → payment → OTP)
  const [pickupNavigated,  setPickupNavigated]  = useState(false);
  const [dropNavigated,    setDropNavigated]    = useState(false);
  const [paymentVisible,   setPaymentVisible]   = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  // Card slide-in on stage change
  const cardY    = useRef(new Animated.Value(60)).current;
  const cardOpac = useRef(new Animated.Value(0)).current;

  const bannerOpacity    = useRef(new Animated.Value(0)).current;
  const shownBannerForRef = useRef<Set<string>>(new Set());

  function animateIn() {
    cardY.setValue(60); cardOpac.setValue(0);
    Animated.parallel([
      Animated.spring(cardY,    { toValue: 0, friction: 7, tension: 130, useNativeDriver: true }),
      Animated.timing(cardOpac, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }
  useEffect(() => { animateIn(); }, [stage]);

  // Payment-first at drop: when entering at_drop, open the Payment Collection
  // sheet. OTP only auto-opens AFTER payment is confirmed (req: never show OTP
  // before payment). Leaving at_drop closes both sheets.
  useEffect(() => {
    if (stage === "at_drop") {
      if (paymentConfirmed) { setOtpSheetVisible(true); setPaymentVisible(false); }
      else                  { setPaymentVisible(true);  setOtpSheetVisible(false); }
    } else {
      setOtpSheetVisible(false);
      setPaymentVisible(false);
    }
  }, [stage, paymentConfirmed]);

  // ─── External cancellation guard ───────────────────────────────────────────
  useEffect(() => {
    if (!orderId) return;
    if (activeOrders.some((o) => o.id === orderId)) return;
    if (didEndSelf.current) return;
    if (stage === "delivered") return;
    const reason = orderRemovalReasons[orderId] ?? null;
    if (reason === "delivered" || reason === "completed") return;
    Alert.alert(
      "Order Cancelled",
      "This order was cancelled by the customer.",
      [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
      { cancelable: false },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrders, orderRemovalReasons]);

  // ─── Non-focused order cancellation notice ─────────────────────────────────
  useEffect(() => {
    for (const [id, reason] of Object.entries(orderRemovalReasons)) {
      if (id === orderId) continue;
      if (shownBannerForRef.current.has(id)) continue;
      if (reason !== "cancelled" && reason !== "rejected" && reason !== "deleted") continue;
      shownBannerForRef.current.add(id);
      Animated.sequence([
        Animated.timing(bannerOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(bannerOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
      break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRemovalReasons]);

  // ─── Route params with fallbacks ───────────────────────────────────────────
  const customer    = params.customer    ?? activeRide?.passengerName  ?? "Customer";
  const phone       = params.phone       ?? activeRide?.customerPhone  ?? "";
  const parcel      = params.parcelType  ?? activeRide?.parcelType     ?? "Parcel";
  const emoji       = params.parcelEmoji ?? activeRide?.parcelEmoji    ?? "📦";
  const pickup      = params.pickup      ?? activeRide?.pickup         ?? "Pickup location";
  const pickupCity  = params.pickupCity  ?? activeRide?.pickupCity     ?? "";
  const drop        = params.drop        ?? activeRide?.drop           ?? "Drop location";
  const dropCity    = params.dropCity    ?? activeRide?.dropCity       ?? "";
  const distKm      = params.distanceKm  ?? (activeRide ? String(activeRide.distanceKm)  : "—");
  const durMin      = params.durationMin ?? (activeRide ? String(activeRide.durationMin) : "—");
  const weight      = params.weight      ?? activeRide?.parcelWeight   ?? "—";
  const earning         = params.earning     ? `₹${params.earning}`
                        : activeRide         ? `₹${activeRide.fareEstimate}`
                        : "₹—";
  const fareAmount      = params.earning     ? Number(params.earning)
                        : (activeRide?.fareEstimate ?? 0);
  const paymentMode     = params.paymentMode    ?? activeRide?.paymentMode      ?? "Cash";
  const surge           = params.surge          === "true" || (activeRide?.surge ?? false);
  const surgeMultiplier = params.surgeMultiplier ? Number(params.surgeMultiplier) : (activeRide?.surgeMultiplier ?? 1);
  const isDelivered     = stage === "delivered";

  // ─── Write initial to_pickup stage ─────────────────────────────────────────
  useEffect(() => {
    if (!orderId) return;
    const restored = activeRide?.orderStatus;
    const isFreshAccept = !restored || restored === "accepted" || restored === "driver_assigned";
    if (isFreshAccept) {
      updateOrderStageViaApi(orderId, "to_pickup").catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Foreground location watcher ───────────────────────────────────────────
  useEffect(() => {
    if (!orderId) return;
    let removed = false;
    void (async () => {
      try {
        const { granted } = await Location.getForegroundPermissionsAsync();
        console.log("[Location] permission granted:", granted, "| orderId:", orderId);
        if (!granted) {
          console.warn("[Location] Foreground permission not granted — live tracking disabled for this delivery");
          return;
        }
        console.log("[Location] Starting watchPositionAsync for order:", orderId);
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 30 },
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            console.log("[Location] GPS callback — lat:", latitude.toFixed(5), "lng:", longitude.toFixed(5), "accuracy:", accuracy, "m");
            updateOrderLocationViaApi(orderId, position)
              .then(() => console.log("[Location] PG-authoritative write sent — orders/", orderId))
              .catch((err: unknown) => console.error("[Location] location write FAILED — orders/", orderId, err));
          },
        );
        if (removed) {
          sub.remove();
          console.log("[Location] Watcher discarded (screen unmounted before start)");
        } else {
          locationSubRef.current = sub;
          console.log("[Location] Watcher active for order:", orderId);
        }
      } catch (e) {
        console.warn("[Location] watchPositionAsync failed:", e);
      }
    })();
    return () => {
      removed = true;
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      console.log("[Location] Watcher stopped for order:", orderId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (stage === "delivered") {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    }
  }, [stage]);

  // ─── Payment classification (frontend display only; fail-safe to cash) ───────
  // ONLINE allow-list mirrors the backend's isCashPayment philosophy: anything
  // unknown/empty is treated as cash (COD), never as already-paid.
  const isOnlinePaid = /^(online|prepaid|paid|upi|razorpay|wallet)$/i.test(String(paymentMode).trim());
  const isCod        = !isOnlinePaid;

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleCall      = () => callNumber(phone);
  // Navigate buttons ONLY open Maps and unlock the matching "Mark" CTA — they
  // never advance the delivery stage (state changes happen on Mark taps only).
  const handleNavPickup = () => { openGoogleMaps(pickup, pickupCity); setPickupNavigated(true); };
  const handleNavDrop   = () => { openGoogleMaps(drop, dropCity);     setDropNavigated(true);   };

  async function advance() {
    if (!activeOrders.some((o) => o.id === orderId) && stage !== "delivered") return;
    haptic("success");

    if (stage === "at_drop") {
      if (otp.length !== 4) { setOtpError("Enter 4-digit OTP"); return; }
      const netState = await Network.getNetworkStateAsync();
      if (netState.isConnected === false) {
        Alert.alert("No Internet Connection", "Internet required to complete delivery and credit earnings. Please reconnect and try again.", [{ text: "OK" }]);
        return;
      }
      setOtpError(null);
      console.log("[OTP] submit — stage:", stage, "| orderId:", orderId ?? "NULL", "| otpLength:", otp.length);
      const result = await completeDelivery(orderId!, otp);
      console.log("[OTP] response — ok:", result.ok, result.ok ? "| newBalance:" + String(result.newBalance) : "| error:" + result.error);
      if (!result.ok) {
        switch (result.error) {
          case "incorrect_otp":
            setOtpError("Incorrect OTP. Please check with customer.");
            return;
          case "already_completed":
            break;
          default: {
            const msgs: Record<string, string> = {
              invalid_stage: "Order state changed. Please refresh.",
              forbidden:     "You are not allowed to complete this order.",
              otp_missing:   "Delivery OTP is missing. Please contact support.",
            };
            Alert.alert("Delivery Error", msgs[result.error] ?? "Could not complete delivery. Please try again.");
            return;
          }
        }
      }
      didEndSelf.current = true;
      if (result.ok) applyWalletUpdate(result.newBalance, result.todayEarnings, result.tripsToday, result.todayDate);
      setOtpSheetVisible(false);
      setStage("delivered");
      return;
    }

    if (stage === "delivered") {
      endRide(orderId!);
      router.replace("/(tabs)");
      return;
    }

    const next = nextStage(stage);
    if (!next || next === "delivered") return;
    setStage(next);
    if (orderId) {
      updateOrderStageViaApi(orderId, next as DeliveryStage).catch((err) =>
        console.warn("[Stage] API write failed:", err),
      );
    }
  }

  function handleCancelOrder() {
    haptic("light");
    setSelectedReason(null);
    setCancelVisible(true);
  }

  async function confirmCancel(reason: string) {
    setCancelVisible(false);
    if (!orderId) return;
    haptic("light");
    try {
      await driverCancelOrder(orderId, driverUid ?? "", reason);
      endRide(orderId);
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Cancel failed", "Could not cancel this order. Please try again.");
    }
  }

  // ─── Mark Drop: driver reached the drop point. Records to_drop+at_drop stages
  // (preserving the existing tracking progression) but NEVER calls the completion
  // API. The Payment Collection sheet opens next; OTP only opens once payment is
  // confirmed. ─────────────────────────────────────────────────────────────────
  async function markDrop() {
    if (!activeOrders.some((o) => o.id === orderId) && stage !== "delivered") return;
    haptic("success");
    // Move UI to at_drop immediately (payment sheet opens via effect).
    setStage("at_drop");
    if (orderId) {
      // Await sequentially so the backend records to_drop BEFORE at_drop. This
      // guarantees the server is in at_drop when the later OTP /complete call
      // arrives (which requires at_drop), avoiding an invalid_stage race.
      // updateOrderStageViaApi is fire-and-forget safe — it never throws.
      if (stage === "at_pickup") {
        await updateOrderStageViaApi(orderId, "to_drop");
      }
      await updateOrderStageViaApi(orderId, "at_drop");
    }
  }

  // ─── Payment Collection confirm handlers ─────────────────────────────────────
  function onCashCollected() {
    haptic("light");
    Alert.alert(
      "Confirm Cash Received",
      `Have you received full ₹${fareAmount} from the customer?`,
      [
        { text: "No", style: "cancel" },
        { text: "Yes, Received", onPress: () => setPaymentConfirmed(true) },
      ],
    );
  }
  function onConfirmOnlinePayment() {
    haptic("light");
    setPaymentConfirmed(true);
  }

  // ─── Sticky CTA descriptor (navigate → mark → payment → OTP) ─────────────────
  const cta: { label: string; icon: string; color: string; hint?: string; onPress: () => void } = (() => {
    if (stage === "to_pickup") {
      return pickupNavigated
        ? { label: "Mark Pickup",        icon: "package",    color: GREEN,   onPress: () => void advance() }
        : { label: "Navigate to Pickup", icon: "navigation", color: PRIMARY, hint: "Opens Google Maps", onPress: handleNavPickup };
    }
    if (stage === "at_pickup" || stage === "to_drop") {
      return dropNavigated
        ? { label: "Mark Drop",        icon: "map-pin",    color: RED,     onPress: () => void markDrop() }
        : { label: "Navigate to Drop", icon: "navigation", color: PRIMARY, hint: "Opens Google Maps", onPress: handleNavDrop };
    }
    if (stage === "at_drop") {
      return paymentConfirmed
        ? { label: "Enter OTP to Deliver", icon: "shield",      color: RED,       onPress: () => setOtpSheetVisible(true) }
        : { label: "Collect Payment",      icon: "dollar-sign", color: PRIMARY,   onPress: () => setPaymentVisible(true) };
    }
    return { label: "Back to Home", icon: "home", color: GREEN, onPress: () => void advance() };
  })();

  // ─── Stage pill label ───────────────────────────────────────────────────────
  const STAGE_PILL: Record<Stage, string> = {
    to_pickup: "En Route to Pickup",
    at_pickup: "Collecting Parcel",
    to_drop:   "En Route to Drop",
    at_drop:   "At Drop Point",
    delivered: "Delivered ✓",
  };
  const STAGE_PILL_COLOR: Record<Stage, string> = {
    to_pickup: PRIMARY,
    at_pickup: GREEN,
    to_drop:   ORANGE,
    at_drop:   "#7C3AED",
    delivered: GREEN,
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={[st.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={st.topBarLeft}>
          <TouchableOpacity style={st.topBarBackBtn} onPress={() => router.replace("/(tabs)")} activeOpacity={0.7}>
            <Feather name="arrow-left" size={18} color={TEXT} />
          </TouchableOpacity>
          <View>
            <Text style={st.topBarTitle}>
              {orderId ? `Order #${orderId.slice(-6).toUpperCase()}` : "Delivery"}
            </Text>
            <View style={[st.stagePill, { backgroundColor: STAGE_PILL_COLOR[stage] + "15", borderColor: STAGE_PILL_COLOR[stage] + "40" }]}>
              <View style={[st.stagePillDot, { backgroundColor: STAGE_PILL_COLOR[stage] }]} />
              <Text style={[st.stagePillTxt, { color: STAGE_PILL_COLOR[stage] }]}>{STAGE_PILL[stage]}</Text>
            </View>
          </View>
        </View>
        <View style={st.topBarRight}>
          <View style={st.timerWrap}>
            <Feather name="clock" size={11} color={MUTED} />
            <ElapsedTimer />
          </View>
          <View style={[st.earningPill, { backgroundColor: PRIMARY + "15", borderColor: PRIMARY + "30" }]}>
            <Text style={[st.earningPillTxt, { color: PRIMARY }]}>{earning}</Text>
          </View>
        </View>
      </View>

      {/* ── Non-focused cancellation banner ─────────────────────────────────── */}
      <Animated.View
        style={[st.cancelBanner, { opacity: bannerOpacity, top: insets.top + 76 }]}
        pointerEvents="none"
      >
        <Feather name="alert-circle" size={14} color="#fff" />
        <Text style={st.cancelBannerText}>A sibling order was cancelled</Text>
      </Animated.View>

      {/* ── SCROLLABLE CONTENT ─────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 130, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Stage tracker */}
        <View style={st.trackerCard}>
          <StepTracker stage={stage} />
        </View>

        <Animated.View style={{ gap: 12, transform: [{ translateY: cardY }], opacity: cardOpac }}>

          {/* ── to_pickup ── */}
          {stage === "to_pickup" && (
            <>
              <RouteCard pickup={pickup} pickupCity={pickupCity} drop={drop} dropCity={dropCity}
                distanceKm={distKm} durationMin={durMin} leg="pickup" />
              <ActionRow onCall={handleCall} onNavigate={handleNavPickup} navigateLabel="Navigate to Pickup" />
              <CustomerCard customer={customer} phone={phone} pickup={pickup} pickupCity={pickupCity}
                emoji={emoji} parcel={parcel} weight={weight} />
            </>
          )}

          {/* ── at_pickup ── */}
          {stage === "at_pickup" && (
            <>
              <PickupConfirmCard pickup={pickup} pickupCity={pickupCity} customer={customer}
                phone={phone} emoji={emoji} parcel={parcel} weight={weight} />
              <ActionRow onCall={handleCall} onNavigate={handleNavPickup} navigateLabel="Re-navigate" />
            </>
          )}

          {/* ── to_drop ── */}
          {stage === "to_drop" && (
            <>
              <RouteCard pickup={pickup} pickupCity={pickupCity} drop={drop} dropCity={dropCity}
                distanceKm={distKm} durationMin={durMin} leg="drop" />
              <ActionRow onCall={handleCall} onNavigate={handleNavDrop} navigateLabel="Navigate to Drop" />
              <DropInfoCard drop={drop} dropCity={dropCity} customer={customer} phone={phone} />
            </>
          )}

          {/* ── at_drop ── */}
          {stage === "at_drop" && (
            <>
              <DeliverCard drop={drop} dropCity={dropCity} customer={customer} phone={phone}
                earning={earning} emoji={emoji} parcel={parcel}
                otp={otp} onOtpChange={(v) => { setOtp(v); setOtpError(null); }}
                otpError={otpError ?? undefined} />
              <ActionRow onCall={handleCall} onNavigate={handleNavDrop} navigateLabel="Re-navigate" />
            </>
          )}

          {/* ── delivered ── */}
          {stage === "delivered" && (
            <CelebrationCard earning={earning} customer={customer} distKm={distKm} />
          )}

        </Animated.View>
      </ScrollView>

      {/* ── STICKY CTA ──────────────────────────────────────────────────────── */}
      <View style={[st.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          onPress={cta.onPress}
          activeOpacity={0.87}
          style={[st.ctaBtn, { backgroundColor: cta.color }]}
        >
          <Feather name={cta.icon as any} size={20} color="#fff" />
          <Text style={st.ctaTxt}>{cta.label}</Text>
        </TouchableOpacity>
        {cta.hint && <Text style={st.ctaHint}>{cta.hint}</Text>}
        {stage === "to_pickup" && (
          <TouchableOpacity onPress={handleCancelOrder} activeOpacity={0.7} style={st.cancelLink}>
            <Text style={st.cancelLinkTxt}>Cancel Order</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── PAYMENT COLLECTION SHEET (shows before OTP at drop) ─────────────── */}
      <Modal
        visible={paymentVisible && stage === "at_drop"}
        transparent
        animationType="slide"
        onRequestClose={() => setPaymentVisible(false)}
        statusBarTranslucent
      >
        <Pressable style={st.otpBackdrop} onPress={() => setPaymentVisible(false)}>
          <Pressable style={[st.otpSheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={st.otpHandle} />

            <View style={st.otpSheetHeader}>
              <View style={[st.otpSheetIcon, { backgroundColor: (isCod ? PRIMARY : GREEN) + "18" }]}>
                <Feather name={isCod ? "dollar-sign" : "check-circle"} size={20} color={isCod ? PRIMARY : GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.otpSheetTitle}>{isCod ? "Collect Payment" : "Payment Received"}</Text>
                <Text style={st.otpSheetSub}>{isCod ? "Cash on delivery" : "Prepaid / online order"}</Text>
              </View>
            </View>

            <View style={[st.payAmountBox, { borderColor: (isCod ? PRIMARY : GREEN) + "30", backgroundColor: (isCod ? PRIMARY : GREEN) + "0D" }]}>
              <Text style={st.payAmountLabel}>Amount to Collect</Text>
              <Text style={[st.payAmountValue, { color: isCod ? PRIMARY : GREEN }]}>
                {isCod ? `₹${fareAmount}` : "₹0"}
              </Text>
              <Text style={st.payAmountHint}>
                {isCod ? `Collect ₹${fareAmount} from customer` : "Payment already received"}
              </Text>
            </View>

            <TouchableOpacity
              style={[st.deliverBtn, { backgroundColor: isCod ? PRIMARY : GREEN }]}
              onPress={isCod ? onCashCollected : onConfirmOnlinePayment}
              activeOpacity={0.85}
            >
              <Feather name="check-circle" size={18} color="#fff" />
              <Text style={[st.deliverBtnText, { color: "#fff" }]}>
                {isCod ? "Cash Collected" : "Confirm Payment"}
              </Text>
            </TouchableOpacity>

            <Text style={st.otpNote}>
              {isCod ? "⚠️ Confirm only after receiving the full cash amount" : "Tap confirm to proceed to delivery OTP"}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── OTP BOTTOM SHEET ────────────────────────────────────────────────── */}
      <Modal
        visible={otpSheetVisible && stage === "at_drop"}
        transparent
        animationType="slide"
        onRequestClose={() => setOtpSheetVisible(false)}
        statusBarTranslucent
      >
        <Pressable style={st.otpBackdrop} onPress={() => setOtpSheetVisible(false)}>
          <Pressable style={[st.otpSheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={st.otpHandle} />

            <View style={st.otpSheetHeader}>
              <View style={st.otpSheetIcon}>
                <Feather name="shield" size={20} color={GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.otpSheetTitle}>Delivery OTP</Text>
                <Text style={st.otpSheetSub}>Ask customer for 4-digit OTP</Text>
              </View>
              <View style={[st.otpRequiredBadge]}>
                <Text style={st.otpRequiredText}>Required</Text>
              </View>
            </View>

            {/* OTP boxes */}
            <View style={st.otpInputRow}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[st.otpBox, otp[i] ? st.otpBoxFilled : {}]}>
                  <Text style={st.otpDigit}>{otp[i] ?? ""}</Text>
                </View>
              ))}
              <TextInput
                style={st.otpHidden}
                value={otp}
                onChangeText={(v) => { setOtp(v.replace(/\D/g, "").slice(0, 4)); setOtpError(null); }}
                keyboardType="numeric"
                maxLength={4}
                caretHidden
                autoFocus
              />
            </View>

            {otpError && (
              <View style={st.otpErrorRow}>
                <Feather name="alert-circle" size={13} color={RED} />
                <Text style={st.otpErrorText}>{otpError}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[st.deliverBtn, { backgroundColor: otp.length === 4 ? RED : BORDER }]}
              onPress={() => void advance()}
              activeOpacity={0.85}
            >
              <Feather name="check-circle" size={18} color={otp.length === 4 ? "#fff" : MUTED} />
              <Text style={[st.deliverBtnText, { color: otp.length === 4 ? "#fff" : MUTED }]}>
                Deliver Parcel
              </Text>
            </TouchableOpacity>

            <Text style={st.otpNote}>⚠️ Delivery OTP is required to complete this order</Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── CANCEL ORDER MODAL ──────────────────────────────────────────────── */}
      <Modal
        visible={cancelVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelVisible(false)}
        statusBarTranslucent
      >
        <Pressable style={st.csBackdrop} onPress={() => setCancelVisible(false)}>
          <Pressable style={st.csCard} onPress={() => {}}>
            <Text style={st.csTitle}>Cancel Order</Text>
            <Text style={st.csSub}>Select a reason before pickup</Text>

            <View style={st.csCardList}>
              {([
                { emoji: "📦", label: "Oversized Parcel",            desc: "Parcel is too large for vehicle",  reason: "Oversized Parcel"            },
                { emoji: "🚗", label: "Vehicle Breakdown / Accident", desc: "Vehicle issue or accident",        reason: "Vehicle Breakdown / Accident" },
                { emoji: "⚠️", label: "Route Not Reachable",          desc: "Road blocked or inaccessible",    reason: "Route Not Reachable"         },
              ] as const).map(({ emoji, label, desc, reason }) => {
                const selected = selectedReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    activeOpacity={0.8}
                    style={[
                      st.csReason,
                      selected && { borderColor: ORANGE, backgroundColor: "#FFF8F5", borderWidth: 2 },
                    ]}
                    onPress={() => { haptic("light"); setSelectedReason(reason); }}
                  >
                    <Text style={st.csReasonEmoji}>{emoji}</Text>
                    <View style={st.csReasonText}>
                      <Text style={[st.csReasonLabel, selected && { color: ORANGE }]}>{label}</Text>
                      <Text style={st.csReasonDesc}>{desc}</Text>
                    </View>
                    {selected && <Feather name="check-circle" size={20} color={ORANGE} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={st.csBtnRow}>
              <TouchableOpacity style={st.csKeepBtn} activeOpacity={0.8} onPress={() => setCancelVisible(false)}>
                <Text style={st.csKeepTxt}>Keep Order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={selectedReason ? 0.85 : 1}
                disabled={!selectedReason}
                style={[st.csConfirmBtn, { backgroundColor: selectedReason ? RED : BORDER }]}
                onPress={() => selectedReason && confirmCancel(selectedReason)}
              >
                <Text style={[st.csConfirmTxt, !selectedReason && { color: MUTED }]}>
                  Confirm Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  // Header
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  topBarLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  topBarBackBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER,
  },
  topBarTitle: { fontSize: 14, fontWeight: "800", color: TEXT, marginBottom: 3 },
  stagePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start",
  },
  stagePillDot: { width: 5, height: 5, borderRadius: 2.5 },
  stagePillTxt: { fontSize: 10, fontWeight: "700" },
  topBarRight: { alignItems: "flex-end", gap: 6 },
  timerWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  elapsed: { fontSize: 13, fontWeight: "700", color: TEXT, fontVariant: ["tabular-nums"] },
  earningPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  earningPillTxt: { fontSize: 13, fontWeight: "900" },

  // Stage tracker
  trackerCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  stepRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  stepItem: { flex: 1, alignItems: "center", position: "relative" },
  stepLine: { position: "absolute", top: 12, left: "-50%", right: "50%", height: 2, zIndex: 0 },
  stepCircle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center", zIndex: 1 },
  stepLbl: { fontSize: 9, fontWeight: "700", marginTop: 5, textAlign: "center" },

  // Route card (light)
  routeCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 14, gap: 12,
    borderWidth: 1.5,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  routeChips: { flexDirection: "row", gap: 6, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  chipTxt: { fontSize: 10, fontWeight: "700" },
  routeViz: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  pinCol: { alignItems: "center", gap: 4, paddingTop: 2 },
  pinDot: { width: 14, height: 14, borderRadius: 7, shadowRadius: 8, shadowOpacity: 0.5, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  pinLine: { width: 2, flex: 1, backgroundColor: BORDER, borderRadius: 1 },
  pinTag: { fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  pinAddr: { fontSize: 13, fontWeight: "700", color: TEXT, marginTop: 1 },
  pinCity: { fontSize: 10, color: MUTED, marginTop: 1 },
  dashes: { flexDirection: "row", gap: 3, marginVertical: 5 },
  dash: { flex: 1, height: 2, borderRadius: 1 },
  routeStatusRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7 },
  routeStatusTxt: { fontSize: 12, fontWeight: "700" },

  // Action row
  actionRow: { flexDirection: "row", gap: 10 },
  callBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: "#ECFDF5", borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: GREEN + "40",
    shadowColor: GREEN, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2,
  },
  callTxt: { fontSize: 14, fontWeight: "800", color: GREEN },
  navBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10,
    shadowColor: BLUE, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  navTxt: { fontSize: 13, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },

  // Cards
  card: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 13,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 18, fontWeight: "800", color: PINK },
  custName: { fontSize: 15, fontWeight: "700", color: TEXT },
  custPhone: { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 1, letterSpacing: 0.3 },
  custVerified: { fontSize: 10, color: GREEN, fontWeight: "700", marginTop: 2 },
  parcelChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: BG, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  parcelName: { fontSize: 11, fontWeight: "700", color: TEXT },
  parcelWeight: { fontSize: 9, color: MUTED, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "#F1F5F9" },
  addrBlock: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  addrDotGreen: { width: 14, height: 14, borderRadius: 7, backgroundColor: GREEN, marginTop: 2, shadowColor: GREEN, shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrDotRed: { width: 14, height: 14, borderRadius: 7, backgroundColor: RED, marginTop: 2, shadowColor: RED, shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrTag: { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 0.8 },
  addrMain: { fontSize: 14, fontWeight: "700", color: TEXT, marginTop: 2 },
  addrSub: { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },
  confirmBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, padding: 13 },
  confirmIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  confirmTitle: { fontSize: 14, fontWeight: "800" },
  confirmSub: { fontSize: 11, color: MUTED, marginTop: 2 },
  parcelDetailRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  parcelDetailName: { fontSize: 15, fontWeight: "800", color: TEXT },
  parcelDetailMeta: { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 3 },
  verifyBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: GREEN + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifyTxt: { fontSize: 10, fontWeight: "700", color: GREEN },

  // Celebration
  celebCard: { backgroundColor: CARD, borderRadius: 20, padding: 28, alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#D1FAE5" },
  celebTitle: { fontSize: 24, fontWeight: "900", color: TEXT },
  celebSub: { fontSize: 14, color: MUTED, textAlign: "center" },
  celebEarning: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 50, shadowColor: PRIMARY, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  celebAmt: { fontSize: 30, fontWeight: "900", color: "#fff" },
  celebStats: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  celebStat: { alignItems: "center", gap: 4, paddingHorizontal: 16 },
  celebStatVal: { fontSize: 16, fontWeight: "800", color: TEXT },
  celebStatLbl: { fontSize: 10, fontWeight: "600", color: MUTED },
  celebSep: { width: 1, height: 32, backgroundColor: BORDER },

  // Non-focused cancellation banner
  cancelBanner: {
    position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: NAVY, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    zIndex: 200, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 8,
  },
  cancelBannerText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "600" },

  // CTA
  ctaWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14,
    backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER,
    shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: -4 }, elevation: 10,
    gap: 6,
  },
  ctaBtn: {
    height: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 18,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  ctaTxt: { fontSize: 17, fontWeight: "900", color: "#fff" },
  ctaHint: { textAlign: "center", fontSize: 11, color: MUTED, fontWeight: "500" },
  cancelLink: { alignItems: "center", paddingVertical: 2 },
  cancelLinkTxt: { fontSize: 12, fontWeight: "600", color: RED, textDecorationLine: "underline" },

  // OTP bottom sheet
  otpBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  otpSheet: {
    backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 14, gap: 16,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 20,
  },
  otpHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: "center", marginBottom: 4 },
  otpSheetHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  otpSheetIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  otpSheetTitle: { fontSize: 17, fontWeight: "800", color: TEXT },
  otpSheetSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  otpRequiredBadge: { backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  otpRequiredText: { fontSize: 10, fontWeight: "700", color: RED },
  otpInputRow: { flexDirection: "row", gap: 10, justifyContent: "center", position: "relative" },
  otpBox: {
    width: 58, height: 64, borderRadius: 14, borderWidth: 2, borderColor: BORDER,
    backgroundColor: BG, alignItems: "center", justifyContent: "center",
  },
  otpBoxFilled: { borderColor: GREEN, backgroundColor: GREEN + "10" },
  otpDigit: { fontSize: 28, fontWeight: "900", color: TEXT },
  otpHidden: { position: "absolute", opacity: 0, width: "100%", height: "100%" },
  otpErrorRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FEE2E2", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  otpErrorText: { fontSize: 13, color: RED, fontWeight: "600" },
  deliverBtn: {
    height: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 16,
  },
  deliverBtnText: { fontSize: 16, fontWeight: "900" },
  otpNote: { textAlign: "center", fontSize: 11, color: MUTED, paddingBottom: 4 },

  // Payment collection sheet
  payAmountBox: {
    borderRadius: 16, borderWidth: 1.5, paddingVertical: 20, paddingHorizontal: 16,
    alignItems: "center", gap: 4, marginVertical: 4,
  },
  payAmountLabel: { fontSize: 12, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  payAmountValue: { fontSize: 36, fontWeight: "900", fontVariant: ["tabular-nums"] },
  payAmountHint: { fontSize: 13, fontWeight: "600", color: TEXT },

  // Cancel modal
  csBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "center", alignItems: "center" },
  csCard: {
    width: "88%", backgroundColor: CARD, borderRadius: 24, paddingHorizontal: 20,
    paddingTop: 24, paddingBottom: 20,
    shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 20,
  },
  csTitle: { fontSize: 20, fontWeight: "900", color: TEXT, textAlign: "center" },
  csSub: { fontSize: 13, color: MUTED, textAlign: "center", marginTop: 4, marginBottom: 16 },
  csCardList: { gap: 10 },
  csReason: {
    flexDirection: "row", alignItems: "center", minHeight: 68, gap: 14,
    backgroundColor: BG, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  csReasonEmoji: { fontSize: 24, width: 34, textAlign: "center" },
  csReasonText: { flex: 1, gap: 2 },
  csReasonLabel: { fontSize: 14, fontWeight: "800", color: TEXT },
  csReasonDesc: { fontSize: 12, color: MUTED },
  csBtnRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  csKeepBtn: {
    flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: BORDER,
    justifyContent: "center", alignItems: "center", backgroundColor: CARD,
  },
  csKeepTxt: { fontSize: 14, fontWeight: "700", color: MUTED },
  csConfirmBtn: { flex: 1, height: 50, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  csConfirmTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },
});
