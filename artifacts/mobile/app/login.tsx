/**
 * login.tsx — Screen 2: Mobile Number + OTP (combined, no navigation between them)
 *
 * Phase 1 — phone entry:  user types 10-digit number → "Send OTP"
 * Phase 2 — OTP entry:    6-digit cells appear inline → "Verify" → navigate
 *
 * After successful OTP verification the screen calls router.replace(nextRoute).
 * No push to /otp happens; /otp.tsx is a dead redirect stub.
 */

import { SafeInlineIcon, SafeIconName, PremiumButton3D } from "@/components/SafeIcon";
import { VehicleArt, VehicleArtType } from "@/components/VehicleArt";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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

import { useDriver } from "@/contexts/DriverContext";
import { sendOtp } from "@/utils/auth-api";

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const B = {
  bg:           "#FFF8F5",
  navy:         "#111827",
  orange:       "#F97316",
  amber:        "#F59E0B",
  indigo:       "#6366F1",
  textSecondary:"#6B7280",
  textMuted:    "#9CA3AF",
  placeholder:  "#C4B5B0",
  white:        "#FFFFFF",
  cardBorder:   "#F3E8E2",
  inputBorder:  "#E5D5CF",
  error:        "#DC2626",
  green:        "#10B981",
  primarySoft:  "#FFFBEB",
} as const;

const OTP_LENGTH    = 6;
const RESEND_SECONDS = 30;

// ─── Service cards ────────────────────────────────────────────────────────────
const BIKE_IMG       = require("@/assets/images/bike-delivery.png");
const AUTO_CARGO_IMG = require("@/assets/images/auto-cargo-delivery.png");
const TRUCK_IMG      = require("@/assets/images/truck-delivery.png");

const SERVICES: Array<{
  artType:    VehicleArtType;
  image?:     ReturnType<typeof require>;
  imgScale?:  number;
  title:      string;
  sub:        string;
  accent:     string;
}> = [
  { artType: "bike",      image: BIKE_IMG,       title: "2-Wheeler", sub: "Express", accent: B.orange },
  { artType: "autoCargo", image: AUTO_CARGO_IMG,  imgScale: 1.45, title: "3W Loader", sub: "Economy", accent: B.amber },
  { artType: "truck",     image: TRUCK_IMG,        title: "4W Loader", sub: "Cargo",   accent: B.indigo },
];

const CHIPS: Array<{ icon: SafeIconName; label: string; color: string; bg: string }> = [
  { icon: "lock",  label: "Secure OTP",    color: "#059669", bg: "#ECFDF5" },
  { icon: "star",  label: "Instant Signup", color: "#D97706", bg: "#FFFBEB" },
  { icon: "bell",  label: "No Spam",        color: "#DC2626", bg: "#FFF1F2" },
];

// ─── ServiceCard ──────────────────────────────────────────────────────────────
function ServiceCard({ artType, image, imgScale, title, sub, accent }: typeof SERVICES[number]) {
  return (
    <View style={ss.serviceCard}>
      <View style={[ss.accentDot, { backgroundColor: accent }]} />
      {image
        ? <Image
            source={image}
            style={[ss.serviceImg, imgScale ? { transform: [{ scale: imgScale }] } : undefined]}
            resizeMode="contain"
          />
        : <VehicleArt type={artType} size={62} />
      }
      <Text style={ss.serviceTitle} numberOfLines={1}>{title}</Text>
      <Text style={ss.serviceSub}   numberOfLines={1}>{sub}</Text>
      <View style={[ss.accentLine, { backgroundColor: accent }]} />
    </View>
  );
}

// ─── TrustChip ────────────────────────────────────────────────────────────────
function TrustChip({ icon, label, color, bg }: typeof CHIPS[number]) {
  return (
    <View style={[ss.chip, { backgroundColor: bg, borderColor: `${color}40` }]}>
      <SafeInlineIcon name={icon} size={11} color={color} />
      <Text style={[ss.chipText, { color }]}>{label}</Text>
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

  const { setPhone: setDriverPhone, driverUid, authLoading, isOtpVerified, confirmOtp } = useDriver();

  // Phase state
  const [phase,    setPhase]    = useState<"phone" | "otp">("phone");
  const slideAnim              = useRef(new Animated.Value(0)).current;

  // Phone phase
  const [phone,    setPhone]    = useState("");
  const [focused,  setFocused]  = useState(false);
  const [sending,  setSending]  = useState(false);
  const [sendErr,  setSendErr]  = useState("");
  const [devOtp,   setDevOtp]   = useState("");

  // OTP phase
  const [otp,       setOtp]      = useState("");
  const [verifying, setVerifying] = useState(false);
  const [otpErr,    setOtpErr]   = useState("");
  const [timer,     setTimer]    = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);

  const digits    = phone.replace(/\D/g, "");
  const isValid   = digits.length === 10;
  const charCount = digits.length;

  const otpDigits = otp.split("").concat(Array(OTP_LENGTH - otp.length).fill(""));

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
  function transitionTo(newPhase: "phone" | "otp") {
    Animated.timing(slideAnim, {
      toValue:        newPhase === "otp" ? 1 : 0,
      duration:       280,
      useNativeDriver: true,
      easing:          Easing.out(Easing.cubic),
    }).start(() => setPhase(newPhase));
    setPhase(newPhase);
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
    setDevOtp(result.devOtp ?? "");
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
    setDevOtp("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);

    const result = await sendOtp(digits);
    if (result.ok && result.devOtp) setDevOtp(result.devOtp);
    setTimeout(() => otpRef.current?.focus(), 100);
  }

  // ── Verify OTP ────────────────────────────────────────────────────────────
  async function handleVerify(code: string) {
    if (verifying || code.length !== OTP_LENGTH || !digits) return;
    setVerifying(true);
    setOtpErr("");

    const result = await confirmOtp(digits, code);

    if (!result.ok) {
      setVerifying(false);
      setOtp("");
      setOtpErr(result.error ?? "Verification failed. Try again.");
      setTimeout(() => otpRef.current?.focus(), 100);
      return;
    }

    const nextRoute = result.nextRoute ?? (result.profileComplete ? "/(tabs)" : "/registration");
    console.log("[LOGIN_OTP_SUCCESS] nextRoute =", nextRoute);
    router.replace(nextRoute as never);
  }

  console.log("[SCREEN_MOUNT] login — authLoading =", authLoading, "driverUid =", driverUid);

  if (authLoading || isOtpVerified) {
    return (
      <View style={[ss.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={B.amber} />
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
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 36 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── 1. Brand Hero (always visible) ── */}
        <View style={ss.hero}>
          <LinearGradient
            colors={[B.amber, B.orange]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ss.logoCircle}
          >
            <Text style={ss.logoText}>BC</Text>
          </LinearGradient>
          <View style={ss.titleRow}>
            <Text style={ss.titleBike}>Bike</Text>
            <Text style={ss.titleCourier}>Courier</Text>
          </View>
          <Text style={ss.subtitle}>FAST · RELIABLE · SECURE</Text>
        </View>

        {/* ── PHASE: PHONE ── */}
        {phase === "phone" && (
          <>
            {/* Service Cards */}
            <View style={ss.serviceRow}>
              {SERVICES.map((s) => <ServiceCard key={s.title} {...s} />)}
            </View>

            {/* Phone Input Card */}
            <View style={ss.loginCard}>
              <View style={ss.cardHeaderRow}>
                <View style={ss.headerDot} />
                <Text style={ss.cardHeaderText}>MOBILE NUMBER</Text>
              </View>

              <Pressable
                onPress={() => phoneRef.current?.focus()}
                style={[ss.inputRow, focused && ss.inputRowFocused]}
              >
                <Text style={ss.countryFlag}>IN</Text>
                <Text style={ss.countryCode}>+91</Text>
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
                  placeholder="Mobile Number"
                  placeholderTextColor={B.placeholder}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  returnKeyType="done"
                  onSubmitEditing={() => void handleSendOtp()}
                  underlineColorAndroid="transparent"
                  selectionColor={B.amber}
                  {...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {})}
                />
              </Pressable>

              {/* Progress bar */}
              <View style={ss.progressTrack}>
                <View
                  style={[
                    ss.progressFill,
                    {
                      width:           `${(charCount / 10) * 100}%` as `${number}%`,
                      backgroundColor: charCount === 10 ? B.green : B.amber,
                    },
                  ]}
                />
              </View>

              <View style={ss.counterRow}>
                <Text style={ss.helperText}>
                  {charCount === 10
                    ? "Ready to continue!"
                    : focused || charCount > 0
                      ? "Enter your 10-digit mobile number"
                      : "Tap to enter your 10-digit number"}
                </Text>
                <Text style={[ss.counter, charCount === 10 && { color: B.green }]}>
                  {charCount}/10
                </Text>
              </View>

              {!!sendErr && <Text style={ss.errorText}>{sendErr}</Text>}
            </View>

            {/* Send OTP Button */}
            <PremiumButton3D
              title="CONTINUE WITH OTP"
              loading={sending}
              disabled={!isValid || sending}
              onPress={() => void handleSendOtp()}
              bg={B.amber}
              bgDark="#B45309"
              rightIcon={undefined}
              style={ss.ctaWrap}
            />

            {/* Trust Chips */}
            <View style={ss.chipsRow}>
              {CHIPS.map((c) => <TrustChip key={c.label} {...c} />)}
            </View>

            {/* Terms */}
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
              <Text style={ss.termsNote}>
                New or existing user? Verify your mobile number with OTP.
              </Text>
            </View>
          </>
        )}

        {/* ── PHASE: OTP ── */}
        {phase === "otp" && (
          <View style={ss.otpPhase}>
            {/* Back to phone */}
            <TouchableOpacity
              style={ss.backBtn}
              onPress={() => {
                setOtp(""); setOtpErr(""); transitionTo("phone");
              }}
              activeOpacity={0.7}
            >
              <Feather name="arrow-left" size={18} color={B.navy} />
              <Text style={ss.backBtnText}>Change number</Text>
            </TouchableOpacity>

            {/* OTP Header */}
            <View style={ss.otpHeader}>
              <View style={ss.shieldWrap}>
                <Feather name="shield" size={22} color={B.amber} />
              </View>
              <Text style={ss.otpHeadline}>Verify your number</Text>
              <View style={ss.codeSentRow}>
                <Text style={ss.codeSentText}>Code sent to </Text>
                <Text style={ss.codeSentPhone}>{formattedPhone}</Text>
              </View>
            </View>

            {/* OTP Cells */}
            <Pressable onPress={() => otpRef.current?.focus()} style={ss.cellsRow}>
              {otpDigits.map((d, i) => {
                const isFilled = i < otp.length;
                const isActive = i === otp.length && !verifying;
                return (
                  <CellPop key={i} trigger={isFilled}>
                    <View
                      style={[
                        ss.cellShell,
                        {
                          borderColor:     isActive ? B.amber     : isFilled ? B.navy + "60" : B.cardBorder,
                          borderWidth:     isActive ? 2           : 1,
                          backgroundColor: isActive ? B.primarySoft : B.white,
                          shadowColor:     isActive ? B.amber     : "#000",
                          shadowOpacity:   isActive ? 0.16        : 0.04,
                          shadowRadius:    isActive ? 10          : 4,
                          shadowOffset:    { width: 0, height: isActive ? 4 : 2 },
                          elevation:       isActive ? 4           : 1,
                        },
                      ]}
                    >
                      <Text style={[ss.cellText, { color: isActive ? B.amber : B.navy }]}>
                        {isFilled ? d : ""}
                      </Text>
                    </View>
                  </CellPop>
                );
              })}
            </Pressable>

            {/* Hidden input */}
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

            {/* Error */}
            {!!otpErr && (
              <View style={ss.errorRow}>
                <Feather name="alert-circle" size={13} color={B.error} />
                <Text style={[ss.errorText, { marginTop: 0 }]}>{otpErr}</Text>
              </View>
            )}

            {/* Dev hint */}
            {!!devOtp && (
              <Text style={ss.devHint}>Dev — code: {devOtp}</Text>
            )}

            {/* Verify button */}
            <View style={ss.verifyWrap}>
              <Pressable
                onPress={() => void handleVerify(otp)}
                disabled={otp.length < OTP_LENGTH || verifying}
                style={[
                  ss.verifyBtn,
                  {
                    backgroundColor:
                      otp.length === OTP_LENGTH ? B.amber : B.cardBorder,
                  },
                ]}
              >
                {verifying ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <VerifyingDots />
                    <Text style={[ss.verifyBtnText, { color: B.white }]}>Verifying…</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      style={[
                        ss.verifyBtnText,
                        { color: otp.length === OTP_LENGTH ? B.white : B.textMuted },
                      ]}
                    >
                      {otp.length === OTP_LENGTH ? "Verify" : `Enter code (${otp.length}/${OTP_LENGTH})`}
                    </Text>
                    {otp.length === OTP_LENGTH && (
                      <Feather name="arrow-right" size={18} color={B.white} />
                    )}
                  </View>
                )}
              </Pressable>
            </View>

            {/* Resend */}
            <View style={ss.resendRow}>
              {canResend ? (
                <TouchableOpacity onPress={() => void handleResend()} activeOpacity={0.6}>
                  <Text style={ss.resendText}>
                    Didn't receive it?{" "}
                    <Text style={[ss.resendText, { color: B.amber, fontWeight: "700" }]}>Resend code</Text>
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={ss.resendText}>
                  Resend in <Text style={{ color: B.navy, fontWeight: "700" }}>{timer}s</Text>
                </Text>
              )}
            </View>
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
    backgroundColor: B.bg,
  },
  scroll: {
    flexGrow:  1,
    alignItems:"center",
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:    "center",
    paddingBottom: 24,
    width:         "100%",
  },
  logoCircle: {
    width:          64,
    height:         64,
    borderRadius:   32,
    alignItems:     "center",
    justifyContent: "center",
    shadowColor:    B.amber,
    shadowOpacity:  0.40,
    shadowRadius:   16,
    shadowOffset:   { width: 0, height: 5 },
    elevation:      8,
  },
  logoText: {
    fontSize:      24,
    fontWeight:    "800",
    color:         B.white,
    letterSpacing: -0.5,
  },
  titleRow: {
    flexDirection: "row",
    alignItems:    "baseline",
    marginTop:     12,
    gap:           3,
  },
  titleBike: {
    fontSize:      32,
    fontWeight:    "800",
    color:         B.navy,
    letterSpacing: -1,
  },
  titleCourier: {
    fontSize:      32,
    fontWeight:    "800",
    color:         B.amber,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize:      11,
    fontWeight:    "600",
    color:         B.textMuted,
    letterSpacing: 3,
    marginTop:     7,
    textTransform: "uppercase",
  },

  // ── Service Cards ─────────────────────────────────────────────────────────
  serviceRow: {
    flexDirection:     "row",
    paddingHorizontal: 20,
    gap:               10,
    width:             "100%",
    marginBottom:      20,
  },
  serviceCard: {
    flex:              1,
    backgroundColor:   B.white,
    borderRadius:      22,
    paddingVertical:   16,
    paddingHorizontal: 8,
    alignItems:        "center",
    shadowColor:       "#000",
    shadowOpacity:     0.07,
    shadowRadius:      10,
    shadowOffset:      { width: 0, height: 4 },
    elevation:         3,
    overflow:          "visible",
  },
  accentDot: {
    position:     "absolute",
    top:          10,
    right:        10,
    width:        7,
    height:       7,
    borderRadius: 4,
  },
  serviceImg: {
    width:        72,
    height:       62,
    marginBottom: 2,
  },
  serviceTitle: {
    fontSize:   11,
    fontWeight: "700",
    color:      B.navy,
    textAlign:  "center",
    marginTop:  2,
  },
  serviceSub: {
    fontSize:  10,
    color:     B.textMuted,
    marginTop: 2,
    textAlign: "center",
  },
  accentLine: {
    width:        22,
    height:       3,
    borderRadius: 2,
    marginTop:    10,
  },

  // ── Login Card ────────────────────────────────────────────────────────────
  loginCard: {
    alignSelf:         "stretch",
    marginHorizontal:  20,
    paddingHorizontal: 20,
    paddingVertical:   20,
    backgroundColor:   B.white,
    borderRadius:      24,
    borderWidth:       1,
    borderColor:       B.cardBorder,
    shadowColor:       B.amber,
    shadowOpacity:     0.08,
    shadowRadius:      20,
    shadowOffset:      { width: 0, height: 6 },
    elevation:         5,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
    marginBottom:  16,
  },
  headerDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: B.amber,
  },
  cardHeaderText: {
    fontSize:      11,
    fontWeight:    "700",
    color:         B.textMuted,
    letterSpacing: 1.8,
  },
  inputRow: {
    flexDirection:     "row",
    alignItems:        "center",
    borderWidth:       1.5,
    borderColor:       B.inputBorder,
    borderRadius:      14,
    height:            56,
    paddingHorizontal: 14,
    backgroundColor:   B.bg,
  },
  inputRowFocused: {
    borderColor:     B.amber,
    backgroundColor: B.primarySoft,
  },
  countryFlag: {
    fontSize:      12,
    fontWeight:    "700",
    color:         B.textSecondary,
    marginRight:   4,
    letterSpacing: 0.5,
  },
  countryCode: {
    fontSize:      16,
    fontWeight:    "700",
    color:         B.navy,
    marginRight:   10,
    letterSpacing: 0.2,
  },
  inputDivider: {
    width:           1.5,
    height:          22,
    backgroundColor: B.inputBorder,
    marginRight:     12,
  },
  phoneInput: {
    flex:       1,
    fontSize:   17,
    fontWeight: "600",
    color:      B.navy,
    height:     "100%",
    ...Platform.select({
      web:     { outlineWidth: 0, outlineStyle: "none" } as object,
      default: {},
    }),
  },
  progressTrack: {
    height:          3,
    backgroundColor: "#F3F4F6",
    borderRadius:    2,
    marginTop:       10,
    overflow:        "hidden",
  },
  progressFill: {
    height:       3,
    borderRadius: 2,
  },
  counterRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginTop:      6,
  },
  helperText: {
    fontSize: 11,
    color:    B.textMuted,
    flex:     1,
  },
  counter: {
    fontSize:   12,
    fontWeight: "600",
    color:      B.textMuted,
    marginLeft: 8,
  },
  errorText: {
    fontSize:   13,
    fontWeight: "500",
    color:      B.error,
    marginTop:  10,
  },

  // ── CTA Button wrap ───────────────────────────────────────────────────────
  ctaWrap: {
    alignSelf:        "stretch",
    marginHorizontal: 20,
    marginTop:        16,
    borderRadius:     22,
  },

  // ── Trust Chips ───────────────────────────────────────────────────────────
  chipsRow: {
    flexDirection:     "row",
    justifyContent:    "center",
    flexWrap:          "wrap",
    gap:               8,
    marginTop:         18,
    paddingHorizontal: 20,
  },
  chip: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      20,
    borderWidth:       1,
  },
  chipText: {
    fontSize:   12,
    fontWeight: "600",
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  termsBlock: {
    marginTop:         20,
    paddingHorizontal: 20,
    alignItems:        "center",
    width:             "100%",
  },
  termsRow: {
    flexDirection: "row",
    flexWrap:      "wrap",
    alignItems:    "center",
    justifyContent:"center",
    gap:           1,
  },
  termsText: {
    fontSize: 12,
    color:    B.textSecondary,
  },
  termsLink: {
    fontSize:   12,
    fontWeight: "700",
    color:      B.amber,
  },
  termsNote: {
    fontSize:  11,
    color:     B.textMuted,
    marginTop: 8,
    textAlign: "center",
  },

  // ── OTP Phase ─────────────────────────────────────────────────────────────
  otpPhase: {
    alignSelf:         "stretch",
    paddingHorizontal: 24,
    paddingTop:        8,
    alignItems:        "center",
    gap:               20,
  },

  backBtn: {
    alignSelf:     "flex-start",
    flexDirection: "row",
    alignItems:    "center",
    gap:           6,
    paddingVertical:   8,
    paddingHorizontal: 12,
    borderRadius:  12,
    backgroundColor: B.white,
    borderWidth:    1,
    borderColor:    B.cardBorder,
    shadowColor:    "#000",
    shadowOpacity:  0.05,
    shadowRadius:   6,
    shadowOffset:   { width: 0, height: 2 },
    elevation:      2,
  },
  backBtnText: {
    fontSize:   14,
    fontWeight: "600",
    color:      B.navy,
  },

  otpHeader: {
    alignItems: "center",
    gap:        8,
    width:      "100%",
  },
  shieldWrap: {
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: B.primarySoft,
    borderWidth:     1,
    borderColor:     B.amber + "60",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    4,
  },
  otpHeadline: {
    fontSize:      28,
    fontWeight:    "800",
    letterSpacing: -0.5,
    color:         B.navy,
  },
  codeSentRow: {
    flexDirection: "row",
    alignItems:    "center",
    flexWrap:      "wrap",
    justifyContent:"center",
  },
  codeSentText: {
    fontSize: 15,
    color:    B.textSecondary,
  },
  codeSentPhone: {
    fontSize:   15,
    fontWeight: "700",
    color:      B.navy,
  },

  cellsRow: {
    flexDirection: "row",
    gap:           10,
    alignItems:    "center",
    marginTop:     8,
  },
  cellShell: {
    width:          50,
    height:         62,
    borderRadius:   17,
    alignItems:     "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize:   24,
    fontWeight: "700",
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
    backgroundColor: B.white,
  },

  errorRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
    alignSelf:     "stretch",
  },

  devHint: {
    fontSize: 12,
    color:    B.textMuted,
  },

  verifyWrap: {
    alignSelf: "stretch",
  },
  verifyBtn: {
    height:         58,
    borderRadius:   20,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    width:          "100%",
    shadowColor:    B.amber,
    shadowOpacity:  0.30,
    shadowRadius:   14,
    shadowOffset:   { width: 0, height: 6 },
    elevation:      5,
  },
  verifyBtnText: {
    fontSize:   18,
    fontWeight: "700",
  },

  resendRow: {
    alignItems: "center",
    marginTop:  4,
  },
  resendText: {
    fontSize: 14,
    color:    B.textMuted,
  },
});
