/**
 * login.tsx — Screen 2: Mobile Number + OTP (combined, no navigation between them)
 *
 * Phase 1 — phone entry:  user types 10-digit number → "Send OTP"
 * Phase 2 — OTP entry:    6-digit cells appear inline → "Verify" → navigate
 *
 * After successful OTP verification the screen calls router.replace(nextRoute).
 * No push to /otp happens; /otp.tsx is a dead redirect stub.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import Svg, {
  Ellipse,
  Line,
  Path,
  Rect,
  Circle,
  G,
  Defs,
  ClipPath,
  Stop,
  RadialGradient,
  LinearGradient as SvgLinearGradient,
} from "react-native-svg";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
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
import { LinearGradient } from "expo-linear-gradient";

import { useDriver } from "@/contexts/DriverContext";
import { sendOtp } from "@/utils/auth-api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:            "#FFFFFF",
  primary:       "#FF6A00",
  primaryDark:   "#F25600",
  primarySoft:   "#FFF3EC",
  text:          "#172033",
  textSecondary: "#6B7280",
  textMuted:     "#9CA3AF",
  border:        "#E8E8E8",
  inputBorder:   "#E5E7EB",
  cardLabel:     "#374151",
  forgot:        "#DC2626",
  inputBg:       "#FBFBFB",
  white:         "#FFFFFF",
  success:       "#16A34A",
  error:         "#DC2626",
  placeholder:   "#9CA3AF",
  // Aliases used by OTP phase
  navy:          "#172033",
  amber:         "#FF6A00",
  cardBorder:    "#E8E8E8",
} as const;

const OTP_LENGTH     = 6;
const PIN_LENGTH     = 6;
const RESEND_SECONDS = 30;

// ─── Responsive layout config ─────────────────────────────────────────────────
const WIN_H  = Dimensions.get("window").height;
const small  = WIN_H < 700;
const medium = WIN_H >= 700 && WIN_H < 850;

const clamp = (v: number, lo: number, hi: number) =>
  Math.round(Math.max(lo, Math.min(hi, v)));

// Hero scales proportionally to viewport height (clamped) so it keeps the same
// optical balance across 360×800 → 412×915 instead of jumping between tiers.
const HERO_H     = clamp(WIN_H * 0.205, 138, 186);
const SCOOTER_H  = clamp(HERO_H * 0.82, 108, 152);
const SCOOTER_MT = clamp(HERO_H * 0.07, 8, 14);

const r = {
  topPad:       clamp(WIN_H * 0.022, 10, 20),
  botPad:       clamp(WIN_H * 0.020, 10, 18),
  logoSize:     small ? 48  : medium ? 54  : 64,
  logoBorderR:  small ? 24  : medium ? 27  : 32,
  logoFontSize: small ? 16  : medium ? 18  : 22,
  logoMb:       small ? 8   : medium ? 10  : 12,
  brandSize:    small ? 16  : medium ? 17  : 20,
  partnerMb:    small ? 6   : medium ? 12  : 16,
  headlineSize: small ? 22  : medium ? 25  : 28,
  showSubline:  !small,
  heroMb:       small ? 2   : medium ? 5   : 8,
  illustMt:     small ? 6   : medium ? 12  : 16,
  illustH:      small ? 118 : medium ? 145 : 160,
  illustMb:     small ? 8   : medium ? 14  : 18,
  scooterW:     small ? 166 : medium ? 200 : 220,
  scooterH:     small ? 104 : medium ? 127 : 140,
  cardMb:       small ? 8   : medium ? 12  : 14,
  trustMb:      small ? 12  : medium ? 16  : 20,
  btnMb:        small ? 12  : medium ? 18  : 24,
  scrollable:   WIN_H < 620,
} as const;

// Cell width: explicit pixels so Android flex doesn't collapse inside Pressable
const WIN_W  = Dimensions.get("window").width;
const CELL_W = Math.floor((WIN_W - 40 - 40) / 6); // 40 = paddingH×2, 40 = 5 gaps×8

// ─── Hero illustration ─────────────────────────────────────────────────────────
function HeroIllustration({
  h, scooterW, scooterH, mt, mb,
}: {
  h: number; scooterW: number; scooterH: number; mt: number; mb: number;
}) {
  return (
    <View style={[ss.heroIllustration, { height: h, marginTop: mt, marginBottom: mb }]}>
      {/* Background scene — scales proportionally with container height */}
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 320 160"
        style={StyleSheet.absoluteFillObject}
      >
        {/* Left buildings */}
        <Rect x="0"  y="10" width="30" height="150" rx="3" fill="#FFE8D6" opacity="0.90" />
        <Rect x="10" y="0"  width="14" height="160" rx="2" fill="#FFD8C0" opacity="0.80" />
        <Rect x="36" y="20" width="24" height="140" rx="3" fill="#FFE8D6" opacity="0.90" />
        <Rect x="46" y="8"  width="11" height="152" rx="2" fill="#FFD0B4" opacity="0.70" />
        <Rect x="68" y="28" width="18" height="132" rx="3" fill="#FFE8D6" opacity="0.60" />
        {/* Right buildings */}
        <Rect x="234" y="24" width="18" height="136" rx="3" fill="#FFE8D6" opacity="0.60" />
        <Rect x="252" y="8"  width="26" height="152" rx="3" fill="#FFE8D6" opacity="0.90" />
        <Rect x="264" y="0"  width="13" height="160" rx="2" fill="#FFD8C0" opacity="0.80" />
        <Rect x="285" y="16" width="35" height="144" rx="3" fill="#FFE8D6" opacity="0.90" />
        {/* Road platform */}
        <Rect x="0" y="142" width="320" height="18" rx="0" fill="#FFF3EC" />
        <Line x1="0" y1="142" x2="320" y2="142" stroke="#FFDCC8" strokeWidth="1.5" />
        {/* Road centre dashes */}
        <Line x1="50"  y1="151" x2="84"  y2="151" stroke="#FF6B00" strokeWidth="1.5" strokeDasharray="9,7" opacity="0.22" />
        <Line x1="106" y1="151" x2="140" y2="151" stroke="#FF6B00" strokeWidth="1.5" strokeDasharray="9,7" opacity="0.22" />
        <Line x1="162" y1="151" x2="196" y2="151" stroke="#FF6B00" strokeWidth="1.5" strokeDasharray="9,7" opacity="0.22" />
        <Line x1="218" y1="151" x2="252" y2="151" stroke="#FF6B00" strokeWidth="1.5" strokeDasharray="9,7" opacity="0.22" />
        {/* Soft ground shadow ellipse */}
        <Ellipse cx="160" cy="142" rx="82" ry="6" fill="#C05000" opacity="0.12" />
      </Svg>

      {/* Premium delivery scooter — size driven by responsive props */}
      <Image
        source={require("@/assets/images/vehicles/scooter-hero.png")}
        style={[ss.heroScooter, { width: scooterW, height: scooterH }]}
        resizeMode="contain"
      />
    </View>
  );
}

// ─── Login hero: pixel-perfect reference illustration (image asset) ─────────────
// Full-bleed frosted-glass India map + monuments + clouds + pins + route lines
// with the existing delivery scooter on a glowing glass platform. Rendered as the
// source illustration to match the reference at 1:1 fidelity.
function LoginHeroImage() {
  return (
    <Image
      source={require("@/assets/images/login-hero.png")}
      style={ss.loginHeroImg}
      resizeMode="cover"
    />
  );
}

// ─── Setup hero: glass India map + skyline + scooter on a glowing platform ──────
// Geographically accurate India outline, projected into viewBox 0 0 360 260.
// Derived from real national-boundary data and simplified — the angular outline
// is intentional (Kashmir crown, north-east tail, Gujarat/Kutch, southern tip).
const INDIA_PATH =
  "M148.5 46.3 L165.7 46 L157.7 56 L161 64.8 L153.9 65.9 L156.3 74 " +
  "L170.2 81.4 L165.2 91 L180.6 99.4 L213 107 L217 95.3 L218.4 103 " +
  "L234.7 104.1 L238.3 103.2 L235.4 97.8 L254 87.4 L263.1 87.2 L270.7 96.2 " +
  "L269.2 102.1 L257 105.4 L243.2 136.4 L239.3 124.6 L235.3 129.8 L232.5 125.3 " +
  "L240.3 115.9 L224.3 114 L223.4 107.9 L215.5 105.2 L213.6 110.6 L219.2 114.3 " +
  "L213.3 118 L219.5 138.6 L213.3 134.7 L203.3 149.3 L165.4 178.3 L163 213.8 " +
  "L146.7 228 L123.5 175.4 L119.8 134.4 L107.3 144.8 L95.7 134.1 L104.7 129.5 " +
  "L91.3 125.1 L108.3 120.3 L99.2 103 L104.5 96 L113.4 96.6 L135.3 68 " +
  "L124.8 61.8 L127.6 48.5 L118.7 41.1 L137.8 38 Z";

// A premium glowing location pin centred on (x, y)
const PIN_BODY =
  "M0 13.5 C-7 4.5 -8.2 -2.8 -3.6 -7.2 C-1.3 -9.5 1.3 -9.5 3.6 -7.2 " +
  "C8.2 -2.8 7 4.5 0 13.5 Z";
function Pin({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      {/* soft orange glow */}
      <Circle cx="0" cy="0" r="11" fill="url(#pinGlow)" />
      {/* ground shadow */}
      <Ellipse cx="0" cy="14" rx="4" ry="1.7" fill="#172033" opacity="0.22" />
      {/* teardrop body */}
      <Path d={PIN_BODY} fill="url(#pinGrad)" />
      {/* bright rim highlight */}
      <Path d={PIN_BODY} fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.7" />
      {/* white centre */}
      <Circle cx="0" cy="-2.6" r="2.6" fill="#FFFFFF" />
      <Circle cx="0" cy="-2.6" r="2.6" fill="none" stroke="#FFFFFF" strokeWidth="0.5" opacity="0.6" />
    </G>
  );
}

function SetupHero() {
  return (
    <View style={ss.setupHero}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 360 260"
        preserveAspectRatio="xMidYMid meet"
        style={StyleSheet.absoluteFillObject}
      >
        <Defs>
          {/* Frosted glass fill — orange tint over white */}
          <SvgLinearGradient id="glassFill" x1="0.12" y1="0" x2="0.88" y2="1">
            <Stop offset="0"    stopColor="#FF6A00" stopOpacity="0.32" />
            <Stop offset="0.5"  stopColor="#FF6A00" stopOpacity="0.16" />
            <Stop offset="1"    stopColor="#FF6A00" stopOpacity="0.28" />
          </SvgLinearGradient>
          {/* Inner glass highlight (top-left light pooling) */}
          <RadialGradient id="glassInner" cx="36%" cy="28%" r="68%">
            <Stop offset="0"   stopColor="#FFFFFF" stopOpacity="0.60" />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.14" />
            <Stop offset="1"   stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
          <SvgLinearGradient id="glassHi" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </SvgLinearGradient>
          {/* Platform — soft outer glow */}
          <RadialGradient id="platformGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0"   stopColor="#FF6A00" stopOpacity="0.30" />
            <Stop offset="0.7" stopColor="#FF6A00" stopOpacity="0.09" />
            <Stop offset="1"   stopColor="#FF6A00" stopOpacity="0" />
          </RadialGradient>
          {/* Platform — glass disc */}
          <RadialGradient id="platformDisc" cx="50%" cy="42%" r="62%">
            <Stop offset="0"   stopColor="#FFFFFF" stopOpacity="0.55" />
            <Stop offset="0.6" stopColor="#FF6A00" stopOpacity="0.32" />
            <Stop offset="1"   stopColor="#FF6A00" stopOpacity="0.05" />
          </RadialGradient>
          {/* Platform — bright orange core */}
          <RadialGradient id="platformCore" cx="50%" cy="46%" r="60%">
            <Stop offset="0"    stopColor="#FFFFFF" stopOpacity="0.70" />
            <Stop offset="0.55" stopColor="#FF6A00" stopOpacity="0.50" />
            <Stop offset="1"    stopColor="#FF6A00" stopOpacity="0" />
          </RadialGradient>
          <SvgLinearGradient id="reflectGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FF6A00" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#FF6A00" stopOpacity="0" />
          </SvgLinearGradient>
          <SvgLinearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FF6A00" stopOpacity="1" />
            <Stop offset="1" stopColor="#FF6A00" stopOpacity="0.82" />
          </SvgLinearGradient>
          {/* Pin glow */}
          <RadialGradient id="pinGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0"   stopColor="#FF6A00" stopOpacity="0.45" />
            <Stop offset="0.6" stopColor="#FF6A00" stopOpacity="0.12" />
            <Stop offset="1"   stopColor="#FF6A00" stopOpacity="0" />
          </RadialGradient>
          <ClipPath id="indiaClip">
            <Path d={INDIA_PATH} />
          </ClipPath>
        </Defs>

        {/* Soft white/orange clouds — very subtle, behind the map */}
        <Ellipse cx="70"  cy="58" rx="34" ry="12" fill="#FFFFFF" opacity="0.48" />
        <Ellipse cx="96"  cy="64" rx="22" ry="9"  fill="#FFFFFF" opacity="0.40" />
        <Ellipse cx="300" cy="50" rx="34" ry="12" fill="#FFFFFF" opacity="0.48" />
        <Ellipse cx="278" cy="56" rx="22" ry="9"  fill="#FFFFFF" opacity="0.40" />
        <Ellipse cx="322" cy="62" rx="18" ry="7"  fill="#FFFFFF" opacity="0.36" />

        {/* India map — premium frosted glass fill */}
        <Path d={INDIA_PATH} fill="url(#glassFill)" />

        {/* Landmarks + network + highlights clipped INSIDE the map */}
        <G clipPath="url(#indiaClip)">
          {/* inner glass highlight + top sheen */}
          <Path d={INDIA_PATH} fill="url(#glassInner)" />
          <Ellipse cx="150" cy="78" rx="92" ry="58" fill="url(#glassHi)" opacity="0.52" />

          {/* Curved dotted delivery routes connecting cities */}
          <Path d="M118 102 Q150 80 165 80"   stroke="#FF6A00" strokeWidth="1.4" strokeDasharray="1.4,5" strokeLinecap="round" fill="none" opacity="0.48" />
          <Path d="M165 80 Q200 92 232 116"   stroke="#FF6A00" strokeWidth="1.4" strokeDasharray="1.4,5" strokeLinecap="round" fill="none" opacity="0.42" />
          <Path d="M118 102 Q120 130 140 150" stroke="#FF6A00" strokeWidth="1.4" strokeDasharray="1.4,5" strokeLinecap="round" fill="none" opacity="0.38" />
          <Path d="M165 80 Q175 120 140 150"  stroke="#FF6A00" strokeWidth="1.4" strokeDasharray="1.4,5" strokeLinecap="round" fill="none" opacity="0.34" />

          {/* India Gate (left) */}
          <G opacity="0.34" fill="#FF6A00">
            <Rect x="126" y="150" width="34" height="46" rx="2" />
            <Path d="M137 196 v-26 a7 7 0 0 1 14 0 v26 Z" fill="#FFFFFF" opacity="0.85" />
            <Rect x="122" y="146" width="42" height="6" rx="2" />
            <Rect x="139" y="136" width="8"  height="11" rx="1.5" />
          </G>

          {/* Taj-style domed palace (centre) */}
          <G opacity="0.30" fill="#FF6A00">
            <Rect x="164" y="160" width="32" height="36" rx="2" />
            <Ellipse cx="180" cy="160" rx="14" ry="15" />
            <Rect x="178" y="136" width="4" height="13" />
            <Ellipse cx="180" cy="134" rx="2.4" ry="3.4" />
            <Rect x="161" y="164" width="4" height="32" />
            <Rect x="195" y="164" width="4" height="32" />
          </G>

          {/* Temple silhouettes — stepped shikhara (centre-right) */}
          <G opacity="0.30" fill="#FF6A00">
            <Path d="M196 196 L196 170 L206 150 L216 170 L216 196 Z" />
            <Path d="M217 196 L217 178 L223 164 L229 178 L229 196 Z" />
            <Circle cx="206" cy="147" r="2.2" />
          </G>

          {/* Modern towers (upper-right interior) */}
          <G opacity="0.28" fill="#FF6A00">
            <Rect x="208" y="120" width="13" height="50" rx="2" />
            <Rect x="223" y="130" width="10" height="40" rx="2" />
            <Rect x="200" y="132" width="8"  height="38" rx="2" />
            <Path d="M214.5 120 l-3 -12 l3 0 Z" />
          </G>
        </G>

        {/* Premium glass glowing edges — multi-layer + bright rim */}
        <Path d={INDIA_PATH} fill="none" stroke="#FF6A00" strokeWidth="16"  opacity="0.10" strokeLinejoin="round" />
        <Path d={INDIA_PATH} fill="none" stroke="#FF6A00" strokeWidth="8"   opacity="0.20" strokeLinejoin="round" />
        <Path d={INDIA_PATH} fill="none" stroke="#FF6A00" strokeWidth="3"   opacity="0.60" strokeLinejoin="round" />
        <Path d={INDIA_PATH} fill="none" stroke="#FFFFFF" strokeWidth="1.3" opacity="0.95" strokeLinejoin="round" />

        {/* Glowing delivery-network pins across the map */}
        <Pin x={118} y={102} s={1.05} />
        <Pin x={150} y={100} s={1.05} />
        <Pin x={178} y={112} s={1} />
        <Pin x={195} y={118} s={0.95} />
        <Pin x={140} y={150} s={0.92} />

        {/* Scooter platform — radial glow + glass disc + bright core + rings + reflection */}
        <Ellipse cx="180" cy="224" rx="140" ry="34"   fill="url(#platformGlow)" />
        <Ellipse cx="180" cy="222" rx="104" ry="23"   fill="url(#platformDisc)" />
        <Ellipse cx="180" cy="221" rx="60"  ry="13"   fill="url(#platformCore)" />
        <Ellipse cx="180" cy="222" rx="104" ry="23"   fill="none" stroke="#FFFFFF" strokeWidth="1.6" opacity="0.85" />
        <Ellipse cx="180" cy="222" rx="82"  ry="17"   fill="none" stroke="#FF6A00" strokeWidth="1.1" opacity="0.6" />
        <Ellipse cx="180" cy="222" rx="58"  ry="11.5" fill="none" stroke="#FFFFFF" strokeWidth="0.9" opacity="0.5" />
        <Ellipse cx="168" cy="215" rx="34"  ry="6"    fill="#FFFFFF" opacity="0.30" />
        <Ellipse cx="180" cy="240" rx="80"  ry="14"   fill="url(#reflectGrad)" />
      </Svg>

      <Image
        source={require("@/assets/images/vehicles/scooter-hero.png")}
        style={ss.setupScooter}
        resizeMode="contain"
      />
    </View>
  );
}

// ─── OTP Cell Pop animation ────────────────────────────────────────────────────
function CellPop({ children, trigger }: { children: React.ReactNode; trigger: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev  = useRef(trigger);

  useEffect(() => {
    if (trigger && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.08, useNativeDriver: true, speed: 50, bounciness: 8 }),
        Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 40, bounciness: 5 }),
      ]).start();
    }
    prev.current = trigger;
  }, [trigger, scale]);

  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

// ─── Animated verifying dots ──────────────────────────────────────────────────
function VerifyingDots() {
  const v1 = useRef(new Animated.Value(0.3)).current;
  const v2 = useRef(new Animated.Value(0.3)).current;
  const v3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1,   duration: 380, delay, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(val, { toValue: 0.3, duration: 380,         useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      );
    const a = make(v1, 0); const b = make(v2, 130); const c = make(v3, 260);
    a.start(); b.start(); c.start();
    return () => { a.stop(); b.stop(); c.stop(); };
  }, [v1, v2, v3]);

  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center", width: 28 }}>
      <Animated.View style={[ss.loadDot, { opacity: v1 }]} />
      <Animated.View style={[ss.loadDot, { opacity: v2 }]} />
      <Animated.View style={[ss.loadDot, { opacity: v3 }]} />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const phoneRef = useRef<TextInput>(null);
  const otpRef   = useRef<TextInput>(null);

  const { setPhone: setDriverPhone, driverUid, authLoading, isOtpVerified, confirmOtp, confirmPin } = useDriver();

  // Phase state — "login" (phone + PIN) is the daily-login surface and the
  // default. "phone" → "otp" is the OTP flow, used ONLY for first-time PIN
  // setup and forgot/reset; it always ends on /create-pin.
  const [phase,    setPhase]    = useState<"login" | "phone" | "otp">("login");
  const slideAnim              = useRef(new Animated.Value(0)).current;

  // Phone / PIN-login phase
  const [phone,    setPhone]    = useState("");
  const [focused,  setFocused]  = useState(false);
  const [sending,  setSending]  = useState(false);
  const [sendErr,  setSendErr]  = useState("");

  // PIN-login factor
  const pinRef                    = useRef<TextInput>(null);
  const [pin,          setPin]          = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [pinErr,       setPinErr]       = useState("");

  // OTP intent — both "setup" and "forgot" land on /create-pin; only the copy
  // shown during the OTP flow differs.
  const [otpIntent, setOtpIntent] = useState<"setup" | "forgot">("setup");

  // OTP phase
  const [otp,       setOtp]      = useState("");
  const [verifying, setVerifying] = useState(false);
  const [otpErr,    setOtpErr]   = useState("");
  const [timer,     setTimer]    = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);

  const digits  = phone.replace(/\D/g, "");
  const isValid = digits.length === 10;

  const otpDigits = otp.split("").concat(Array(OTP_LENGTH - otp.length).fill(""));
  const pinDigits = pin.split("").concat(Array(PIN_LENGTH - pin.length).fill(""));

  // ── Resend countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "otp") return;
    if (timer === 0) { setCanResend(true); return; }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [phase, timer]);

  // ── Auto-focus OTP input when phase switches ──────────────────────────────
  useEffect(() => {
    if (phase === "otp") {
      const t = setTimeout(() => otpRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // ── Phase transition animation ────────────────────────────────────────────
  function transitionTo(newPhase: "login" | "phone" | "otp") {
    Animated.timing(slideAnim, {
      toValue:         newPhase === "otp" ? 1 : 0,
      duration:        280,
      useNativeDriver: true,
      easing:          Easing.out(Easing.cubic),
    }).start(() => setPhase(newPhase));
    setPhase(newPhase);
  }

  // ── Start the OTP flow (PIN setup or reset) ───────────────────────────────
  function startOtpFlow(intent: "setup" | "forgot") {
    setOtpIntent(intent);
    setSendErr("");
    setOtp("");
    setOtpErr("");
    transitionTo("phone");
  }

  // ── Back to PIN login from the OTP flow ───────────────────────────────────
  function backToPinLogin() {
    setPin("");
    setPinErr("");
    setOtp("");
    setOtpErr("");
    transitionTo("login");
  }

  // ── Verify PIN (daily login) ──────────────────────────────────────────────
  async function handleConfirmPin(code: string) {
    if (verifyingPin || code.length !== PIN_LENGTH || !isValid) return;
    setVerifyingPin(true);
    setPinErr("");

    const result = await confirmPin(digits, code);

    setVerifyingPin(false);

    if (!result.ok) {
      setPin("");
      // No PIN set for this number yet → send the driver straight into the OTP
      // verification + first-time PIN setup flow. No error is shown and no
      // anonymous "does a PIN exist?" lookup is made — the verify-pin 404
      // response alone drives this branch.
      if (result.pinNotFound) {
        startOtpFlow("setup");
        return;
      }
      setPinErr(result.error ?? "Incorrect PIN. Please try again.");
      setTimeout(() => pinRef.current?.focus(), 100);
      return;
    }

    const nextRoute = result.nextRoute ?? (result.profileComplete ? "/(tabs)" : "/registration");
    router.replace(nextRoute as never);
  }

  // ── Send OTP ──────────────────────────────────────────────────────────────
  async function handleSendOtp() {
    if (sending || !isValid) return;
    setSendErr("");
    setSending(true);

    const result = await sendOtp(digits);
    setSending(false);

    if (!result.ok) {
      setSendErr(result.error);
      return;
    }

    setDriverPhone(digits);
    setOtp("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);
    transitionTo("otp");
  }

  // ── Resend OTP ────────────────────────────────────────────────────────────
  async function handleResend() {
    if (!canResend) return;
    setOtp("");
    setOtpErr("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);

    await sendOtp(digits);
    setTimeout(() => otpRef.current?.focus(), 100);
  }

  // ── Verify OTP ────────────────────────────────────────────────────────────
  async function handleVerify(code: string) {
    if (verifying || code.length !== OTP_LENGTH || !digits) return;
    setVerifying(true);
    setOtpErr("");

    const result = await confirmOtp(digits, code);

    setVerifying(false);

    if (!result.ok) {
      setOtp("");
      setOtpErr(result.error ?? "Verification failed. Try again.");
      setTimeout(() => otpRef.current?.focus(), 100);
      return;
    }

    const nextRoute = result.nextRoute ?? (result.profileComplete ? "/(tabs)" : "/registration");

    // The OTP flow exists ONLY to set up (first-time) or reset (forgot) the PIN,
    // so a successful OTP verify always routes to /create-pin. create-pin then
    // continues to nextRoute once the PIN is saved.
    router.replace({ pathname: "/create-pin", params: { next: nextRoute } });
  }

  console.log("[SCREEN_MOUNT] login — authLoading =", authLoading, "driverUid =", driverUid);

  if (authLoading || isOtpVerified) {
    return (
      <View style={[ss.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={D.primary} />
      </View>
    );
  }

  const formattedPhone = digits
    ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
    : "+91 — — — — —";

  return (
    <KeyboardAvoidingView
      style={ss.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          ss.scroll,
          { paddingTop: insets.top + r.topPad, paddingBottom: insets.bottom + r.botPad },
        ]}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
      >

        {/* ── PHASE: LOGIN (phone + PIN) ── */}
        {phase === "login" && (
          <>
            {/* ── Hero: pixel-perfect reference illustration (image) ── */}
            <LoginHeroImage />

            {/* ── Branding ── */}
            <View style={ss.brandBlock}>
              <Text style={ss.brandWordmark}>
                <Text style={{ color: D.navy }}>Bike</Text>
                <Text style={{ color: D.primary }}>Courier</Text>
              </Text>
              <View style={ss.partnerRow}>
                <View style={ss.partnerLine} />
                <Text style={ss.partnerWord}>PARTNER</Text>
                <View style={ss.partnerLine} />
              </View>
            </View>

            {/* ── Welcome ── */}
            <Text style={ss.welcomeHeadline}>Welcome Back</Text>
            <Text style={ss.welcomeSub}>Log in with your mobile number & PIN</Text>

            {/* ── Mobile number card ── */}
            <View style={[ss.floatCard, ss.mobileCardSpacing]}>
              <Text style={ss.cardLabelText}>Mobile Number</Text>

              <Pressable
                onPress={() => phoneRef.current?.focus()}
                style={[ss.inputRow, focused && ss.inputRowFocused]}
              >
                <View style={ss.countryPill}>
                  <Text style={ss.flagEmoji}>🇮🇳</Text>
                  <Text style={ss.countryCode}>+91</Text>
                </View>
                <View style={ss.inputDivider} />
                <TextInput
                  ref={phoneRef}
                  style={ss.phoneInput}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t.replace(/\D/g, "").slice(0, 10));
                    setPinErr("");
                  }}
                  keyboardType="phone-pad"
                  placeholder="Enter 10-digit mobile"
                  placeholderTextColor={D.textSecondary}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  returnKeyType="next"
                  onSubmitEditing={() => pinRef.current?.focus()}
                  underlineColorAndroid="transparent"
                  selectionColor={D.primary}
                  {...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {})}
                />
              </Pressable>
            </View>

            {/* ── PIN card ── */}
            <View style={ss.floatCard}>
              <Text style={ss.cardLabelText}>6-digit PIN</Text>

              <Pressable onPress={() => pinRef.current?.focus()} style={ss.pinCellsRow}>
                {pinDigits.map((d, i) => {
                  const isFilled = i < pin.length;
                  const isActive = i === pin.length && !verifyingPin && isValid;
                  const hasError = !!pinErr;
                  return (
                    <View
                      key={i}
                      style={[
                        ss.pinCellShell,
                        {
                          borderColor:     hasError ? D.error : isActive ? D.primary : D.inputBorder,
                          borderWidth:     isActive || hasError ? 2 : 1,
                          backgroundColor: isActive ? D.primarySoft : D.white,
                        },
                        isActive && ss.pinCellActiveGlow,
                      ]}
                    >
                      {isFilled ? (
                        <Text style={[ss.pinDot, { color: D.navy }]}>●</Text>
                      ) : isActive ? (
                        <Text style={ss.pinCursor}>|</Text>
                      ) : null}
                    </View>
                  );
                })}
              </Pressable>

              {/* Hidden PIN input */}
              <TextInput
                ref={pinRef}
                value={pin}
                onChangeText={(t) => {
                  if (verifyingPin) return;
                  setPinErr("");
                  const cleaned = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
                  setPin(cleaned);
                  if (cleaned.length === PIN_LENGTH && isValid) void handleConfirmPin(cleaned);
                }}
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                secureTextEntry
                style={ss.hiddenInput}
                caretHidden
                selectionColor="transparent"
                underlineColorAndroid="transparent"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                autoCorrect={false}
              />

              {!!pinErr && (
                <View style={ss.errorRow}>
                  <Feather name="alert-circle" size={13} color={D.error} />
                  <Text style={ss.errorText}>{pinErr}</Text>
                </View>
              )}
            </View>

            {/* ── Forgot PIN ── */}
            <TouchableOpacity
              onPress={() => startOtpFlow("forgot")}
              activeOpacity={0.7}
              hitSlop={8}
              disabled={!isValid}
              style={ss.forgotRow}
            >
              <Text style={[ss.forgotLink, !isValid && { color: D.placeholder }]}>Forgot PIN?</Text>
            </TouchableOpacity>

            {/* ── Log In button ── */}
            <TouchableOpacity
              style={ss.loginBtnWrap}
              onPress={() => void handleConfirmPin(pin)}
              activeOpacity={0.9}
              disabled={!isValid || pin.length < PIN_LENGTH || verifyingPin}
            >
              <LinearGradient
                colors={((!isValid || pin.length < PIN_LENGTH) ? ["#E7E9EE", "#E7E9EE"] : ["#FF8A00", "#FF6A00"]) as readonly [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={ss.loginBtn}
              >
                {verifyingPin ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <ActivityIndicator size="small" color={D.white} />
                    <Text style={ss.loginBtnText}>Logging in...</Text>
                  </View>
                ) : (
                  <Text style={[ss.loginBtnText, (!isValid || pin.length < PIN_LENGTH) && ss.loginBtnTextDisabled]}>
                    Log In
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* ── First-time setup ── */}
            <View style={ss.bottomBlock}>
              <Text style={ss.firstTimeLine}>
                <Text style={ss.firstTimeGrey}>First time here? </Text>
                <Text
                  style={[ss.firstTimeLink, !isValid && { color: D.placeholder }]}
                  onPress={() => { if (isValid) startOtpFlow("setup"); }}
                >
                  Set up with OTP
                </Text>
              </Text>
              <Text style={ss.firstTimeHelper}>Enter your mobile number to continue.</Text>

              {/* ── Terms ── */}
              <View style={ss.termsRow}>
                <Text style={ss.termsText}>By continuing, you agree to our </Text>
                <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/terms-and-conditions")}>
                  <Text style={ss.termsLink}>Terms</Text>
                </TouchableOpacity>
                <Text style={ss.termsText}> & </Text>
                <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/privacy-policy")}>
                  <Text style={ss.termsLink}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* ── PHASE: PHONE ── */}
        {phase === "phone" && (
          <>
            {/* ── Hero: glass India map + scooter on platform ── */}
            <SetupHero />

            {/* ── Branding ── */}
            <View style={ss.brandBlock}>
              <Text style={ss.brandWordmark}>
                <Text style={{ color: D.navy }}>Bike</Text>
                <Text style={{ color: D.primary }}>Courier</Text>
              </Text>
              <View style={ss.partnerRow}>
                <View style={ss.partnerLine} />
                <Text style={ss.partnerWord}>PARTNER</Text>
                <View style={ss.partnerLine} />
              </View>
            </View>

            {/* ── Heading ── */}
            <Text style={ss.setupHeadline}>
              {otpIntent === "forgot" ? "Reset your PIN" : "Set up your PIN"}
            </Text>
            <Text style={ss.setupSubtitle}>
              {otpIntent === "forgot"
                ? "Verify your number with OTP to set a new PIN"
                : "Verify your number with OTP to create your PIN"}
            </Text>

            {/* ── Phone input card ── */}
            <View style={ss.floatCard}>
              <Text style={ss.setupCardLabel}>Mobile Number</Text>

              <Pressable
                onPress={() => phoneRef.current?.focus()}
                style={[ss.inputRow, focused && ss.inputRowFocused]}
              >
                <View style={ss.countryPill}>
                  <Text style={ss.flagEmoji}>🇮🇳</Text>
                  <Text style={ss.countryCode}>+91</Text>
                </View>
                <View style={ss.inputDivider} />
                <TextInput
                  ref={phoneRef}
                  style={ss.phoneInput}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t.replace(/\D/g, "").slice(0, 10));
                    setSendErr("");
                  }}
                  keyboardType="phone-pad"
                  placeholder="Enter 10-digit mobile number"
                  placeholderTextColor={D.placeholder}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  returnKeyType="done"
                  onSubmitEditing={() => void handleSendOtp()}
                  underlineColorAndroid="transparent"
                  selectionColor={D.primary}
                  {...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {})}
                />
              </Pressable>

              {!!sendErr && (
                <View style={ss.errorRow}>
                  <Feather name="alert-circle" size={13} color={D.error} />
                  <Text style={ss.errorText}>{sendErr}</Text>
                </View>
              )}
            </View>

            {/* ── Trust note ── */}
            <View style={ss.setupTrustRow}>
              <Feather name="shield" size={14} color={D.primary} />
              <Text style={ss.setupTrustText}>
                Your number is used only for secure login and delivery updates.
              </Text>
            </View>

            {/* ── Continue button ── */}
            <TouchableOpacity
              style={ss.setupBtnWrap}
              onPress={() => void handleSendOtp()}
              activeOpacity={0.9}
              disabled={!isValid || sending}
            >
              <LinearGradient
                colors={(!isValid ? ["#E7E9EE", "#E7E9EE"] : [D.primary, D.primaryDark]) as readonly [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={ss.setupBtn}
              >
                {sending ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <ActivityIndicator size="small" color={D.white} />
                    <Text style={ss.setupBtnText}>Sending OTP...</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={[ss.setupBtnText, !isValid && ss.loginBtnTextDisabled]}>
                      Continue
                    </Text>
                    <Feather name="arrow-right" size={20} color={!isValid ? "#9CA3AF" : D.white} />
                  </View>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Terms ── */}
            <View style={ss.termsBlock}>
              <View style={ss.termsRow}>
                <Text style={ss.termsText}>By continuing, you agree to our </Text>
                <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/terms-and-conditions")}>
                  <Text style={ss.termsLink}>Terms</Text>
                </TouchableOpacity>
                <Text style={ss.termsText}> & </Text>
                <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/privacy-policy")}>
                  <Text style={ss.termsLink}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Back to PIN login ── */}
            <TouchableOpacity
              style={ss.backToPinBtn}
              onPress={backToPinLogin}
              activeOpacity={0.7}
            >
              <Feather name="arrow-left" size={15} color={D.navy} />
              <Text style={ss.changeNumText}>Back to PIN login</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── PHASE: OTP ── */}
        {phase === "otp" && (
          <View style={ss.otpPhase}>

            {/* ── BC logo + branding (mirrors phone phase) ── */}
            <View style={ss.otpBranding}>
              <View style={[ss.logoCircle, { width: r.logoSize, height: r.logoSize, borderRadius: r.logoBorderR, marginBottom: r.logoMb }]}>
                <Text style={[ss.logoText, { fontSize: r.logoFontSize }]}>BC</Text>
              </View>
              <Text style={[ss.brandName, { fontSize: r.brandSize }]}>
                <Text style={{ color: D.text }}>Bike</Text>
                <Text style={{ color: D.primary }}>Courier</Text>
              </Text>
              <Text style={[ss.partnerLabel, { marginBottom: 0 }]}>PARTNER</Text>
            </View>

            {/* ── Heading ── */}
            <View style={ss.otpHeader}>
              <Text style={ss.otpHeadline}>Verify your number</Text>
              <View style={ss.codeSentRow}>
                <Text style={ss.codeSentText}>Code sent to </Text>
                <Text style={ss.codeSentPhone}>{formattedPhone}</Text>
              </View>
            </View>

            {/* ── OTP Cells ── */}
            <Pressable onPress={() => otpRef.current?.focus()} style={ss.cellsRow}>
              {otpDigits.map((d, i) => {
                const isFilled = i < otp.length;
                const isActive = i === otp.length && !verifying;
                const hasError = !!otpErr;
                return (
                  <CellPop key={i} trigger={isFilled}>
                    <View
                      style={[
                        ss.cellShell,
                        {
                          borderColor:     hasError ? D.error : isActive ? D.primary : isFilled ? D.navy + "60" : D.cardBorder,
                          borderWidth:     isActive || hasError ? 2 : 1,
                          backgroundColor: isActive ? D.primarySoft : D.white,
                          shadowColor:     isActive ? D.primary : "#000",
                          shadowOpacity:   isActive ? 0.16 : 0.04,
                          shadowRadius:    isActive ? 10 : 4,
                          shadowOffset:    { width: 0, height: isActive ? 4 : 2 },
                          elevation:       isActive ? 4 : 1,
                        },
                      ]}
                    >
                      <Text style={[ss.cellText, { color: isActive ? D.primary : D.text }]}>
                        {isFilled ? d : ""}
                      </Text>
                    </View>
                  </CellPop>
                );
              })}
            </Pressable>

            {/* Hidden OTP input */}
            <TextInput
              ref={otpRef}
              value={otp}
              onChangeText={(t) => {
                if (verifying) return;
                setOtpErr("");
                const cleaned = t.replace(/\D/g, "").slice(0, OTP_LENGTH);
                setOtp(cleaned);
                if (cleaned.length === OTP_LENGTH) void handleVerify(cleaned);
              }}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              style={ss.hiddenInput}
              caretHidden
              selectionColor="transparent"
              underlineColorAndroid="transparent"
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              autoCorrect={false}
            />

            {/* OTP error */}
            {!!otpErr && (
              <View style={ss.otpErrRow}>
                <Feather name="alert-circle" size={13} color={D.error} />
                <Text style={ss.otpErrText}>{otpErr}</Text>
              </View>
            )}

            {/* Verify & Continue button */}
            <TouchableOpacity
              style={[ss.verifyBtn, otp.length < OTP_LENGTH && ss.verifyBtnDisabled]}
              onPress={() => void handleVerify(otp)}
              activeOpacity={0.85}
              disabled={otp.length < OTP_LENGTH || verifying}
            >
              {verifying ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <VerifyingDots />
                  <Text style={ss.verifyBtnText}>Verifying...</Text>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[ss.verifyBtnText, otp.length < OTP_LENGTH && ss.verifyBtnTextDisabled]}>
                    {otp.length === OTP_LENGTH ? "Verify & Continue" : `Enter code (${otp.length}/${OTP_LENGTH})`}
                  </Text>
                  {otp.length === OTP_LENGTH && (
                    <Feather name="arrow-right" size={18} color={D.white} />
                  )}
                </View>
              )}
            </TouchableOpacity>

            {/* Resend timer */}
            <View style={ss.resendRow}>
              {canResend ? (
                <TouchableOpacity onPress={() => void handleResend()} activeOpacity={0.6}>
                  <Text style={ss.resendActiveText}>Resend OTP</Text>
                </TouchableOpacity>
              ) : (
                <Text style={ss.resendText}>
                  Resend in <Text style={{ color: D.text, fontWeight: "700" }}>{timer}s</Text>
                </Text>
              )}
            </View>

            {/* Change number — bottom */}
            <TouchableOpacity
              style={ss.changeNumBtn}
              onPress={() => { setOtp(""); setOtpErr(""); transitionTo("phone"); }}
              activeOpacity={0.7}
            >
              <Feather name="arrow-left" size={15} color={D.navy} />
              <Text style={ss.changeNumText}>Change number</Text>
            </TouchableOpacity>

          </View>
        )}

      </ScrollView>

    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: D.bg,
  },
  scroll: {
    flexGrow:          1,
    alignItems:        "center",
    paddingHorizontal: 22,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:   "center",
    marginBottom: 8,
    width:        "100%",
  },
  logoCircle: {
    width:           64,
    height:          64,
    borderRadius:    32,
    backgroundColor: D.primary,
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    12,
    shadowColor:     D.primary,
    shadowOpacity:   0.30,
    shadowRadius:    14,
    shadowOffset:    { width: 0, height: 5 },
    elevation:       6,
  },
  logoText: {
    fontSize:      22,
    fontWeight:    "900",
    color:         D.white,
    letterSpacing: -0.5,
  },
  brandName: {
    fontSize:      20,
    fontWeight:    "800",
    letterSpacing: -0.5,
    marginBottom:  2,
  },
  partnerLabel: {
    fontSize:      10,
    fontWeight:    "700",
    color:         D.primary,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    marginBottom:  16,
  },
  headline: {
    fontSize:      28,
    fontWeight:    "800",
    color:         D.text,
    letterSpacing: -0.5,
    textAlign:     "center",
    marginBottom:  4,
  },
  subline: {
    fontSize:  14,
    color:     D.textSecondary,
    textAlign: "center",
  },

  // ── Login hero (pixel-perfect reference illustration image) ───────────────
  loginHeroImg: {
    width:        Math.round(WIN_W * 0.827),
    height:       Math.round(WIN_W * 0.827 * (648 / 853)),
    marginTop:    -r.topPad,
    marginBottom: -2,
    alignSelf:    "center",
  },

  // ── Login hero (scooter + skyline) ────────────────────────────────────────
  loginHero: {
    width:          "100%",
    height:         small ? 182 : medium ? 212 : 234,
    alignItems:     "center",
    justifyContent: "center",
    marginTop:      small ? 4 : 8,
    marginBottom:   2,
  },
  loginScooter: {
    width:  Math.min(WIN_W * 0.75, 300),
    height: small ? 160 : medium ? 184 : 200,
    zIndex: 2,
  },

  // ── Setup hero (glass India map + scooter platform) ───────────────────────
  setupHero: {
    width:          "100%",
    height:         HERO_H,
    alignItems:     "center",
    justifyContent: "center",
    marginTop:      clamp(WIN_H * 0.005, 2, 6),
    marginBottom:   clamp(WIN_H * 0.011, 6, 12),
  },
  setupScooter: {
    width:        Math.min(WIN_W * 0.60, 244),
    height:       SCOOTER_H,
    marginTop:    SCOOTER_MT,
    zIndex:       2,
  },
  setupHeadline: {
    fontSize:      28,
    fontWeight:    "800",
    color:         D.navy,
    letterSpacing: -0.5,
    textAlign:     "center",
    marginBottom:  8,
  },
  setupSubtitle: {
    fontSize:      14,
    color:         D.textSecondary,
    textAlign:     "center",
    lineHeight:    20,
    marginBottom:  24,
  },
  setupCardLabel: {
    fontSize:     14,
    fontWeight:   "700",
    color:        D.navy,
    marginBottom: 12,
  },
  setupTrustRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    paddingHorizontal: 6,
    marginTop:      14,
    marginBottom:   22,
  },
  setupTrustText: {
    flexShrink: 1,
    fontSize:   13,
    color:      D.textSecondary,
    textAlign:  "center",
  },
  setupBtnWrap: {
    alignSelf:     "stretch",
    borderRadius:  18,
    marginBottom:  20,
    shadowColor:   D.primary,
    shadowOpacity: 0.40,
    shadowRadius:  18,
    shadowOffset:  { width: 0, height: 10 },
    elevation:     9,
  },
  setupBtn: {
    height:         58,
    borderRadius:   18,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
  },
  setupBtnText: {
    fontSize:      18,
    fontWeight:    "800",
    color:         D.white,
    letterSpacing: 0.2,
  },

  // ── Branding ──────────────────────────────────────────────────────────────
  brandBlock: {
    alignItems:   "center",
    marginTop:    -8,
    marginBottom: small ? 8 : 10,
  },
  brandWordmark: {
    fontSize:      26,
    fontWeight:    "800",
    letterSpacing: -0.6,
    marginBottom:  5,
  },
  partnerRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
  },
  partnerLine: {
    width:           26,
    height:          1.5,
    borderRadius:    1,
    backgroundColor: "#F0C9AE",
  },
  partnerWord: {
    fontSize:      11,
    fontWeight:    "700",
    color:         D.primary,
    letterSpacing: 4,
  },

  // ── Welcome ───────────────────────────────────────────────────────────────
  welcomeHeadline: {
    fontSize:      small ? 25 : 30,
    fontWeight:    "800",
    color:         D.navy,
    letterSpacing: -0.6,
    textAlign:     "center",
    marginTop:     -6,
    marginBottom:  1,
  },
  welcomeSub: {
    fontSize:     16,
    fontWeight:   "500",
    color:        D.textSecondary,
    textAlign:    "center",
    marginBottom: 16,
  },

  // ── Floating cards ────────────────────────────────────────────────────────
  floatCard: {
    alignSelf:         "stretch",
    backgroundColor:   D.white,
    borderRadius:      24,
    paddingVertical:   11,
    paddingHorizontal: 24,
    borderWidth:       1,
    borderColor:       D.border,
    shadowColor:       "#1B2733",
    shadowOpacity:     0.07,
    shadowRadius:      18,
    shadowOffset:      { width: 0, height: 8 },
    elevation:         4,
    marginBottom:      14,
  },
  mobileCardSpacing: {
    marginBottom: 14,
  },
  cardLabelText: {
    fontSize:     14,
    fontWeight:   "600",
    color:        D.cardLabel,
    marginBottom: 10,
  },

  // ── PIN cell states ───────────────────────────────────────────────────────
  pinCellActiveGlow: {
    shadowColor:   D.primary,
    shadowOpacity: 0.32,
    shadowRadius:  11,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     4,
  },
  pinCursor: {
    fontSize:   22,
    fontWeight: "400",
    color:      D.primary,
  },
  pinIdleDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: "#CBD2DA",
  },

  // ── Log In button ─────────────────────────────────────────────────────────
  loginBtnWrap: {
    width:         "88%",
    alignSelf:     "center",
    borderRadius:  18,
    marginTop:     -12,
    marginBottom:  10,
    shadowColor:   D.primary,
    shadowOpacity: 0.26,
    shadowRadius:  16,
    shadowOffset:  { width: 0, height: 8 },
    elevation:     8,
  },
  loginBtn: {
    height:         52,
    borderRadius:   18,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
  },
  loginBtnText: {
    fontSize:      18,
    fontWeight:    "800",
    color:         D.white,
    letterSpacing: 0.2,
  },
  loginBtnTextDisabled: {
    color: "#9CA3AF",
  },

  // ── First-time setup (bottom) ─────────────────────────────────────────────
  bottomBlock: {
    alignSelf:  "stretch",
    alignItems: "center",
  },
  firstTimeLine: {
    fontSize:   15,
    textAlign:  "center",
    lineHeight: 22,
  },
  firstTimeGrey: {
    fontSize: 15,
    color:    D.textSecondary,
  },
  firstTimeLink: {
    fontSize:   15,
    fontWeight: "700",
    color:      D.primary,
  },
  firstTimeHelper: {
    fontSize:     13,
    color:        D.textSecondary,
    textAlign:    "center",
    marginTop:    2,
    marginBottom: 14,
  },

  // ── Hero illustration ─────────────────────────────────────────────────────
  heroIllustration: {
    alignSelf:      "stretch",
    alignItems:     "center",
    justifyContent: "flex-end",
    overflow:       "hidden",
    // height / marginTop / marginBottom come from responsive props
  },
  heroScooter: {
    zIndex:       1,
    marginBottom: 2,
    // width / height come from responsive props
  },

  // ── Phone Input Card ──────────────────────────────────────────────────────
  loginCard: {
    alignSelf:       "stretch",
    backgroundColor: D.white,
    borderRadius:    20,
    padding:         20,
    shadowColor:     "#000",
    shadowOpacity:   0.06,
    shadowRadius:    16,
    shadowOffset:    { width: 0, height: 4 },
    elevation:       4,
    marginBottom:    14,
  },
  cardLabel: {
    fontSize:     13,
    fontWeight:   "600",
    color:        D.textSecondary,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection:     "row",
    alignItems:        "center",
    borderWidth:       1,
    borderColor:       D.inputBorder,
    borderRadius:      18,
    height:            48,
    paddingHorizontal: 14,
    backgroundColor:   D.white,
  },
  inputRowFocused: {
    borderColor:     D.primary,
    backgroundColor: D.primarySoft,
  },
  countryPill: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           4,
  },
  flagEmoji: {
    fontSize:   18,
    lineHeight: 24,
  },
  countryCode: {
    fontSize:   15,
    fontWeight: "600",
    color:      D.text,
  },
  inputDivider: {
    width:             1.5,
    height:            22,
    backgroundColor:   D.border,
    marginHorizontal:  12,
  },
  phoneInput: {
    flex:               1,
    fontSize:           16,
    fontWeight:         "500",
    color:              D.text,
    lineHeight:         22,
    paddingVertical:    0,
    textAlignVertical:  "center",
    includeFontPadding: false,
    ...Platform.select({
      web:     { outlineWidth: 0, outlineStyle: "none" } as object,
      default: {},
    }),
  },
  errorRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
    marginTop:     10,
    alignSelf:     "stretch",
  },
  errorText: {
    fontSize:   13,
    fontWeight: "500",
    color:      D.error,
    flex:       1,
  },

  // ── Trust note ────────────────────────────────────────────────────────────
  trustRow: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               8,
    alignSelf:         "stretch",
    marginBottom:      20,
    paddingHorizontal: 4,
  },
  trustText: {
    flex:       1,
    fontSize:   12,
    color:      D.textSecondary,
    lineHeight: 17,
  },

  // ── Continue button ───────────────────────────────────────────────────────
  continueBtn: {
    alignSelf:       "stretch",
    height:          56,
    borderRadius:    16,
    backgroundColor: D.primary,
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    24,
    shadowColor:     D.primary,
    shadowOpacity:   0.30,
    shadowRadius:    10,
    shadowOffset:    { width: 0, height: 4 },
    elevation:       4,
  },
  continueBtnDisabled: {
    backgroundColor: "#E5E7EB",
    borderWidth:     1,
    borderColor:     "#D1D5DB",
    shadowOpacity:   0,
    elevation:       0,
  },
  continueBtnText: {
    fontSize:      17,
    fontWeight:    "700",
    color:         D.white,
    letterSpacing: 0.2,
  },
  continueBtnTextDisabled: {
    color:      "#6B7280",
    fontWeight: "600",
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  termsBlock: {
    alignItems: "center",
    alignSelf:  "stretch",
  },
  termsRow: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    alignItems:     "center",
    justifyContent: "center",
    gap:            1,
  },
  termsText: {
    fontSize: 12,
    color:    D.textSecondary,
  },
  termsLink: {
    fontSize:   12,
    fontWeight: "700",
    color:      D.primary,
  },
  termsNote: {
    fontSize:  11,
    color:     D.textMuted,
    marginTop: 6,
    textAlign: "center",
  },

  // ── OTP Phase ─────────────────────────────────────────────────────────────
  otpPhase: {
    alignSelf:  "stretch",
    alignItems: "center",
    gap:        14,
  },
  otpBranding: {
    alignItems: "center",
    gap:        4,
  },
  otpHeader: {
    alignItems: "center",
    gap:        6,
    width:      "100%",
  },
  otpHeadline: {
    fontSize:      26,
    fontWeight:    "800",
    letterSpacing: -0.5,
    color:         D.navy,
    textAlign:     "center",
  },
  codeSentRow: {
    flexDirection:  "row",
    alignItems:     "center",
    flexWrap:       "wrap",
    justifyContent: "center",
  },
  codeSentText: {
    fontSize: 15,
    color:    D.textSecondary,
  },
  codeSentPhone: {
    fontSize:   15,
    fontWeight: "700",
    color:      D.navy,
  },
  cellsRow: {
    flexDirection:  "row",
    gap:            8,
    width:          "100%",
    justifyContent: "center",
    alignItems:     "center",
  },
  cellShell: {
    width:          CELL_W,
    height:         54,
    borderRadius:   14,
    alignItems:     "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize:   22,
    fontWeight: "700",
  },
  // ── PIN-login cells ───────────────────────────────────────────────────────
  pinCellsRow: {
    flexDirection:     "row",
    gap:               6,
    width:             "100%",
    paddingHorizontal: 8,
    justifyContent:    "center",
    alignItems:        "center",
    marginTop:         2,
  },
  pinCellShell: {
    flex:           1,
    aspectRatio:    1,
    maxWidth:       50,
    borderRadius:   14,
    alignItems:     "center",
    justifyContent: "center",
  },
  pinDot: {
    fontSize:   18,
    fontWeight: "700",
  },
  // ── Forgot / setup links ──────────────────────────────────────────────────
  forgotRow: {
    alignSelf:    "flex-end",
    marginTop:    0,
    marginRight:  24,
    marginBottom: 14,
    paddingVertical: 2,
  },
  forgotLink: {
    fontSize:   14,
    fontWeight: "600",
    color:      D.forgot,
  },
  setupRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   8,
  },
  setupText: {
    fontSize: 13,
    color:    D.textSecondary,
  },
  setupLink: {
    fontSize:   13,
    fontWeight: "700",
    color:      D.primary,
  },
  setupHint: {
    fontSize:     11,
    color:        D.textMuted,
    textAlign:    "center",
    marginBottom: 12,
  },
  hiddenInput: {
    position: "absolute",
    width:    1,
    height:   1,
    opacity:  0,
  },
  loadDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: D.white,
  },
  otpErrRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
    alignSelf:     "stretch",
    marginTop:     -4,
  },
  otpErrText: {
    fontSize:   13,
    fontWeight: "500",
    color:      D.error,
    flex:       1,
  },
  verifyBtn: {
    width:           "100%",
    height:          56,
    borderRadius:    16,
    backgroundColor: D.primary,
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    shadowColor:     D.primary,
    shadowOpacity:   0.30,
    shadowRadius:    10,
    shadowOffset:    { width: 0, height: 4 },
    elevation:       4,
  },
  verifyBtnDisabled: {
    backgroundColor: "#E5E7EB",
    borderWidth:     1,
    borderColor:     "#D1D5DB",
    shadowOpacity:   0,
    elevation:       0,
    opacity:         1,
  },
  verifyBtnText: {
    fontSize:      17,
    fontWeight:    "700",
    color:         D.white,
    letterSpacing: 0.2,
  },
  verifyBtnTextDisabled: {
    color:      "#6B7280",
    fontWeight: "600",
  },
  resendRow: {
    alignItems: "center",
    marginTop:  -4,
  },
  resendText: {
    fontSize: 14,
    color:    D.textMuted,
  },
  resendActiveText: {
    fontSize:   14,
    fontWeight: "700",
    color:      D.primary,
  },
  changeNumBtn: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    paddingVertical:   9,
    paddingHorizontal: 14,
    borderRadius:      12,
    backgroundColor:   D.white,
    borderWidth:       1,
    borderColor:       D.cardBorder,
    shadowColor:       "#000",
    shadowOpacity:     0.05,
    shadowRadius:      6,
    shadowOffset:      { width: 0, height: 2 },
    elevation:         2,
  },
  changeNumText: {
    fontSize:   14,
    fontWeight: "600",
    color:      D.navy,
  },
  backToPinBtn: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "center",
    gap:               6,
    marginTop:         16,
    paddingVertical:   9,
    paddingHorizontal: 14,
  },

});

