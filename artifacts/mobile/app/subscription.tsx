import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { callSupport } from "@/utils/support";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RazorpayWebCheckout } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { firebaseAuth } from "@/utils/firebase";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

type CheckoutState = {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  planType: PlanId;
  planName: string;
  driverPhone: string;
};

type SuccessModalState = {
  visible: boolean;
  planName: string;
  expiryText: string;
};

const SCREEN_WIDTH = Dimensions.get("window").width;

type PlanId = "daily" | "weekly" | "monthly";

type Plan = {
  id: PlanId;
  name: string;
  price: number;
  period: string;       // human-readable: "/ 12 hours", "/ 7 days", "/ 30 days"
  pricePerDay: number;
  badge?: string;       // "Save 10%", "Long Validity" — shown inline
  recommended?: boolean; // shows "Recommended" badge
  subtitle: string;     // one-line beneath price
  mainFeature: string;  // single feature line at bottom of card
};

const PLANS: Plan[] = [
  {
    id: "daily",
    name: "Daily",
    price: 3,
    period: "/ 12 hours",
    pricePerDay: 3,
    recommended: true,
    subtitle: "Best for short working shifts",
    mainFeature: "Unlimited rides for 12 hours",
  },
  {
    id: "weekly",
    name: "Weekly",
    price: 19,
    period: "/ 7 days",
    pricePerDay: 2.71,
    badge: "Save 10%",
    subtitle: "Best for part-time drivers",
    mainFeature: "Unlimited rides for 7 days",
  },
  {
    id: "monthly",
    name: "Monthly",
    price: 100,
    period: "/ 30 days",
    pricePerDay: 3.33,
    badge: "Long Validity",
    subtitle: "Best for regular drivers",
    mainFeature: "Unlimited rides for 30 days",
  },
];

// ─── PlanCard ─────────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  selected,
  onSelect,
  isCurrentPlan,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  isCurrentPlan: boolean;
}) {
  const colors = useColors();

  // Per-plan tier accent — daily=info (basic), weekly=primary (standard), monthly=money (premium)
  const accent     = plan.id === "monthly" ? colors.money   : plan.id === "weekly" ? colors.primary   : colors.info;
  const accentSoft = plan.id === "monthly" ? colors.moneySoft : plan.id === "weekly" ? colors.primarySoft : colors.infoSoft;

  // Save-badge tint — "Save 10%" → warning, "Long Validity" → info
  const badgeTint = plan.badge === "Save 10%" ? colors.warning  : colors.info;
  const badgeSoft = plan.badge === "Save 10%" ? colors.warningSoft : colors.infoSoft;

  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={0.88}
      style={[
        styles.planCard,
        {
          backgroundColor: selected ? accentSoft : colors.surfaceElevated,
          borderColor:     selected ? accent     : colors.border,
          borderWidth:     selected ? 2          : 1.5,
          shadowColor:     selected ? accent     : "#000",
          shadowOpacity:   selected ? 0.22       : 0.06,
          shadowRadius:    selected ? 18         : 8,
          shadowOffset:    { width: 0, height: selected ? 6 : 3 },
          elevation:       selected ? 10         : 3,
        },
      ]}
    >
      {/* Badges */}
      {(isCurrentPlan || plan.recommended || plan.badge) && (
        <View style={styles.badgeRow}>
          {isCurrentPlan ? (
            <View style={[styles.badge, { backgroundColor: colors.success }]}>
              <Feather name="check-circle" size={10} color="#fff" />
              <Text style={styles.badgeTextLight}>Current Plan</Text>
            </View>
          ) : plan.recommended ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.success },
              ]}
            >
              <Text style={[styles.badgeTextDark, { color: colors.successText }]}>Recommended</Text>
            </View>
          ) : null}
          {plan.badge && (
            <View style={[styles.badge, { backgroundColor: badgeSoft }]}>
              <Text style={[styles.badgeTextDark, { color: badgeTint }]}>{plan.badge}</Text>
            </View>
          )}
        </View>
      )}

      {/* Main row: name + price + subtitle | radio */}
      <View style={styles.planMainRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
          <View style={styles.priceRow}>
            <Text style={[styles.priceCurrency, { color: selected ? accent : colors.foreground }]}>
              ₹
            </Text>
            <Text style={[styles.priceValue, { color: selected ? accent : colors.foreground }]}>
              {plan.price}
            </Text>
            <Text style={[styles.pricePeriod, { color: colors.mutedForeground }]}>{plan.period}</Text>
          </View>
          <Text style={[styles.planSubtitle, { color: colors.mutedForeground }]}>{plan.subtitle}</Text>
        </View>
        <View
          style={[
            styles.radio,
            {
              borderColor:     selected ? accent       : colors.borderStrong,
              backgroundColor: selected ? accent       : "transparent",
            },
          ]}
        >
          {selected && <Feather name="check" size={12} color="#fff" />}
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Single feature line */}
      <View style={styles.featureRow}>
        <View style={[styles.featureCheck, { backgroundColor: selected ? accentSoft : colors.successSoft }]}>
          <Feather name="check" size={10} color={selected ? accent : colors.success} />
        </View>
        <Text style={[styles.featureText, { color: colors.textSecondary }]}>{plan.mainFeature}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── SubscriptionScreen ───────────────────────────────────────────────────────
export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    driverUid,
    phone,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionActive,
    refreshSubscription,
  } = useDriver();
  const [selected,       setSelected]       = useState<PlanId>("monthly");
  const [isActivating,   setIsActivating]   = useState(false);
  const [checkoutParams, setCheckoutParams] = useState<CheckoutState | null>(null);
  const [successModal,   setSuccessModal]   = useState<SuccessModalState>({
    visible: false, planName: "", expiryText: "",
  });

  const selectedPlan          = PLANS.find((p) => p.id === selected)!;
  const isSelectedCurrentPlan = subscriptionPlan === selected && subscriptionActive;

  const PLAN_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const MS_PER_DAY  = 86_400_000;
  const MS_PER_HOUR = 3_600_000;
  const activePlanName       = subscriptionPlan ? (PLAN_LABEL[subscriptionPlan] ?? subscriptionPlan) : null;
  const activePlanExpiryDate = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  const activePlanMsLeft     = activePlanExpiryDate
    ? Math.max(0, activePlanExpiryDate.getTime() - Date.now())
    : 0;
  const activePlanShowHours  = activePlanMsLeft < MS_PER_DAY;
  const activePlanHoursLeft  = Math.max(0, Math.ceil(activePlanMsLeft / MS_PER_HOUR));
  const activePlanDaysLeft   = Math.max(0, Math.ceil(activePlanMsLeft / MS_PER_DAY));
  const activePlanTimeLeft   = activePlanShowHours
    ? `${activePlanHoursLeft} hour${activePlanHoursLeft !== 1 ? "s" : ""} left`
    : `${activePlanDaysLeft} day${activePlanDaysLeft !== 1 ? "s" : ""} left`;
  const activePlanExpiryStr  = activePlanExpiryDate
    ? activePlanExpiryDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";

  const handleActivate = async () => {
    if (isActivating || !driverUid) return;
    setIsActivating(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert("Error", "Not logged in. Please sign in again.");
        return;
      }
      const token = await user.getIdToken();

      const res = await fetch(`${API_BASE}/driver-plans/create-order`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({ driverUid, planType: selected }),
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
        planType:        selected,
        planName:        selectedPlan.name,
        driverPhone:     phone ?? "",
      });
    } catch {
      Alert.alert("Error", "Could not start payment. Check your connection.");
    } finally {
      setIsActivating(false);
    }
  };

  const handlePaymentSuccess = async (paymentId: string, _orderId: string, signature: string) => {
    const cp = checkoutParams;
    if (!cp || !driverUid) return;
    setIsActivating(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();

      const res = await fetch(`${API_BASE}/driver-plans/verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          driverUid,
          planType:           cp.planType,
          razorpayOrderId:    cp.razorpayOrderId,
          razorpayPaymentId:  paymentId,
          razorpaySignature:  signature,
        }),
      });

      const data = (await res.json()) as {
        ok?:          boolean;
        planExpiryAt?: number;
        error?:       string;
      };

      if (!res.ok || !data.ok) {
        Alert.alert("Payment failed. Please try again.");
        return;
      }

      await refreshSubscription();

      const expiry = data.planExpiryAt
        ? new Date(data.planExpiryAt).toLocaleDateString("en-IN", {
            day:   "numeric",
            month: "short",
            year:  "numeric",
          })
        : "";

      setSuccessModal({ visible: true, planName: cp.planName, expiryText: expiry });
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setIsActivating(false);
    }
  };

  const handlePaymentCancel = () => {
    Alert.alert("Payment cancelled");
  };

  const handlePaymentFailure = (_error: string) => {
    Alert.alert("Payment failed. Please try again.");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* HEADER */}
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 12,
            backgroundColor:   colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Driver Plans</Text>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <Feather name="help-circle" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* HERO */}
        <LinearGradient
          colors={["#110712", "#0A0A0A"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={[styles.heroBadge, { backgroundColor: "rgba(232,51,108,0.15)" }]}>
            <Feather name="zap" size={11} color={colors.primary} />
            <Text style={[styles.heroBadgeText, { color: colors.primary }]}>
              ZERO COMMISSION
            </Text>
          </View>
          <Text style={styles.heroTitle}>
            Keep <Text style={{ color: colors.primary }}>100%</Text>{"\n"}of every ride
          </Text>
          <Text style={styles.heroSub}>
            Pay one flat fee. No commission, no hidden cuts. More money in your pocket every trip.
          </Text>

          <View style={styles.compareRow}>
            <View style={styles.compareItem}>
              <Text style={styles.compareLabel}>With commission</Text>
              <Text style={[styles.compareValue, { textDecorationLine: "line-through", color: "rgba(255,255,255,0.5)" }]}>
                ₹148
              </Text>
              <Text style={styles.compareSub}>20% cut on ₹186</Text>
            </View>
            <View style={[styles.compareArrow, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Feather name="arrow-right" size={14} color="#fff" />
            </View>
            <View style={styles.compareItem}>
              <Text style={[styles.compareLabel, { color: colors.primary }]}>With Driver Plan</Text>
              <Text style={[styles.compareValue, { color: "#fff" }]}>₹186</Text>
              <Text style={styles.compareSub}>You keep full fare</Text>
            </View>
          </View>
        </LinearGradient>

        {/* PLAN STATUS */}
        {subscriptionActive ? (
          <View
            style={[
              styles.statusCard,
              { borderColor: colors.success, backgroundColor: colors.successSoft },
            ]}
          >
            <View style={[styles.statusIcon, { backgroundColor: colors.moneySoft }]}>
              <Feather name="check-circle" size={16} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: colors.successText }]}>
                {activePlanName} Plan — Active
              </Text>
              <Text style={[styles.statusSub, { color: colors.successText }]}>
                {activePlanTimeLeft} · Expires {activePlanExpiryStr}
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.statusCard,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <View style={[styles.statusIcon, { backgroundColor: colors.warningSoft }]}>
              <Feather name="alert-circle" size={16} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>
                No active plan
              </Text>
              <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
                Choose a plan below to go online and accept rides
              </Text>
            </View>
          </View>
        )}

        {/* SECTION HEADER */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Choose a plan
          </Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
            Cancel anytime · No setup fee
          </Text>
        </View>

        {/* PLAN CARDS */}
        <View style={{ gap: 14 }}>
          {PLANS.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              selected={selected === p.id}
              onSelect={() => setSelected(p.id)}
              isCurrentPlan={subscriptionPlan === p.id && subscriptionActive}
            />
          ))}
        </View>

        {/* PAYMENT METHODS */}
        <View
          style={[
            styles.paymentCard,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <View style={styles.paymentHeader}>
            <Feather name="credit-card" size={14} color={colors.foreground} />
            <Text style={[styles.paymentTitle, { color: colors.foreground }]}>
              Pay using
            </Text>
          </View>
          <View style={styles.paymentMethods}>
            {[
              { label: "UPI", icon: "smartphone" },
              { label: "Cards", icon: "credit-card" },
              { label: "Wallet", icon: "briefcase" },
              { label: "Net Banking", icon: "globe" },
            ].map((m) => (
              <View key={m.label} style={[styles.payMethod, { borderColor: colors.border }]}>
                <Feather name={m.icon as any} size={13} color={colors.mutedForeground} />
                <Text style={[styles.payMethodText, { color: colors.foreground }]}>
                  {m.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* FAQ */}
        <TouchableOpacity
          style={[
            styles.faqRow,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          activeOpacity={0.7}
        >
          <View style={[styles.faqIcon, { backgroundColor: colors.muted }]}>
            <Feather name="help-circle" size={14} color={colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.faqTitle, { color: colors.foreground }]}>
              Questions about Driver Plans?
            </Text>
            <Text style={[styles.faqSub, { color: colors.mutedForeground }]}>
              Read FAQs · Contact support
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        <Text style={[styles.terms, { color: colors.mutedForeground }]}>
          By activating, you agree to Driver Plan terms. No auto-renewal. GST included.
        </Text>
      </ScrollView>

      {/* STICKY FOOTER CTA */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom:   insets.bottom + 12,
            backgroundColor: colors.surface,
            borderTopColor:  colors.border,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.footerLabel, { color: colors.mutedForeground }]}>
            {selectedPlan.name} plan
          </Text>
          <View style={styles.footerPriceRow}>
            <Text style={[styles.footerPrice, { color: colors.foreground }]}>
              ₹{selectedPlan.price}
            </Text>
            <Text style={[styles.footerPeriod, { color: colors.mutedForeground }]}>
              {selectedPlan.period}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.cta,
            {
              backgroundColor: colors.primary,
              opacity: isActivating ? 0.6 : 1,
            },
          ]}
          activeOpacity={0.85}
          onPress={handleActivate}
          disabled={isActivating}
        >
          {isActivating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : isSelectedCurrentPlan ? (
            <>
              <Feather name="refresh-cw" size={15} color="#fff" />
              <Text style={styles.ctaText}>Renew {selectedPlan.name} Plan</Text>
            </>
          ) : (
            <>
              <Text style={styles.ctaText}>Activate Plan</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>

      {checkoutParams && (
        <RazorpayWebCheckout
          visible
          params={{
            razorpayOrderId: checkoutParams.razorpayOrderId,
            amount:          checkoutParams.amount,
            currency:        checkoutParams.currency,
            keyId:           checkoutParams.keyId,
            planName:        checkoutParams.planName,
            driverPhone:     checkoutParams.driverPhone,
          }}
          onSuccess={handlePaymentSuccess}
          onCancel={handlePaymentCancel}
          onFailure={handlePaymentFailure}
          onClose={() => setCheckoutParams(null)}
        />
      )}

      <Modal
        visible={successModal.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          setSuccessModal((s) => ({ ...s, visible: false }));
          router.back();
        }}
      >
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <LinearGradient
              colors={["#059669", "#047857"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.successGradient}
            >
              <View style={styles.successGlass}>
                <View style={styles.successCheckCircle}>
                  <Text style={styles.successCheckMark}>✓</Text>
                </View>

                <Text style={styles.successTitle}>Plan Activated</Text>
                <Text style={styles.successSubtitle}>{successModal.planName} Plan Active</Text>

                {successModal.expiryText ? (
                  <View style={styles.successExpiryRow}>
                    <Text style={styles.successExpiryLabel}>Expires</Text>
                    <Text style={styles.successExpiryValue}>{successModal.expiryText}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={styles.successBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    setSuccessModal((s) => ({ ...s, visible: false }));
                    router.back();
                  }}
                >
                  <Text style={styles.successBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  // Hero
  hero: {
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  heroBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  heroTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 31,
  },
  heroSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 18,
  },
  compareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 13,
  },
  compareItem: { flex: 1, gap: 2 },
  compareLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.55)", letterSpacing: 0.3 },
  compareValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  compareSub: { fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: "500" },
  compareArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // Status card
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
  },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: { fontSize: 13, fontWeight: "800" },
  statusSub: { fontSize: 11, fontWeight: "500", marginTop: 1 },

  sectionHeader: { gap: 2, marginTop: 4, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  sectionSub: { fontSize: 12, fontWeight: "500" },

  // Plan card — colours all injected inline via useColors()
  planCard: {
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },

  // Badge system
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  badgeTextLight: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  badgeTextDark:  { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },

  // Plan card content
  planMainRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planName:    { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  planSubtitle: { fontSize: 11.5, fontWeight: "500", marginTop: 2 },

  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  priceRow:     { flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: 4 },
  priceCurrency: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  priceValue:   { fontSize: 32, fontWeight: "800", letterSpacing: -1.5, lineHeight: 38 },
  pricePeriod:  { fontSize: 12, fontWeight: "600", marginBottom: 5, marginLeft: 2 },

  divider: { height: 1 },

  featureRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  featureCheck: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, fontSize: 12.5, fontWeight: "600" },

  // Payment card
  paymentCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  paymentHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  paymentTitle: { fontSize: 13, fontWeight: "800" },
  paymentMethods: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  payMethod: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  payMethodText: { fontSize: 11, fontWeight: "700" },

  // FAQ
  faqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
  },
  faqIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  faqTitle: { fontSize: 13, fontWeight: "700" },
  faqSub: { fontSize: 11, fontWeight: "500", marginTop: 1 },

  terms: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 14,
    paddingHorizontal: 12,
    marginTop: 4,
  },

  // Footer / CTA
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  footerLabel:    { fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  footerPriceRow: { flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 2 },
  footerPrice:    { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  footerPeriod:   { fontSize: 12, fontWeight: "600", marginBottom: 3 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    height: 50,
    borderRadius: 14,
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // Success modal
  successBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  successCard: {
    width: SCREEN_WIDTH * 0.84,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  successGradient: { borderRadius: 24 },
  successGlass: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    alignItems: "center",
    gap: 6,
  },
  successCheckCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  successCheckMark: { fontSize: 26, fontWeight: "800", color: "#fff", lineHeight: 30 },
  successTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.4,
    marginTop: 2,
  },
  successSubtitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  successExpiryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  successExpiryLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.72)" },
  successExpiryValue: { fontSize: 12, fontWeight: "800", color: "#fff" },
  successBtn: {
    marginTop: 18,
    width: "100%",
    height: 46,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  successBtnText: { fontSize: 15, fontWeight: "800", color: "#059669", letterSpacing: 0.2 },
});
