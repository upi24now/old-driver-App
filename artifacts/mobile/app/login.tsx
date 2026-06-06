import { Feather } from "@expo/vector-icons";
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
import { useColors } from "@/hooks/useColors";
import { sendOtp } from "@/utils/auth-api";
import { TS } from "@/constants/typography";

const LOGO = require("@/assets/images/logo.png");

const COUNTRY_CODE = "+91";

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
  const colors = useColors();
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

  return (
    <Animated.View style={[styles.card3dOuter, { transform: [{ scale }] }]}>
      {/* Focus glow ring */}
      <Animated.View
        style={[
          styles.card3dGlow,
          {
            opacity:         glow,
            backgroundColor: colors.primary,
            shadowColor:     colors.primary,
          },
        ]}
        pointerEvents="none"
      />

      {/* Card shell — border & shadow animate with focused state */}
      <View
        style={[
          styles.card3dShell,
          {
            borderColor:    focused ? colors.primary      : colors.border,
            borderWidth:    focused ? 1.5                 : 1,
            backgroundColor: colors.surface,
            shadowColor:    focused ? colors.primary      : "#000",
            shadowOpacity:  focused ? 0.20                : 0.08,
            shadowRadius:   focused ? 22                  : 14,
            shadowOffset:   { width: 0, height: focused ? 8 : 5 },
            elevation:      focused ? 10                  : 5,
          },
        ]}
      >
        {/* Sheen highlight at top edge */}
        <View style={styles.card3dSheen} />
        <Pressable onPress={onPress} style={styles.card3dRow}>
          {children}
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Continue Button ──────────────────────────────────────────────────────────
function ContinueButton({
  enabled,
  onPress,
}: {
  enabled: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
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
        {
          transform:    [{ scale }],
          shadowColor:  enabled ? colors.primary : "transparent",
          shadowOpacity: enabled ? 0.28 : 0,
          elevation:     enabled ? 6    : 0,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => enabled && press(0.97)}
        onPressOut={() => press(1)}
        disabled={!enabled}
        style={styles.ctaPressable}
      >
        <View
          style={[
            styles.ctaButton,
            { backgroundColor: enabled ? colors.primary : colors.muted },
          ]}
        >
          <Text style={[styles.ctaText, !enabled && { color: colors.mutedForeground }]}>
            Continue
          </Text>
          {enabled && <Feather name="arrow-right" size={18} color="#fff" />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
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
        <View style={[styles.flagWrap, { borderColor: colors.border }]}>
          <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
          <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
            <View style={styles.flagChakra} />
          </View>
          <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
        </View>
        <Text style={[styles.codeText, { color: colors.foreground }]}>{COUNTRY_CODE}</Text>
        <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
      </TouchableOpacity>

      <View style={[styles.codeDivider, { backgroundColor: colors.borderStrong }]} />

      <TextInput
        ref={inputRef}
        style={[styles.phoneInput, { color: colors.foreground }]}
        value={phone}
        onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
        keyboardType="phone-pad"
        placeholder="Enter mobile number"
        placeholderTextColor={colors.textPlaceholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        underlineColorAndroid="transparent"
        selectionColor={colors.primary}
      />
    </>
  );

  // Show blank screen while Firebase restores session from AsyncStorage.
  // This prevents the login form from flashing before the redirect fires.
  if (authLoading) {
    return (
      <View style={[styles.root, styles.loadingRoot, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
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
            style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => router.canGoBack() && router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ── Premium hero section ── */}
        <View style={styles.heroSection}>
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.surface,
                borderColor:     colors.border,
                shadowColor:     colors.primary,
              },
            ]}
          >
            {/* Sheen */}
            <View style={styles.heroSheen} />

            {/* Brand badge */}
            <View style={[styles.heroBadge, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.heroBadgeText, { color: colors.primary }]}>🚴 Bike Courier</Text>
            </View>

            <Image
              source={LOGO}
              style={styles.logoImage}
              resizeMode="contain"
            />

            <Text style={[styles.heroTagline, { color: colors.mutedForeground }]}>
              Delivery Partner Platform
            </Text>
          </View>
        </View>

        <View style={styles.headingSection}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome Driver</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
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
              <Feather name="alert-circle" size={13} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.signupRow}>
          <Text style={[styles.signupText, { color: colors.mutedForeground }]}>New driver? </Text>
          <TouchableOpacity
            activeOpacity={0.6}
            hitSlop={8}
            onPress={handleSignUp}
            disabled={loading}
          >
            <Text style={[styles.signupLink, { color: colors.primary }, loading && { opacity: 0.5 }]}>
              Sign up
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.termsText, { color: colors.mutedForeground }]}>
          By continuing you agree to{" "}
          <Text style={[styles.termsLink, { color: colors.foreground }]}>Terms</Text>
          {" & "}
          <Text style={[styles.termsLink, { color: colors.foreground }]}>Privacy Policy</Text>
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
            style={[styles.modalCard, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Feather name="x" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.countryItemActive,
                { backgroundColor: colors.primarySoft, borderColor: colors.primary },
              ]}
            >
              <View style={[styles.flagWrap, { borderColor: colors.border }]}>
                <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
                <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
                  <View style={styles.flagChakra} />
                </View>
                <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.countryItemName, { color: colors.foreground }]}>India</Text>
                <Text style={[styles.countryItemCode, { color: colors.mutedForeground }]}>+91</Text>
              </View>
              <Feather name="check-circle" size={20} color={colors.primary} />
            </View>

            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              More countries coming soon.
            </Text>
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
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  // ── Hero section ──
  heroSection: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroCard: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 1,
    paddingTop: 20,
    paddingBottom: 14,
    paddingHorizontal: 24,
    width: "100%",
    overflow: "hidden",
    shadowOpacity: 0.10,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    gap: 2,
  },
  heroSheen: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
    zIndex: 2,
  },
  heroBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 8,
  },
  heroBadgeText: {
    ...TS.label,
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: "700",
  },
  logoImage: {
    width: 150,
    height: 150,
  },
  heroTagline: {
    ...TS.bodySm,
    fontWeight: "500",
    marginTop: 2,
  },

  // ── Heading ──
  headingSection: {
    marginTop: 16,
    gap: 8,
    alignItems: "center",
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  subtitle: {
    ...TS.bodyLg,
    textAlign: "center",
    paddingHorizontal: 12,
  },

  // ── Form ──
  formSection: {
    marginTop: 22,
    gap: 0,
  },

  // Phone input card — shell bg/border/shadow injected inline
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
    shadowOpacity: 0.42,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  card3dShell: {
    borderRadius: 24,
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

  // Country selector
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
    letterSpacing: 0.2,
  },
  codeDivider: {
    width: 1,
    height: 20,
    alignSelf: "center",
    marginHorizontal: 0,
  },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
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

  // CTA button — bg + shadow injected inline
  ctaWrap: {
    borderRadius: 16,
    width: "88%",
    alignSelf: "center",
    marginTop: 40,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  ctaPressable: {
    borderRadius: 16,
    overflow: "hidden",
  },
  ctaButton: {
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },

  // Error
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  errorText: {
    ...TS.bodySm,
    fontWeight: "500",
    flex: 1,
  },

  // Sign-up / terms
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  signupText: {
    ...TS.body,
  },
  signupLink: {
    ...TS.body,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  termsText: {
    ...TS.bodySm,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 8,
  },
  termsLink: {
    fontWeight: "600",
  },

  // Country picker modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    borderRadius: 22,
    padding: 22,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  countryItemActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  countryItemName: {
    fontSize: 16,
    fontWeight: "700",
  },
  countryItemCode: {
    ...TS.bodySm,
    marginTop: 2,
  },
  modalHint: {
    ...TS.bodySm,
    textAlign: "center",
  },
});
