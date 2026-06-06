/**
 * onboarding-fee.tsx
 *
 * One-time registration fee screen shown ONLY to new signup drivers.
 * Appears after document upload, before verification-pending.
 *
 * Existing approved drivers NEVER reach this screen:
 *   - deriveNextRoute() skips it when verificationStatus === "approved"
 *   - _layout.tsx auth-restore guard skips it the same way
 *
 * On payment confirmation → marks onboardingFeeStatus = "paid" in Firestore
 * → navigates to /verification-pending.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
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

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

const FEE_AMOUNT = 499;

const BENEFITS: { icon: string; title: string; subtitle: string }[] = [
  {
    icon: "shield",
    title: "Verified Driver Badge",
    subtitle: "Your profile is marked as background-verified for customers",
  },
  {
    icon: "map-pin",
    title: "Unlimited Order Access",
    subtitle: "Receive delivery orders across your city with no cap",
  },
  {
    icon: "headphones",
    title: "Priority Driver Support",
    subtitle: "Dedicated helpline and faster issue resolution",
  },
  {
    icon: "trending-up",
    title: "Bonus Earnings Programme",
    subtitle: "Eligible for weekly streaks, referral rewards and surge bonuses",
  },
];

export default function OnboardingFeeScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { markOnboardingFeePaid, driverUid } = useDriver();

  const [paying, setPaying] = useState(false);

  const s = styles(colors);

  async function handlePay() {
    if (!driverUid) return;
    setPaying(true);
    try {
      await markOnboardingFeePaid();
      router.replace("/verification-pending");
    } catch {
      setPaying(false);
      Alert.alert(
        "Payment Failed",
        "We couldn't process your payment right now. Please try again.",
        [{ text: "OK" }],
      );
    }
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
          A one-time ₹{FEE_AMOUNT} fee is required to activate your driver
          account. This covers document verification, background checks, and
          onboarding support.
        </Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Fee breakdown card ── */}
        <View style={s.feeCard}>
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>One-time registration fee</Text>
            <Text style={s.feeAmount}>₹{FEE_AMOUNT}</Text>
          </View>
          <View style={s.feeDivider} />
          <View style={s.feeRow}>
            <Text style={[s.feeLabel, s.feeTotalLabel]}>Total due today</Text>
            <Text style={[s.feeAmount, s.feeTotalAmount]}>₹{FEE_AMOUNT}</Text>
          </View>
          <View style={s.feeNote}>
            <Feather name="info" size={13} color={colors.textMuted} />
            <Text style={s.feeNoteText}>
              This is a non-refundable, one-time fee. You will not be charged
              again after activation.
            </Text>
          </View>
        </View>

        {/* ── Benefits ── */}
        <Text style={s.benefitsHeading}>What you get</Text>
        {BENEFITS.map((b) => (
          <View key={b.title} style={s.benefitRow}>
            <View style={s.benefitIcon}>
              <Feather name={b.icon as any} size={18} color={colors.primary} />
            </View>
            <View style={s.benefitText}>
              <Text style={s.benefitTitle}>{b.title}</Text>
              <Text style={s.benefitSubtitle}>{b.subtitle}</Text>
            </View>
          </View>
        ))}

        {/* ── Pay button ── */}
        <TouchableOpacity
          style={[s.payBtn, paying && s.payBtnDisabled]}
          onPress={handlePay}
          disabled={paying}
          activeOpacity={0.85}
        >
          {paying ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="lock" size={16} color={colors.primaryForeground} style={s.payIcon} />
              <Text style={s.payBtnText}>Pay ₹{FEE_AMOUNT} — Activate Account</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={s.secureNote}>
          🔒 Secure payment · Your details are protected
        </Text>
      </ScrollView>
    </View>
  );
}

function styles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 20,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    badgeRow: {
      flexDirection: "row",
      marginBottom: 10,
    },
    stepBadge: {
      backgroundColor: c.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    stepBadgeText: {
      fontSize: 12,
      fontWeight: "600",
      color: c.primary,
      fontFamily: "Inter_600SemiBold",
    },
    title: {
      fontSize: 26,
      fontWeight: "700",
      color: c.text,
      fontFamily: "Inter_700Bold",
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 14,
      color: c.textSecondary,
      fontFamily: "Inter_400Regular",
      lineHeight: 21,
    },

    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 24,
      gap: 16,
    },

    // ── Fee card ──
    feeCard: {
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    feeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    feeLabel: {
      fontSize: 14,
      color: c.textSecondary,
      fontFamily: "Inter_400Regular",
    },
    feeAmount: {
      fontSize: 16,
      color: c.text,
      fontFamily: "Inter_600SemiBold",
    },
    feeDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginVertical: 14,
    },
    feeTotalLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: c.text,
      fontFamily: "Inter_600SemiBold",
    },
    feeTotalAmount: {
      fontSize: 22,
      fontWeight: "700",
      color: c.primary,
      fontFamily: "Inter_700Bold",
    },
    feeNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 14,
      backgroundColor: c.muted,
      padding: 10,
      borderRadius: 10,
    },
    feeNoteText: {
      flex: 1,
      fontSize: 12,
      color: c.textMuted,
      fontFamily: "Inter_400Regular",
      lineHeight: 17,
    },

    // ── Benefits ──
    benefitsHeading: {
      fontSize: 16,
      fontWeight: "600",
      color: c.text,
      fontFamily: "Inter_600SemiBold",
      marginTop: 8,
    },
    benefitRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    benefitIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    benefitText: {
      flex: 1,
    },
    benefitTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: c.text,
      fontFamily: "Inter_600SemiBold",
      marginBottom: 2,
    },
    benefitSubtitle: {
      fontSize: 13,
      color: c.textSecondary,
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },

    // ── Pay button ──
    payBtn: {
      backgroundColor: c.primary,
      borderRadius: 14,
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      gap: 8,
      shadowColor: c.primary,
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 5,
    },
    payBtnDisabled: {
      opacity: 0.65,
    },
    payIcon: {
      marginRight: 2,
    },
    payBtnText: {
      fontSize: 16,
      fontWeight: "700",
      color: c.primaryForeground,
      fontFamily: "Inter_700Bold",
    },
    secureNote: {
      textAlign: "center",
      fontSize: 12,
      color: c.textMuted,
      fontFamily: "Inter_400Regular",
      marginTop: 4,
    },
  });
}
