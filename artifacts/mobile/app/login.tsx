import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
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

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

const COUNTRY_CODE = "+91";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [phone, setPhone] = useState("");
  const { setPhone: setDriverPhone } = useDriver();
  const [focused, setFocused] = useState(false);

  const isValid = phone.replace(/\D/g, "").length === 10;

  function handleContinue() {
    if (!isValid) return;
    setDriverPhone(phone);
    router.push({ pathname: "/otp", params: { phone } });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: "#fff" }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.topSection}>
          <View style={styles.logoRow}>
            <View style={[styles.logoIconWrap, { backgroundColor: colors.primary }]}>
              <Feather name="navigation" size={22} color="#fff" />
            </View>
            <Text style={styles.logoText}>DRIVER</Text>
          </View>

          <View style={styles.heroSection}>
            <Text style={styles.headline}>Let's get{"\n"}you moving</Text>
            <Text style={[styles.subheadline, { color: colors.mutedForeground }]}>
              Enter your mobile number to continue
            </Text>
          </View>
        </View>

        <View style={styles.formSection}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
            Mobile Number
          </Text>

          <TouchableOpacity
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            style={[
              styles.inputRow,
              {
                borderColor: focused ? colors.primary : colors.border,
                backgroundColor: focused ? "#f8fff8" : "#fafafa",
              },
            ]}
          >
            <View style={[styles.countryCode, { borderRightColor: colors.border }]}>
              <Text style={styles.flag}>🇮🇳</Text>
              <Text style={styles.codeText}>{COUNTRY_CODE}</Text>
            </View>

            <TextInput
              ref={inputRef}
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="00000 00000"
              placeholderTextColor="#ccc"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              autoFocus
            />

            {phone.length > 0 && (
              <TouchableOpacity onPress={() => setPhone("")} style={styles.clearBtn}>
                <Feather name="x-circle" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.ctaButton,
              {
                backgroundColor: isValid ? colors.primary : colors.muted,
              },
            ]}
            onPress={handleContinue}
            activeOpacity={0.85}
            disabled={!isValid}
          >
            <Text
              style={[
                styles.ctaText,
                { color: isValid ? "#fff" : colors.mutedForeground },
              ]}
            >
              Get OTP
            </Text>
            <Feather
              name="arrow-right"
              size={18}
              color={isValid ? "#fff" : colors.mutedForeground}
            />
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[styles.altButton, { borderColor: colors.border }]}
            activeOpacity={0.75}
          >
            <Feather name="mail" size={17} color={colors.foreground} />
            <Text style={[styles.altText, { color: colors.foreground }]}>
              Continue with Email
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.terms, { color: colors.mutedForeground }]}>
          By continuing, you agree to our{" "}
          <Text style={{ color: colors.primary, fontWeight: "600" }}>
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text style={{ color: colors.primary, fontWeight: "600" }}>
            Privacy Policy
          </Text>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  topSection: { gap: 40 },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0a0a0a",
    letterSpacing: 5,
  },
  heroSection: { gap: 8 },
  headline: {
    fontSize: 38,
    fontWeight: "800",
    color: "#0a0a0a",
    lineHeight: 46,
  },
  subheadline: {
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 22,
  },
  formSection: { gap: 14 },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: -2,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 14,
    overflow: "hidden",
    height: 58,
  },
  countryCode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRightWidth: 1,
    height: "100%",
  },
  flag: { fontSize: 20 },
  codeText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    paddingHorizontal: 14,
    height: "100%",
    letterSpacing: 1,
  },
  clearBtn: {
    paddingRight: 14,
  },
  ctaButton: {
    height: 56,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: "700",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 13 },
  altButton: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  altText: {
    fontSize: 15,
    fontWeight: "600",
  },
  terms: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});
