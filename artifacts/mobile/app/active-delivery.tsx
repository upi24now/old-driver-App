/**
 * active-delivery.tsx — Real logistics delivery flow
 *
 * 5-stage driver workflow:
 *   to_pickup  → Navigate to Pickup (Google Maps deep link) + "Arrived" advances
 *   at_pickup  → "Parcel Picked Up" advances to drop leg
 *   to_drop    → Navigate to Drop   (Google Maps deep link) + "Arrived" advances
 *   at_drop    → "Deliver Parcel" + OTP field (future-ready)
 *   delivered  → Celebration + earnings credited
 *
 * Google Maps: Linking.openURL("https://www.google.com/maps/dir/?api=1&destination=…")
 * No API key needed — uses deep link/web redirect.
 */

import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
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
const BLUE   = "#4285F4";   // Google Maps blue
const NAVY   = "#0F172A";
const RED    = "#EF4444";

// ─── Delivery stages ─────────────────────────────────────────────────────────
type Stage = "to_pickup" | "at_pickup" | "to_drop" | "at_drop" | "delivered";

const STAGE_ORDER: Stage[] = ["to_pickup", "at_pickup", "to_drop", "at_drop", "delivered"];

function nextStage(s: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(s);
  return i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

// ─── Step tracker steps (3 milestones visible) ────────────────────────────────
const STEPS = [
  { id: "to_pickup" as Stage, label: "To Pickup",  icon: "navigation" },
  { id: "at_pickup" as Stage, label: "Picked Up",  icon: "package"    },
  { id: "to_drop"   as Stage, label: "To Drop",    icon: "map-pin"    },
  { id: "delivered" as Stage, label: "Delivered",   icon: "check"      },
];

function stageToStep(s: Stage): number {
  const map: Record<Stage, number> = {
    to_pickup: 0, at_pickup: 1, to_drop: 2, at_drop: 3, delivered: 3,
  };
  return map[s];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function haptic(type: "success" | "light" | "warning" = "success") {
  if (Platform.OS === "web") return;
  if (type === "success")
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else if (type === "light")
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

function openGoogleMaps(address: string, city: string) {
  const dest = encodeURIComponent(`${address}, ${city}, India`);
  const url  = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=two-wheeler`;
  Linking.canOpenURL(url).then((ok) => {
    if (ok) Linking.openURL(url);
    else Alert.alert("Maps unavailable", "Please install Google Maps to navigate.");
  });
}

// ─── Pulsing live dot ─────────────────────────────────────────────────────────
function LiveDot({ color = GREEN, size = 10 }: { color?: string; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.8, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const half = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{
        position: "absolute", width: size, height: size, borderRadius: half,
        backgroundColor: color + "44", transform: [{ scale: pulse }],
      }} />
      <View style={{ width: half + 1, height: half + 1, borderRadius: (half + 1) / 2, backgroundColor: color }} />
    </View>
  );
}

// ─── Elapsed timer ────────────────────────────────────────────────────────────
function ElapsedTimer({ color = "rgba(255,255,255,0.75)" }: { color?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(n / 60).toString().padStart(2, "0");
  const s = (n % 60).toString().padStart(2, "0");
  return <Text style={[st.elapsed, { color }]}>{m}:{s}</Text>;
}

// ─── Step progress tracker ────────────────────────────────────────────────────
function StepTracker({ stage }: { stage: Stage }) {
  const active = stageToStep(stage);
  return (
    <View style={st.stepRow}>
      {STEPS.map((step, i) => {
        const done  = i < active;
        const cur   = i === active;
        const col   = done || cur ? GREEN : "#CBD5E1";
        return (
          <View key={step.id} style={st.stepItem}>
            {/* Connector line (left side) */}
            {i > 0 && (
              <View style={[st.stepLine, { backgroundColor: i <= active ? GREEN : "#E2E8F0" }]} />
            )}
            {/* Circle */}
            <View style={[st.stepCircle, { borderColor: col, backgroundColor: done ? GREEN : cur ? "#E8FFF0" : "#F8FAFC" }]}>
              {done
                ? <Feather name="check" size={9} color="#fff" />
                : <Feather name={step.icon as any} size={9} color={cur ? GREEN : "#CBD5E1"} />
              }
            </View>
            <Text style={[st.stepLbl, { color: cur ? GREEN : done ? "#374151" : "#94A3B8" }]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Route visual card (mini map mockup) ─────────────────────────────────────
function RouteCard({
  pickup, pickupCity, drop, dropCity,
  distanceKm, durationMin, leg,
}: {
  pickup: string; pickupCity: string;
  drop: string;   dropCity: string;
  distanceKm: string; durationMin: string;
  leg: "pickup" | "drop";
}) {
  const pulse = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.9,  duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const activeColor = leg === "pickup" ? GREEN : ORANGE;
  const inactiveColor = "#94A3B8";

  return (
    <View style={st.routeCard}>
      <LinearGradient colors={[NAVY, "#1E293B"]} style={st.routeCardBg} />

      {/* Top chips */}
      <View style={st.routeChips}>
        <View style={[st.chip, { backgroundColor: activeColor + "22", borderColor: activeColor + "55" }]}>
          <Feather name="navigation" size={10} color={activeColor} />
          <Text style={[st.chipText, { color: activeColor }]}>{distanceKm} km</Text>
        </View>
        <View style={[st.chip, { backgroundColor: "#FFFFFF14", borderColor: "#FFFFFF22" }]}>
          <Feather name="clock" size={10} color="#94A3B8" />
          <Text style={[st.chipText, { color: "#CBD5E1" }]}>{durationMin} min ETA</Text>
        </View>
        <View style={[st.chip, { backgroundColor: "#FFFFFF14", borderColor: "#FFFFFF22" }]}>
          <Text style={st.chipText}>📍 Live tracking</Text>
        </View>
      </View>

      {/* Route visualizer */}
      <View style={st.routeViz}>
        {/* Pickup pin */}
        <View style={st.pinCol}>
          <Animated.View style={[
            st.pinDot,
            { backgroundColor: GREEN, transform: [{ scale: leg === "pickup" ? pulse : new Animated.Value(1) }] },
          ]} />
          <View style={st.pinLine} />
        </View>
        <View style={st.pinLabels}>
          <View style={st.pinLabelRow}>
            <Text style={[st.pinTag, { color: GREEN }]}>PICKUP</Text>
            <Text style={st.pinAddr} numberOfLines={1}>{pickup}</Text>
            <Text style={st.pinCity}>{pickupCity}</Text>
          </View>

          {/* Dashes */}
          <View style={st.dashes}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[st.dash, { backgroundColor: leg === "pickup" ? GREEN + "55" : ORANGE + "55" }]} />
            ))}
          </View>

          <View style={st.pinLabelRow}>
            <Text style={[st.pinTag, { color: RED }]}>DROP</Text>
            <Text style={st.pinAddr} numberOfLines={1}>{drop}</Text>
            <Text style={st.pinCity}>{dropCity}</Text>
          </View>
        </View>
        {/* Drop pin */}
        <View style={st.pinCol}>
          <View style={[st.pinLine, { opacity: 0 }]} />
          <Animated.View style={[
            st.pinDot,
            { backgroundColor: RED, transform: [{ scale: leg === "drop" ? pulse : new Animated.Value(1) }] },
          ]} />
        </View>
      </View>

      {/* Bottom label */}
      <View style={st.routeCardBottom}>
        <LiveDot color={activeColor} size={7} />
        <Text style={[st.routeCardBottomText, { color: activeColor }]}>
          {leg === "pickup" ? "Navigate to pickup now" : "Navigate to drop now"}
        </Text>
      </View>
    </View>
  );
}

// ─── Google Maps navigate button ──────────────────────────────────────────────
function NavigateButton({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.02, duration: 900, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={st.navBtn}>
        <LinearGradient
          colors={[BLUE, "#5B9BFF", BLUE]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={st.navBtnGrad}
        >
          {/* Maps "M" style icon */}
          <View style={st.mapsIconWrap}>
            <View style={[st.mapsIconDot, { backgroundColor: "#EA4335" }]} />
            <Feather name="map-pin" size={13} color="#fff" style={{ marginLeft: -2 }} />
          </View>
          <Text style={st.navBtnText}>{label}</Text>
          <Feather name="external-link" size={14} color="rgba(255,255,255,0.75)" />
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── OTP input row ────────────────────────────────────────────────────────────
function OtpRow({ otp, onChange }: { otp: string; onChange: (v: string) => void }) {
  return (
    <View style={st.otpWrap}>
      <View style={st.otpHeader}>
        <Feather name="shield" size={14} color={GREEN} />
        <Text style={st.otpTitle}>Delivery OTP (optional)</Text>
        <View style={st.otpBadge}><Text style={st.otpBadgeText}>Future-ready</Text></View>
      </View>
      <Text style={st.otpSub}>Ask customer for 4-digit OTP to confirm delivery</Text>
      <View style={st.otpInputRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[st.otpBox, otp[i] ? st.otpBoxFilled : {}]}>
            <Text style={st.otpDigit}>{otp[i] ?? ""}</Text>
          </View>
        ))}
        <TextInput
          style={st.otpHidden}
          value={otp}
          onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, 4))}
          keyboardType="numeric"
          maxLength={4}
          caretHidden
        />
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function ActiveDeliveryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    customer: string; parcelType: string; parcelEmoji: string;
    pickup: string; pickupCity: string; drop: string; dropCity: string;
    distanceKm: string; durationMin: string; earning: string; weight: string;
    surge: string; surgeMultiplier: string;
  }>();

  const [stage, setStage] = useState<Stage>("to_pickup");
  const [otp,   setOtp]   = useState("");

  // Slide-up on stage change
  const cardY = useRef(new Animated.Value(60)).current;
  const cardOpac = useRef(new Animated.Value(0)).current;

  function animateIn() {
    cardY.setValue(60); cardOpac.setValue(0);
    Animated.parallel([
      Animated.spring(cardY, { toValue: 0, friction: 7, tension: 130, useNativeDriver: true }),
      Animated.timing(cardOpac, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }

  useEffect(() => { animateIn(); }, [stage]);

  // Derived
  const customer   = params.customer    ?? "Customer";
  const parcel     = params.parcelType  ?? "Parcel";
  const emoji      = params.parcelEmoji ?? "📦";
  const pickup     = params.pickup      ?? "Pickup location";
  const pickupCity = params.pickupCity  ?? "";
  const drop       = params.drop        ?? "Drop location";
  const dropCity   = params.dropCity    ?? "";
  const distKm     = params.distanceKm  ?? "—";
  const durMin     = params.durationMin ?? "—";
  const weight     = params.weight      ?? "—";
  const earning    = params.earning     ? `₹${params.earning}` : "₹—";
  const isDelivered = stage === "delivered";

  // Stage-level labels
  const stageMeta: Record<Stage, { topLabel: string; topColor: [string, string]; stagePill: string }> = {
    to_pickup: { topLabel: "Navigating to Pickup",   topColor: [NAVY, "#1E293B"],         stagePill: "🛵 En Route to Pickup" },
    at_pickup: { topLabel: "At Pickup Location",     topColor: ["#065F46", "#047857"],     stagePill: "📦 Collect Parcel"      },
    to_drop:   { topLabel: "Navigating to Drop",     topColor: ["#7C2D12", "#92400E"],     stagePill: "🚀 En Route to Drop"   },
    at_drop:   { topLabel: "At Drop Location",       topColor: ["#1E1B4B", "#312E81"],     stagePill: "🏁 Complete Delivery"   },
    delivered: { topLabel: "Order Delivered! 🎉",    topColor: ["#00C853", "#00E676"],     stagePill: "✅ Earnings Credited"   },
  };
  const meta = stageMeta[stage];

  function advance() {
    haptic("success");
    const next = nextStage(stage);
    if (!next) { router.replace("/(tabs)"); return; }
    setStage(next);
  }

  function handleCall() {
    Alert.alert("Calling customer", `Connecting to ${customer}…`,
      [{ text: "End call", style: "destructive" }, { text: "OK" }]);
  }
  function handleChat() {
    Alert.alert("Chat", "In-app chat coming soon.", [{ text: "OK" }]);
  }
  function navigatePickup() {
    haptic("light");
    openGoogleMaps(pickup, pickupCity);
  }
  function navigateDrop() {
    haptic("light");
    openGoogleMaps(drop, dropCity);
  }

  // ── CTA config per stage ──────────────────────────────────────────────────
  type CtaConfig = { label: string; icon: string; color: [string, string]; secondary?: string; onSecondary?: () => void };
  const ctaConfig: Record<Stage, CtaConfig> = {
    to_pickup: {
      label: "I've Arrived at Pickup",
      icon: "map-pin",
      color: [GREEN, "#00E676"],
      secondary: "Skip navigation",
    },
    at_pickup: {
      label: "Parcel Picked Up  ✓",
      icon: "package",
      color: [GREEN, "#00E676"],
    },
    to_drop: {
      label: "I've Arrived at Drop",
      icon: "map-pin",
      color: [ORANGE, "#FF9F45"],
    },
    at_drop: {
      label: "Deliver Parcel  ✓",
      icon: "check-circle",
      color: ["#8B5CF6", "#7C3AED"],
    },
    delivered: {
      label: "Back to Home",
      icon: "home",
      color: [GREEN, "#00E676"],
    },
  };
  const cta = ctaConfig[stage];

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>

      {/* ── Top status bar ── */}
      <LinearGradient colors={meta.topColor} style={st.topBar}>
        <View style={st.topBarLeft}>
          {!isDelivered && <LiveDot color="#fff" size={10} />}
          <Text style={st.topBarTitle} numberOfLines={1}>{meta.topLabel}</Text>
        </View>
        <View style={st.topBarRight}>
          {!isDelivered && <ElapsedTimer />}
          {isDelivered && <Text style={{ fontSize: 22 }}>🎉</Text>}
        </View>
      </LinearGradient>

      {/* Stage pill */}
      <View style={st.pillRow}>
        <View style={st.stagePill}>
          <Text style={st.stagePillText}>{meta.stagePill}</Text>
        </View>
        <View style={st.earningPill}>
          <Text style={st.earningPillText}>{earning}</Text>
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

          {/* ── STAGE: to_pickup ── Navigate to Pickup */}
          {stage === "to_pickup" && (
            <>
              <RouteCard
                pickup={pickup} pickupCity={pickupCity}
                drop={drop} dropCity={dropCity}
                distanceKm={distKm} durationMin={durMin}
                leg="pickup"
              />
              <NavigateButton label="Navigate to Pickup" onPress={navigatePickup} />
              <CustomerCard customer={customer} pickup={pickup} pickupCity={pickupCity} emoji={emoji} parcel={parcel} weight={weight} onCall={handleCall} onChat={handleChat} />
            </>
          )}

          {/* ── STAGE: at_pickup ── Collect parcel */}
          {stage === "at_pickup" && (
            <>
              <PickupConfirmCard pickup={pickup} pickupCity={pickupCity} customer={customer} emoji={emoji} parcel={parcel} weight={weight} onCall={handleCall} onChat={handleChat} />
            </>
          )}

          {/* ── STAGE: to_drop ── Navigate to Drop */}
          {stage === "to_drop" && (
            <>
              <RouteCard
                pickup={pickup} pickupCity={pickupCity}
                drop={drop} dropCity={dropCity}
                distanceKm={distKm} durationMin={durMin}
                leg="drop"
              />
              <NavigateButton label="Navigate to Drop" onPress={navigateDrop} />
              <DropInfoCard drop={drop} dropCity={dropCity} customer={customer} onCall={handleCall} onChat={handleChat} />
            </>
          )}

          {/* ── STAGE: at_drop ── Deliver parcel */}
          {stage === "at_drop" && (
            <>
              <DeliverCard
                drop={drop} dropCity={dropCity} customer={customer}
                earning={earning} emoji={emoji} parcel={parcel}
                otp={otp} onOtpChange={setOtp}
                onCall={handleCall} onChat={handleChat}
              />
            </>
          )}

          {/* ── STAGE: delivered ── Celebration */}
          {stage === "delivered" && (
            <CelebrationCard earning={earning} customer={customer} distKm={distKm} />
          )}

        </Animated.View>
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <View style={[st.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity onPress={advance} activeOpacity={0.87} style={{ borderRadius: 18, overflow: "hidden" }}>
          <LinearGradient
            colors={cta.color}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={st.ctaBtn}
          >
            <Feather name={cta.icon as any} size={20} color="#fff" />
            <Text style={st.ctaText}>{cta.label}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* For navigation stages: show "arrived" hint */}
        {(stage === "to_pickup" || stage === "to_drop") && (
          <Text style={st.ctaHint}>
            Tap after reaching the location
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Sub-cards ────────────────────────────────────────────────────────────────

function CustomerCard({ customer, pickup, pickupCity, emoji, parcel, weight, onCall, onChat }: {
  customer: string; pickup: string; pickupCity: string;
  emoji: string; parcel: string; weight: string;
  onCall: () => void; onChat: () => void;
}) {
  return (
    <View style={st.card}>
      <View style={st.cardHeaderRow}>
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custSub}>✓ Verified customer</Text>
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

      {/* Pickup address */}
      <View style={st.addrBlock}>
        <View style={st.addrDotGreen} />
        <View style={{ flex: 1 }}>
          <Text style={st.addrTag}>PICKUP ADDRESS</Text>
          <Text style={st.addrMain}>{pickup}</Text>
          <Text style={st.addrSub}>{pickupCity}</Text>
        </View>
      </View>

      <View style={st.divider} />

      <View style={st.contactRow}>
        <TouchableOpacity style={st.contactBtn} onPress={onCall} activeOpacity={0.8}>
          <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={st.contactGrad}>
            <Feather name="phone" size={17} color={GREEN} />
            <Text style={[st.contactTxt, { color: GREEN }]}>Call</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={st.contactBtn} onPress={onChat} activeOpacity={0.8}>
          <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={st.contactGrad}>
            <Feather name="message-circle" size={17} color={BLUE} />
            <Text style={[st.contactTxt, { color: BLUE }]}>Chat</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PickupConfirmCard({ pickup, pickupCity, customer, emoji, parcel, weight, onCall, onChat }: {
  pickup: string; pickupCity: string; customer: string;
  emoji: string; parcel: string; weight: string;
  onCall: () => void; onChat: () => void;
}) {
  return (
    <View style={[st.card, st.cardGlowGreen]}>
      {/* Header banner */}
      <LinearGradient colors={[GREEN + "22", GREEN + "08"]} style={st.confirmBanner}>
        <View style={[st.confirmIcon, { backgroundColor: GREEN + "25" }]}>
          <Feather name="package" size={22} color={GREEN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.confirmTitle, { color: "#065F46" }]}>Collect Parcel from Customer</Text>
          <Text style={st.confirmSub}>Verify parcel before confirming pickup</Text>
        </View>
      </LinearGradient>

      {/* Parcel details */}
      <View style={st.parcelDetailRow}>
        <Text style={{ fontSize: 32 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.parcelDetailName}>{parcel}</Text>
          <Text style={st.parcelDetailWeight}>Weight: {weight}</Text>
        </View>
        <View style={st.verifyBadge}>
          <Feather name="check-circle" size={12} color={GREEN} />
          <Text style={st.verifyText}>Ready</Text>
        </View>
      </View>

      <View style={st.divider} />

      {/* Address */}
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
          <Text style={st.custSub}>✓ Verified customer</Text>
        </View>
      </View>

      <View style={st.divider} />
      <View style={st.contactRow}>
        <TouchableOpacity style={st.contactBtn} onPress={onCall} activeOpacity={0.8}>
          <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={st.contactGrad}>
            <Feather name="phone" size={17} color={GREEN} />
            <Text style={[st.contactTxt, { color: GREEN }]}>Call</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={st.contactBtn} onPress={onChat} activeOpacity={0.8}>
          <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={st.contactGrad}>
            <Feather name="message-circle" size={17} color={BLUE} />
            <Text style={[st.contactTxt, { color: BLUE }]}>Chat</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DropInfoCard({ drop, dropCity, customer, onCall, onChat }: {
  drop: string; dropCity: string; customer: string;
  onCall: () => void; onChat: () => void;
}) {
  return (
    <View style={st.card}>
      <View style={st.cardHeaderRow}>
        <LinearGradient colors={[PINK + "30", PINK + "15"]} style={st.avatar}>
          <Text style={st.avatarTxt}>{customer.charAt(0)}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={st.custName}>{customer}</Text>
          <Text style={st.custSub}>✓ Verified customer</Text>
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

      <View style={st.contactRow}>
        <TouchableOpacity style={st.contactBtn} onPress={onCall} activeOpacity={0.8}>
          <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={st.contactGrad}>
            <Feather name="phone" size={17} color={GREEN} />
            <Text style={[st.contactTxt, { color: GREEN }]}>Call</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={st.contactBtn} onPress={onChat} activeOpacity={0.8}>
          <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={st.contactGrad}>
            <Feather name="message-circle" size={17} color={BLUE} />
            <Text style={[st.contactTxt, { color: BLUE }]}>Chat</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DeliverCard({ drop, dropCity, customer, earning, emoji, parcel, otp, onOtpChange, onCall, onChat }: {
  drop: string; dropCity: string; customer: string; earning: string;
  emoji: string; parcel: string; otp: string;
  onOtpChange: (v: string) => void;
  onCall: () => void; onChat: () => void;
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

      {/* Parcel info */}
      <View style={st.parcelDetailRow}>
        <Text style={{ fontSize: 32 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.parcelDetailName}>{parcel}</Text>
          <Text style={st.parcelDetailWeight}>Earning: {earning}</Text>
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

      <OtpRow otp={otp} onChange={onOtpChange} />

      <View style={st.divider} />

      <View style={st.contactRow}>
        <TouchableOpacity style={st.contactBtn} onPress={onCall} activeOpacity={0.8}>
          <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={st.contactGrad}>
            <Feather name="phone" size={17} color={GREEN} />
            <Text style={[st.contactTxt, { color: GREEN }]}>Call</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={st.contactBtn} onPress={onChat} activeOpacity={0.8}>
          <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={st.contactGrad}>
            <Feather name="message-circle" size={17} color={BLUE} />
            <Text style={[st.contactTxt, { color: BLUE }]}>Chat</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CelebrationCard({ earning, customer, distKm }: { earning: string; customer: string; distKm: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={st.celebCard}>
      <Animated.Text style={[{ fontSize: 60 }, { transform: [{ rotate }] }]}>🎉</Animated.Text>
      <Text style={st.celebTitle}>Delivery Complete!</Text>
      <Text style={st.celebSub}>You delivered to {customer} and earned</Text>
      <LinearGradient colors={[PINK, ORANGE]} style={st.celebEarning} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Text style={st.celebEarningAmt}>{earning}</Text>
      </LinearGradient>
      <View style={st.celebStats}>
        <View style={st.celebStat}>
          <Feather name="navigation" size={14} color={GREEN} />
          <Text style={st.celebStatVal}>{distKm} km</Text>
          <Text style={st.celebStatLbl}>Travelled</Text>
        </View>
        <View style={st.celebStatSep} />
        <View style={st.celebStat}>
          <Feather name="star" size={14} color={ORANGE} />
          <Text style={st.celebStatVal}>5.0</Text>
          <Text style={st.celebStatLbl}>Rating</Text>
        </View>
        <View style={st.celebStatSep} />
        <View style={st.celebStat}>
          <Feather name="check-circle" size={14} color={GREEN} />
          <Text style={st.celebStatVal}>1</Text>
          <Text style={st.celebStatLbl}>Delivery</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F1F5F9" },

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
  },
  topBarLeft:  { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  topBarTitle: { fontSize: 15, fontWeight: "800", color: "#fff", flex: 1 },
  topBarRight: { alignItems: "flex-end" },
  elapsed:     { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },

  // Stage pill row
  pillRow:     { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  stagePill:   { flex: 1, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  stagePillText: { fontSize: 11, fontWeight: "700", color: "#374151" },
  earningPill: { backgroundColor: PINK + "15", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: PINK + "30" },
  earningPillText: { fontSize: 13, fontWeight: "900", color: PINK },

  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  // Step tracker
  trackerCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  stepRow:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  stepItem:    { flex: 1, alignItems: "center", position: "relative" },
  stepLine:    { position: "absolute", top: 12, left: "-50%", right: "50%", height: 2, zIndex: 0 },
  stepCircle:  { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center", zIndex: 1 },
  stepLbl:     { fontSize: 9, fontWeight: "700", marginTop: 5, textAlign: "center" },

  // Route card
  routeCard:   { borderRadius: 18, overflow: "hidden", padding: 16, gap: 12, minHeight: 160, borderWidth: 1, borderColor: "#1E293B" },
  routeCardBg: { ...StyleSheet.absoluteFillObject, borderRadius: 18 },
  routeChips:  { flexDirection: "row", gap: 6 },
  chip:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  chipText:    { fontSize: 10, fontWeight: "700" },

  routeViz:    { flexDirection: "row", alignItems: "stretch", gap: 12 },
  pinCol:      { alignItems: "center", gap: 4, paddingTop: 2 },
  pinDot:      { width: 14, height: 14, borderRadius: 7, shadowRadius: 8, shadowOpacity: 0.5, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  pinLine:     { width: 2, flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 1 },
  pinLabels:   { flex: 1, gap: 4 },
  pinLabelRow: {},
  pinTag:      { fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  pinAddr:     { fontSize: 12, fontWeight: "700", color: "#fff", marginTop: 1 },
  pinCity:     { fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1 },
  dashes:      { flexDirection: "row", gap: 4, marginVertical: 6 },
  dash:        { flex: 1, height: 2, borderRadius: 1 },

  routeCardBottom: { flexDirection: "row", alignItems: "center", gap: 5 },
  routeCardBottomText: { fontSize: 11, fontWeight: "700" },

  // Navigate button
  navBtn:      { borderRadius: 16, overflow: "hidden", shadowColor: BLUE, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  navBtnGrad:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 17, borderRadius: 16 },
  navBtnText:  { fontSize: 16, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },
  mapsIconWrap: { flexDirection: "row", alignItems: "center", gap: 2, width: 28 },
  mapsIconDot: { width: 8, height: 8, borderRadius: 4 },

  // Info card
  card: {
    backgroundColor: "#fff", borderRadius: 18,
    borderWidth: 1, borderColor: "#E2E8F0",
    padding: 16, gap: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  cardGlowGreen:  { borderColor: GREEN + "40",  shadowColor: GREEN,  shadowOpacity: 0.12 },
  cardGlowPurple: { borderColor: "#8B5CF640", shadowColor: "#8B5CF6", shadowOpacity: 0.12 },

  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarTxt:   { fontSize: 18, fontWeight: "800", color: PINK },
  custName:    { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  custSub:     { fontSize: 11, color: "#10B981", fontWeight: "600", marginTop: 1 },
  parcelChip:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F8FAFC", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  parcelName:  { fontSize: 11, fontWeight: "700", color: "#374151" },
  parcelWeight:{ fontSize: 9,  color: "#94A3B8", fontWeight: "600" },

  divider: { height: 1, backgroundColor: "#F1F5F9" },

  addrBlock:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  addrDotGreen:{ width: 14, height: 14, borderRadius: 7, backgroundColor: GREEN, marginTop: 2, shadowColor: GREEN, shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrDotRed:  { width: 14, height: 14, borderRadius: 7, backgroundColor: RED,   marginTop: 2, shadowColor: RED,   shadowOpacity: 0.5, shadowRadius: 6, elevation: 3 },
  addrTag:     { fontSize: 9, fontWeight: "900", color: "#94A3B8", letterSpacing: 0.8 },
  addrMain:    { fontSize: 14, fontWeight: "700", color: "#0F172A", marginTop: 2 },
  addrSub:     { fontSize: 11, color: "#64748B", fontWeight: "500", marginTop: 2 },

  contactRow:  { flexDirection: "row", gap: 10 },
  contactBtn:  { flex: 1, borderRadius: 12, overflow: "hidden" },
  contactGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13 },
  contactTxt:  { fontSize: 14, fontWeight: "700" },

  // Pickup confirm
  confirmBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, padding: 14 },
  confirmIcon:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  confirmTitle:  { fontSize: 14, fontWeight: "800" },
  confirmSub:    { fontSize: 11, color: "#6B7280", marginTop: 2 },

  parcelDetailRow:   { flexDirection: "row", alignItems: "center", gap: 14 },
  parcelDetailName:  { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  parcelDetailWeight:{ fontSize: 12, color: "#64748B", fontWeight: "600", marginTop: 3 },
  verifyBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: GREEN + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifyText:  { fontSize: 10, fontWeight: "700", color: GREEN },

  // OTP
  otpWrap:     { gap: 8 },
  otpHeader:   { flexDirection: "row", alignItems: "center", gap: 6 },
  otpTitle:    { fontSize: 13, fontWeight: "700", color: "#374151", flex: 1 },
  otpBadge:    { backgroundColor: "#EDE9FE", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  otpBadgeText:{ fontSize: 9, fontWeight: "700", color: "#7C3AED" },
  otpSub:      { fontSize: 11, color: "#94A3B8" },
  otpInputRow: { flexDirection: "row", gap: 10, position: "relative" },
  otpBox:      { width: 52, height: 56, borderRadius: 12, borderWidth: 2, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" },
  otpBoxFilled:{ borderColor: GREEN, backgroundColor: GREEN + "10" },
  otpDigit:    { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  otpHidden:   { position: "absolute", opacity: 0, width: "100%", height: "100%" },

  // Celebration
  celebCard:   { backgroundColor: "#fff", borderRadius: 20, padding: 28, alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#D1FAE5" },
  celebTitle:  { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  celebSub:    { fontSize: 14, color: "#6B7280", textAlign: "center" },
  celebEarning:{ paddingHorizontal: 32, paddingVertical: 12, borderRadius: 50 },
  celebEarningAmt: { fontSize: 30, fontWeight: "900", color: "#fff" },
  celebStats:  { flexDirection: "row", alignItems: "center", gap: 0, marginTop: 8 },
  celebStat:   { flex: 1, alignItems: "center", gap: 4 },
  celebStatVal:{ fontSize: 16, fontWeight: "800", color: "#0F172A" },
  celebStatLbl:{ fontSize: 10, fontWeight: "600", color: "#94A3B8" },
  celebStatSep:{ width: 1, height: 32, backgroundColor: "#E2E8F0", marginHorizontal: 8 },

  // CTA
  ctaWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14,
    backgroundColor: "#fff",
    borderTopWidth: 1, borderTopColor: "#E2E8F0",
    shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 }, elevation: 10,
    gap: 6,
  },
  ctaBtn:  { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18 },
  ctaText: { fontSize: 17, fontWeight: "900", color: "#fff" },
  ctaHint: { textAlign: "center", fontSize: 11, color: "#94A3B8", fontWeight: "500" },
});
