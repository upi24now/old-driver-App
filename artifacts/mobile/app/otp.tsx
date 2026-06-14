import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { sendOtp } from "@/utils/auth-api";
import { TS } from "@/constants/typography";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

// ─── Subtle pop on digit entry ────────────────────────────────────────────────
function CellPop({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(trigger);

  useEffect(() => {
    if (trigger && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.06,
          useNativeDriver: true,
          speed: 50,
          bounciness: 8,
        }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 40,
          bounciness: 5,
        }),
      ]).start();
    }
    prev.current = trigger;
  }, [trigger]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Animated loading dots ────────────────────────────────────────────────────
function VerifyingDots() {
  const v1 = useRef(new Animated.Value(0.3)).current;
  const v2 = useRef(new Animated.Value(0.3)).current;
  const v3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: 1,
            duration: 380,
            delay,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(val, {
            toValue: 0.3,
            duration: 380,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ]),
      );
    const a = make(v1, 0);
    const b = make(v2, 130);
    const c = make(v3, 260);
    a.start();
    b.start();
    c.start();
    return () => { a.stop(); b.stop(); c.stop(); };
  }, []);

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.loadDot, { opacity: v1 }]} />
      <Animated.View style={[styles.loadDot, { opacity: v2 }]} />
      <Animated.View style={[styles.loadDot, { opacity: v3 }]} />
    </View>
  );
}

// ─── Verify button ─────────────────────────────────────────────────────────────
function VerifyButton({
  state,
  digitCount,
  onPress,
}: {
  state: "idle" | "ready" | "verifying";
  digitCount: number;
  onPress: () => void;
}) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const isActive = state === "ready" || state === "verifying";

  const press = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  return (
    <Animated.View
      style={[
        styles.ctaWrap,
        {
          transform:     [{ scale }],
          shadowColor:   isActive ? colors.primary : "transparent",
          shadowOpacity: isActive ? 0.28 : 0,
          elevation:     isActive ? 6    : 0,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => isActive && press(0.97)}
        onPressOut={() => press(1)}
        disabled={!isActive}
        style={styles.ctaPressable}
      >
        <View
          style={[
            styles.ctaButton,
            { backgroundColor: isActive ? colors.primary : colors.muted },
          ]}
        >
          {isActive ? (
            state === "verifying" ? (
              <>
                <VerifyingDots />
                <Text style={styles.ctaText}>Verifying</Text>
                <View style={{ width: 28 }} />
              </>
            ) : (
              <>
                <View style={{ width: 28 }} />
                <Text style={styles.ctaText}>Verify</Text>
                <Feather name="arrow-right" size={18} color="#fff" />
              </>
            )
          ) : (
            <>
              <View style={{ width: 28 }} />
              <Text style={[styles.ctaText, { color: colors.mutedForeground }]}>
                Enter code ({digitCount}/{OTP_LENGTH})
              </Text>
              <View style={{ width: 28 }} />
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function OtpScreen() {
  const colors = useColors();
  const { confirmOtp } = useDriver();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();

  const [otp, setOtp] = useState("");
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [currentDevOtp, setCurrentDevOtp] = useState(devOtp ?? "");
  const inputRef = useRef<TextInput>(null);

  const formattedPhone = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "+91 12345 67890";

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (timer === 0) { setCanResend(true); return; }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  async function handleVerify(code: string) {
    if (verifying || code.length !== OTP_LENGTH || !phone) return;
    setVerifying(true);
    setError("");

    const result = await confirmOtp(phone, code);

    if (!result.ok) {
      setVerifying(false);
      setOtp("");
      setError(result.error ?? "Verification failed.");
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    const nextRoute = result.nextRoute ?? (result.profileComplete ? "/(tabs)" : "/vehicle-selection");

    console.log("[OTP_SUCCESS_ROUTE] nextRoute =", nextRoute, "| profileComplete =", result.profileComplete, "| raw nextRoute =", result.nextRoute);

    // ── Auth-stack reset ──────────────────────────────────────────────────────
    // login.tsx uses router.push("/otp"), so the stack at this point is:
    //   [/login, /otp]
    //
    // router.replace(nextRoute) alone would produce [/login, nextRoute], keeping
    // /login in history — Back from the dashboard would resurface the login screen.
    //
    // Fix: two synchronous calls dispatched in the same event-loop tick.
    //   router.back()            → state: [/login]        (/otp popped)
    //   router.replace(nextRoute) → state: [nextRoute]    (/login replaced)
    //
    // React 19 automatic batching coalesces both updates into one frame, so no
    // intermediate render of /login occurs; the UI transitions directly from
    // /otp to the destination.
    console.log("[AUTH_STACK_CLEAR] popping /otp and replacing /login — final stack will be [", nextRoute, "]");
    router.back();
    console.log("[ROUTE_DECISION_AFTER_OTP] router.replace →", nextRoute);
    router.replace(nextRoute as never);
  }

  async function handleResend() {
    if (!canResend || !phone) return;
    setOtp("");
    setError("");
    setCurrentDevOtp("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);

    const result = await sendOtp(phone);
    if (result.ok && result.devOtp) {
      setCurrentDevOtp(result.devOtp);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const digits = otp
    .split("")
    .concat(Array(OTP_LENGTH - otp.length).fill(""));

  const btnState = verifying ? "verifying" : otp.length === OTP_LENGTH ? "ready" : "idle";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.headerSection}>
          {/* Shield icon tile */}
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            ]}
          >
            <Feather name="shield" size={22} color={colors.primary} />
          </View>

          <Text style={[styles.headline, { color: colors.foreground }]}>
            Verify your number
          </Text>
          <View style={styles.codeSentRow}>
            <Text style={[styles.codeSentText, { color: colors.mutedForeground }]}>
              Code sent to{" "}
            </Text>
            <Text style={[styles.codeSentPhone, { color: colors.foreground }]}>
              {formattedPhone}
            </Text>
          </View>
        </View>

        {/* ── OTP cells ── */}
        <View style={styles.otpSection}>
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={styles.cellsRow}
          >
            {digits.map((d, i) => {
              const isFilled = i < otp.length;
              const isActive = i === otp.length && !verifying;

              return (
                <CellPop key={i} trigger={isFilled}>
                  <View
                    style={[
                      styles.cellShell,
                      {
                        borderColor:     isActive  ? colors.primary      : isFilled ? colors.borderStrong : colors.border,
                        borderWidth:     isActive  ? 2                   : 1,
                        backgroundColor: isActive  ? colors.primarySoft  : colors.surfaceElevated,
                        shadowColor:     isActive  ? colors.primary      : "#000",
                        shadowOpacity:   isActive  ? 0.14                : 0.04,
                        shadowRadius:    isActive  ? 10                  : 4,
                        shadowOffset:    { width: 0, height: isActive ? 4 : 2 },
                        elevation:       isActive  ? 4                   : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        { color: isActive ? colors.primary : colors.foreground },
                      ]}
                    >
                      {isFilled ? d : ""}
                    </Text>
                  </View>
                </CellPop>
              );
            })}
          </Pressable>

          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(t) => {
              if (verifying) return;
              setError("");
              setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
            }}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            style={styles.hiddenInput}
            caretHidden
            selectionColor="transparent"
            underlineColorAndroid="transparent"
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            autoCorrect={false}
          />

          {!!error && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          {!!currentDevOtp && (
            <Text style={[styles.devHint, { color: colors.mutedForeground }]}>
              Dev — code: {currentDevOtp}
            </Text>
          )}
        </View>

        <View style={styles.ctaSection}>
          <VerifyButton
            state={btnState}
            digitCount={otp.length}
            onPress={() => void handleVerify(otp)}
          />
        </View>

        <View style={styles.resendRow}>
          {canResend ? (
            <TouchableOpacity onPress={() => void handleResend()} activeOpacity={0.6}>
              <Text style={[styles.resendText, { color: colors.mutedForeground }]}>
                Didn't receive it?{" "}
                <Text style={[styles.resendLink, { color: colors.primary }]}>Resend code</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.resendText, { color: colors.mutedForeground }]}>
              Resend in{" "}
              <Text style={[styles.resendTimer, { color: colors.foreground }]}>{timer}s</Text>
            </Text>
          )}
        </View>

        <View style={{ flex: 1 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24 },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },

  headerSection: { marginTop: 32, gap: 8 },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headline: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  codeSentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },
  codeSentText:  { ...TS.bodyLg },
  codeSentPhone: { ...TS.bodyLg, fontWeight: "700" },

  // OTP grid
  otpSection: { alignItems: "center", marginTop: 40, gap: 16 },
  cellsRow:   { flexDirection: "row", gap: 10, alignItems: "center" },

  // Single merged cell — bg/border/shadow all injected inline
  cellShell: {
    width: 50,
    height: 62,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 0,
  },

  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0 },

  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  errorText: { ...TS.bodySm, fontWeight: "500", flex: 1 },
  devHint:   { ...TS.bodySm },

  ctaSection: { marginTop: 32 },
  ctaWrap: {
    borderRadius: 20,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
  },
  ctaPressable: { borderRadius: 20, overflow: "hidden" },
  ctaButton: {
    height: 58,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    width: "100%",
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },

  // Verifying dots — always white on primary bg
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 4, width: 28 },
  loadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },

  resendRow:   { alignItems: "center", marginTop: 22 },
  resendText:  { ...TS.body },
  resendTimer: { fontWeight: "700" },
  resendLink:  { fontWeight: "700" },
});
