import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function OtpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [otp, setOtp] = useState("");
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const maskedPhone = phone
    ? `+91 ${phone.slice(0, 2)}****${phone.slice(-4)}`
    : "+91 ••••••••••";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (timer === 0) {
      setCanResend(true);
      return;
    }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  function handleResend() {
    if (!canResend) return;
    setOtp("");
    setTimer(RESEND_SECONDS);
    setCanResend(false);
    inputRef.current?.focus();
  }

  function handleVerify() {
    if (otp.length !== OTP_LENGTH) return;
    router.replace("/(tabs)");
  }

  const digits = otp.split("").concat(Array(OTP_LENGTH - otp.length).fill(""));

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: "#fff" }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: "#f5f5f5" }]}
          >
            <Feather name="arrow-left" size={20} color="#0a0a0a" />
          </TouchableOpacity>
        </View>

        <View style={styles.headerSection}>
          <View style={[styles.shieldWrap, { backgroundColor: "#e8f5e9" }]}>
            <Feather name="shield" size={32} color={colors.primary} />
          </View>
          <Text style={styles.headline}>Verify your number</Text>
          <Text style={[styles.subheadline, { color: colors.mutedForeground }]}>
            We sent a 6-digit OTP to
          </Text>
          <Text style={styles.phoneDisplay}>{maskedPhone}</Text>
        </View>

        <View style={styles.otpSection}>
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH))}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            style={styles.hiddenInput}
            onSubmitEditing={handleVerify}
          />

          <TouchableOpacity
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            style={styles.cellsRow}
          >
            {digits.map((d, i) => {
              const isCurrent = i === otp.length;
              const isFilled = i < otp.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.cell,
                    {
                      borderColor: isFilled
                        ? colors.primary
                        : isCurrent
                          ? colors.primary
                          : colors.border,
                      backgroundColor: isFilled ? "#f0fdf4" : "#fafafa",
                    },
                  ]}
                >
                  {isCurrent && !isFilled && (
                    <View
                      style={[styles.cursor, { backgroundColor: colors.primary }]}
                    />
                  )}
                  {isFilled && (
                    <Text style={[styles.cellText, { color: colors.foreground }]}>
                      {d}
                    </Text>
                  )}
                </View>
              );
            })}
          </TouchableOpacity>

          <View style={styles.resendRow}>
            {canResend ? (
              <TouchableOpacity onPress={handleResend}>
                <Text style={[styles.resendActive, { color: colors.primary }]}>
                  Resend OTP
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.resendTimer, { color: colors.mutedForeground }]}>
                Resend in{" "}
                <Text style={{ fontWeight: "700", color: "#0a0a0a" }}>
                  {timer}s
                </Text>
              </Text>
            )}
          </View>
        </View>

        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={[
              styles.verifyBtn,
              {
                backgroundColor:
                  otp.length === OTP_LENGTH ? colors.primary : colors.muted,
              },
            ]}
            onPress={handleVerify}
            activeOpacity={0.85}
            disabled={otp.length !== OTP_LENGTH}
          >
            <Text
              style={[
                styles.verifyText,
                {
                  color:
                    otp.length === OTP_LENGTH ? "#fff" : colors.mutedForeground,
                },
              ]}
            >
              Verify & Continue
            </Text>
            <Feather
              name="check-circle"
              size={18}
              color={otp.length === OTP_LENGTH ? "#fff" : colors.mutedForeground}
            />
          </TouchableOpacity>

          <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
            Having trouble?{" "}
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              Call support
            </Text>
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    gap: 36,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSection: {
    alignItems: "center",
    gap: 10,
  },
  shieldWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  headline: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0a0a0a",
  },
  subheadline: {
    fontSize: 15,
  },
  phoneDisplay: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0a0a0a",
    letterSpacing: 0.5,
  },
  otpSection: {
    gap: 20,
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
    width: 48,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: 22,
    fontWeight: "700",
  },
  cursor: {
    width: 2,
    height: 24,
    borderRadius: 1,
    opacity: 0.8,
  },
  resendRow: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  resendTimer: {
    fontSize: 14,
  },
  resendActive: {
    fontSize: 14,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  bottomSection: {
    gap: 16,
    marginTop: "auto",
  },
  verifyBtn: {
    height: 56,
    borderRadius: 14,
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
});
