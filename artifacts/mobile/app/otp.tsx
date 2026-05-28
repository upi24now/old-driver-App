import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

const GRADIENT_FROM = "#FF4D8D";
const GRADIENT_TO = "#FF7A3D";
const PAGE_BG = "#F8FAFC";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#6B7280";
const BORDER = "#E5E7EB";

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
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, []);

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.loadDot, { opacity: v1 }]} />
      <Animated.View style={[styles.loadDot, { opacity: v2 }]} />
      <Animated.View style={[styles.loadDot, { opacity: v3 }]} />
    </View>
  );
}

// ─── Verify button (matches login ContinueButton pattern) ─────────────────────
function VerifyButton({
  state,
  digitCount,
  onPress,
}: {
  state: "idle" | "ready" | "verifying";
  digitCount: number;
  onPress: () => void;
}) {
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
        !isActive && styles.ctaWrapDisabled,
        { transform: [{ scale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => isActive && press(0.97)}
        onPressOut={() => press(1)}
        disabled={!isActive}
        style={styles.ctaPressable}
      >
        {isActive ? (
          <LinearGradient
            colors={[GRADIENT_FROM, GRADIENT_TO]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.ctaButton}
          >
            {state === "verifying" ? (
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
            )}
          </LinearGradient>
        ) : (
          <View style={[styles.ctaButton, styles.ctaButtonDisabled]}>
            <View style={{ width: 28 }} />
            <Text style={[styles.ctaText, styles.ctaTextDisabled]}>
              Enter code ({digitCount}/{OTP_LENGTH})
            </Text>
            <View style={{ width: 28 }} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function OtpScreen() {
  const { verifyOtp } = useDriver();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [otp, setOtp] = useState("");
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const formattedPhone = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "+91 12345 67890";

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (timer === 0) {
      setCanResend(true);
      return;
    }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  useEffect(() => {
    if (otp.length === OTP_LENGTH) {
      setVerifying(true);
      const t = setTimeout(() => {
        verifyOtp();
        router.replace("/vehicle-selection");
      }, 1400);
      return () => clearTimeout(t);
    }
  }, [otp]);

  function handleResend() {
    if (!canResend) return;
    setOtp("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const digits = otp
    .split("")
    .concat(Array(OTP_LENGTH - otp.length).fill(""));

  const btnState = verifying ? "verifying" : otp.length === OTP_LENGTH ? "ready" : "idle";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: PAGE_BG }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 },
        ]}
      >
        {/* Back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={20} color={TEXT_PRIMARY} />
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.headerSection}>
          <View style={styles.iconWrap}>
            <Feather name="shield" size={22} color={GRADIENT_FROM} />
          </View>
          <Text style={styles.headline}>Verify your number</Text>
          <View style={styles.codeSentRow}>
            <Text style={styles.codeSentText}>Code sent to </Text>
            <Text style={styles.codeSentPhone}>{formattedPhone}</Text>
          </View>
        </View>

        {/* OTP cells */}
        <View style={styles.otpSection}>
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={styles.cellsRow}
          >
            {digits.map((d, i) => {
              const isFilled = i < otp.length;
              const isActive = i === otp.length && !verifying;

              const cellContent = (
                <View style={styles.cellInner}>
                  <Text
                    style={[
                      styles.cellText,
                      isFilled && styles.cellTextFilled,
                    ]}
                  >
                    {isFilled ? d : ""}
                  </Text>
                </View>
              );

              return (
                <CellPop key={i} trigger={isFilled}>
                  {isActive ? (
                    <LinearGradient
                      colors={[GRADIENT_FROM, GRADIENT_TO]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.cellShellActive}
                    >
                      {cellContent}
                    </LinearGradient>
                  ) : (
                    <View
                      style={[
                        styles.cellShellIdle,
                        isFilled && styles.cellShellFilled,
                      ]}
                    >
                      {cellContent}
                    </View>
                  )}
                </CellPop>
              );
            })}
          </Pressable>

          {/* Hidden input */}
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(t) => {
              if (verifying) return;
              setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
            }}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            style={styles.hiddenInput}
            caretHidden
            autoFocus
            selectionColor="transparent"
            underlineColorAndroid="transparent"
          />

          <Text style={styles.hintText}>Enter 123456 to verify</Text>
        </View>

        {/* Verify button */}
        <View style={styles.ctaSection}>
          <VerifyButton
            state={btnState}
            digitCount={otp.length}
            onPress={() => {}}
          />
        </View>

        {/* Resend */}
        <View style={styles.resendRow}>
          {canResend ? (
            <TouchableOpacity onPress={handleResend} activeOpacity={0.6}>
              <Text style={styles.resendText}>
                Didn't receive it?{" "}
                <Text style={styles.resendLink}>Resend code</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.resendText}>
              Resend in{" "}
              <Text style={styles.resendTimer}>{timer}s</Text>
            </Text>
          )}
        </View>

        <View style={{ flex: 1 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  container: {
    flex: 1,
    paddingHorizontal: 24,
  },

  // ─── Back button ─────────────────────────────────────────────────────────
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },

  // ─── Header ──────────────────────────────────────────────────────────────
  headerSection: {
    marginTop: 32,
    gap: 8,
  },

  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#FFF0F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#FFD6E8",
  },

  headline: {
    fontSize: 30,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: -0.5,
  },

  codeSentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },

  codeSentText: {
    fontSize: 15,
    color: TEXT_MUTED,
    fontWeight: "400",
  },

  codeSentPhone: {
    fontSize: 15,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },

  // ─── OTP cells ───────────────────────────────────────────────────────────
  otpSection: {
    alignItems: "center",
    marginTop: 40,
    gap: 14,
  },

  cellsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },

  // Active cell: gradient shell (1.5px padding = gradient border)
  cellShellActive: {
    width: 50,
    height: 62,
    borderRadius: 17.5,
    padding: 1.5,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  // Idle / filled cell: plain border shell
  cellShellIdle: {
    width: 50,
    height: 62,
    borderRadius: 17.5,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  cellShellFilled: {
    borderColor: "#D1D5DB",
    shadowOpacity: 0.05,
  },

  // Inner white card (sits inside both shell types)
  cellInner: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  cellText: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: 0,
  },

  cellTextFilled: {
    color: TEXT_PRIMARY,
  },

  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },

  hintText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
  },

  // ─── Verify button ───────────────────────────────────────────────────────
  ctaSection: {
    marginTop: 32,
  },

  ctaWrap: {
    borderRadius: 20,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.13,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },

  ctaWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },

  ctaPressable: {
    borderRadius: 20,
    overflow: "hidden",
  },

  ctaButton: {
    height: 58,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    width: "100%",
  },

  ctaButtonDisabled: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: BORDER,
  },

  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  ctaTextDisabled: {
    color: "#9CA3AF",
    fontWeight: "600",
  },

  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: 28,
  },

  loadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },

  // ─── Resend ──────────────────────────────────────────────────────────────
  resendRow: {
    alignItems: "center",
    marginTop: 20,
  },

  resendText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: "400",
  },

  resendTimer: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
  },

  resendLink: {
    color: GRADIENT_FROM,
    fontWeight: "700",
  },
});
