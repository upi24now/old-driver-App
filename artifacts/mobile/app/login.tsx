import { SafeInlineIcon, SafeIconName, PremiumButton3D } from "@/components/SafeIcon";
import { VehicleArt, VehicleArtType } from "@/components/VehicleArt";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const B = {
  bg:           "#FFF8F5",
  navy:         "#111827",
  orange:       "#F97316",
  pink:         "#E83272",
  amber:        "#F59E0B",
  indigo:       "#6366F1",
  textSecondary:"#6B7280",
  textMuted:    "#9CA3AF",
  placeholder:  "#C4B5B0",
  white:        "#FFFFFF",
  cardBorder:   "#F3E8E2",
  inputBorder:  "#E5D5CF",
  error:        "#DC2626",
  green:        "#10B981",
} as const;

// ─── Service cards data ───────────────────────────────────────────────────────
const BIKE_IMG = require("@/assets/images/bike-delivery.png");

const SERVICES: Array<{
  artType:    VehicleArtType;
  image?:     ReturnType<typeof require>;
  title:      string;
  sub:        string;
  accent:     string;
  accentSoft: string;
}> = [
  { artType: "bike",      image: BIKE_IMG, title: "2-Wheeler", sub: "Express", accent: B.orange, accentSoft: "#FFF3E0" },
  { artType: "autoCargo",                  title: "3W Loader", sub: "Economy", accent: B.amber,  accentSoft: "#FFFBEB" },
  { artType: "truck",                      title: "4W Loader", sub: "Cargo",   accent: B.indigo, accentSoft: "#EEF2FF" },
];

// ─── Trust chips data ─────────────────────────────────────────────────────────
const CHIPS: Array<{ icon: SafeIconName; label: string; color: string; bg: string }> = [
  { icon: "lock",  label: "Secure OTP",    color: "#059669", bg: "#ECFDF5" },
  { icon: "star",  label: "Instant Signup", color: "#D97706", bg: "#FFFBEB" },
  { icon: "bell",  label: "No Spam",        color: "#DC2626", bg: "#FFF1F2" },
];

// ─── ServiceCard ──────────────────────────────────────────────────────────────
function ServiceCard({ artType, image, title, sub, accent }: typeof SERVICES[number]) {
  return (
    <View style={styles.serviceCard}>
      <View style={[styles.accentDot, { backgroundColor: accent }]} />
      {image
        ? <Image source={image} style={styles.serviceImg} resizeMode="contain" />
        : <VehicleArt type={artType} size={62} />
      }
      <Text style={styles.serviceTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.serviceSub}   numberOfLines={1}>{sub}</Text>
      <View style={[styles.accentLine, { backgroundColor: accent }]} />
    </View>
  );
}

// ─── TrustChip ────────────────────────────────────────────────────────────────
function TrustChip({ icon, label, color, bg }: typeof CHIPS[number]) {
  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: `${color}40` }]}>
      <SafeInlineIcon name={icon} size={11} color={color} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── ContinueButton ───────────────────────────────────────────────────────────
function ContinueButton({
  enabled,
  loading,
  onPress,
}: {
  enabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <PremiumButton3D
      title="CONTINUE WITH OTP"
      loading={loading}
      disabled={!enabled || loading}
      onPress={onPress}
      bg={B.orange}
      bgDark="#C85A0D"
      rightIcon={undefined}
      style={styles.ctaWrap}
    />
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

  const { setPhone: setDriverPhone, driverUid, authLoading } = useDriver();

  const digits    = phone.replace(/\D/g, "");
  const isValid   = digits.length === 10;
  const charCount = digits.length;

  async function goToOtp() {
    if (loading) return;
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
      params:   { phone: digits, devOtp: result.devOtp ?? "" },
    });
  }

  console.log("[SCREEN_MOUNT] login — authLoading =", authLoading, "driverUid =", driverUid);

  if (authLoading) {
    console.log("[SPINNER_PROOF] component = LoginSpinner — authLoading=true (brief)");
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={B.orange} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 36 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── 1. Brand Hero ── */}
        <View style={styles.hero}>
          <LinearGradient
            colors={[B.orange, B.pink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoCircle}
          >
            <Text style={styles.logoText}>BC</Text>
          </LinearGradient>

          <View style={styles.titleRow}>
            <Text style={styles.titleBike}>Bike</Text>
            <Text style={styles.titleCourier}>Courier</Text>
          </View>

          <Text style={styles.subtitle}>FAST · RELIABLE · SECURE</Text>
        </View>

        {/* ── 2. Service Cards ── */}
        <View style={styles.serviceRow}>
          {SERVICES.map((s) => (
            <ServiceCard key={s.title} {...s} />
          ))}
        </View>

        {/* ── 3. Login Card ── */}
        <View style={styles.loginCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.headerDot} />
            <Text style={styles.cardHeaderText}>MOBILE NUMBER</Text>
          </View>

          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={[styles.inputRow, focused && styles.inputRowFocused]}
          >
            <Text style={styles.countryFlag}>IN</Text>
            <Text style={styles.countryCode}>+91</Text>
            <View style={styles.inputDivider} />
            <TextInput
              ref={inputRef}
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => {
                setPhone(t.replace(/\D/g, "").slice(0, 10));
                setError("");
              }}
              keyboardType="phone-pad"
              placeholder="Mobile Number"
              placeholderTextColor={B.placeholder}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="done"
              onSubmitEditing={() => void goToOtp()}
              underlineColorAndroid="transparent"
              selectionColor={B.orange}
              {...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {})}
            />
          </Pressable>

          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width:           `${(charCount / 10) * 100}%` as `${number}%`,
                  backgroundColor: charCount === 10 ? B.green : B.orange,
                },
              ]}
            />
          </View>

          {/* Counter row */}
          <View style={styles.counterRow}>
            <Text style={styles.helperText}>
              {charCount === 10
                ? "Ready to continue!"
                : focused || charCount > 0
                  ? "Enter your 10-digit mobile number"
                  : "Tap to enter your 10-digit number"}
            </Text>
            <Text style={[styles.counter, charCount === 10 && { color: B.green }]}>
              {charCount}/10
            </Text>
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        {/* ── 4. Continue Button ── */}
        <ContinueButton
          enabled={isValid && !loading}
          loading={loading}
          onPress={() => void goToOtp()}
        />

        {/* ── 5. Trust Chips ── */}
        <View style={styles.chipsRow}>
          {CHIPS.map((c) => (
            <TrustChip key={c.label} {...c} />
          ))}
        </View>

        {/* ── 6. Terms ── */}
        <View style={styles.termsBlock}>
          <View style={styles.termsRow}>
            <Text style={styles.termsText}>By continuing, you agree to our </Text>
            <TouchableOpacity
              activeOpacity={0.7}
              hitSlop={6}
              onPress={() => router.push("/terms-and-conditions")}
            >
              <Text style={styles.termsLink}>Terms</Text>
            </TouchableOpacity>
            <Text style={styles.termsText}> & </Text>
            <TouchableOpacity
              activeOpacity={0.7}
              hitSlop={6}
              onPress={() => router.push("/privacy-policy")}
            >
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.termsNote}>
            New or existing user? Verify your mobile number with OTP.
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: B.bg,
  },

  scroll: {
    flexGrow:  1,
    alignItems:"center",
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:    "center",
    paddingBottom: 24,
    width:         "100%",
  },

  logoCircle: {
    width:          64,
    height:         64,
    borderRadius:   32,
    alignItems:     "center",
    justifyContent: "center",
    shadowColor:    B.orange,
    shadowOpacity:  0.40,
    shadowRadius:   16,
    shadowOffset:   { width: 0, height: 5 },
    elevation:      8,
  },
  logoText: {
    fontSize:      24,
    fontWeight:    "800",
    color:         B.white,
    letterSpacing: -0.5,
  },

  titleRow: {
    flexDirection: "row",
    alignItems:    "baseline",
    marginTop:     12,
    gap:           3,
  },
  titleBike: {
    fontSize:      32,
    fontWeight:    "800",
    color:         B.navy,
    letterSpacing: -1,
  },
  titleCourier: {
    fontSize:      32,
    fontWeight:    "800",
    color:         B.orange,
    letterSpacing: -1,
  },

  subtitle: {
    fontSize:      11,
    fontWeight:    "600",
    color:         B.textMuted,
    letterSpacing: 3,
    marginTop:     7,
    textTransform: "uppercase",
  },

  // ── Service Cards ─────────────────────────────────────────────────────────
  serviceRow: {
    flexDirection:     "row",
    paddingHorizontal: 20,
    gap:               10,
    width:             "100%",
    marginBottom:      20,
  },

  serviceCard: {
    flex:              1,
    backgroundColor:   B.white,
    borderRadius:      22,
    paddingVertical:   16,
    paddingHorizontal: 8,
    alignItems:        "center",
    shadowColor:       "#000",
    shadowOpacity:     0.07,
    shadowRadius:      10,
    shadowOffset:      { width: 0, height: 4 },
    elevation:         3,
    overflow:          "visible",
  },
  accentDot: {
    position:     "absolute",
    top:          10,
    right:        10,
    width:        7,
    height:       7,
    borderRadius: 4,
  },
  serviceIconWrap: {
    width:          48,
    height:         48,
    borderRadius:   14,
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   6,
  },
  serviceImg: {
    width:        72,
    height:       62,
    marginBottom: 2,
  },
  serviceTitle: {
    fontSize:  11,
    fontWeight:"700",
    color:     B.navy,
    textAlign: "center",
    marginTop: 2,
  },
  serviceSub: {
    fontSize:  10,
    color:     B.textMuted,
    marginTop: 2,
    textAlign: "center",
  },
  accentLine: {
    width:        22,
    height:       3,
    borderRadius: 2,
    marginTop:    10,
  },

  // ── Login Card ────────────────────────────────────────────────────────────
  // FIX: removed width:"100%" — conflicts with alignSelf:stretch + marginHorizontal
  // FIX: removed duplicate marginLeft/marginRight (marginHorizontal is the sole authority)
  loginCard: {
    alignSelf:         "stretch",
    marginHorizontal:  20,
    paddingHorizontal: 20,
    paddingVertical:   20,
    backgroundColor:   B.white,
    borderRadius:      24,
    borderWidth:       1,
    borderColor:       B.cardBorder,
    shadowColor:       B.orange,
    shadowOpacity:     0.08,
    shadowRadius:      20,
    shadowOffset:      { width: 0, height: 6 },
    elevation:         5,
  },

  cardHeaderRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
    marginBottom:  16,
  },
  headerDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: B.orange,
  },
  cardHeaderText: {
    fontSize:      11,
    fontWeight:    "700",
    color:         B.textMuted,
    letterSpacing: 1.8,
  },

  inputRow: {
    flexDirection:     "row",
    alignItems:        "center",
    borderWidth:       1.5,
    borderColor:       B.inputBorder,
    borderRadius:      14,
    height:            56,
    paddingHorizontal: 14,
    backgroundColor:   B.bg,
  },
  inputRowFocused: {
    borderColor:     B.orange,
    backgroundColor: "#FFFAF8",
  },

  countryFlag: {
    fontSize:      12,
    fontWeight:    "700",
    color:         B.textSecondary,
    marginRight:   4,
    letterSpacing: 0.5,
  },
  countryCode: {
    fontSize:      16,
    fontWeight:    "700",
    color:         B.navy,
    marginRight:   10,
    letterSpacing: 0.2,
  },
  inputDivider: {
    width:           1.5,
    height:          22,
    backgroundColor: B.inputBorder,
    marginRight:     12,
  },
  phoneInput: {
    flex:       1,
    fontSize:   17,
    fontWeight: "600",
    color:      B.navy,
    height:     "100%",
    ...Platform.select({
      web:     { outlineWidth: 0, outlineStyle: "none" } as object,
      default: {},
    }),
  },

  progressTrack: {
    height:          3,
    backgroundColor: "#F3F4F6",
    borderRadius:    2,
    marginTop:       10,
    overflow:        "hidden",
  },
  progressFill: {
    height:       3,
    borderRadius: 2,
  },

  counterRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginTop:      6,
  },
  helperText: {
    fontSize: 11,
    color:    B.textMuted,
    flex:     1,
  },
  counter: {
    fontSize:   12,
    fontWeight: "600",
    color:      B.textMuted,
    marginLeft: 8,
  },

  errorText: {
    fontSize:   13,
    fontWeight: "500",
    color:      B.error,
    marginTop:  10,
  },

  // ── Continue Button ───────────────────────────────────────────────────────
  // FIX: removed width:"100%", moved paddingHorizontal → marginHorizontal
  // so the gradient and shadow share the same bounding box
  ctaWrap: {
    alignSelf:        "stretch",
    marginHorizontal: 20,
    marginTop:        16,
    borderRadius:     22,
  },
  ctaPressable: {
    borderRadius: 22,
    overflow:     "hidden",
  },
  ctaGradient: {
    height:         58,
    borderRadius:   22,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
  },
  ctaText: {
    fontSize:      16,
    fontWeight:    "800",
    color:         B.white,
    letterSpacing: 0.8,
  },

  // ── Trust Chips ───────────────────────────────────────────────────────────
  chipsRow: {
    flexDirection:     "row",
    justifyContent:    "center",
    flexWrap:          "wrap",
    gap:               8,
    marginTop:         18,
    paddingHorizontal: 20,
  },
  chip: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               5,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      20,
    borderWidth:       1,
  },
  chipText: {
    fontSize:   12,
    fontWeight: "600",
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  termsBlock: {
    marginTop:         20,
    paddingHorizontal: 20,
    alignItems:        "center",
    width:             "100%",
  },
  termsRow: {
    flexDirection: "row",
    flexWrap:      "wrap",
    alignItems:    "center",
    justifyContent:"center",
    gap:           1,
  },
  termsText: {
    fontSize: 12,
    color:    B.textSecondary,
  },
  termsLink: {
    fontSize:   12,
    fontWeight: "700",
    color:      B.orange,
  },
  termsNote: {
    fontSize:   11,
    color:      B.textMuted,
    marginTop:  8,
    textAlign:  "center",
  },
});
