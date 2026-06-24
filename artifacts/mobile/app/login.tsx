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
import Svg, { Ellipse, Line, Rect } from "react-native-svg";
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

import { useDriver } from "@/contexts/DriverContext";
import { sendOtp } from "@/utils/auth-api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:            "#F8FAFC",
  primary:       "#FF6B00",
  primarySoft:   "#FFF3EC",
  text:          "#111827",
  textSecondary: "#6B7280",
  textMuted:     "#9CA3AF",
  border:        "#E5E7EB",
  inputBg:       "#F9FAFB",
  white:         "#FFFFFF",
  success:       "#16A34A",
  error:         "#DC2626",
  placeholder:   "#9CA3AF",
  // Aliases used by OTP phase
  navy:          "#111827",
  amber:         "#FF6B00",
  cardBorder:    "#E5E7EB",
} as const;

const OTP_LENGTH     = 6;
const RESEND_SECONDS = 30;

// ─── Responsive layout config ─────────────────────────────────────────────────
const WIN_H  = Dimensions.get("window").height;
const small  = WIN_H < 700;
const medium = WIN_H >= 700 && WIN_H < 850;

const r = {
  topPad:       small ? 12  : medium ? 18  : 24,
  botPad:       small ? 12  : medium ? 16  : 22,
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

  // Debug panel — shown after OTP verify, before routing
  const [debugData, setDebugData] = useState<{ lines: string[]; route: string } | null>(null);

  const digits  = phone.replace(/\D/g, "");
  const isValid = digits.length === 10;

  const otpDigits = otp.split("").concat(Array(OTP_LENGTH - otp.length).fill(""));

  // ── Runtime diagnostic — baked at Metro build time ────────────────────────
  const _diagDomain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "(not set)";
  const _diagUrl    = _diagDomain && _diagDomain !== "(not set)"
    ? `https://${_diagDomain}/api`
    : "/api";
  const [diagHealthz, setDiagHealthz] = useState<string>("…");
  useEffect(() => {
    const url = `${_diagUrl}/healthz`;
    fetch(url, { method: "GET" })
      .then((r) => r.json())
      .then((j: unknown) => setDiagHealthz(`${(j as { status?: string }).status ?? "?"} (${url})`))
      .catch((e: unknown) => setDiagHealthz(`ERR: ${(e as Error).message} (${url})`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toValue:         newPhase === "otp" ? 1 : 0,
      duration:        280,
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

    setVerifying(false);

    if (!result.ok) {
      setOtp("");
      setOtpErr(result.error ?? "Verification failed. Try again.");
      setTimeout(() => otpRef.current?.focus(), 100);
      return;
    }

    const nextRoute = result.nextRoute ?? (result.profileComplete ? "/(tabs)" : "/registration");
    console.log("[LOGIN_OTP_SUCCESS] nextRoute =", nextRoute);

    // ── Build debug lines including reason ────────────────────────────────
    const lines: string[] = [...(result.debugLog ?? [])];
    if (nextRoute === "/registration") {
      const srv = result.debugLog?.find((l) => l.startsWith("9."))?.split(": ")[1] ?? "?";
      lines.push(`12. REASON: server said "${srv}" → mapServerNextRoute collapsed to /registration`);
    } else {
      lines.push(`12. REASON: routing to ${nextRoute} (no collapse)`);
    }
    setDebugData({ lines, route: nextRoute });
    router.replace(nextRoute as never);
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
        scrollEnabled={r.scrollable}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
      >

        {/* ── PHASE: PHONE ── */}
        {phase === "phone" && (
          <>
            {/* ── Brand hero ── */}
            <View style={[ss.hero, { marginBottom: r.heroMb }]}>
              <View style={[ss.logoCircle, { width: r.logoSize, height: r.logoSize, borderRadius: r.logoBorderR, marginBottom: r.logoMb }]}>
                <Text style={[ss.logoText, { fontSize: r.logoFontSize }]}>BC</Text>
              </View>
              <Text style={[ss.brandName, { fontSize: r.brandSize }]}>
                <Text style={{ color: D.text }}>Bike</Text>
                <Text style={{ color: D.primary }}>Courier</Text>
              </Text>
              <Text style={[ss.partnerLabel, { marginBottom: r.partnerMb }]}>PARTNER</Text>
              <Text style={[ss.headline, { fontSize: r.headlineSize }]}>Welcome Partner</Text>
              {r.showSubline && (
                <Text style={ss.subline}>Start earning with BikeCourier</Text>
              )}
            </View>

            {/* ── Delivery illustration ── */}
            <HeroIllustration
              h={r.illustH}
              scooterW={r.scooterW}
              scooterH={r.scooterH}
              mt={r.illustMt}
              mb={r.illustMb}
            />

            {/* ── Phone input card ── */}
            <View style={[ss.loginCard, { marginBottom: r.cardMb }]}>
              <Text style={ss.cardLabel}>Mobile Number</Text>

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

            {/* ── Runtime diagnostic banner (shows baked-in domain + healthz) ── */}
            <View style={{ backgroundColor: "#1a1a2e", borderRadius: 6, padding: 8, marginBottom: 8 }}>
              <Text style={{ color: "#aaa", fontSize: 9, fontFamily: "monospace" }}>
                {"DOMAIN=" + _diagDomain}
              </Text>
              <Text style={{ color: "#aaa", fontSize: 9, fontFamily: "monospace" }}>
                {"HEALTHZ=" + diagHealthz}
              </Text>
            </View>

            {/* ── Trust note ── */}
            <View style={[ss.trustRow, { marginBottom: r.trustMb }]}>
              <Feather name="shield" size={14} color={D.primary} />
              <Text style={ss.trustText}>
                Your number is used only for secure login and delivery updates.
              </Text>
            </View>

            {/* ── Continue button ── */}
            <TouchableOpacity
              style={[ss.continueBtn, !isValid && ss.continueBtnDisabled, { marginBottom: r.btnMb }]}
              onPress={() => void handleSendOtp()}
              activeOpacity={0.85}
              disabled={!isValid || sending}
            >
              {sending ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator size="small" color={D.white} />
                  <Text style={ss.continueBtnText}>Sending OTP...</Text>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[ss.continueBtnText, !isValid && ss.continueBtnTextDisabled]}>
                    Continue
                  </Text>
                  {isValid && (
                    <Feather name="arrow-right" size={18} color={D.white} />
                  )}
                </View>
              )}
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
              <Text style={ss.termsNote}>
                New or existing user? Verify your mobile number with OTP.
              </Text>
            </View>
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

            {/* Dev hint */}
            {!!devOtp && (
              <Text style={ss.devHint}>Dev — code: {devOtp}</Text>
            )}

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

      {/* ── DEBUG PANEL — shown after OTP verify, blocks routing until "Proceed" ── */}
      {!!debugData && (
        <View style={dbg.overlay}>
          <View style={dbg.card}>
            <Text style={dbg.title}>🔍 OTP Debug Panel</Text>
            <Text style={dbg.subtitle}>Read carefully before tapping Proceed</Text>
            <ScrollView style={dbg.scroll} showsVerticalScrollIndicator>
              {debugData.lines.map((line, i) => {
                const isRoute  = line.startsWith("10.") || line.startsWith("11.") || line.startsWith("12.");
                const isReason = line.startsWith("12.");
                return (
                  <Text
                    key={i}
                    style={[dbg.line, isReason && dbg.lineReason, isRoute && dbg.lineRoute]}
                  >
                    {line}
                  </Text>
                );
              })}
              <Text style={dbg.lineRoute}>→ will navigate to: {debugData.route}</Text>
            </ScrollView>
            <TouchableOpacity
              style={dbg.proceedBtn}
              onPress={() => {
                const route = debugData.route;
                setDebugData(null);
                router.replace(route as never);
              }}
              activeOpacity={0.85}
            >
              <Text style={dbg.proceedText}>Proceed to App →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    flex:              1,
    alignItems:        "center",
    paddingHorizontal: 20,
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
    borderWidth:       1.5,
    borderColor:       D.border,
    borderRadius:      12,
    height:            56,
    paddingHorizontal: 12,
    backgroundColor:   D.inputBg,
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
    fontWeight: "700",
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
  devHint: {
    fontSize:  12,
    color:     D.textMuted,
    marginTop: -4,
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

});

// ─── Debug panel styles ────────────────────────────────────────────────────────
const dbg = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems:      "center",
    justifyContent:  "center",
    zIndex:          9999,
    padding:         16,
  },
  card: {
    backgroundColor: "#0d1117",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#30363d",
    width:           "100%",
    maxHeight:       "85%",
    padding:         14,
    gap:             10,
  },
  title: {
    color:      "#e6edf3",
    fontSize:   16,
    fontWeight: "700",
  },
  subtitle: {
    color:     "#8b949e",
    fontSize:  11,
    marginTop: -6,
  },
  scroll: {
    maxHeight: 400,
  },
  line: {
    color:         "#c9d1d9",
    fontSize:      10,
    fontFamily:    "monospace",
    marginBottom:  4,
    lineHeight:    16,
  },
  lineRoute: {
    color:      "#58a6ff",
    fontWeight: "600",
  },
  lineReason: {
    color:         "#f85149",
    fontWeight:    "700",
    backgroundColor: "#1c0a0a",
    padding:       4,
    borderRadius:  4,
    marginVertical: 4,
  },
  proceedBtn: {
    backgroundColor: "#238636",
    borderRadius:    8,
    height:          44,
    alignItems:      "center",
    justifyContent:  "center",
    marginTop:       6,
  },
  proceedText: {
    color:      "#ffffff",
    fontSize:   15,
    fontWeight: "700",
  },
});
