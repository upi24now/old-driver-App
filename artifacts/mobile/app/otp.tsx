import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;
const RING_SIZE = 56;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE * 2) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function useBlinkAnim() {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 500, easing: Easing.step0, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, easing: Easing.step0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return blink;
}

function CellPop({ children, trigger }: { children: React.ReactNode; trigger: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(trigger);
  useEffect(() => {
    if (trigger && !prev.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.18, useNativeDriver: true, friction: 4, tension: 200 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 180 }),
      ]).start();
    }
    prev.current = trigger;
  }, [trigger]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

function SuccessOverlay({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const colors = useColors();
  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(onDone, 600);
    });
  }, [visible]);
  if (!visible) return null;
  return (
    <Animated.View style={[styles.successOverlay, { opacity }]}>
      <Animated.View style={[styles.successCircle, { backgroundColor: colors.primary, transform: [{ scale }] }]}>
        <Feather name="check" size={44} color="#fff" />
      </Animated.View>
      <Text style={styles.successText}>Verified!</Text>
    </Animated.View>
  );
}

function ResendRing({ timer, total }: { timer: number; total: number }) {
  const colors = useColors();
  const progress = timer / total;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.border}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.primary}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <View style={styles.ringInner}>
        <Text style={styles.ringSeconds}>{timer}</Text>
        <Text style={styles.ringLabel}>sec</Text>
      </View>
    </View>
  );
}

export default function OtpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [otp, setOtp] = useState("");
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const cursorBlink = useBlinkAnim();

  const maskedPhone = phone
    ? `+91 ${phone.slice(0, 2)}•••• ${phone.slice(-4)}`
    : "+91 ••••••••••";

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (timer === 0) { setCanResend(true); return; }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  useEffect(() => {
    if (otp.length === OTP_LENGTH) {
      const t = setTimeout(() => setShowSuccess(true), 120);
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

  const digits = otp.split("").concat(Array(OTP_LENGTH - otp.length).fill(""));

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: "#fff" }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 }]}>

        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: "#f5f5f5" }]}
        >
          <Feather name="arrow-left" size={20} color="#0a0a0a" />
        </TouchableOpacity>

        <View style={styles.headerSection}>
          <View style={[styles.shieldWrap, { backgroundColor: "#e8f5e9" }]}>
            <Feather name="shield" size={30} color={colors.primary} />
          </View>
          <Text style={styles.headline}>Enter OTP</Text>
          <Text style={[styles.subheadline, { color: colors.mutedForeground }]}>
            {OTP_LENGTH}-digit code sent to
          </Text>
          <View style={styles.phoneRow}>
            <Text style={styles.phoneDisplay}>{maskedPhone}</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={[styles.changeLink, { color: colors.primary }]}>Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.otpSection}>
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(t) => {
              if (showSuccess) return;
              setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
            }}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            style={styles.hiddenInput}
            caretHidden
          />

          <TouchableOpacity
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            style={styles.cellsRow}
          >
            {digits.map((d, i) => {
              const isCurrent = i === otp.length && !showSuccess;
              const isFilled = i < otp.length;
              const isComplete = showSuccess;

              return (
                <CellPop key={i} trigger={isFilled}>
                  <View
                    style={[
                      styles.cell,
                      {
                        borderColor: isComplete
                          ? colors.primary
                          : isFilled
                          ? colors.primary
                          : isCurrent
                          ? colors.primary
                          : colors.border,
                        backgroundColor: isComplete
                          ? "#f0fdf4"
                          : isFilled
                          ? "#f0fdf4"
                          : "#fafafa",
                      },
                    ]}
                  >
                    {isCurrent && (
                      <Animated.View
                        style={[
                          styles.cursor,
                          { backgroundColor: colors.primary, opacity: cursorBlink },
                        ]}
                      />
                    )}
                    {isFilled && (
                      <Text style={[styles.cellText, { color: colors.foreground }]}>{d}</Text>
                    )}
                  </View>
                </CellPop>
              );
            })}
          </TouchableOpacity>

          <View style={styles.resendSection}>
            {canResend ? (
              <TouchableOpacity
                onPress={handleResend}
                style={[styles.resendBtn, { borderColor: colors.primary }]}
              >
                <Feather name="refresh-cw" size={14} color={colors.primary} />
                <Text style={[styles.resendBtnText, { color: colors.primary }]}>
                  Resend OTP
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.resendTimerRow}>
                <ResendRing timer={timer} total={RESEND_SECONDS} />
                <View>
                  <Text style={[styles.resendHint, { color: colors.mutedForeground }]}>
                    Resend code in
                  </Text>
                  <Text style={[styles.resendCountdown, { color: colors.foreground }]}>
                    {timer} seconds
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.bottomSection}>
          <View style={styles.progressDots}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: i < otp.length ? colors.primary : colors.border,
                    width: i < otp.length ? 20 : 8,
                  },
                ]}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.verifyBtn,
              {
                backgroundColor: otp.length === OTP_LENGTH ? colors.primary : colors.muted,
              },
            ]}
            onPress={() => setShowSuccess(true)}
            activeOpacity={0.85}
            disabled={otp.length !== OTP_LENGTH || showSuccess}
          >
            <Text
              style={[
                styles.verifyText,
                { color: otp.length === OTP_LENGTH ? "#fff" : colors.mutedForeground },
              ]}
            >
              Verify & Continue
            </Text>
            {otp.length === OTP_LENGTH && (
              <Feather name="arrow-right" size={18} color="#fff" />
            )}
          </TouchableOpacity>

          <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
            Didn't receive it?{" "}
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              Call support
            </Text>
          </Text>
        </View>
      </View>

      <SuccessOverlay
        visible={showSuccess}
        onDone={() => router.replace("/(tabs)")}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    gap: 32,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  headerSection: {
    alignItems: "center",
    gap: 8,
  },
  shieldWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  headline: {
    fontSize: 30,
    fontWeight: "800",
    color: "#0a0a0a",
  },
  subheadline: {
    fontSize: 15,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  phoneDisplay: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0a0a0a",
    letterSpacing: 0.5,
  },
  changeLink: {
    fontSize: 14,
    fontWeight: "600",
  },
  otpSection: {
    gap: 28,
    alignItems: "center",
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  cellsRow: {
    flexDirection: "row",
    gap: 10,
  },
  cell: {
    width: 50,
    height: 62,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: 24,
    fontWeight: "700",
  },
  cursor: {
    width: 2,
    height: 26,
    borderRadius: 1,
  },
  resendSection: {
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },
  resendTimerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringInner: {
    position: "absolute",
    alignItems: "center",
  },
  ringSeconds: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0a0a0a",
    lineHeight: 17,
  },
  ringLabel: {
    fontSize: 9,
    color: "#888",
    fontWeight: "500",
  },
  resendHint: {
    fontSize: 13,
  },
  resendCountdown: {
    fontSize: 14,
    fontWeight: "700",
  },
  resendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  resendBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  bottomSection: {
    gap: 14,
    marginTop: "auto",
  },
  progressDots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 4,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
    transition: "width 0.2s",
  } as any,
  verifyBtn: {
    height: 58,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  verifyText: {
    fontSize: 17,
    fontWeight: "700",
  },
  helpText: {
    fontSize: 13,
    textAlign: "center",
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  successText: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0a0a0a",
    letterSpacing: 0.5,
  },
});
