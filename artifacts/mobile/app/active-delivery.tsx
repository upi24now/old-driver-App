/**
 * active-delivery.tsx — Real logistics delivery flow
 *
 * 5-stage workflow:
 *   to_pickup → Navigate to Pickup (Google Maps) + "Arrived" CTA
 *   at_pickup → "Parcel Picked Up" CTA
 *   to_drop   → Navigate to Drop   (Google Maps) + "Arrived" CTA
 *   at_drop   → "Deliver Parcel"  + OTP field (future-ready)
 *   delivered → Celebration + earnings
 *
 * Call: Linking.openURL("tel:+91XXXXXXXXXX") — opens Android dialer, no permission needed.
 * Maps: Linking.openURL("https://www.google.com/maps/dir/?api=1&destination=…")
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDriver } from "@/contexts/DriverContext";
import { useEffect, useRef, useState } from "react";
import { driverCancelOrder, updateOrderStage, type DeliveryStage } from "@/utils/firestore";
import { completeDelivery } from "@/utils/delivery-api";
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

// ─── Brand ────────────────────────────────────────────────────────────────────
const GREEN  = "#00C853";
const PINK   = "#FF4D8D";
const ORANGE = "#FF7A3D";
const BLUE   = "#4285F4";
const NAVY   = "#0F172A";
const RED    = "#EF4444";

// ─── Stage machine ────────────────────────────────────────────────────────────
type Stage = "to_pickup" | "at_pickup" | "to_drop" | "at_drop" | "delivered";
const STAGE_ORDER: Stage[] = ["to_pickup", "at_pickup", "to_drop", "at_drop", "delivered"];

/**
 * Map a Firestore OrderStatus to the local Stage type.
 * "accepted" and unknown values both start at "to_pickup" (safe default).
 * Never rolls back — caller must not pass a status regressed from actual.
 */
function firestoreStatusToStage(status: string | undefined): Stage {
  switch (status) {
    case "at_pickup": return "at_pickup";
    case "to_drop":   return "to_drop";
    case "at_drop":   return "at_drop";
    case "delivered": return "delivered";
    default:          return "to_pickup"; // covers "accepted", "to_pickup", undefined
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

/** +91 98XXXX210 — masks middle 4 digits of a 10-digit number */
function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "Number unavailable";
  if (d.length < 7) return `+91 ${d}`;
  return `+91 ${d.slice(0, 2)}XXXX${d.slice(-3)}`;
}

/** Open Android dialer with pre-filled number — no confirmation popup. */
function callNumber(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (!d) {
    Alert.alert("No number", "Customer phone number is unavailable for this order.");
    return;
  }
  // tel: URIs open the native dialer directly on Android/iOS — no canOpenURL check needed.
  Linking.openURL(`tel:+91${d}`).catch(() => {
    Alert.alert("Dialer unavailable", "Unable to open phone app on this device.");
  });
}

function openGoogleMaps(address: string, city: string) {
  const dest = encodeURIComponent(`${address}, ${city}, India`);
  const url  = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=two-wheeler`;
  Linking.canOpenURL(url)
    .then((ok) => { if (ok) Linking.openURL(url); else Alert.alert("Maps unavailable"); })
    .catch(() => Alert.alert("Maps unavailable"));
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
            {i > 0 && <View style={[st.stepLine, { backgroundColor: i <= active ? GREEN : "#E2E8F0" }]} />}
            <View style={[st.stepCircle, { borderColor: col, backgroundColor: done ? GREEN : cur ? "#E8FFF0" : "#F8FAFC" }]}>
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

// ─── Route preview card ───────────────────────────────────────────────────────
function RouteCard({ pickup, pickupCity, drop, dropCity, distanceKm, durationMin, leg }: {
  pickup: string; pickupCity: string; drop: string; dropCity: string;
  distanceKm: string; durationMin: string; leg: "pickup" | "drop";
}) {
  const pulse = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.2, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.9, duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  const activeColor = leg === "pickup" ? GREEN : ORANGE;
  return (
    <View style={st.routeCard}>
      <LinearGradient colors={[NAVY, "#1E293B"]} style={StyleSheet.absoluteFill} />
      {/* Chips */}
      <View style={st.routeChips}>
        <View style={[st.chip, { backgroundColor: activeColor + "22", borderColor: activeColor + "55" }]}>
          <Feather name="navigation" size={10} color={activeColor} />
          <Text style={[st.chipTxt, { color: activeColor }]}>{distanceKm} km</Text>
        </View>
        <View style={[st.chip, { backgroundColor: "#FFFFFF14", borderColor: "#FFFFFF22" }]}>
          <Feather name="clock" size={10} color="#94A3B8" />
          <Text style={[st.chipTxt, { color: "#CBD5E1" }]}>{durationMin} min ETA</Text>
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
              <View key={i} style={[st.dash, { backgroundColor: activeColor + "55" }]} />
            ))}
          </View>
          <View>
            <Text style={[st.pinTag, { color: RED }]}>DROP</Text>
            <Text style={st.pinAddr} numberOfLines={1}>{drop}</Text>
            <Text style={st.pinCity}>{dropCity}</Text>
          </View>
        </View>
      </View>
      {/* Bottom status */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <LiveDot color={activeColor} size={7} />
        <Text style={[st.routeBottomTxt, { color: activeColor }]}>
          {leg === "pickup" ? "Navigate to pickup" : "Navigate to drop"}
        </Text>
      </View>
    </View>
  );
}

// ─── Compact action row: Call + Navigate (50/50) ──────────────────────────────
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
      {/* Call */}
      <Animated.View style={[{ flex: 1 }, { transform: [{ scale: callScale }] }]}>
        <TouchableOpacity
          onPressIn={() => pressIn(callScale)}
          onPressOut={() => pressOut(callScale, onCall)}
          activeOpacity={1}
          style={st.callBtn}
        >
          <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={st.callGrad}>
            <Feather name="phone" size={16} color={GREEN} />
            <Text style={st.callTxt}>Call</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      {/* Navigate */}
      <Animated.View style={[{ flex: 1 }, { transform: [{ scale: navScale }] }]}>
        <TouchableOpacity
          onPressIn={() => pressIn(navScale)}
          onPressOut={() => pressOut(navScale, onNavigate)}
          activeOpacity={1}
          style={st.navBtn}
        >
          <LinearGradient
            colors={[BLUE, "#5B9BFF"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={st.navGrad}
          >
            <Feather name="map-pin" size={14} color="#fff" />
            <Text style={st.navTxt} numberOfLines={1}>{navigateLabel}</Text>
            <Feather name="external-link" size={11} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
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
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
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
    <View style={[st.card, st.cardGlowGreen]}>
      <LinearGradient colors={[GREEN + "22", GREEN + "08"]} style={st.confirmBanner}>
        <View style={[st.confirmIcon, { backgroundColor: GREEN + "25" }]}>
          <Feather name="package" size={22} color={GREEN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.confirmTitle, { color: "#065F46" }]}>Collect Parcel from Customer</Text>
          <Text style={st.confirmSub}>Verify parcel before confirming pickup</Text>
        </View>
      </LinearGradient>
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
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
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
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
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

// ─── Deliver card ─────────────────────────────────────────────────────────────
function DeliverCard({ drop, dropCity, customer, phone, earning, emoji, parcel, otp, onOtpChange, otpError }: {
  drop: string; dropCity: string; customer: string; phone: string;
  earning: string; emoji: string; parcel: string;
  otp: string; onOtpChange: (v: string) => void; otpError?: string;
}) {
  return (
    <View style={[st.card, st.cardGlowPurple]}>
      <LinearGradient colors={["#EDE9FE", "#F5F3FF"]} style={st.confirmBanner}>
        <View style={[st.confirmIcon, { backgroundColor: "#8B5CF620" }]}>
          <Feather name="check-circle" size={22} color="#8B5CF6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.confirmTitle, { color: "#4C1D95" }]}>Deliver Parcel to Customer</Text>
          <Text style={st.confirmSub}>Confirm delivery once handed over</Text>
        </View>
      </LinearGradient>
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
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custPhone}>{maskPhone(phone)}</Text>
        </View>
      </View>
      <View style={st.divider} />
      {/* OTP */}
      <View style={st.otpWrap}>
        <View style={st.otpHeader}>
          <Feather name="shield" size={13} color={GREEN} />
          <Text style={st.otpTitle}>Delivery OTP</Text>
          <View style={[st.otpBadge, { backgroundColor: "#FEE2E2" }]}><Text style={[st.otpBadgeTxt, { color: "#DC2626" }]}>Required</Text></View>
        </View>
        <Text style={st.otpSub}>Ask customer for 4-digit OTP to confirm delivery</Text>
        {!!otpError && (
          <Text style={{ fontSize: 12, color: "#DC2626", fontWeight: "600", marginTop: 2 }}>
            {otpError}
          </Text>
        )}
        <View style={st.otpInputRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[st.otpBox, otp[i] ? st.otpBoxFilled : {}]}>
              <Text style={st.otpDigit}>{otp[i] ?? ""}</Text>
            </View>
          ))}
          <TextInput
            style={st.otpHidden} value={otp}
            onChangeText={(v) => onOtpChange(v.replace(/\D/g, "").slice(0, 4))}
            keyboardType="numeric" maxLength={4} caretHidden
          />
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
      <LinearGradient colors={[PINK, ORANGE]} style={st.celebEarning} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Text style={st.celebAmt}>{earning}</Text>
      </LinearGradient>
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
    orderId: string;   // Firestore order document ID — required for stage writes
    customer: string; phone: string; parcelType: string; parcelEmoji: string;
    pickup: string; pickupCity: string; drop: string; dropCity: string;
    distanceKm: string; durationMin: string; earning: string; weight: string;
    // Payment / surge — serialized as strings for route params
    paymentMode: string; surge: string; surgeMultiplier: string;
  }>();

  // Must come before useState so the lazy initializer can read restored status.
  const { activeOrders, activeRide, endRide, orderRemovalReasons, driverUid, refreshWallet } = useDriver();

  // ── Derive orderId and thisOrder early — before useState so the lazy
  // initializer can seed stage from the correct order's status. ────────────────
  //
  // orderId:   prefers params.orderId (written at router.replace time) so this
  //            screen stays anchored to the order it was opened for, regardless
  //            of where currentActiveOrderId points later.
  //
  // thisOrder: looks up the exact order in activeOrders rather than relying on
  //            activeRide (the compat shim).  activeRide shifts whenever
  //            currentActiveOrderId changes — a second order accepted, focusOrder
  //            called from the Command Center, etc.  All order-specific reads
  //            (stage init, OTP, cancellation guard, advance guard) use thisOrder
  //            so they always operate on params.orderId's order, not the focused one.
  //            Falls back to activeRide so 1-order behavior is entirely unchanged.
  const orderId   = params.orderId ?? activeRide?.id ?? null;
  const thisOrder = activeOrders.find((o) => o.id === orderId) ?? activeRide;

  // Tracks whether THIS screen called endRide() normally (delivery complete).
  // If the order is externally removed without us setting this, it means an
  // external cancellation occurred and we must exit with an alert.
  const didEndSelf = useRef(false);

  // Restore delivery stage from Firestore status on app restart.
  // Uses thisOrder (not activeRide) so stage reflects THIS screen's order,
  // not whichever order currentActiveOrderId happens to point to at mount time.
  const [stage, setStage] = useState<Stage>(() =>
    firestoreStatusToStage(thisOrder?.orderStatus),
  );
  const [otp,           setOtp]           = useState("");
  const [otpError,      setOtpError]      = useState<string | null>(null);
  const [cancelVisible,  setCancelVisible]  = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  // Card slide-in on stage change
  const cardY    = useRef(new Animated.Value(60)).current;
  const cardOpac = useRef(new Animated.Value(0)).current;

  // Non-focused cancellation banner — fade in / hold / fade out.
  const bannerOpacity     = useRef(new Animated.Value(0)).current;
  // Tracks which orderIds have already triggered a banner to prevent duplicate
  // notices if orderRemovalReasons re-renders without adding new keys.
  const shownBannerForRef = useRef<Set<string>>(new Set());

  function animateIn() {
    cardY.setValue(60); cardOpac.setValue(0);
    Animated.parallel([
      Animated.spring(cardY,    { toValue: 0, friction: 7, tension: 130, useNativeDriver: true }),
      Animated.timing(cardOpac, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }
  useEffect(() => { animateIn(); }, [stage]);

  // ─── External cancellation guard ──────────────────────────────────────────
  // Fires whenever activeRide or the per-order removal reason map changes.
  // If activeRide becomes null and THIS screen did not trigger the clear
  // (didEndSelf), the order was cancelled externally (customer, admin, etc.).
  //
  // P4-D: looks up the reason by THIS screen's orderId — not a shared global —
  // so cancelling Order A never triggers a false alert on Order B's screen.
  //
  // "delivered" is excluded: the DriverContext listener clears activeRide as
  // soon as it sees status="delivered" in Firestore (~100–500ms after advance()
  // writes the status), before the driver presses "Back to Home". At that point
  // didEndSelf may still be false, so we also guard on stage === "delivered".
  useEffect(() => {
    // No order to watch yet.
    if (!orderId) return;

    // Order is still active — nothing to do.
    //
    // NOTE: this replaces the previous `if (activeRide !== null) return` guard,
    // which was broken in multi-order scenarios: when the focused order is cancelled
    // while a sibling order exists, DriverContext shifts currentActiveOrderId to the
    // sibling, so activeRide becomes the sibling order (never null), and the
    // cancellation alert was silently swallowed.  Checking activeOrders membership
    // by orderId is order-specific and correct in all cases (1, 2, or 3 orders).
    if (activeOrders.some((o) => o.id === orderId)) return;

    if (didEndSelf.current) return;        // normal completion — already navigating
    if (stage === "delivered") return;     // delivery finished normally — not a cancel

    // Look up the removal reason for THIS screen's order specifically.
    // Falls back to null when the map entry hasn't been written yet (race window
    // between Firestore listener firing and React state updating).
    const reason = orderRemovalReasons[orderId] ?? null;

    // Only show "Order Cancelled" for genuine external events.
    // "delivered" and "completed" mean the order finished normally via the
    // DriverContext Firestore listener — not an external cancellation.
    // "cancelled", "rejected", "deleted", and null (reason not yet set) all
    // indicate an external action by the customer, admin, or test cleanup.
    if (reason === "delivered" || reason === "completed") return;

    // External cancellation confirmed for this specific order.
    Alert.alert(
      "Order Cancelled",
      "This order was cancelled by the customer.",
      [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
      { cancelable: false },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrders, orderRemovalReasons]);

  // ─── Non-focused order cancellation notice ─────────────────────────────────
  // When a sibling order (not this screen's orderId) is cancelled/rejected/deleted,
  // show a brief passive banner so the driver is aware without interrupting Order A.
  // Does NOT navigate, does NOT change focus, does NOT affect stage flow.
  useEffect(() => {
    for (const [id, reason] of Object.entries(orderRemovalReasons)) {
      if (id === orderId) continue;                                  // focused order — handled by Alert above
      if (shownBannerForRef.current.has(id)) continue;              // already notified for this order
      if (reason !== "cancelled" && reason !== "rejected" && reason !== "deleted") continue;
      shownBannerForRef.current.add(id);                            // mark as shown
      Animated.sequence([
        Animated.timing(bannerOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(bannerOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
      break; // one banner at a time; next re-render will handle any further removals
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRemovalReasons]);

  // Params — fall back to DriverContext activeRide when navigating back to this
  // screen without fresh route params (e.g. after app restore or tab switch).
  // orderId is derived earlier (before useState) so thisOrder can be seeded correctly.
  const customer   = params.customer    ?? activeRide?.passengerName  ?? "Customer";
  const phone      = params.phone       ?? activeRide?.customerPhone  ?? "";
  const parcel     = params.parcelType  ?? activeRide?.parcelType     ?? "Parcel";
  const emoji      = params.parcelEmoji ?? activeRide?.parcelEmoji    ?? "📦";
  const pickup     = params.pickup      ?? activeRide?.pickup         ?? "Pickup location";
  const pickupCity = params.pickupCity  ?? activeRide?.pickupCity     ?? "";
  const drop       = params.drop        ?? activeRide?.drop           ?? "Drop location";
  const dropCity   = params.dropCity    ?? activeRide?.dropCity       ?? "";
  const distKm     = params.distanceKm  ?? (activeRide ? String(activeRide.distanceKm)  : "—");
  const durMin     = params.durationMin ?? (activeRide ? String(activeRide.durationMin) : "—");
  const weight     = params.weight      ?? activeRide?.parcelWeight   ?? "—";
  const earning        = params.earning     ? `₹${params.earning}`
                       : activeRide         ? `₹${activeRide.fareEstimate}`
                       : "₹—";
  // Raw numeric fare used for earning credit on delivery
  const fareAmount     = params.earning     ? Number(params.earning)
                       : (activeRide?.fareEstimate ?? 0);
  const paymentMode    = params.paymentMode     ?? activeRide?.paymentMode      ?? "Cash";
  const surge          = params.surge           === "true" || (activeRide?.surge ?? false);
  const surgeMultiplier = params.surgeMultiplier ? Number(params.surgeMultiplier) : (activeRide?.surgeMultiplier ?? 1);
  const isDelivered = stage === "delivered";

  // Write "to_pickup" to Firestore only for a fresh accept (status is "accepted" or
  // undefined — meaning the driver just accepted the order and the screen opened for
  // the first time). On app restore the order is already progressed, so we must NOT
  // roll back its status.
  useEffect(() => {
    if (!orderId) return;
    const restored = activeRide?.orderStatus;
    const isFreshAccept = !restored || restored === "accepted";
    if (isFreshAccept) {
      updateOrderStage(orderId, "to_pickup").catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageMeta: Record<Stage, { topLabel: string; topColor: [string, string]; pill: string }> = {
    to_pickup: { topLabel: "Navigating to Pickup", topColor: [NAVY, "#1E293B"],     pill: "🛵 En Route to Pickup"  },
    at_pickup: { topLabel: "At Pickup Location",   topColor: ["#065F46", "#047857"], pill: "📦 Collect Parcel"      },
    to_drop:   { topLabel: "Navigating to Drop",   topColor: ["#7C2D12", "#92400E"], pill: "🚀 En Route to Drop"    },
    at_drop:   { topLabel: "At Drop Location",     topColor: ["#1E1B4B", "#312E81"], pill: "🏁 Complete Delivery"   },
    delivered: { topLabel: "Order Delivered! 🎉",  topColor: [GREEN, "#00E676"],     pill: "✅ Earnings Credited"   },
  };
  const meta = stageMeta[stage];

  async function advance() {
    // Guard: if this order is no longer in activeOrders (customer cancellation or
    // external removal), do not write any stage to Firestore. The cancellation
    // useEffect handles the alert and exit.
    // Exception: at delivered stage the DriverContext listener may have already
    // removed the order (it fires on status="delivered"), so we must still allow
    // "Back to Home" to proceed — there is no Firestore write at that stage anyway.
    //
    // NOTE: uses activeOrders.some() rather than !activeRide because activeRide (the
    // compat shim) can point to a sibling order when currentActiveOrderId shifts,
    // which would allow writes to already-removed orders to slip through.
    if (!activeOrders.some((o) => o.id === orderId) && stage !== "delivered") return;

    haptic("success");

    // OTP gate — enforced only at the at_drop → delivered transition.
    // Server verifies the OTP, atomically sets status=delivered, and credits the
    // driver wallet. The client never sees or compares the OTP value.
    if (stage === "at_drop") {
      if (otp.length !== 4) {
        setOtpError("Enter 4-digit OTP");
        return;
      }

      // ── Network guard ─────────────────────────────────────────────────────
      const netState = await Network.getNetworkStateAsync();
      if (netState.isConnected === false) {
        Alert.alert(
          "No Internet Connection",
          "Internet required to complete delivery and credit earnings. Please reconnect and try again.",
          [{ text: "OK" }],
        );
        return;
      }

      setOtpError(null);

      // ── Server-side OTP verification + completion ─────────────────────────
      // Server atomically: verifies OTP, marks order delivered, credits wallet.
      const result = await completeDelivery(orderId!, otp);

      if (!result.ok) {
        switch (result.error) {
          case "incorrect_otp":
            setOtpError("Incorrect OTP. Please check with customer.");
            return;
          case "already_completed":
            // Idempotent — treat the same as a fresh success; fall through.
            break;
          default: {
            const msgs: Record<string, string> = {
              invalid_stage: "Order state changed. Please refresh.",
              forbidden:     "You are not allowed to complete this order.",
              otp_missing:   "Delivery OTP is missing. Please contact support.",
            };
            Alert.alert(
              "Delivery Error",
              msgs[result.error] ?? "Could not complete delivery. Please try again.",
            );
            return;
          }
        }
      }

      // Server completed the order — arm self-exit guard, sync wallet, show celebration.
      // endRide + navigation happen when the driver taps "Back to Home" below.
      didEndSelf.current = true;
      refreshWallet().catch(console.error);
      setStage("delivered");
      return;
    }

    setOtpError(null);
    const next = nextStage(stage);
    if (!next) {
      // ── Delivered "Back to Home" ──────────────────────────────────────────
      // Wallet credit was already handled by the server at the at_drop step.
      // No wallet transaction here — just clean up local state and go home.
      didEndSelf.current = true;
      if (orderId) endRide(orderId);
      router.replace("/(tabs)");
      return;
    }
    // Write the incoming stage to Firestore before updating local state.
    // Customer app listens to orders/{orderId}.status for real-time tracking.
    if (orderId) {
      updateOrderStage(orderId, next as DeliveryStage).catch(console.error);
    }
    setStage(next);
  }

  function handleCall()         { callNumber(phone); }
  function handleNavPickup()    { haptic("light"); openGoogleMaps(pickup, pickupCity); }
  function handleNavDrop()      { haptic("light"); openGoogleMaps(drop,   dropCity);   }

  function handleCancelOrder() {
    haptic("light");
    setSelectedReason(null);
    setCancelVisible(true);
  }

  async function confirmCancel(reason: string) {
    setCancelVisible(false);
    haptic("light");
    // Arm the self-exit guard BEFORE local cleanup so the external
    // cancellation useEffect doesn't fire a false "Order Cancelled" alert.
    didEndSelf.current = true;
    try {
      if (orderId && driverUid) {
        await driverCancelOrder(orderId, driverUid, reason);
      }
    } catch {
      // Firestore write failed — order may still be in-progress on the
      // server. Local cleanup proceeds regardless so the driver is
      // unblocked; dispatcher will reconcile.
    }
    if (orderId) endRide(orderId);
    router.replace("/(tabs)");
  }

  type CtaCfg = { label: string; icon: string; color: [string, string] };
  const ctaCfg: Record<Stage, CtaCfg> = {
    to_pickup: { label: "I've Arrived at Pickup", icon: "map-pin",     color: [GREEN,     "#00E676"] },
    at_pickup: { label: "Parcel Picked Up  ✓",    icon: "package",     color: [GREEN,     "#00E676"] },
    to_drop:   { label: "I've Arrived at Drop",   icon: "map-pin",     color: [ORANGE,    "#FF9F45"] },
    at_drop:   { label: "Deliver Parcel  ✓",      icon: "check-circle",color: ["#8B5CF6", "#7C3AED"] },
    delivered: { label: "Back to Home",            icon: "home",        color: [GREEN,     "#00E676"] },
  };
  const cta = ctaCfg[stage];

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      {/* Non-focused cancellation banner — passive, non-blocking, auto-hides */}
      <Animated.View
        pointerEvents="none"
        style={[st.cancelBanner, { opacity: bannerOpacity, top: insets.top + 8 }]}
      >
        <Feather name="alert-circle" size={14} color="#fff" />
        <Text style={st.cancelBannerText}>Another delivery was cancelled.</Text>
      </Animated.View>

      {/* Top bar */}
      <LinearGradient colors={meta.topColor} style={st.topBar}>
        <View style={st.topBarLeft}>
          {!isDelivered && <LiveDot color="#fff" size={10} />}
          <Text style={st.topBarTitle} numberOfLines={1}>{meta.topLabel}</Text>
        </View>
        <View style={[st.topBarRight, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
          <TouchableOpacity onPress={callSupport} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="help-circle" size={18} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          {!isDelivered && (
            <ElapsedTimer
              startSec={activeRide?.acceptedAt
                ? Math.max(0, Math.floor((Date.now() - activeRide.acceptedAt) / 1000))
                : 0}
            />
          )}
          {isDelivered && <Text style={{ fontSize: 22 }}>🎉</Text>}
        </View>
      </LinearGradient>

      {/* Stage pill + earning */}
      <View style={st.pillRow}>
        <View style={st.stagePill}>
          <Text style={st.stagePillTxt}>{meta.pill}</Text>
        </View>
        <View style={st.earningPill}>
          <Text style={st.earningPillTxt}>{earning}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Step tracker */}
        <View style={st.trackerCard}>
          <StepTracker stage={stage} />
        </View>

        <Animated.View style={{ gap: 12, transform: [{ translateY: cardY }], opacity: cardOpac }}>

          {/* ── to_pickup ── */}
          {stage === "to_pickup" && (
            <>
              <RouteCard pickup={pickup} pickupCity={pickupCity} drop={drop} dropCity={dropCity}
                distanceKm={distKm} durationMin={durMin} leg="pickup" />
              <ActionRow
                onCall={handleCall}
                onNavigate={handleNavPickup}
                navigateLabel="Navigate to Pickup"
              />
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
              <ActionRow
                onCall={handleCall}
                onNavigate={handleNavDrop}
                navigateLabel="Navigate to Drop"
              />
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

      {/* Sticky CTA */}
      <View style={[st.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity onPress={advance} activeOpacity={0.87} style={{ borderRadius: 18, overflow: "hidden" }}>
          <LinearGradient
            colors={cta.color} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={st.ctaBtn}
          >
            <Feather name={cta.icon as any} size={20} color="#fff" />
            <Text style={st.ctaTxt}>{cta.label}</Text>
          </LinearGradient>
        </TouchableOpacity>
        {(stage === "to_pickup" || stage === "to_drop") && (
          <Text style={st.ctaHint}>Tap after reaching the location</Text>
        )}
        {stage === "to_pickup" && (
          <TouchableOpacity onPress={handleCancelOrder} activeOpacity={0.7} style={st.cancelLink}>
            <Text style={st.cancelLinkTxt}>Cancel Order</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Cancel Order modal ─────────────────────────────────────────────── */}
      <Modal
        visible={cancelVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelVisible(false)}
        statusBarTranslucent
      >
        {/* Backdrop — tapping outside dismisses */}
        <Pressable
          style={st.csBackdrop}
          onPress={() => setCancelVisible(false)}
        >
          {/* Inner Pressable stops tap propagation so card taps don't close modal */}
          <Pressable style={st.csCard} onPress={() => {}}>

            {/* Header */}
            <Text style={st.csTitle}>Cancel Order</Text>
            <Text style={st.csSub}>Select a reason before pickup</Text>

            {/* Reason cards */}
            <View style={st.csCardList}>
              {([
                { emoji: "📦", label: "Oversized Parcel",             desc: "Parcel is too large for vehicle",  reason: "Oversized Parcel"            },
                { emoji: "🚗", label: "Vehicle Breakdown / Accident",  desc: "Vehicle issue or accident",        reason: "Vehicle Breakdown / Accident" },
                { emoji: "⚠️", label: "Route Not Reachable",           desc: "Road blocked or inaccessible",    reason: "Route Not Reachable"         },
              ] as const).map(({ emoji, label, desc, reason }) => {
                const selected = selectedReason === reason;
                return selected ? (
                  <LinearGradient
                    key={reason}
                    colors={["#FF7A3D", "#FF4D8D"]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={st.csReasonGradWrap}
                  >
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[st.csReason, st.csReasonSelected]}
                      onPress={() => setSelectedReason(reason)}
                    >
                      <Text style={st.csReasonEmoji}>{emoji}</Text>
                      <View style={st.csReasonText}>
                        <Text style={[st.csReasonLabel, { color: "#FF7A3D" }]}>{label}</Text>
                        <Text style={st.csReasonDesc}>{desc}</Text>
                      </View>
                      <Feather name="check-circle" size={20} color="#FF7A3D" />
                    </TouchableOpacity>
                  </LinearGradient>
                ) : (
                  <TouchableOpacity
                    key={reason}
                    activeOpacity={0.8}
                    style={st.csReason}
                    onPress={() => { haptic("light"); setSelectedReason(reason); }}
                  >
                    <Text style={st.csReasonEmoji}>{emoji}</Text>
                    <View style={st.csReasonText}>
                      <Text style={st.csReasonLabel}>{label}</Text>
                      <Text style={st.csReasonDesc}>{desc}</Text>
                    </View>
                    <View style={{ width: 20 }} />
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Action buttons */}
            <View style={st.csBtnRow}>
              <TouchableOpacity
                style={st.csKeepBtn}
                activeOpacity={0.8}
                onPress={() => setCancelVisible(false)}
              >
                <Text style={st.csKeepTxt}>Keep Order</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={selectedReason ? 0.85 : 1}
                disabled={!selectedReason}
                style={{ flex: 1, borderRadius: 14, overflow: "hidden" }}
                onPress={() => selectedReason && confirmCancel(selectedReason)}
              >
                <LinearGradient
                  colors={selectedReason ? ["#FF7A3D", "#EF4444"] : ["#CBD5E1", "#CBD5E1"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={st.csConfirmBtn}
                >
                  <Text style={[st.csConfirmTxt, !selectedReason && { color: "#94A3B8" }]}>
                    Confirm Cancel
                  </Text>
                </LinearGradient>
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
  root: { flex: 1, backgroundColor: "#F1F5F9" },

  topBar:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  topBarLeft:  { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  topBarTitle: { fontSize: 15, fontWeight: "800", color: "#fff", flex: 1 },
  topBarRight: { alignItems: "flex-end" },
  elapsed:     { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.75)", fontVariant: ["tabular-nums"] },

  pillRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  stagePill:    { flex: 1, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" },
  stagePillTxt: { fontSize: 11, fontWeight: "700", color: "#374151" },
  earningPill:  { backgroundColor: PINK + "15", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: PINK + "30" },
  earningPillTxt:{ fontSize: 13, fontWeight: "900", color: PINK },

  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  trackerCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  stepRow:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  stepItem: { flex: 1, alignItems: "center", position: "relative" },
  stepLine: { position: "absolute", top: 12, left: "-50%", right: "50%", height: 2, zIndex: 0 },
  stepCircle:{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center", zIndex: 1 },
  stepLbl:  { fontSize: 9, fontWeight: "700", marginTop: 5, textAlign: "center" },

  // Route card
  routeCard:    { borderRadius: 18, overflow: "hidden", padding: 14, gap: 10, borderWidth: 1, borderColor: "#1E293B" },
  routeChips:   { flexDirection: "row", gap: 6 },
  chip:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  chipTxt:      { fontSize: 10, fontWeight: "700" },
  routeViz:     { flexDirection: "row", alignItems: "stretch", gap: 12 },
  pinCol:       { alignItems: "center", gap: 4, paddingTop: 2 },
  pinDot:       { width: 14, height: 14, borderRadius: 7, shadowRadius: 8, shadowOpacity: 0.5, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  pinLine:      { width: 2, flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 1 },
  pinTag:       { fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  pinAddr:      { fontSize: 12, fontWeight: "700", color: "#fff", marginTop: 1 },
  pinCity:      { fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1 },
  dashes:       { flexDirection: "row", gap: 3, marginVertical: 5 },
  dash:         { flex: 1, height: 2, borderRadius: 1 },
  routeBottomTxt:{ fontSize: 11, fontWeight: "700" },

  // Action row (Call + Navigate — 50/50)
  actionRow: { flexDirection: "row", gap: 10 },

  callBtn:  { borderRadius: 14, overflow: "hidden", borderWidth: 1.5, borderColor: GREEN + "40", shadowColor: GREEN, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 },
  callGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 14 },
  callTxt:  { fontSize: 14, fontWeight: "800", color: GREEN },

  navBtn:  { borderRadius: 14, overflow: "hidden", shadowColor: BLUE, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  navGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 10 },
  navTxt:  { fontSize: 13, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },

  // Cards
  card: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#E2E8F0", padding: 16, gap: 13, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  cardGlowGreen:  { borderColor: GREEN + "40",  shadowColor: GREEN,    shadowOpacity: 0.1 },
  cardGlowPurple: { borderColor: "#8B5CF640",   shadowColor: "#8B5CF6", shadowOpacity: 0.1 },

  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:    { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 18, fontWeight: "800", color: PINK },
  custName:  { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  custPhone: { fontSize: 12, fontWeight: "600", color: "#475569", marginTop: 1, letterSpacing: 0.3 },
  custVerified: { fontSize: 10, color: "#10B981", fontWeight: "700", marginTop: 2 },
  parcelChip:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F8FAFC", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  parcelName:   { fontSize: 11, fontWeight: "700", color: "#374151" },
  parcelWeight: { fontSize: 9,  color: "#94A3B8",  fontWeight: "600" },

  divider: { height: 1, backgroundColor: "#F1F5F9" },

  addrBlock:    { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  addrDotGreen: { width: 14, height: 14, borderRadius: 7, backgroundColor: GREEN, marginTop: 2, shadowColor: GREEN, shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrDotRed:   { width: 14, height: 14, borderRadius: 7, backgroundColor: RED,   marginTop: 2, shadowColor: RED,   shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrTag:  { fontSize: 9,  fontWeight: "900", color: "#94A3B8", letterSpacing: 0.8 },
  addrMain: { fontSize: 14, fontWeight: "700", color: "#0F172A", marginTop: 2 },
  addrSub:  { fontSize: 11, fontWeight: "500", color: "#64748B", marginTop: 2 },

  // Pickup/deliver confirm
  confirmBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, padding: 13 },
  confirmIcon:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  confirmTitle:  { fontSize: 14, fontWeight: "800" },
  confirmSub:    { fontSize: 11, color: "#6B7280", marginTop: 2 },

  parcelDetailRow:  { flexDirection: "row", alignItems: "center", gap: 14 },
  parcelDetailName: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  parcelDetailMeta: { fontSize: 12, fontWeight: "600", color: "#64748B", marginTop: 3 },
  verifyBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: GREEN + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifyTxt:   { fontSize: 10, fontWeight: "700", color: GREEN },

  // OTP
  otpWrap:      { gap: 7 },
  otpHeader:    { flexDirection: "row", alignItems: "center", gap: 6 },
  otpTitle:     { fontSize: 13, fontWeight: "700", color: "#374151", flex: 1 },
  otpBadge:     { backgroundColor: "#EDE9FE", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  otpBadgeTxt:  { fontSize: 9, fontWeight: "700", color: "#7C3AED" },
  otpSub:       { fontSize: 11, color: "#94A3B8" },
  otpInputRow:  { flexDirection: "row", gap: 10, position: "relative" },
  otpBox:       { width: 52, height: 56, borderRadius: 12, borderWidth: 2, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" },
  otpBoxFilled: { borderColor: GREEN, backgroundColor: GREEN + "10" },
  otpDigit:     { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  otpHidden:    { position: "absolute", opacity: 0, width: "100%", height: "100%" },

  // Celebration
  celebCard:    { backgroundColor: "#fff", borderRadius: 20, padding: 28, alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#D1FAE5" },
  celebTitle:   { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  celebSub:     { fontSize: 14, color: "#6B7280", textAlign: "center" },
  celebEarning: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 50 },
  celebAmt:     { fontSize: 30, fontWeight: "900", color: "#fff" },
  celebStats:   { flexDirection: "row", alignItems: "center", marginTop: 8 },
  celebStat:    { alignItems: "center", gap: 4, paddingHorizontal: 16 },
  celebStatVal: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  celebStatLbl: { fontSize: 10, fontWeight: "600", color: "#94A3B8" },
  celebSep:     { width: 1, height: 32, backgroundColor: "#E2E8F0" },

  // Non-focused cancellation banner
  cancelBanner: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1E293B", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, zIndex: 200, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 8 },
  cancelBannerText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "600" },

  // CTA
  ctaWrap: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E2E8F0", shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: -4 }, elevation: 10, gap: 6 },
  ctaBtn:  { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18 },
  ctaTxt:  { fontSize: 17, fontWeight: "900", color: "#fff" },
  ctaHint:       { textAlign: "center", fontSize: 11, color: "#94A3B8", fontWeight: "500" },
  cancelLink:    { alignItems: "center", paddingVertical: 2 },
  cancelLinkTxt: { fontSize: 12, fontWeight: "600", color: "#EF4444", textDecorationLine: "underline" },

  // Cancel modal
  csBackdrop:         { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "center", alignItems: "center" },
  csCard:             { width: "88%", backgroundColor: "#fff", borderRadius: 24, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 20 },
  csTitle:            { fontSize: 20, fontWeight: "900", color: "#0F172A", textAlign: "center" },
  csSub:              { fontSize: 13, color: "#64748B", textAlign: "center", marginTop: 4, marginBottom: 16 },
  csCardList:         { gap: 10 },
  csReasonGradWrap:   { borderRadius: 18, padding: 2 },
  csReason:           { flexDirection: "row", alignItems: "center", minHeight: 68, gap: 14, backgroundColor: "#F8FAFC", borderRadius: 16, borderWidth: 1.5, borderColor: "#E2E8F0", paddingHorizontal: 14, paddingVertical: 12 },
  csReasonSelected:   { backgroundColor: "#FFF8F5", borderWidth: 0, borderRadius: 14 },
  csReasonEmoji:      { fontSize: 24, width: 34, textAlign: "center" },
  csReasonText:       { flex: 1, gap: 2 },
  csReasonLabel:      { fontSize: 14, fontWeight: "800", color: "#0F172A" },
  csReasonDesc:       { fontSize: 12, color: "#64748B" },
  csBtnRow:           { flexDirection: "row", gap: 10, marginTop: 20 },
  csKeepBtn:          { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: "#CBD5E1", justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  csKeepTxt:          { fontSize: 14, fontWeight: "700", color: "#475569" },
  csConfirmBtn:       { height: 50, justifyContent: "center", alignItems: "center", borderRadius: 14 },
  csConfirmTxt:       { fontSize: 14, fontWeight: "800", color: "#fff" },
});
