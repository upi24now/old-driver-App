/**
 * onboarding-fee.tsx
 *
 * One-time registration fee screen shown ONLY to brand-new signup drivers.
 * Guard: onboardingFeeApplies === true AND onboardingFeeStatus !== "paid"
 *        AND verificationStatus !== "approved"
 *
 * Existing / approved / old drivers are NEVER routed here:
 *   - deriveNextRoute() requires onboardingFeeApplies === true (set at createDriverDoc)
 *   - _layout.tsx auth-restore guard uses the same condition
 *   - Existing drivers never have onboardingFeeApplies in their Firestore doc
 *
 * Payment flow:
 *   1. Fetch fee config from Firestore (app_config/driver_onboarding)
 *   2. POST /api/driver-plans/onboarding-fee/create-order → Razorpay order
 *   3. Open RazorpayWebCheckout modal
 *   4. onSuccess → POST /api/driver-plans/onboarding-fee/verify-payment
 *      Server verifies HMAC, writes driver_payments record + marks driver doc paid
 *   5. markOnboardingFeePaidLocally() → show success modal → router.replace("/verification-pending")
 *
 * onboardingFeeStatus is NEVER set to "paid" without a verified Razorpay payment.
 */

import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RazorpayWebCheckout, type RazorpayCheckoutParams } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { firebaseAuth } from "@/utils/firebase";
import { getOnboardingFeeConfig, type OnboardingFeeConfig } from "@/utils/firestore";

// ── Premium brand constants (screen-specific, intentionally outside the token system) ──
// Mirrors the pattern used in active-delivery.tsx for module-level brand constants.
const PINK         = "#E83272";
const HOT_PINK     = "#F43F8F";
const DEEP_PURPLE  = "#1F1235";
const SUCCESS      = "#10B981";
const GOLD         = "#F59E0B";
const CARD_BG      = "#FFFFFF";
const MUTED        = "#6B7280";
const PINK_SOFT    = "rgba(232,50,114,0.10)";
const SUCCESS_SOFT = "rgba(16,185,129,0.12)";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ── Registration fee = ₹10 ────────────────────────────────────────────────────
// Firestore app_config/driver_onboarding is the authoritative source.
// This fallback is used only when that doc is absent or unreachable.
const REGISTRATION_FEE = 10;

const FALLBACK_CONFIG: OnboardingFeeConfig = {
  enabled:  true,
  amount:   REGISTRATION_FEE,
  currency: "INR",
  title:    "One-time onboarding fee",
};

const BENEFITS: {
  icon:     "shield" | "map-pin" | "headphones" | "trending-up";
  title:    string;
  subtitle: string;
  color:    string;
  bg:       string;
}[] = [
  {
    icon:     "shield",
    title:    "Verified Driver Badge",
    subtitle: "Your profile is marked as background-verified for customers",
    color:    PINK,
    bg:       PINK_SOFT,
  },
  {
    icon:     "map-pin",
    title:    "Unlimited Order Access",
    subtitle: "Receive delivery orders across your city with no restrictions",
    color:    "#6366F1",
    bg:       "rgba(99,102,241,0.10)",
  },
  {
    icon:     "headphones",
    title:    "Priority Driver Support",
    subtitle: "Dedicated helpline and faster issue resolution",
    color:    "#0EA5E9",
    bg:       "rgba(14,165,233,0.10)",
  },
  {
    icon:     "trending-up",
    title:    "Bonus Earnings Programme",
    subtitle: "Eligible for weekly streak bonuses, referral rewards, and surge pay",
    color:    GOLD,
    bg:       "rgba(245,158,11,0.12)",
  },
];

const MINI_BADGES = ["✓  Verified", "🛡  Trusted", "★  Premium Support"];

export default function OnboardingFeeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    driverUid,
    phone,
    onboardingFeeAmount,
    markOnboardingFeePaidLocally,
  } = useDriver();

  const [config,          setConfig]          = useState<OnboardingFeeConfig | null>(null);
  const [configLoading,   setConfigLoading]   = useState(true);
  const [creatingOrder,   setCreatingOrder]   = useState(false);
  const [verifying,       setVerifying]       = useState(false);
  const [checkoutParams,  setCheckoutParams]  = useState<RazorpayCheckoutParams | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [showSuccess,     setShowSuccess]     = useState(false);

  useEffect(() => {
    getOnboardingFeeConfig()
      .then(setConfig)
      .catch(() => setConfig(FALLBACK_CONFIG))
      .finally(() => setConfigLoading(false));
  }, []);

  // Firestore config is authoritative; fall back to driver-doc stamp, then constant.
  const amount   = config?.amount   ?? onboardingFeeAmount ?? REGISTRATION_FEE;
  const currency = config?.currency ?? "INR";

  // ── Create Razorpay order on server ──────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!driverUid || creatingOrder || verifying) return;
    setCreatingOrder(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert("Error", "Not logged in. Please sign in again.");
        return;
      }
      const token = await user.getIdToken();

      const res = await fetch(`${API_BASE}/driver-plans/onboarding-fee/create-order`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ driverUid }),
      });

      const data = (await res.json()) as {
        razorpayOrderId?: string;
        amount?:          number;
        currency?:        string;
        keyId?:           string;
        error?:           string;
      };

      if (!res.ok || !data.razorpayOrderId || data.amount == null || !data.keyId) {
        Alert.alert("Error", data.error ?? "Could not start payment. Please try again.");
        return;
      }

      setCheckoutParams({
        razorpayOrderId: data.razorpayOrderId,
        amount:          data.amount,
        currency:        data.currency ?? "INR",
        keyId:           data.keyId,
        planName:        "Registration",
        driverPhone:     phone ?? "",
      });
      setCheckoutVisible(true);
    } catch {
      Alert.alert("Error", "Could not start payment. Check your connection.");
    } finally {
      setCreatingOrder(false);
    }
  }, [driverUid, phone, creatingOrder, verifying]);

  // ── Verify Razorpay payment on server, then show success modal ────────────
  // IMPORTANT: onboardingFeeStatus is only set to "paid" after the server has
  // verified the Razorpay HMAC signature and written the payment record.
  const handlePaymentSuccess = useCallback(async (
    paymentId: string,
    orderId:   string,
    signature: string,
  ) => {
    if (!driverUid) return;
    setVerifying(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();

      const res = await fetch(`${API_BASE}/driver-plans/onboarding-fee/verify-payment`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          driverUid,
          razorpayOrderId:   orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        Alert.alert(
          "Verification failed",
          data.error ?? "Payment could not be verified. Please contact support.",
          [{ text: "OK" }],
        );
        return;
      }

      // Server verified + wrote all Firestore fields. Update local state then
      // show the success modal (navigation happens from inside the modal).
      markOnboardingFeePaidLocally();
      setShowSuccess(true);
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setVerifying(false);
    }
  }, [driverUid, markOnboardingFeePaidLocally]);

  // ── Cancel / failure ──────────────────────────────────────────────────────
  const handlePaymentCancel = useCallback(() => {
    Alert.alert(
      "Payment cancelled",
      "Your account was not charged. Tap 'Pay ₹10 — Activate Account' to try again.",
      [{ text: "OK" }],
    );
  }, []);

  const handlePaymentFailure = useCallback((error: string) => {
    Alert.alert(
      "Payment failed",
      error || "Something went wrong with the payment. Please try again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Try Again", onPress: handlePay },
      ],
    );
  }, [handlePay]);

  const isBusy = creatingOrder || verifying;

  const currentDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  if (configLoading) {
    return (
      <View style={[s.loadingRoot, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PINK} />
        <Text style={s.loadingText}>Loading fee details…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Premium Header ── */}
      <LinearGradient colors={["#FFF0F6", "#FFF7FB", "#FAFAFC"]} style={s.header}>

        <View style={s.badgeRow}>
          <View style={s.badge}>
            <Text style={s.badgeText}>One-time fee</Text>
          </View>
        </View>

        <View style={s.heroRow}>
          {/* Shield hero — icon only, no image assets */}
          <View style={s.shieldWrap}>
            <LinearGradient colors={[PINK, HOT_PINK]} style={s.shieldGrad}>
              <Feather name="shield" size={28} color="#fff" />
            </LinearGradient>
            <View style={s.shieldCheck}>
              <Text style={{ fontSize: 10, color: "#fff", fontWeight: "900" }}>✓</Text>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Registration Fee</Text>
            <View style={s.amountRow}>
              <Text style={s.amountCurrency}>₹</Text>
              <Text style={s.amountValue}>{amount}</Text>
              <View style={s.onceTag}>
                <Text style={s.onceTagText}>one-time</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={s.subtitle}>
          A one-time ₹{amount} activation fee is required to activate your driver account.
          This covers document verification and onboarding support.
        </Text>

      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Fee Summary Card ── */}
        <View style={s.feeCard}>
          <View style={s.feeCardHeader}>
            <Feather name="file-text" size={15} color={PINK} />
            <Text style={s.feeCardTitle}>Fee Summary</Text>
          </View>
          <View style={s.feeDivider} />
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>One-time onboarding fee</Text>
            <Text style={s.feeAmt}>₹{amount}</Text>
          </View>
          <View style={s.feeDivider} />
          <View style={s.feeRow}>
            <Text style={[s.feeLabel, s.feeLabelBold]}>Total due today</Text>
            <Text style={s.feeTotalAmt}>₹{amount}</Text>
          </View>
          <View style={s.feeNote}>
            <Feather name="info" size={12} color={MUTED} />
            <Text style={s.feeNoteText}>
              This is a non-refundable, one-time activation fee. You will not be charged again.
            </Text>
          </View>
        </View>

        {/* ── Benefits ── */}
        <Text style={s.sectionTitle}>What you get</Text>

        {BENEFITS.map((b) => (
          <View key={b.title} style={s.benefitCard}>
            <View style={[s.benefitIconBox, { backgroundColor: b.bg }]}>
              <Feather name={b.icon} size={20} color={b.color} />
            </View>
            <View style={s.benefitBody}>
              <Text style={s.benefitTitle}>{b.title}</Text>
              <Text style={s.benefitSub}>{b.subtitle}</Text>
            </View>
            <View style={[s.checkBadge, { backgroundColor: SUCCESS_SOFT }]}>
              <Feather name="check" size={13} color={SUCCESS} />
            </View>
          </View>
        ))}

        {/* ── Premium Activation Card (dark gradient) ── */}
        <LinearGradient
          colors={[DEEP_PURPLE, "#2D1B5C", "#3A1F6E"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.activationCard}
        >
          <View style={s.activationTop}>
            <LinearGradient colors={[PINK, HOT_PINK]} style={s.activationIconBox}>
              <Feather name="zap" size={20} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={s.activationTitle}>Activate & Start Earning</Text>
              <Text style={s.activationSubtitle}>
                Complete your registration and unlock all benefits instantly.
              </Text>
            </View>
          </View>

          <View style={s.miniBadgesRow}>
            {MINI_BADGES.map((b) => (
              <View key={b} style={s.miniBadge}>
                <Text style={s.miniBadgeText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* Gradient CTA button */}
          <TouchableOpacity
            style={[s.payBtn, isBusy && { opacity: 0.65 }]}
            onPress={handlePay}
            disabled={isBusy}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[PINK, HOT_PINK]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.payBtnGrad}
            >
              {isBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="lock" size={16} color="#fff" />
                  <Text style={s.payBtnText}>Pay ₹{amount} — Activate Account  →</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <Text style={s.secureNote}>
            🔒  Secure payment via Razorpay · ₹{amount} {currency}
          </Text>

        </LinearGradient>

      </ScrollView>

      {/* ── Razorpay checkout modal ── */}
      {checkoutParams && (
        <RazorpayWebCheckout
          visible={checkoutVisible}
          params={checkoutParams}
          onSuccess={handlePaymentSuccess}
          onCancel={handlePaymentCancel}
          onFailure={handlePaymentFailure}
          onClose={() => setCheckoutVisible(false)}
        />
      )}

      {/* ── Premium Success Modal ── */}
      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          setShowSuccess(false);
          router.replace("/verification-pending");
        }}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>

            {/* Sparkle row — icon-only decoration */}
            <View style={s.sparkleRow}>
              <Text style={[s.sparkle, { fontSize: 10, color: GOLD }]}>✦</Text>
              <Text style={[s.sparkle, { fontSize: 14, color: PINK }]}>✦</Text>
              <Text style={[s.sparkle, { fontSize: 9, color: SUCCESS }]}>✦</Text>
            </View>

            {/* Green triple-ring check badge */}
            <View style={s.successBadgeOuter}>
              <View style={s.successBadgeMid}>
                <View style={s.successBadgeInner}>
                  <Feather name="check" size={34} color="#fff" />
                </View>
              </View>
            </View>

            <Text style={s.modalTitle}>Payment Successful</Text>
            <Text style={s.modalSubtitle}>
              Your driver onboarding has been submitted successfully.
            </Text>

            <Text style={s.modalDateText}>
              Your documents were submitted on{" "}
              <Text style={{ fontWeight: "700", color: "#1a1a1a" }}>{currentDate}</Text>.
              {" "}Our verification team will review your profile within 24 hours.
            </Text>

            {/* Status highlight card */}
            <View style={s.statusCard}>
              <View style={s.statusRow}>
                <View style={s.statusDot} />
                <View>
                  <Text style={s.statusLabel}>Verification Status</Text>
                  <Text style={s.statusValue}>Pending Review</Text>
                </View>
              </View>
              <View style={s.statusDivider} />
              <View style={s.statusRow}>
                <Feather name="clock" size={14} color={GOLD} />
                <View style={{ marginLeft: 10 }}>
                  <Text style={s.statusLabel}>Expected Approval</Text>
                  <Text style={s.statusValue}>Within 24 hours</Text>
                </View>
              </View>
            </View>

            <Text style={s.modalNote}>
              You will be notified once your account is verified. After approval, you can go online and start receiving orders.
            </Text>

            <TouchableOpacity
              style={s.dashBtn}
              onPress={() => {
                setShowSuccess(false);
                router.replace("/verification-pending");
              }}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={[SUCCESS, "#059669"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.dashBtnGrad}
              >
                <Feather name="home" size={16} color="#fff" />
                <Text style={s.dashBtnText}>Go to Dashboard</Text>
              </LinearGradient>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#FFF7FB" },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#FFF7FB" },
  loadingText: { fontSize: 14, color: MUTED, fontFamily: "Inter_400Regular" },

  // ── Header ──
  header: {
    paddingHorizontal: 22,
    paddingTop:        16,
    paddingBottom:     24,
  },
  badgeRow:  { flexDirection: "row", marginBottom: 16 },
  badge:     { backgroundColor: PINK_SOFT, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: "700", color: PINK, fontFamily: "Inter_700Bold" },

  heroRow: { flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 14 },

  shieldWrap: { position: "relative" },
  shieldGrad: {
    width: 60, height: 60, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: PINK, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shieldCheck: {
    position: "absolute", bottom: -5, right: -5,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: SUCCESS,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: "#fff",
  },

  title:          { fontSize: 24, fontWeight: "800", color: "#1a1a1a", fontFamily: "Inter_700Bold" },
  amountRow:      { flexDirection: "row", alignItems: "baseline", gap: 2, marginTop: 4 },
  amountCurrency: { fontSize: 22, fontWeight: "700", color: PINK, fontFamily: "Inter_700Bold" },
  amountValue:    { fontSize: 44, fontWeight: "800", color: PINK, fontFamily: "Inter_700Bold", lineHeight: 52 },
  onceTag: {
    backgroundColor: PINK_SOFT, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, marginLeft: 6, alignSelf: "flex-end", marginBottom: 7,
  },
  onceTagText: { fontSize: 11, fontWeight: "600", color: PINK, fontFamily: "Inter_600SemiBold" },
  subtitle:    { fontSize: 13, color: "#4B5563", fontFamily: "Inter_400Regular", lineHeight: 20 },

  // ── Scroll ──
  scroll: { paddingHorizontal: 18, paddingTop: 20, gap: 14 },

  // ── Fee card ──
  feeCard: {
    backgroundColor: CARD_BG, borderRadius: 20, padding: 18,
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  feeCardHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  feeCardTitle:  { fontSize: 13, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold" },
  feeDivider:    { height: StyleSheet.hairlineWidth, backgroundColor: "#F0F0F0", marginVertical: 12 },
  feeRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  feeLabel:      { fontSize: 13, color: MUTED, fontFamily: "Inter_400Regular" },
  feeLabelBold:  { fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", fontSize: 14 },
  feeAmt:        { fontSize: 14, fontWeight: "600", color: "#1a1a1a", fontFamily: "Inter_600SemiBold" },
  feeTotalAmt:   { fontSize: 26, fontWeight: "800", color: PINK, fontFamily: "Inter_700Bold" },
  feeNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 14,
    backgroundColor: "#F9FAFB", padding: 10, borderRadius: 10,
  },
  feeNoteText: { flex: 1, fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular", lineHeight: 17 },

  // ── Section title ──
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", marginTop: 4 },

  // ── Benefit cards ──
  benefitCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: CARD_BG, borderRadius: 18, padding: 16,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  benefitIconBox: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  benefitBody:    { flex: 1 },
  benefitTitle:   { fontSize: 14, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", marginBottom: 2 },
  benefitSub:     { fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular", lineHeight: 17 },
  checkBadge:     { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  // ── Premium activation card ──
  activationCard: {
    borderRadius: 24, padding: 22, gap: 16,
    shadowColor: DEEP_PURPLE, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  activationTop:      { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  activationIconBox:  { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  activationTitle:    { fontSize: 17, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold", marginBottom: 4 },
  activationSubtitle: { fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_400Regular", lineHeight: 19 },

  miniBadgesRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  miniBadge: {
    backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.20)",
  },
  miniBadgeText: { fontSize: 12, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },

  // ── Pay button ──
  payBtn:     { borderRadius: 16, overflow: "hidden" },
  payBtnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 17, gap: 8, borderRadius: 16,
  },
  payBtnText:  { fontSize: 16, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold" },
  secureNote:  { textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.60)", fontFamily: "Inter_400Regular" },

  // ── Success modal ──
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: CARD_BG, borderRadius: 28, padding: 26,
    width: "100%", maxWidth: 400,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 10 },
    elevation: 20, alignItems: "center", gap: 12,
  },

  sparkleRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  sparkle:    { fontSize: 12, fontWeight: "900" },

  successBadgeOuter: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "rgba(16,185,129,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  successBadgeMid: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: "rgba(16,185,129,0.16)",
    alignItems: "center", justifyContent: "center",
  },
  successBadgeInner: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: SUCCESS,
    alignItems: "center", justifyContent: "center",
    shadowColor: SUCCESS, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  modalTitle:    { fontSize: 22, fontWeight: "800", color: "#1a1a1a", fontFamily: "Inter_700Bold", textAlign: "center" },
  modalSubtitle: { fontSize: 14, color: "#4B5563", fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  modalDateText: { fontSize: 13, color: MUTED, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  statusCard: {
    backgroundColor: "#F0FDF9", borderRadius: 16, padding: 16,
    width: "100%", borderWidth: 1, borderColor: "rgba(16,185,129,0.22)", gap: 12,
  },
  statusRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD },
  statusDivider:{ height: StyleSheet.hairlineWidth, backgroundColor: "rgba(16,185,129,0.22)" },
  statusLabel:  { fontSize: 11, color: MUTED, fontFamily: "Inter_400Regular" },
  statusValue:  { fontSize: 14, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold" },

  modalNote: {
    fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 18,
  },

  dashBtn:     { width: "100%", borderRadius: 16, overflow: "hidden" },
  dashBtnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 16, gap: 8,
  },
  dashBtnText: { fontSize: 16, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});
