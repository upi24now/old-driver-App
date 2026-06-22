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
import {
  ActivityIndicator,
  Animated,
  Easing,
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

  const digits  = phone.replace(/\D/g, "");
  const isValid = digits.length === 10;

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
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 36 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── PHASE: PHONE ── */}
        {phase === "phone" && (
          <>
            {/* ── Brand hero ── */}
            <View style={ss.hero}>
              <View style={ss.logoCircle}>
                <Text style={ss.logoText}>BC</Text>
              </View>
              <Text style={ss.brandName}>
                <Text style={{ color: D.text }}>Bike</Text>
                <Text style={{ color: D.primary }}>Courier</Text>
              </Text>
              <Text style={ss.partnerLabel}>PARTNER</Text>
              <Text style={ss.headline}>Welcome Partner</Text>
              <Text style={ss.subline}>Start earning with BikeCourier</Text>
            </View>

            {/* ── Phone input card ── */}
            <View style={ss.loginCard}>
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

            {/* ── Trust note ── */}
            <View style={ss.trustRow}>
              <Feather name="shield" size={14} color={D.primary} />
              <Text style={ss.trustText}>
                Your number is used only for secure login and delivery updates.
              </Text>
            </View>

            {/* ── Continue button ── */}
            <TouchableOpacity
              style={[ss.continueBtn, !isValid && ss.continueBtnDisabled]}
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
            {/* Back to phone */}
            <TouchableOpacity
              style={ss.backBtn}
              onPress={() => {
                setOtp(""); setOtpErr(""); transitionTo("phone");
              }}
              activeOpacity={0.7}
            >
              <Feather name="arrow-left" size={18} color={D.navy} />
              <Text style={ss.backBtnText}>Change number</Text>
            </TouchableOpacity>

            {/* OTP Header */}
            <View style={ss.otpHeader}>
              <View style={ss.shieldWrap}>
                <Feather name="shield" size={22} color={D.amber} />
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
                          borderColor:     isActive ? D.amber       : isFilled ? D.navy + "60" : D.cardBorder,
                          borderWidth:     isActive ? 2             : 1,
                          backgroundColor: isActive ? D.primarySoft : D.white,
                          shadowColor:     isActive ? D.amber       : "#000",
                          shadowOpacity:   isActive ? 0.16          : 0.04,
                          shadowRadius:    isActive ? 10            : 4,
                          shadowOffset:    { width: 0, height: isActive ? 4 : 2 },
                          elevation:       isActive ? 4             : 1,
                        },
                      ]}
                    >
                      <Text style={[ss.cellText, { color: isActive ? D.amber : D.navy }]}>
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
              <View style={ss.errorRow}>
                <Feather name="alert-circle" size={13} color={D.error} />
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
                  { backgroundColor: otp.length === OTP_LENGTH ? D.amber : D.cardBorder },
                ]}
              >
                {verifying ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <VerifyingDots />
                    <Text style={[ss.verifyBtnText, { color: D.white }]}>Verifying…</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[ss.verifyBtnText, { color: otp.length === OTP_LENGTH ? D.white : D.textMuted }]}>
                      {otp.length === OTP_LENGTH ? "Verify" : `Enter code (${otp.length}/${OTP_LENGTH})`}
                    </Text>
                    {otp.length === OTP_LENGTH && (
                      <Feather name="arrow-right" size={18} color={D.white} />
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
                    <Text style={[ss.resendText, { color: D.amber, fontWeight: "700" }]}>Resend code</Text>
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={ss.resendText}>
                  Resend in <Text style={{ color: D.navy, fontWeight: "700" }}>{timer}s</Text>
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
    backgroundColor: D.bg,
  },
  scroll: {
    flexGrow:          1,
    alignItems:        "center",
    paddingHorizontal: 20,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:   "center",
    marginBottom: 24,
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
    flex:              1,
    fontSize:          16,
    fontWeight:        "500",
    color:             D.text,
    paddingVertical:   0,
    textAlignVertical: "center",
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
    marginBottom:      28,
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
    backgroundColor: D.border,
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
    color: D.textSecondary,
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
    paddingTop: 8,
    alignItems: "center",
    gap:        20,
  },
  backBtn: {
    alignSelf:         "flex-start",
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    paddingVertical:   8,
    paddingHorizontal: 12,
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
  backBtnText: {
    fontSize:   14,
    fontWeight: "600",
    color:      D.navy,
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
    backgroundColor: D.primarySoft,
    borderWidth:     1,
    borderColor:     D.amber + "60",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    4,
  },
  otpHeadline: {
    fontSize:      28,
    fontWeight:    "800",
    letterSpacing: -0.5,
    color:         D.navy,
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
    backgroundColor: D.white,
  },
  devHint: {
    fontSize: 12,
    color:    D.textMuted,
  },
  verifyWrap: {
    alignSelf: "stretch",
  },
  verifyBtn: {
    height:            58,
    borderRadius:      20,
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "center",
    paddingHorizontal: 20,
    width:             "100%",
    shadowColor:       D.amber,
    shadowOpacity:     0.30,
    shadowRadius:      14,
    shadowOffset:      { width: 0, height: 6 },
    elevation:         5,
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
    color:    D.textMuted,
  },
});
