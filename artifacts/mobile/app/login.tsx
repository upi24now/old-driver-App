import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
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

// ─── Design tokens (self-contained — no theme dependency) ────────────────────
const D = {
  bg:            "#F6F7FB",
  textPrimary:   "#0F172A",
  textSecondary: "#6B7280",
  cardBg:        "#FFFFFF",
  activeCard:    "#FFF3BF",
  gradStart:     "#FFD43B",
  gradEnd:       "#FFA726",
  greenLine:     "#22C55E",
  border:        "#E5E7EB",
  inputBorder:   "#D1D5DB",
  error:         "#DC2626",
  signUpGold:    "#F59E0B",
  placeholder:   "#9CA3AF",
  white:         "#FFFFFF",
} as const;

const VEHICLES = [
  { icon: "motorbike" as const, label: "Motorcycle" },
  { icon: "car"       as const, label: "Auto"       },
  { icon: "truck"     as const, label: "Truck"      },
] as const;

// ─── Vehicle Card ─────────────────────────────────────────────────────────────
function VehicleCard({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(active ? 1.06 : 1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: active ? 1.06 : 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  }, [active]);

  return (
    <Pressable onPress={onPress} style={styles.vehicleHitArea}>
      <Animated.View
        style={[
          styles.vehicleCard,
          active && styles.vehicleCardActive,
          { transform: [{ scale }] },
        ]}
      >
        <MaterialCommunityIcons
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          name={icon as any}
          size={30}
          color={active ? D.textPrimary : D.textSecondary}
        />
        <Text
          style={[
            styles.vehicleLabel,
            active && styles.vehicleLabelActive,
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Login Button ─────────────────────────────────────────────────────────────
function LoginButton({
  enabled,
  loading,
  onPress,
}: {
  enabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn  = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 40, bounciness: 4 }).start();

  return (
    <Animated.View style={[styles.btnWrap, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={!enabled}
        style={styles.btnPressable}
      >
        <LinearGradient
          colors={enabled ? [D.gradStart, D.gradEnd] : ["#D1D5DB", "#D1D5DB"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.btnGradient}
        >
          {loading ? (
            <ActivityIndicator size="small" color={D.white} />
          ) : (
            <Text style={[styles.btnText, !enabled && { color: "#9CA3AF" }]}>
              Login
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [phone,   setPhone]   = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [activeVehicle, setActiveVehicle] = useState(1);

  const { setPhone: setDriverPhone, driverUid, authLoading } = useDriver();

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

  if (authLoading) {
    return (
      <View style={[styles.root, { backgroundColor: D.bg, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={D.gradEnd} />
      </View>
    );
  }

  if (driverUid) {
    return (
      <View style={[styles.root, { backgroundColor: D.bg, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={D.gradEnd} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: D.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand heading ── */}
        <Text style={styles.brandTitle}>Ride Partner</Text>
        <Text style={styles.brandSubtitle}>Welcome back, driver</Text>

        {/* ── Vehicle selector row ── */}
        <View style={styles.vehicleRow}>
          {VEHICLES.map((v, i) => (
            <VehicleCard
              key={v.label}
              icon={v.icon}
              label={v.label}
              active={activeVehicle === i}
              onPress={() => setActiveVehicle(i)}
            />
          ))}
        </View>

        {/* ── Login card ── */}
        <View style={styles.loginCard}>
          <Text style={styles.cardHeading}>Driver Login</Text>

          {/* Mobile Number field */}
          <Text style={styles.fieldLabel}>Mobile Number</Text>
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={[
              styles.inputRow,
              focused && styles.inputRowFocused,
            ]}
          >
            <Text style={styles.countryCode}>+91</Text>
            <View style={styles.inputDivider} />
            <TextInput
              ref={inputRef}
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="Mobile Number"
              placeholderTextColor={D.placeholder}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="done"
              onSubmitEditing={() => void goToOtp()}
              underlineColorAndroid="transparent"
              selectionColor={D.gradEnd}
              {...(Platform.OS === "web" ? { outlineWidth: 0 } as object : {})}
            />
          </Pressable>

          {/* Green progress line */}
          <View style={styles.progressLine} />

          {/* Error */}
          {!!error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* Login button */}
          <LoginButton
            enabled={isValid && !loading}
            loading={loading}
            onPress={() => void goToOtp()}
          />

          {/* Sign up row */}
          <View style={styles.signupRow}>
            <Text style={styles.signupGray}>New driver? </Text>
            <TouchableOpacity
              activeOpacity={0.6}
              hitSlop={8}
              onPress={() => void goToOtp()}
              disabled={loading}
            >
              <Text style={styles.signupGold}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Terms ── */}
        <View style={styles.termsRow}>
          <Text style={styles.termsText}>By continuing you agree to our </Text>
          <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/terms-and-conditions")}>
            <Text style={styles.termsLink}>Terms</Text>
          </TouchableOpacity>
          <Text style={styles.termsText}> & </Text>
          <TouchableOpacity activeOpacity={0.7} hitSlop={6} onPress={() => router.push("/privacy-policy")}>
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    alignItems: "center",
  },

  // Brand
  brandTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: D.textPrimary,
    letterSpacing: -0.5,
    textAlign: "center",
    marginBottom: 6,
  },
  brandSubtitle: {
    fontSize: 15,
    fontWeight: "400",
    color: D.textSecondary,
    textAlign: "center",
    marginBottom: 28,
  },

  // Vehicle row
  vehicleRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 14,
    marginBottom: 28,
    width: "100%",
  },
  vehicleHitArea: {
    flex: 1,
    maxWidth: 100,
    alignItems: "center",
  },
  vehicleCard: {
    width: 82,
    height: 82,
    borderRadius: 20,
    backgroundColor: D.white,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  vehicleCardActive: {
    backgroundColor: D.activeCard,
    shadowColor: "#F59E0B",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  vehicleIcon: {
    marginBottom: 2,
  },
  vehicleLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: D.textSecondary,
    letterSpacing: 0.1,
  },
  vehicleLabelActive: {
    color: D.textPrimary,
    fontWeight: "600",
  },

  // Login card
  loginCard: {
    width: "100%",
    backgroundColor: D.white,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    marginBottom: 20,
  },
  cardHeading: {
    fontSize: 28,
    fontWeight: "800",
    color: D.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 22,
  },

  // Field
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: D.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: D.inputBorder,
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: D.white,
  },
  inputRowFocused: {
    borderColor: D.gradEnd,
  },
  countryCode: {
    fontSize: 17,
    fontWeight: "700",
    color: D.textPrimary,
    letterSpacing: 0.2,
    paddingRight: 12,
  },
  inputDivider: {
    width: 1.5,
    height: 22,
    backgroundColor: D.inputBorder,
    marginRight: 12,
  },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: D.textPrimary,
    height: "100%",
    ...Platform.select({
      web: { outlineWidth: 0, outlineStyle: "none" } as object,
      default: {},
    }),
  },

  // Progress line
  progressLine: {
    height: 3,
    backgroundColor: D.greenLine,
    borderRadius: 2,
    marginTop: 14,
    marginBottom: 6,
  },

  // Error
  errorText: {
    fontSize: 13,
    fontWeight: "500",
    color: D.error,
    marginTop: 8,
    marginBottom: 2,
  },

  // Button
  btnWrap: {
    marginTop: 22,
    borderRadius: 16,
    shadowColor: D.gradEnd,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  btnPressable: {
    borderRadius: 16,
    overflow: "hidden",
  },
  btnGradient: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 17,
    fontWeight: "800",
    color: D.white,
    letterSpacing: 0.3,
  },

  // Sign up
  signupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  signupGray: {
    fontSize: 14,
    fontWeight: "400",
    color: D.textSecondary,
  },
  signupGold: {
    fontSize: 14,
    fontWeight: "700",
    color: D.signUpGold,
  },

  // Terms
  termsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    gap: 1,
  },
  termsText: {
    fontSize: 12,
    color: D.textSecondary,
  },
  termsLink: {
    fontSize: 12,
    fontWeight: "700",
    color: D.signUpGold,
  },
});
