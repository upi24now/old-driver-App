/**
 * onboarding-fee.tsx
 *
 * One-time registration fee screen shown ONLY to brand-new signup drivers.
 * Guard: onboardingFeeApplies === true AND onboardingFeeStatus !== "paid"
 *        AND verificationStatus !== "approved"
 *
 * Payment flow:
 *   1. Fetch fee config from Firestore (app_config/driver_onboarding)
 *   2. POST /api/driver-plans/onboarding-fee/create-order → Razorpay order
 *      Server enforces REGISTRATION_FEE_MIN_INR floor (₹10); stale ₹5 configs
 *      are clamped up automatically.
 *   3. Open RazorpayWebCheckout modal
 *   4. onSuccess → POST /api/driver-plans/onboarding-fee/verify-payment
 *      Server verifies HMAC, writes driver_payments + marks driver doc paid
 *   5. markOnboardingFeePaidLocally() → premium success modal → /verification-pending
 *
 * onboardingFeeStatus is NEVER set to "paid" without a verified Razorpay payment.
 */

import { LinearGradient } from "expo-linear-gradient";
import { SafeInlineIcon, SafeIconName, SafeIcon3D, PremiumButton3D } from "@/components/SafeIcon";
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
import { getOnboardingFeeConfig, type OnboardingFeeConfig } from "@/utils/config-api";

// ── Premium brand constants (screen-specific, outside token system) ──────────
const PINK        = "#F59E0B";
const HOT_PINK    = "#FBBF24";
const SUCCESS     = "#10B981";
const GOLD        = "#EA580C";
const MUTED       = "#6B7280";
const PINK_SOFT   = "rgba(245,158,11,0.10)";
const SUCCESS_SOFT= "rgba(16,185,129,0.12)";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ── REGISTRATION_FEE constant ─────────────────────────────────────────────────
// Client-side floor. The server enforces its own REGISTRATION_FEE_MIN_INR = 10.
// Firestore remote config may still show 5 (stale); both sides ignore it.
const REGISTRATION_FEE = 10;

const FALLBACK_CONFIG: OnboardingFeeConfig = {
  enabled:  true,
  amount:   REGISTRATION_FEE,
  currency: "INR",
  title:    "One-time onboarding fee",
};

const CHECKLIST: { icon: SafeIconName; label: string }[] = [
  { icon: "doc",     label: "Document verification" },
  { icon: "check",   label: "Verified driver badge" },
  { icon: "package", label: "Unlimited order access" },
  { icon: "support", label: "Priority support" },
];

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
      .then((cfg) => {
        // Client-side floor: clamp stale ₹5 config up to REGISTRATION_FEE.
        const clamped = { ...cfg, amount: Math.max(cfg.amount, REGISTRATION_FEE) };
        console.log("[FeeDebug] mobile fee amount =", clamped.amount);
        setConfig(clamped);
      })
      .catch(() => {
        console.log("[FeeDebug] mobile fee amount = (fallback)", REGISTRATION_FEE);
        setConfig(FALLBACK_CONFIG);
      })
      .finally(() => setConfigLoading(false));
  }, []);

  // Firestore config (clamped) → driver-doc stamp → constant floor.
  const amount   = config?.amount   ?? Math.max(onboardingFeeAmount ?? 0, REGISTRATION_FEE);
  const currency = config?.currency ?? "INR";

  // ── Create Razorpay order ─────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!driverUid || creatingOrder || verifying) return;
    setCreatingOrder(true);
    console.log("[FeeDebug] order create payload = { driverUid:", driverUid, "}");
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

      console.log("[FeeDebug] razorpay order response amount =", data.amount, "(paise) =", data.amount != null ? data.amount / 100 : "?", "INR");

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

  // ── Verify payment, then show success modal ───────────────────────────────
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

      markOnboardingFeePaidLocally();
      setShowSuccess(true);
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setVerifying(false);
    }
  }, [driverUid, markOnboardingFeePaidLocally]);

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

  const currentDate = new Date().toLocaleString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const appId = driverUid ? `DRV-${driverUid.slice(0, 6).toUpperCase()}` : "DRV-XXXXXX";

  if (configLoading) {
    return (
      <View style={[s.loadingRoot, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PINK} />
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Top header area ── */}
        <View style={s.topHeader}>
          <View style={s.pillBadge}>
            <Text style={s.pillText}>One-time fee</Text>
          </View>
          <Text style={s.pageTitle}>Registration Fee</Text>
          <View style={s.amountRow}>
            <Text style={s.amountSymbol}>₹</Text>
            <Text style={s.amountFigure}>{amount}</Text>
            <View style={s.oncePill}>
              <Text style={s.oncePillText}>one-time</Text>
            </View>
          </View>
          <Text style={s.pageSubtitle}>
            Activate your driver account and start verification.
          </Text>
        </View>

        {/* ── Main compact activation card ── */}
        <View style={s.card}>

          {/* Card header — shield-check + title */}
          <View style={s.cardHeaderRow}>
            <SafeIcon3D
              name="shield"
              size={52}
              bg={PINK}
              color="#fff"
              glow={PINK}
              rounded={16}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Driver Account Activation</Text>
              <Text style={s.cardAmountLine}>
                <Text style={s.cardAmountBig}>₹{amount}  </Text>
                <Text style={s.cardAmountSub}>One-time verification fee</Text>
              </Text>
            </View>
          </View>

          <View style={s.divider} />

          {/* Compact checklist */}
          <Text style={s.includesLabel}>Includes</Text>
          {CHECKLIST.map((item) => (
            <View key={item.label} style={s.checkRow}>
              <SafeIcon3D
                name={item.icon}
                size={26}
                bg={PINK_SOFT}
                color={PINK}
                glow={PINK}
                rounded={8}
              />
              <Text style={s.checkLabel}>{item.label}</Text>
              <SafeInlineIcon name="check" size={15} color={SUCCESS} />
            </View>
          ))}

          <View style={s.divider} />

          {/* Fee summary inline */}
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Total due today</Text>
            <Text style={s.summaryAmount}>₹{amount}</Text>
          </View>
          <Text style={s.summaryNote}>
            Non-refundable · one-time only · no recurring charges
          </Text>

          <View style={{ height: 14 }} />

          {/* Gradient CTA button */}
          <PremiumButton3D
            title={`Pay ₹${amount} — Activate Account`}
            loading={isBusy}
            disabled={isBusy}
            onPress={handlePay}
            leftIcon="lock"
            rightIcon="arrow"
            style={s.payBtn}
          />

          {/* Trust line */}
          <View style={s.trustLineRow}>
            <SafeInlineIcon name="lock" size={11} color={MUTED} />
            <Text style={s.trustLine}>
              Secure payment via Razorpay · ₹{amount} {currency}
            </Text>
          </View>

        </View>

        {/* ── Mini trust badges row ── */}
        <View style={s.badgesRow}>
          {([
            { icon: "shield" as SafeIconName, text: "Verified" },
            { icon: "check"  as SafeIconName, text: "Trusted" },
            { icon: "star"   as SafeIconName, text: "Premium Support" },
          ] as const).map((b) => (
            <View key={b.text} style={s.trustBadge}>
              <SafeInlineIcon name={b.icon} size={12} color={PINK} />
              <Text style={s.trustBadgeText}>{b.text}</Text>
            </View>
          ))}
        </View>

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

            {/* Sparkle decoration — icon only */}
            <View style={s.sparkleRow}>
              <SafeInlineIcon name="star" size={10} color={GOLD} />
              <SafeInlineIcon name="star" size={14} color={PINK} />
              <SafeInlineIcon name="star" size={9}  color={SUCCESS} />
            </View>

            {/* Triple-ring green check badge */}
            <View style={s.successRingOuter}>
              <View style={s.successRingMid}>
                <View style={s.successRingInner}>
                  <SafeInlineIcon name="check" size={32} color="#fff" />
                </View>
              </View>
            </View>

            <Text style={s.modalTitle}>Payment Successful</Text>
            <Text style={s.modalWelcome}>Welcome to Sisko Driver Network</Text>
            <Text style={s.modalPaid}>₹{amount} paid</Text>

            {/* Documents submitted row */}
            <View style={s.modalInfoCard}>
              <View style={s.modalInfoRow}>
                <SafeIcon3D name="doc" size={32} bg={PINK_SOFT} color={PINK} glow={PINK} rounded={10} />
                <View style={{ flex: 1 }}>
                  <Text style={s.modalInfoTitle}>Documents Submitted</Text>
                  <Text style={s.modalInfoSub}>Submitted on: {currentDate}</Text>
                </View>
              </View>

              <View style={s.modalDivider} />

              <View style={s.modalInfoRow}>
                <SafeIcon3D name="clock" size={32} bg={SUCCESS_SOFT} color={SUCCESS} glow={SUCCESS} rounded={10} />
                <View style={{ flex: 1 }}>
                  <Text style={s.modalInfoTitle}>Verification Pending</Text>
                  <Text style={s.modalInfoSub}>Usually within 24 hours.</Text>
                </View>
              </View>

              <View style={s.modalDivider} />

              <View style={s.modalInfoRow}>
                <SafeIcon3D name="hash" size={32} bg="rgba(99,102,241,0.10)" color="#6366F1" glow="#6366F1" rounded={10} />
                <View style={{ flex: 1 }}>
                  <Text style={s.modalInfoTitle}>Application ID</Text>
                  <Text style={s.modalInfoSub}>{appId}</Text>
                </View>
              </View>
            </View>

            <Text style={s.modalNote}>
              You will be notified once your account is approved. After approval, go online and start receiving orders.
            </Text>

            <PremiumButton3D
              title="Go to Verification Status"
              leftIcon="clock"
              bg={SUCCESS}
              bgDark="#047857"
              onPress={() => {
                setShowSuccess(false);
                router.replace("/verification-pending");
              }}
              style={{ width: "100%" }}
            />

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

  scroll: { paddingHorizontal: 18, paddingTop: 24, gap: 16 },

  // ── Top header ──
  topHeader: { alignItems: "center", gap: 6 },
  pillBadge: {
    backgroundColor: PINK_SOFT, paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, marginBottom: 2,
  },
  pillText:     { fontSize: 12, fontWeight: "700", color: PINK, fontFamily: "Inter_700Bold" },
  pageTitle:    { fontSize: 26, fontWeight: "800", color: "#1a1a1a", fontFamily: "Inter_700Bold" },
  amountRow:    { flexDirection: "row", alignItems: "baseline", gap: 2 },
  amountSymbol: { fontSize: 24, fontWeight: "700", color: PINK, fontFamily: "Inter_700Bold" },
  amountFigure: { fontSize: 52, fontWeight: "900", color: PINK, fontFamily: "Inter_700Bold", lineHeight: 60 },
  oncePill: {
    backgroundColor: PINK_SOFT, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, marginLeft: 6, alignSelf: "flex-end", marginBottom: 8,
  },
  oncePillText:  { fontSize: 11, fontWeight: "600", color: PINK, fontFamily: "Inter_600SemiBold" },
  pageSubtitle:  { fontSize: 13, color: MUTED, fontFamily: "Inter_400Regular", textAlign: "center" },

  // ── Main card ──
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  cardIconBox: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    shadowColor: PINK, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cardTitle:     { fontSize: 15, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", marginBottom: 2 },
  cardAmountLine:{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },
  cardAmountBig: { fontSize: 20, fontWeight: "800", color: PINK, fontFamily: "Inter_700Bold" },
  cardAmountSub: { fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular" },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#F0F0F0", marginVertical: 14 },

  includesLabel: { fontSize: 12, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkIconBox: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: PINK_SOFT, alignItems: "center", justifyContent: "center",
  },
  checkLabel: { flex: 1, fontSize: 13, color: "#374151", fontFamily: "Inter_400Regular" },

  summaryRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel:  { fontSize: 13, fontWeight: "600", color: "#1a1a1a", fontFamily: "Inter_600SemiBold" },
  summaryAmount: { fontSize: 20, fontWeight: "800", color: PINK, fontFamily: "Inter_700Bold" },
  summaryNote:   { fontSize: 11, color: MUTED, fontFamily: "Inter_400Regular", marginTop: 3 },

  payBtn:     { borderRadius: 14, overflow: "hidden" },
  payBtnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 16, gap: 7, borderRadius: 14,
  },
  payBtnText: { fontSize: 15, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold" },

  trustLineRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10 },
  trustLine: { textAlign: "center", fontSize: 11, color: MUTED, fontFamily: "Inter_400Regular" },

  // ── Mini trust badges ──
  badgesRow: { flexDirection: "row", justifyContent: "center", gap: 10 },
  trustBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  trustBadgeText: { fontSize: 11, fontWeight: "600", color: "#374151", fontFamily: "Inter_600SemiBold" },

  // ── Success modal ──
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: "#fff", borderRadius: 28, padding: 24,
    width: "100%", maxWidth: 400, alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },

  sparkleRow: { flexDirection: "row", gap: 6, alignItems: "center" },

  successRingOuter: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: "rgba(16,185,129,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  successRingMid: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(16,185,129,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  successRingInner: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: SUCCESS,
    alignItems: "center", justifyContent: "center",
    shadowColor: SUCCESS, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },

  modalTitle:   { fontSize: 21, fontWeight: "800", color: "#1a1a1a", fontFamily: "Inter_700Bold", textAlign: "center" },
  modalWelcome: { fontSize: 12, fontWeight: "600", color: MUTED, fontFamily: "Inter_600SemiBold", textAlign: "center", letterSpacing: 0.4 },
  modalPaid:    { fontSize: 28, fontWeight: "900", color: SUCCESS, fontFamily: "Inter_700Bold" },

  modalInfoCard: {
    backgroundColor: "#F8FAFC", borderRadius: 16, padding: 14,
    width: "100%", borderWidth: 1, borderColor: "#E5E7EB", gap: 10,
  },
  modalInfoRow:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  modalIconBox:  { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modalInfoTitle:{ fontSize: 13, fontWeight: "700", color: "#1a1a1a", fontFamily: "Inter_700Bold", marginBottom: 1 },
  modalInfoSub:  { fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular", lineHeight: 17 },
  modalDivider:  { height: StyleSheet.hairlineWidth, backgroundColor: "#E5E7EB" },

  modalNote: {
    fontSize: 12, color: MUTED, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 18,
  },

  dashBtn:     { width: "100%", borderRadius: 14, overflow: "hidden" },
  dashBtnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 15, gap: 8,
  },
  dashBtnText: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});
