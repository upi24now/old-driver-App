import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
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

const LOGO = require("@/assets/images/logo.png");

const COUNTRY_CODE = "+91";

const GRADIENT_FROM = "#FF4D8D";
const GRADIENT_TO = "#FF7A3D";
const PAGE_BG = "#F7F3F2";
const TEXT_PRIMARY = "#111111";
const TEXT_MUTED = "#6B7280";
const BORDER = "#E5E7EB";

// ─── 3D Phone Input Card ─────────────────────────────────────────────────────
function PhoneInputCard({
  focused,
  onPress,
  children,
}: {
  focused: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.025 : 1,
        useNativeDriver: true,
        speed: 28,
        bounciness: 9,
      }),
      Animated.timing(glow, {
        toValue: focused ? 1 : 0,
        duration: 260,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
    ]).start();
  }, [focused]);

  const cardSurface = (
    <LinearGradient
      colors={["#FFFFFF", "#F6F4FF"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.card3dSurface}
    >
      <View style={styles.card3dSheen} />
      <Pressable onPress={onPress} style={styles.card3dRow}>
        {children}
      </Pressable>
    </LinearGradient>
  );

  return (
    <Animated.View style={[styles.card3dOuter, { transform: [{ scale }] }]}>
      <Animated.View style={[styles.card3dGlow, { opacity: glow }]} />

      {focused ? (
        <LinearGradient
          colors={[GRADIENT_FROM, GRADIENT_TO]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.card3dShellFocused}
        >
          {cardSurface}
        </LinearGradient>
      ) : (
        <View style={styles.card3dShellIdle}>
          {cardSurface}
        </View>
      )}
    </Animated.View>
  );
}

function ContinueButton({
  enabled,
  onPress,
}: {
  enabled: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

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
        !enabled && styles.ctaWrapDisabled,
        { transform: [{ scale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => enabled && press(0.97)}
        onPressOut={() => press(1)}
        disabled={!enabled}
        style={styles.ctaPressable}
      >
        {enabled ? (
          <LinearGradient
            colors={[GRADIENT_FROM, GRADIENT_TO]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.ctaButton}
          >
            <Text style={styles.ctaText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </LinearGradient>
        ) : (
          <View style={[styles.ctaButton, styles.ctaButtonDisabled]}>
            <Text style={[styles.ctaText, styles.ctaTextDisabled]}>
              Continue
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [phone, setPhone] = useState("");
  const { setPhone: setDriverPhone, driverUid, authLoading } = useDriver();
  const [focused, setFocused] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ─── Auth restore redirect ────────────────────────────────────────────────
  // Firebase Auth reads the persisted session from AsyncStorage asynchronously.
  // Once authLoading settles (onAuthStateChanged has fired), redirect to the
  // dashboard if the driver is already authenticated — no re-login needed.
  useEffect(() => {
    if (authLoading) return;
    if (driverUid) router.replace("/(tabs)");
  }, [driverUid, authLoading]);

  const isValid = phone.replace(/\D/g, "").length === 10;

  async function goToOtp() {
    if (loading) return;
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      setError("Please enter your mobile number.");
      inputRef.current?.focus();
      return;
    }
    if (digits.length !== 10) {
      setError("Enter a valid 10-digit mobile number.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    setLoading(true);

    const result = await sendOtp(digits);

    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }

    setDriverPhone(digits);
    setLoading(false);
    router.replace({
      pathname: "/otp",
      params: { phone: digits, devOtp: result.devOtp ?? "" },
    });
  }

  function handleContinue() { void goToOtp(); }
  function handleSignUp()    { void goToOtp(); }

  const inputInner = (
    <>
      <TouchableOpacity
        activeOpacity={0.6}
        onPress={() => setShowCountryPicker(true)}
        style={styles.countrySelector}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
      >
        <View style={styles.flagWrap}>
          <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
          <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
            <View style={styles.flagChakra} />
          </View>
          <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
        </View>
        <Text style={styles.codeText}>{COUNTRY_CODE}</Text>
        <Feather name="chevron-down" size={15} color={TEXT_MUTED} />
      </TouchableOpacity>

      <View style={styles.codeDivider} />

      <TextInput
        ref={inputRef}
        style={styles.phoneInput}
        value={phone}
        onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
        keyboardType="phone-pad"
        placeholder="Enter mobile number"
        placeholderTextColor="#9CA3AF"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        underlineColorAndroid="transparent"
        selectionColor={GRADIENT_FROM}
      />
    </>
  );

  // Show blank screen while Firebase restores session from AsyncStorage.
  // This prevents the login form from flashing before the redirect fires.
  if (authLoading) {
    return (
      <View style={[styles.root, styles.loadingRoot, { backgroundColor: PAGE_BG }]}>
        <ActivityIndicator size="large" color={GRADIENT_FROM} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: PAGE_BG }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + 4,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.canGoBack() && router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={20} color={TEXT_PRIMARY} />
          </TouchableOpacity>
        </View>

        <View style={styles.heroSection}>
          <Image
            source={LOGO}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.headingSection}>
          <Text style={styles.title}>Welcome Driver</Text>
          <Text style={styles.subtitle}>
            Login with your mobile number to continue deliveries
          </Text>
        </View>

        <View style={styles.formSection}>
          <PhoneInputCard
            focused={focused}
            onPress={() => inputRef.current?.focus()}
          >
            {inputInner}
          </PhoneInputCard>

          <ContinueButton enabled={isValid && !loading} onPress={handleContinue} />

          {!!error && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={13} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.signupRow}>
          <Text style={styles.signupText}>New driver? </Text>
          <TouchableOpacity
            activeOpacity={0.6}
            hitSlop={8}
            onPress={handleSignUp}
            disabled={loading}
          >
            <Text style={[styles.signupLink, loading && { opacity: 0.5 }]}>Sign up</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.termsText}>
          By continuing you agree to{" "}
          <Text style={styles.termsLink}>Terms</Text>
          {" & "}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </ScrollView>

      <Modal
        visible={showCountryPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowCountryPicker(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Feather name="x" size={20} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>

            <View style={styles.countryItemActive}>
              <View style={styles.flagWrap}>
                <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
                <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
                  <View style={styles.flagChakra} />
                </View>
                <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.countryItemName}>India</Text>
                <Text style={styles.countryItemCode}>+91</Text>
              </View>
              <Feather name="check-circle" size={20} color={GRADIENT_FROM} />
            </View>

            <Text style={styles.modalHint}>More countries coming soon.</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingRoot: { alignItems: "center", justifyContent: "center" },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
  },
  heroSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 0,
  },
  logoImage: {
    width: 180,
    height: 180,
  },
  headingSection: {
    marginTop: 12,
    gap: 8,
    alignItems: "center",
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "400",
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  formSection: {
    marginTop: 20,
    gap: 0,
  },
  card3dOuter: {
    position: "relative",
  },
  card3dGlow: {
    position: "absolute",
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 34,
    backgroundColor: GRADIENT_FROM,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  card3dShellIdle: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    shadowColor: "#1E1035",
    shadowOpacity: 0.13,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    backgroundColor: "#FFFFFF",
  },
  card3dShellFocused: {
    borderRadius: 24,
    padding: 1.5,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  card3dSurface: {
    borderRadius: 22.5,
    height: 58,
    overflow: "hidden",
    position: "relative",
  },
  card3dSheen: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.95)",
    zIndex: 2,
  },
  card3dRow: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    paddingHorizontal: 0,
  },
  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 4,
    paddingLeft: 14,
    paddingRight: 4,
    height: "100%",
    backgroundColor: "transparent",
  },
  flagWrap: {
    width: 24,
    height: 17,
    borderRadius: 2.5,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#E5E7EB",
    flexDirection: "column",
  },
  flagBand: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  flagChakra: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: 0.8,
    borderColor: "#1A237E",
  },
  codeText: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  codeDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginHorizontal: 0,
  },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    paddingLeft: 4,
    paddingRight: 12,
    height: "100%",
    borderWidth: 0,
    ...Platform.select({
      web: {
        outlineWidth: 0,
        outlineStyle: "none",
      } as object,
      default: {},
    }),
  },
  ctaWrap: {
    borderRadius: 16,
    width: "88%",
    alignSelf: "center",
    marginTop: 40,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  ctaWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaPressable: {
    borderRadius: 16,
    overflow: "hidden",
  },
  ctaButton: {
    height: 50,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
  },
  ctaButtonDisabled: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
  ctaTextDisabled: {
    color: "#9CA3AF",
    fontWeight: "600",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    color: "#EF4444",
    fontWeight: "500",
    flex: 1,
  },
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },
  signupText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: "400",
  },
  signupLink: {
    fontSize: 14,
    fontWeight: "800",
    color: GRADIENT_FROM,
    letterSpacing: 0.2,
  },
  termsText: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: "center",
    marginTop: 18,
    marginBottom: 8,
  },
  termsLink: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 22,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_PRIMARY,
  },
  countryItemActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFF7F2",
    borderWidth: 1.5,
    borderColor: GRADIENT_FROM,
  },
  countryItemName: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  countryItemCode: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  modalHint: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: "center",
  },
});
