import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { callSupport } from "@/utils/support";
import { useState } from "react";
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

import { RazorpayWebCheckout } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { firebaseAuth } from "@/utils/firebase";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#F8FAFC";
const CARD    = "#FFFFFF";
const PRIMARY = "#FF6B00";
const TEXT    = "#0F172A";
const MUTED   = "#64748B";
const BORDER  = "#E2E8F0";
const SUCCESS = "#059669";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ─── Types ────────────────────────────────────────────────────────────────────
type CheckoutState = {
  razorpayOrderId: string;
  amount:          number;
  currency:        string;
  keyId:           string;
  planType:        PlanId;
  planName:        string;
  driverPhone:     string;
};

type SuccessModalState = {
  visible:    boolean;
  planName:   string;
  expiryText: string;
};

type PlanId = "daily" | "weekly" | "monthly";

type Plan = {
  id:          PlanId;
  name:        string;
  price:       number;
  period:      string;
  pricePerDay: number;
  badge?:      string;
  recommended?: boolean;
  subtitle:    string;
  mainFeature: string;
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

// ─── Plan accent colours ──────────────────────────────────────────────────────
const PLAN_ACCENT: Record<PlanId, { color: string; soft: string }> = {
  daily:   { color: "#2563EB", soft: "#EFF6FF" },
  weekly:  { color: PRIMARY,   soft: "#FFF3EC" },
  monthly: { color: SUCCESS,   soft: "#ECFDF5" },
};

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

  // ── Active plan display data ────────────────────────────────────────────────
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

  // ── Business logic — unchanged ──────────────────────────────────────────────
  const handleActivate = async () => {
    if (isActivating || !driverUid) return;
    setIsActivating(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) { Alert.alert("Error", "Not logged in. Please sign in again."); return; }
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/driver-plans/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ driverUid, planType: selected }),
      });

      // ── Log the ACTUAL response (status + raw body + keys) ──────────────────
      const rawBody = await res.text();
      console.log("[DriverPlan] create-order status:", res.status);
      console.log("[DriverPlan] create-order raw body:", rawBody);

      type CreateOrderResponse = {
        razorpayOrderId?:  string;
        orderId?:          string;
        razorpay_order_id?: string;
        order_id?:         string;
        order?:            { id?: string; amount?: number; currency?: string };
        amount?:           number;
        currency?:         string;
        keyId?:            string;
        key?:              string;
        key_id?:           string;
        razorpayKeyId?:    string;
        error?:            string;
      };

      let parsed: unknown = {};
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch (parseErr) {
        console.error("[DriverPlan] create-order JSON parse failed:", parseErr);
        Alert.alert("Error", "Unexpected server response. Please try again.");
        return;
      }
      if (typeof parsed !== "object" || parsed === null) {
        console.error("[DriverPlan] create-order body is not an object:", parsed);
        Alert.alert("Error", "Unexpected server response. Please try again.");
        return;
      }
      const data = parsed as CreateOrderResponse;
      console.log("[DriverPlan] create-order keys:", Object.keys(data));

      if (!res.ok) {
        console.error("[DriverPlan] create-order non-2xx:", res.status, data.error);
        Alert.alert("Error", data.error ?? "Could not start payment. Please try again.");
        return;
      }

      // ── Resilient mapping: prod bundle may name fields differently ──────────
      const order = data.order ?? {};
      const razorpayOrderId =
        data.razorpayOrderId ?? data.orderId ?? data.razorpay_order_id ?? data.order_id ?? order.id;
      const amount          = data.amount ?? order.amount;
      const keyId           = data.keyId ?? data.key ?? data.key_id ?? data.razorpayKeyId;
      const currency        = data.currency ?? order.currency ?? "INR";

      console.log(
        "[DriverPlan] mapped → razorpayOrderId:", razorpayOrderId,
        "| amount:", amount,
        "| keyId present:", !!keyId,
      );

      if (!razorpayOrderId || amount == null || !keyId) {
        console.error("[DriverPlan] create-order missing required fields after mapping:", {
          razorpayOrderId, amount, keyIdPresent: !!keyId, keys: Object.keys(data),
        });
        Alert.alert("Error", data.error ?? "Could not start payment. Please try again.");
        return;
      }

      setCheckoutParams({
        razorpayOrderId,
        amount,
        currency,
        keyId,
        planType: selected,
        planName: selectedPlan.name,
        driverPhone: phone ?? "",
      });
    } catch (err) {
      console.error("[DriverPlan] create-order threw:", err);
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          driverUid,
          planType:          cp.planType,
          razorpayOrderId:   cp.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; planExpiryAt?: number; error?: string };
      if (!res.ok || !data.ok) { Alert.alert("Payment failed. Please try again."); return; }
      await refreshSubscription();
      const expiry = data.planExpiryAt
        ? new Date(data.planExpiryAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        : "";
      setSuccessModal({ visible: true, planName: cp.planName, expiryText: expiry });
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setIsActivating(false);
    }
  };

  const handlePaymentCancel  = () => { Alert.alert("Payment cancelled"); };
  const handlePaymentFailure = (_error: string) => { Alert.alert("Payment failed. Please try again."); };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={[sub.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={sub.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={18} color={TEXT} />
        </TouchableOpacity>
        <Text style={sub.headerTitle}>Driver Plans</Text>
        <TouchableOpacity style={sub.iconBtn} onPress={callSupport} activeOpacity={0.7}>
          <Feather name="help-circle" size={18} color={TEXT} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }} showsVerticalScrollIndicator={false}>

        {/* ── VALUE PROP HERO ─────────────────────────────────────────────── */}
        <View style={sub.heroCard}>
          <View style={sub.heroBadge}>
            <Feather name="zap" size={12} color={PRIMARY} />
            <Text style={sub.heroBadgeText}>ZERO COMMISSION</Text>
          </View>
          <Text style={sub.heroTitle}>
            Keep <Text style={{ color: PRIMARY }}>100%</Text> of every ride
          </Text>
          <Text style={sub.heroSub}>
            Pay one flat fee. No commission cuts. More money in your pocket every trip.
          </Text>
          <View style={sub.compareRow}>
            <View style={sub.compareItem}>
              <Text style={sub.compareLabel}>Without Plan</Text>
              <Text style={sub.compareOldPrice}>₹148</Text>
              <Text style={sub.compareSub}>20% cut on ₹186</Text>
            </View>
            <View style={sub.compareArrow}>
              <Feather name="arrow-right" size={14} color={PRIMARY} />
            </View>
            <View style={sub.compareItem}>
              <Text style={[sub.compareLabel, { color: PRIMARY }]}>With Driver Plan</Text>
              <Text style={[sub.comparePrice, { color: TEXT }]}>₹186</Text>
              <Text style={sub.compareSub}>You keep full fare</Text>
            </View>
          </View>
        </View>

        {/* ── PLAN STATUS BANNER ──────────────────────────────────────────── */}
        {subscriptionActive ? (
          <View style={[sub.statusCard, { backgroundColor: "#ECFDF5", borderColor: "#BBF7D0" }]}>
            <View style={[sub.statusIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={16} color={SUCCESS} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sub.statusTitle, { color: "#065F46" }]}>
                {activePlanName} Plan — Active
              </Text>
              <Text style={[sub.statusSub, { color: "#059669" }]}>
                {activePlanTimeLeft} · Expires {activePlanExpiryStr}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[sub.statusCard, { backgroundColor: "#FFF3EC", borderColor: "#FFD0B0" }]}>
            <View style={[sub.statusIcon, { backgroundColor: "#FFE8D9" }]}>
              <Feather name="alert-circle" size={16} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sub.statusTitle, { color: TEXT }]}>No active plan</Text>
              <Text style={[sub.statusSub, { color: MUTED }]}>
                Choose a plan below to go online and accept rides
              </Text>
            </View>
          </View>
        )}

        {/* ── PLAN SELECTOR (horizontal tabs) ─────────────────────────────── */}
        <View>
          <Text style={sub.sectionLabel}>Choose your plan</Text>
          <View style={sub.tabRow}>
            {PLANS.map((plan) => {
              const active  = selected === plan.id;
              const accent  = PLAN_ACCENT[plan.id];
              const isCurrent = subscriptionPlan === plan.id && subscriptionActive;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[
                    sub.tab,
                    active && { backgroundColor: accent.soft, borderColor: accent.color, borderWidth: 2 },
                  ]}
                  onPress={() => setSelected(plan.id)}
                  activeOpacity={0.8}
                >
                  {isCurrent && <View style={[sub.tabActiveDot, { backgroundColor: SUCCESS }]} />}
                  <Text style={[sub.tabName, active && { color: accent.color }]}>{plan.name}</Text>
                  <Text style={[sub.tabPrice, active && { color: accent.color }]}>₹{plan.price}</Text>
                  {plan.recommended && !isCurrent && (
                    <View style={[sub.tabBadge, { backgroundColor: "#ECFDF5" }]}>
                      <Text style={[sub.tabBadgeText, { color: SUCCESS }]}>★</Text>
                    </View>
                  )}
                  {plan.badge && !isCurrent && (
                    <View style={[sub.tabBadge, { backgroundColor: "#FEF3C7" }]}>
                      <Text style={[sub.tabBadgeText, { color: "#D97706" }]}>%</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── SELECTED PLAN CARD (full detail) ────────────────────────────── */}
        {(() => {
          const plan    = selectedPlan;
          const accent  = PLAN_ACCENT[plan.id];
          const isCurrent = subscriptionPlan === plan.id && subscriptionActive;
          return (
            <View style={[sub.planDetail, { borderColor: accent.color, borderWidth: 2 }]}>
              {/* Header */}
              <View style={[sub.planDetailHeader, { backgroundColor: accent.soft }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[sub.planDetailName, { color: accent.color }]}>{plan.name} Plan</Text>
                    {isCurrent && (
                      <View style={[sub.currentBadge, { backgroundColor: SUCCESS }]}>
                        <Feather name="check" size={9} color="#fff" />
                        <Text style={sub.currentBadgeText}>Current</Text>
                      </View>
                    )}
                    {plan.recommended && !isCurrent && (
                      <View style={[sub.currentBadge, { backgroundColor: SUCCESS + "20", borderWidth: 1, borderColor: SUCCESS }]}>
                        <Text style={[sub.currentBadgeText, { color: SUCCESS }]}>Recommended</Text>
                      </View>
                    )}
                    {plan.badge && (
                      <View style={[sub.currentBadge, { backgroundColor: "#FEF3C7" }]}>
                        <Text style={[sub.currentBadgeText, { color: "#D97706" }]}>{plan.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={sub.planDetailSubtitle}>{plan.subtitle}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
                    <Text style={[sub.planDetailCurrency, { color: accent.color }]}>₹</Text>
                    <Text style={[sub.planDetailPrice, { color: TEXT }]}>{plan.price}</Text>
                  </View>
                  <Text style={sub.planDetailPeriod}>{plan.period}</Text>
                </View>
              </View>

              {/* Features */}
              <View style={sub.planDetailBody}>
                {[
                  "Keep 100% of all fares",
                  plan.mainFeature,
                  "Priority order matching",
                  "24/7 support",
                ].map((feat) => (
                  <View key={feat} style={sub.planFeatureRow}>
                    <View style={[sub.planFeatureCheck, { backgroundColor: accent.soft }]}>
                      <Feather name="check" size={11} color={accent.color} />
                    </View>
                    <Text style={sub.planFeatureText}>{feat}</Text>
                  </View>
                ))}
              </View>

              {/* Per-day cost */}
              <View style={[sub.perDayRow, { backgroundColor: accent.soft, borderTopColor: accent.color + "30" }]}>
                <Feather name="calendar" size={12} color={accent.color} />
                <Text style={[sub.perDayText, { color: accent.color }]}>
                  Just ₹{plan.pricePerDay.toFixed(2)} per day
                </Text>
              </View>
            </View>
          );
        })()}

        {/* ── PAYMENT METHODS ──────────────────────────────────────────────── */}
        <View style={sub.payCard}>
          <View style={sub.payHeader}>
            <Feather name="credit-card" size={13} color={TEXT} />
            <Text style={sub.payTitle}>Accepted payments</Text>
          </View>
          <View style={sub.payMethods}>
            {[
              { label: "UPI",         icon: "smartphone"  },
              { label: "Cards",       icon: "credit-card" },
              { label: "Wallet",      icon: "briefcase"   },
              { label: "Net Banking", icon: "globe"       },
            ].map((m) => (
              <View key={m.label} style={sub.payMethod}>
                <Feather name={m.icon as any} size={13} color={MUTED} />
                <Text style={sub.payMethodText}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* FAQ row */}
        <TouchableOpacity style={sub.faqRow} activeOpacity={0.7} onPress={callSupport}>
          <View style={sub.faqIcon}>
            <Feather name="help-circle" size={15} color={MUTED} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sub.faqTitle}>Questions about Driver Plans?</Text>
            <Text style={sub.faqSub}>Read FAQs · Contact support</Text>
          </View>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </TouchableOpacity>

        <Text style={sub.terms}>
          By activating, you agree to Driver Plan terms. No auto-renewal. GST included.
        </Text>
      </ScrollView>

      {/* ── STICKY CTA ──────────────────────────────────────────────────────── */}
      <View style={[sub.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={sub.footerLabel}>{selectedPlan.name} plan</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
            <Text style={sub.footerPrice}>₹{selectedPlan.price}</Text>
            <Text style={sub.footerPeriod}>{selectedPlan.period}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[sub.cta, { opacity: isActivating ? 0.6 : 1 }]}
          activeOpacity={0.85}
          onPress={handleActivate}
          disabled={isActivating}
        >
          {isActivating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : isSelectedCurrentPlan ? (
            <>
              <Feather name="refresh-cw" size={15} color="#fff" />
              <Text style={sub.ctaText}>Renew {selectedPlan.name}</Text>
            </>
          ) : (
            <>
              <Text style={sub.ctaText}>Activate Plan</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Razorpay checkout */}
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

      {/* Success modal */}
      <Modal
        visible={successModal.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { setSuccessModal((s) => ({ ...s, visible: false })); router.back(); }}
      >
        <View style={sub.successBackdrop}>
          <View style={sub.successCard}>
            {/* Green header */}
            <View style={sub.successHeader}>
              <View style={sub.successCheckCircle}>
                <Feather name="check" size={36} color="#fff" />
              </View>
              <Text style={sub.successTitle}>Plan Activated!</Text>
              <Text style={sub.successPlanName}>{successModal.planName} Plan</Text>
            </View>
            {/* Body */}
            <View style={sub.successBody}>
              {successModal.expiryText ? (
                <View style={sub.successExpiryRow}>
                  <Feather name="calendar" size={15} color={SUCCESS} />
                  <Text style={sub.successExpiry}>Valid until {successModal.expiryText}</Text>
                </View>
              ) : null}
              <Text style={sub.successSub}>
                You can now go online and keep 100% of your earnings. Happy riding!
              </Text>
              <TouchableOpacity
                style={sub.successBtn}
                onPress={() => { setSuccessModal((s) => ({ ...s, visible: false })); router.back(); }}
                activeOpacity={0.85}
              >
                <Feather name="navigation" size={16} color="#fff" />
                <Text style={sub.successBtnText}>Start Earning</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sub = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: TEXT },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER,
  },

  // Hero
  heroCard: {
    backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    padding: 20, gap: 12,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: "#FFF3EC", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  heroBadgeText: { fontSize: 11, fontWeight: "800", color: PRIMARY, letterSpacing: 0.5 },
  heroTitle: { fontSize: 26, fontWeight: "900", color: TEXT, lineHeight: 32 },
  heroSub: { fontSize: 14, color: MUTED, lineHeight: 21 },
  compareRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12,
  },
  compareItem: { flex: 1, alignItems: "center", gap: 3 },
  compareArrow: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: "#FFF3EC",
    alignItems: "center", justifyContent: "center",
  },
  compareLabel: { fontSize: 10, fontWeight: "700", color: MUTED, letterSpacing: 0.3 },
  compareOldPrice: { fontSize: 20, fontWeight: "900", color: "#94A3B8", textDecorationLine: "line-through" },
  comparePrice: { fontSize: 20, fontWeight: "900" },
  compareSub: { fontSize: 10, fontWeight: "500", color: MUTED },

  // Status card
  statusCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
  },
  statusIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  statusSub: { fontSize: 12, fontWeight: "500" },

  // Section label
  sectionLabel: { fontSize: 12, fontWeight: "700", color: MUTED, letterSpacing: 0.5, marginBottom: 10, paddingHorizontal: 2 },

  // Horizontal tab selector
  tabRow: { flexDirection: "row", gap: 10 },
  tab: {
    flex: 1, alignItems: "center", gap: 3, paddingVertical: 12, paddingHorizontal: 8,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1.5, borderColor: BORDER, position: "relative",
    overflow: "hidden",
  },
  tabActiveDot: {
    position: "absolute", top: 6, right: 6,
    width: 6, height: 6, borderRadius: 3,
  },
  tabName: { fontSize: 13, fontWeight: "700", color: TEXT },
  tabPrice: { fontSize: 16, fontWeight: "900", color: TEXT },
  tabBadge: {
    position: "absolute", top: 4, left: 4,
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 5,
  },
  tabBadgeText: { fontSize: 9, fontWeight: "800" },

  // Plan detail card
  planDetail: {
    backgroundColor: CARD, borderRadius: 18, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  planDetailHeader: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    padding: 16, gap: 12,
  },
  planDetailName: { fontSize: 18, fontWeight: "800", marginBottom: 3 },
  planDetailSubtitle: { fontSize: 12, fontWeight: "500", color: MUTED },
  planDetailCurrency: { fontSize: 16, fontWeight: "700", marginBottom: 5 },
  planDetailPrice: { fontSize: 36, fontWeight: "900", lineHeight: 40 },
  planDetailPeriod: { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },
  currentBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  currentBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  planDetailBody: { padding: 16, gap: 10 },
  planFeatureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  planFeatureCheck: {
    width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center",
  },
  planFeatureText: { fontSize: 14, fontWeight: "500", color: TEXT },
  perDayRow: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1,
  },
  perDayText: { fontSize: 13, fontWeight: "700" },

  // Payment card
  payCard: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 10,
  },
  payHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  payTitle: { fontSize: 13, fontWeight: "700", color: TEXT },
  payMethods: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  payMethod: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F8FAFC", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: BORDER,
  },
  payMethodText: { fontSize: 11, fontWeight: "600", color: TEXT },

  // FAQ
  faqRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  faqIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  faqTitle: { fontSize: 13, fontWeight: "700", color: TEXT, marginBottom: 2 },
  faqSub: { fontSize: 11, color: MUTED },
  terms: { fontSize: 11, color: MUTED, textAlign: "center", lineHeight: 17 },

  // Footer CTA
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingTop: 14,
    backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER,
    shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: -4 }, elevation: 10,
  },
  footerLabel: { fontSize: 11, fontWeight: "600", color: MUTED, marginBottom: 2 },
  footerPrice: { fontSize: 22, fontWeight: "900", color: TEXT },
  footerPeriod: { fontSize: 11, color: MUTED, marginBottom: 4 },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: PRIMARY, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14,
    shadowColor: PRIMARY, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  ctaText: { fontSize: 15, fontWeight: "800", color: "#fff" },

  // Success modal
  successBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  successCard: { width: "100%", backgroundColor: CARD, borderRadius: 24, overflow: "hidden" },
  successHeader: { backgroundColor: SUCCESS, alignItems: "center", paddingVertical: 32, paddingHorizontal: 20, gap: 12 },
  successCheckCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 22, fontWeight: "900", color: "#fff" },
  successPlanName: { fontSize: 16, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  successBody: { padding: 24, gap: 14, alignItems: "center" },
  successExpiryRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ECFDF5", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  successExpiry: { fontSize: 14, fontWeight: "700", color: SUCCESS },
  successSub: { fontSize: 14, color: MUTED, textAlign: "center", lineHeight: 21 },
  successBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: SUCCESS, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 4,
  },
  successBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
