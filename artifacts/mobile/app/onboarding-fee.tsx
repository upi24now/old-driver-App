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
 *   5. markOnboardingFeePaidLocally() → router.replace("/verification-pending")
 *
 * onboardingFeeStatus is NEVER set to "paid" without a verified Razorpay payment.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RazorpayWebCheckout, type RazorpayCheckoutParams } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { firebaseAuth } from "@/utils/firebase";
import { getOnboardingFeeConfig, type OnboardingFeeConfig } from "@/utils/firestore";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

const FALLBACK_CONFIG: OnboardingFeeConfig = {
  enabled:  true,
  amount:   5,
  currency: "INR",
  title:    "One-time onboarding fee",
};

const BENEFITS: { icon: "shield" | "map-pin" | "headphones" | "trending-up"; title: string; subtitle: string }[] = [
  {
    icon:     "shield",
    title:    "Verified Driver Badge",
    subtitle: "Your profile is marked as background-verified for customers",
  },
  {
    icon:     "map-pin",
    title:    "Unlimited Order Access",
    subtitle: "Receive delivery orders across your city with no restrictions",
  },
  {
    icon:     "headphones",
    title:    "Priority Driver Support",
    subtitle: "Dedicated helpline and faster issue resolution",
  },
  {
    icon:     "trending-up",
    title:    "Bonus Earnings Programme",
    subtitle: "Eligible for weekly streak bonuses, referral rewards, and surge pay",
  },
];

export default function OnboardingFeeScreen() {
  const colors = useColors();
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

  useEffect(() => {
    getOnboardingFeeConfig()
      .then(setConfig)
      .catch(() => setConfig(FALLBACK_CONFIG))
      .finally(() => setConfigLoading(false));
  }, []);

  // Use freshest config amount; fall back to what was stamped on the driver doc at signup.
  const amount   = config?.amount   ?? onboardingFeeAmount ?? FALLBACK_CONFIG.amount;
  const currency = config?.currency ?? "INR";
  const title    = config?.title    ?? FALLBACK_CONFIG.title;

  // ── Create Razorpay order on server ────────────────────────────────────────
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

  // ── Verify Razorpay payment on server, then mark paid ─────────────────────
  // IMPORTANT: onboardingFeeStatus is only set to "paid" here, AFTER the server
  // has verified the Razorpay HMAC signature and written the payment record.
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

      // Server verified the signature and wrote:
      //   driver_payments/{id}  — payment record
      //   drivers/{uid}         — onboardingFeeStatus: "paid"
      // Update local React state only (no redundant client Firestore write).
      markOnboardingFeePaidLocally();
      router.replace("/verification-pending");
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setVerifying(false);
    }
  }, [driverUid, markOnboardingFeePaidLocally, router]);

  // ── Cancel / failure handlers ──────────────────────────────────────────────
  // onboardingFeeStatus stays "pending" — never marked paid without server verify.
  const handlePaymentCancel = useCallback(() => {
    Alert.alert(
      "Payment cancelled",
      "Your account was not charged. Tap 'Pay Now' to try again.",
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

  const s = styles(colors);
  const isBusy = creatingOrder || verifying;

  if (configLoading) {
    return (
      <View style={[s.root, s.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={s.loadingText}>Loading fee details…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.badgeRow}>
          <View style={s.stepBadge}>
            <Text style={s.stepBadgeText}>One-time fee</Text>
          </View>
        </View>
        <Text style={s.title}>Registration Fee</Text>
        <Text style={s.subtitle}>
          A one-time ₹{amount} fee is required to activate your driver
          account. This covers document verification and onboarding support.
        </Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Fee breakdown card ── */}
        <View style={s.feeCard}>
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>{title}</Text>
            <Text style={s.feeAmount}>₹{amount}</Text>
          </View>
          <View style={s.feeDivider} />
          <View style={s.feeRow}>
            <Text style={[s.feeLabel, s.feeTotalLabel]}>Total due today</Text>
            <Text style={[s.feeAmount, s.feeTotalAmount]}>₹{amount}</Text>
          </View>
          <View style={s.feeNote}>
            <Feather name="info" size={13} color={colors.textMuted} />
            <Text style={s.feeNoteText}>
              This is a non-refundable, one-time activation fee. You will not
              be charged again.
            </Text>
          </View>
        </View>

        {/* ── Benefits ── */}
        <Text style={s.benefitsHeading}>What you get</Text>

        {BENEFITS.map((b) => (
          <View key={b.title} style={s.benefitRow}>
            <View style={s.benefitIcon}>
              <Feather name={b.icon} size={18} color={colors.primary} />
            </View>
            <View style={s.benefitText}>
              <Text style={s.benefitTitle}>{b.title}</Text>
              <Text style={s.benefitSubtitle}>{b.subtitle}</Text>
            </View>
          </View>
        ))}

        {/* ── Pay button ── */}
        <TouchableOpacity
          style={[s.payBtn, isBusy && s.payBtnDisabled]}
          onPress={handlePay}
          disabled={isBusy}
          activeOpacity={0.85}
        >
          {isBusy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather
                name="lock"
                size={16}
                color={colors.primaryForeground}
                style={s.payIcon}
              />
              <Text style={s.payBtnText}>
                Pay ₹{amount} — Activate Account
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={s.secureNote}>
          🔒 Secure payment via Razorpay · ₹{amount} {currency}
        </Text>

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

    </View>
  );
}

function styles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex:            1,
      backgroundColor: c.background,
    },
    centered: {
      alignItems:     "center",
      justifyContent: "center",
      gap:            12,
    },
    loadingText: {
      fontSize:   14,
      color:      c.textMuted,
      fontFamily: "Inter_400Regular",
    },

    // ── Header ──
    header: {
      paddingHorizontal: 24,
      paddingTop:        16,
      paddingBottom:     20,
      backgroundColor:   c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    badgeRow: {
      flexDirection: "row",
      marginBottom:  10,
    },
    stepBadge: {
      backgroundColor:  c.primarySoft,
      paddingHorizontal: 10,
      paddingVertical:  4,
      borderRadius:     20,
    },
    stepBadgeText: {
      fontSize:   12,
      fontWeight: "600",
      color:      c.primary,
      fontFamily: "Inter_600SemiBold",
    },
    title: {
      fontSize:     26,
      fontWeight:   "700",
      color:        c.text,
      fontFamily:   "Inter_700Bold",
      marginBottom: 6,
    },
    subtitle: {
      fontSize:   14,
      color:      c.textSecondary,
      fontFamily: "Inter_400Regular",
      lineHeight: 21,
    },

    // ── Scroll ──
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop:        24,
      gap:               16,
    },

    // ── Fee card ──
    feeCard: {
      backgroundColor: c.surface,
      borderRadius:    16,
      padding:         20,
      borderWidth:     StyleSheet.hairlineWidth,
      borderColor:     c.border,
      shadowColor:     "#000",
      shadowOpacity:   0.04,
      shadowRadius:    8,
      shadowOffset:    { width: 0, height: 2 },
      elevation:       2,
    },
    feeRow: {
      flexDirection:  "row",
      justifyContent: "space-between",
      alignItems:     "center",
    },
    feeLabel: {
      fontSize:   14,
      color:      c.textSecondary,
      fontFamily: "Inter_400Regular",
      flex:       1,
      marginRight: 8,
    },
    feeAmount: {
      fontSize:   16,
      color:      c.text,
      fontFamily: "Inter_600SemiBold",
    },
    feeDivider: {
      height:          StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginVertical:  14,
    },
    feeTotalLabel: {
      fontSize:   15,
      fontWeight: "600",
      color:      c.text,
      fontFamily: "Inter_600SemiBold",
    },
    feeTotalAmount: {
      fontSize:   22,
      fontWeight: "700",
      color:      c.primary,
      fontFamily: "Inter_700Bold",
    },
    feeNote: {
      flexDirection:   "row",
      alignItems:      "flex-start",
      gap:             6,
      marginTop:       14,
      backgroundColor: c.muted,
      padding:         10,
      borderRadius:    10,
    },
    feeNoteText: {
      flex:       1,
      fontSize:   12,
      color:      c.textMuted,
      fontFamily: "Inter_400Regular",
      lineHeight: 17,
    },

    // ── Benefits ──
    benefitsHeading: {
      fontSize:   16,
      fontWeight: "600",
      color:      c.text,
      fontFamily: "Inter_600SemiBold",
      marginTop:  8,
    },
    benefitRow: {
      flexDirection:   "row",
      alignItems:      "flex-start",
      gap:             14,
      backgroundColor: c.surface,
      borderRadius:    12,
      padding:         14,
      borderWidth:     StyleSheet.hairlineWidth,
      borderColor:     c.border,
    },
    benefitIcon: {
      width:           36,
      height:          36,
      borderRadius:    10,
      backgroundColor: c.primarySoft,
      alignItems:      "center",
      justifyContent:  "center",
    },
    benefitText: {
      flex: 1,
    },
    benefitTitle: {
      fontSize:     14,
      fontWeight:   "600",
      color:        c.text,
      fontFamily:   "Inter_600SemiBold",
      marginBottom: 2,
    },
    benefitSubtitle: {
      fontSize:   13,
      color:      c.textSecondary,
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },

    // ── Pay button ──
    payBtn: {
      backgroundColor: c.primary,
      borderRadius:    14,
      height:          54,
      flexDirection:   "row",
      alignItems:      "center",
      justifyContent:  "center",
      marginTop:       8,
      gap:             8,
      shadowColor:     c.primary,
      shadowOpacity:   0.35,
      shadowRadius:    10,
      shadowOffset:    { width: 0, height: 4 },
      elevation:       5,
    },
    payBtnDisabled: {
      opacity: 0.65,
    },
    payIcon: {
      marginRight: 2,
    },
    payBtnText: {
      fontSize:   16,
      fontWeight: "700",
      color:      c.primaryForeground,
      fontFamily: "Inter_700Bold",
    },
    secureNote: {
      textAlign:  "center",
      fontSize:   12,
      color:      c.textMuted,
      fontFamily: "Inter_400Regular",
      marginTop:  4,
    },
  });
}
