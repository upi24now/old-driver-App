import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
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

const COUNTRY_CODE = "+91";

const GRADIENT_FROM = "#FF3D7F";
const GRADIENT_TO = "#FF7A3D";
const PAGE_BG = "#FFF1EE";
const TEXT_DARK = "#0E0E10";
const TEXT_MUTED = "#7E8390";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [phone, setPhone] = useState("");
  const { setPhone: setDriverPhone } = useDriver();
  const [focused, setFocused] = useState(false);

  const isValid = phone.replace(/\D/g, "").length === 10;

  function formatNumber(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  function handleContinue() {
    if (!isValid) return;
    setDriverPhone(phone);
    router.push({ pathname: "/otp", params: { phone } });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: PAGE_BG }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={styles.topBlock}>
          <LinearGradient
            colors={[GRADIENT_FROM, GRADIENT_TO]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoTile}
          >
            <Feather name="box" size={26} color="#fff" />
          </LinearGradient>

          <View style={styles.heroBlock}>
            <Text style={styles.headline}>Welcome back</Text>
            <Text style={styles.subheadline}>Enter your number to continue.</Text>
          </View>
        </View>

        <View style={styles.formBlock}>
          <Text style={styles.inputLabel}>MOBILE NUMBER</Text>

          <View
            style={[
              styles.inputShadow,
              focused && styles.inputShadowFocused,
            ]}
          >
            <Pressable
              onPress={() => inputRef.current?.focus()}
              style={[
                styles.inputRow,
                focused && { borderColor: GRADIENT_FROM },
              ]}
            >
              <View style={styles.countryCode}>
                <View style={styles.flagWrap}>
                  <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
                  <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
                    <View style={styles.flagChakra} />
                  </View>
                  <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
                </View>
                <Text style={styles.codeText}>{COUNTRY_CODE}</Text>
              </View>
              <View style={styles.codeDivider} />

              <TextInput
                ref={inputRef}
                style={styles.phoneInput}
                value={formatNumber(phone)}
                onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
                keyboardType="phone-pad"
                placeholder="12345 67890"
                placeholderTextColor="#C9CDD4"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
                autoFocus
              />

              {isValid && (
                <View style={styles.checkBadge}>
                  <Feather name="check" size={14} color="#fff" />
                </View>
              )}
            </Pressable>
            {focused && <View style={styles.inputUnderline} />}
          </View>

          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.9}
            disabled={!isValid}
            style={styles.ctaWrap}
          >
            <LinearGradient
              colors={
                isValid
                  ? [GRADIENT_FROM, GRADIENT_TO]
                  : ["#F0C5C2", "#F0C5C2"]
              }
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.ctaButton}
            >
              <View style={styles.ctaSpacer} />
              <Text style={styles.ctaText}>Continue</Text>
              <View style={styles.ctaArrowCircle}>
                <Feather name="arrow-right" size={16} color="#fff" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.signupLink}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  topBlock: { gap: 36 },
  logoTile: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  heroBlock: { gap: 10, marginTop: 12 },
  headline: {
    fontSize: 36,
    fontWeight: "900",
    color: TEXT_DARK,
    letterSpacing: -0.5,
  },
  subheadline: {
    fontSize: 16,
    fontWeight: "400",
    color: TEXT_MUTED,
  },
  formBlock: { gap: 16 },
  inputLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: GRADIENT_FROM,
    marginBottom: 2,
  },
  inputShadow: {
    borderRadius: 16,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  inputShadowFocused: {
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "transparent",
    borderRadius: 16,
    overflow: "hidden",
    height: 62,
    backgroundColor: "#fff",
  },
  countryCode: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 10,
    height: "100%",
    flexShrink: 0,
  },
  flagWrap: {
    width: 26,
    height: 18,
    borderRadius: 3,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#D1D5DB",
    flexDirection: "column",
    marginRight: 8,
  },
  flagBand: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  flagChakra: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#1A237E",
  },
  codeText: {
    fontSize: 17,
    fontWeight: "800",
    color: TEXT_DARK,
  },
  codeDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 4,
    flexShrink: 0,
  },
  phoneInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    paddingHorizontal: 14,
    height: "100%",
    letterSpacing: 1,
  },
  checkBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  inputUnderline: {
    height: 2.5,
    backgroundColor: GRADIENT_TO,
    marginHorizontal: 14,
    borderRadius: 2,
    marginTop: -1,
  },
  ctaWrap: {
    borderRadius: 18,
    marginTop: 14,
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
  ctaSpacer: { width: 28 },
  ctaText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },
  ctaArrowCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  signupRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  signupText: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  signupLink: {
    fontSize: 14,
    fontWeight: "800",
    color: GRADIENT_FROM,
  },
});
