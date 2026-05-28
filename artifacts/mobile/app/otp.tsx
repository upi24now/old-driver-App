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

const GRADIENT_FROM = "#FF3D7F";
const GRADIENT_TO = "#FF7A3D";
const PAGE_BG = "#FFF1EE";
const TEXT_DARK = "#0E0E10";
const TEXT_MUTED = "#7E8390";

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

function VerifyingDots() {
  const v1 = useRef(new Animated.Value(0.3)).current;
  const v2 = useRef(new Animated.Value(0.3)).current;
  const v3 = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 400, delay, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(val, { toValue: 0.3, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      );
    const a = make(v1, 0);
    const b = make(v2, 150);
    const c = make(v3, 300);
    a.start(); b.start(); c.start();
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
    if (timer === 0) { setCanResend(true); return; }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  useEffect(() => {
    if (otp.length === OTP_LENGTH) {
      setVerifying(true);
      const t = setTimeout(() => {
        verifyOtp();
        router.replace("/vehicle-selection");
      }, 1200);
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
      style={[styles.root, { backgroundColor: PAGE_BG }]}
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
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <Feather name="arrow-left" size={20} color={TEXT_DARK} />
        </TouchableOpacity>

        <View style={styles.headerSection}>
          <LinearGradient
            colors={[GRADIENT_FROM, GRADIENT_TO]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.phoneTile}
          >
            <Feather name="phone" size={26} color="#fff" />
          </LinearGradient>

          <Text style={styles.headline}>Verify your number</Text>
          <View style={styles.codeSentRow}>
            <Text style={styles.codeSentText}>Code sent to </Text>
            <Text style={styles.codeSentPhone}>{formattedPhone}</Text>
          </View>

          <LinearGradient
            colors={[GRADIENT_FROM, GRADIENT_TO]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.headerUnderline}
          />
        </View>

        <View style={styles.otpSection}>
          <View style={styles.cellsWrap}>
            <Pressable
              onPress={() => inputRef.current?.focus()}
              style={styles.cellsRow}
            >
              {digits.map((d, i) => {
                const isFilled = i < otp.length;
                return (
                  <CellPop key={i} trigger={isFilled}>
                    {isFilled ? (
                      <LinearGradient
                        colors={[GRADIENT_FROM, GRADIENT_TO]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.cellFilled}
                      >
                        <Text style={styles.cellTextFilled}>{d}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.cellEmpty}>
                        <Text style={styles.cellTextEmpty}>•</Text>
                      </View>
                    )}
                  </CellPop>
                );
              })}
            </Pressable>
            <TextInput
              ref={inputRef}
              value={otp}
              onChangeText={(t) => {
                if (verifying) return;
                setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
              }}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              style={styles.invisibleOverlayInput}
              caretHidden
              autoFocus
              selectionColor="transparent"
            />
          </View>

          <Text style={styles.hintText}>Try: 123456 to verify</Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          disabled={!verifying}
          style={styles.ctaWrap}
        >
          <LinearGradient
            colors={
              verifying
                ? [GRADIENT_FROM, GRADIENT_TO]
                : ["#F0C5C2", "#F0C5C2"]
            }
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.ctaButton}
          >
            {verifying ? (
              <>
                <VerifyingDots />
                <Text style={styles.ctaText}>Verifying...</Text>
                <View style={{ width: 28 }} />
              </>
            ) : (
              <>
                <View style={{ width: 28 }} />
                <Text style={styles.ctaText}>
                  Enter code ({otp.length}/{OTP_LENGTH})
                </Text>
                <View style={{ width: 28 }} />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.resendRow}>
          {canResend ? (
            <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
              <Text style={styles.resendActive}>
                Didn't get it? <Text style={styles.resendActiveStrong}>Resend code</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.resendText}>
              Resend in <Text style={styles.resendSeconds}>{timer}s</Text>
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
    paddingHorizontal: 28,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerSection: {
    gap: 10,
    marginTop: 28,
  },
  phoneTile: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    marginBottom: 18,
  },
  headline: {
    fontSize: 30,
    fontWeight: "900",
    color: TEXT_DARK,
    letterSpacing: -0.5,
  },
  codeSentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  codeSentText: {
    fontSize: 15,
    color: TEXT_MUTED,
  },
  codeSentPhone: {
    fontSize: 15,
    fontWeight: "800",
    color: GRADIENT_FROM,
  },
  headerUnderline: {
    height: 2.5,
    borderRadius: 2,
    marginTop: 18,
    width: "92%",
  },
  otpSection: {
    alignItems: "center",
    marginTop: 28,
    gap: 10,
  },
  cellsWrap: {
    position: "relative",
  },
  invisibleOverlayInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: "transparent",
    backgroundColor: "transparent",
    textAlign: "center",
    fontSize: 1,
  },
  cellsRow: {
    flexDirection: "row",
    gap: 10,
  },
  cellFilled: {
    width: 48,
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  cellEmpty: {
    width: 48,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#FFD8CF",
    alignItems: "center",
    justifyContent: "center",
  },
  cellTextFilled: {
    fontSize: 22,
    fontWeight: "900",
    color: "#fff",
  },
  cellTextEmpty: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFB5A8",
    marginTop: -4,
  },
  hintText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 6,
  },
  ctaWrap: {
    borderRadius: 18,
    marginTop: 28,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  ctaButton: {
    height: 60,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#fff",
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
    backgroundColor: "#fff",
  },
  resendRow: {
    alignItems: "center",
    marginTop: 18,
  },
  resendText: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  resendSeconds: {
    color: GRADIENT_TO,
    fontWeight: "800",
  },
  resendActive: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  resendActiveStrong: {
    color: GRADIENT_FROM,
    fontWeight: "800",
  },
});
