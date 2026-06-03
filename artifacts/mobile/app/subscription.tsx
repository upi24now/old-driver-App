import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
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

type PlanId = "daily" | "weekly" | "monthly";

type Plan = {
  id: PlanId;
  name: string;
  price: number;
  period: string;
  pricePerDay: number;
  badge?: string;
  badgeColor?: string;
  highlight?: boolean;
  features: string[];
  description: string;
};

const PLANS: Plan[] = [
  {
    id: "daily",
    name: "Daily",
    price: 3,
    period: "/ day",
    pricePerDay: 3,
    description: "Try it for a day — perfect for occasional drivers",
    features: [
      "0% commission on every ride",
      "Unlimited rides for 24 hours",
      "Standard driver support",
    ],
  },
  {
    id: "weekly",
    name: "Weekly",
    price: 19,
    period: "/ week",
    pricePerDay: 2.71,
    badge: "Save 10%",
    badgeColor: "#1976D2",
    description: "Most flexible for part-time drivers",
    features: [
      "0% commission on every ride",
      "Unlimited rides for 7 days",
      "Priority support · WhatsApp",
      "Free in-app ride insurance",
    ],
  },
  {
    id: "monthly",
    name: "Monthly",
    price: 100,
    period: "/ month",
    pricePerDay: 3.33,
    badge: "Best Value",
    badgeColor: "#00C853",
    highlight: true,
    description: "Best value for full-time drivers",
    features: [
      "0% commission on every ride",
      "Unlimited rides for 30 days",
      "Priority support · phone + WhatsApp",
      "Free in-app ride insurance",
      "Fuel rewards up to ₹500/month",
      "Free vehicle health checkup",
    ],
  },
];

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const colors = useColors();
  const highlight = plan.highlight;

  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={0.9}
      style={[
        styles.planCard,
        {
          borderColor: selected ? colors.primary : highlight ? colors.primary : colors.border,
          borderWidth: selected ? 2 : highlight ? 2 : 1,
          backgroundColor: "#fff",
        },
      ]}
    >
      {highlight && (
        <View style={[styles.recommendedTag, { backgroundColor: colors.primary }]}>
          <Feather name="star" size={10} color="#fff" />
          <Text style={styles.recommendedText}>RECOMMENDED</Text>
        </View>
      )}

      <View style={styles.planTopRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.planNameRow}>
            <Text style={[styles.planName, { color: colors.foreground }]}>
              {plan.name}
            </Text>
            {plan.badge && (
              <View style={[styles.savePill, { backgroundColor: (plan.badgeColor ?? colors.primary) + "1a" }]}>
                <Text style={[styles.savePillText, { color: plan.badgeColor ?? colors.primary }]}>
                  {plan.badge}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>
            {plan.description}
          </Text>
        </View>
        <View
          style={[
            styles.radio,
            {
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : "transparent",
            },
          ]}
        >
          {selected && <Feather name="check" size={13} color="#fff" />}
        </View>
      </View>

      <View style={styles.priceRow}>
        <Text style={[styles.priceCurrency, { color: colors.foreground }]}>₹</Text>
        <Text style={[styles.priceValue, { color: colors.foreground }]}>
          {plan.price}
        </Text>
        <Text style={[styles.pricePeriod, { color: colors.mutedForeground }]}>
          {plan.period}
        </Text>
        {plan.id !== "daily" && (
          <View style={styles.perDayPill}>
            <Text style={[styles.perDayText, { color: colors.mutedForeground }]}>
              ≈ ₹{plan.pricePerDay.toFixed(2)} / day
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.featuresList}>
        {plan.features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <View style={[styles.featureCheck, { backgroundColor: "#f0fdf4" }]}>
              <Feather name="check" size={10} color={colors.primary} />
            </View>
            <Text style={[styles.featureText, { color: colors.foreground }]}>
              {f}
            </Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    activatePlan,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionActive,
  } = useDriver();
  const [selected, setSelected] = useState<PlanId>("monthly");

  const selectedPlan = PLANS.find((p) => p.id === selected)!;

  const PLAN_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const MS_PER_DAY = 86_400_000;
  const activePlanName       = subscriptionPlan ? (PLAN_LABEL[subscriptionPlan] ?? subscriptionPlan) : null;
  const activePlanExpiryDate = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  const activePlanDaysLeft   = activePlanExpiryDate
    ? Math.max(0, Math.ceil((activePlanExpiryDate.getTime() - Date.now()) / MS_PER_DAY))
    : 0;
  const activePlanExpiryStr  = activePlanExpiryDate
    ? activePlanExpiryDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";

  function handleActivate() {
    const r = activatePlan(selected);
    if (!r.ok) {
      Alert.alert("Could not activate", r.reason ?? "Try a different plan.");
      return;
    }
    Alert.alert(
      "Plan activated",
      `${selectedPlan.name} plan is now active. You can go online and accept rides.`,
      [{ text: "Done", onPress: () => router.back() }],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: "#fff" },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: "#f5f5f5" }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color="#0a0a0a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Driver Plans</Text>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: "#f5f5f5" }]}
          activeOpacity={0.7}
        >
          <Feather name="help-circle" size={18} color="#0a0a0a" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* HERO */}
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={[styles.heroBadge, { backgroundColor: "rgba(0, 200, 83, 0.18)" }]}>
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
          <View style={[styles.statusCard, { borderColor: "#00C853", backgroundColor: "#f0fff5" }]}>
            <View style={[styles.statusIcon, { backgroundColor: "#dcfce7" }]}>
              <Feather name="check-circle" size={16} color="#16a34a" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: "#15803d" }]}>
                {activePlanName} Plan — Active
              </Text>
              <Text style={[styles.statusSub, { color: "#166534" }]}>
                {activePlanDaysLeft} day{activePlanDaysLeft !== 1 ? "s" : ""} left · Expires {activePlanExpiryStr}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.statusCard, { borderColor: colors.border }]}>
            <View style={[styles.statusIcon, { backgroundColor: "#fff5e6" }]}>
              <Feather name="alert-circle" size={16} color="#b75d00" />
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
        <View style={{ gap: 12 }}>
          {PLANS.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              selected={selected === p.id}
              onSelect={() => setSelected(p.id)}
            />
          ))}
        </View>

        {/* PAYMENT METHODS */}
        <View style={[styles.paymentCard, { borderColor: colors.border }]}>
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
          style={[styles.faqRow, { borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <View style={[styles.faqIcon, { backgroundColor: "#f5f5f5" }]}>
            <Feather name="help-circle" size={14} color="#0a0a0a" />
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
            paddingBottom: insets.bottom + 12,
            backgroundColor: "#fff",
            borderTopColor: colors.border,
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
          style={[styles.cta, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
          onPress={handleActivate}
        >
          <Text style={styles.ctaText}>Activate Plan</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#0a0a0a", letterSpacing: -0.2 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

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

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
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

  planCard: {
    borderRadius: 18,
    padding: 16,
    gap: 12,
    position: "relative",
  },
  recommendedTag: {
    position: "absolute",
    top: -10,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  recommendedText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  planTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  planNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  planName: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  planDescription: { fontSize: 12, fontWeight: "500", lineHeight: 16 },

  savePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  savePillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },

  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  priceRow: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  priceCurrency: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 5,
  },
  priceValue: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1.5,
    lineHeight: 40,
  },
  pricePeriod: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginLeft: 3,
  },
  perDayPill: {
    marginLeft: "auto",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "#f5f5f5",
    marginBottom: 4,
  },
  perDayText: { fontSize: 10, fontWeight: "700" },

  divider: { height: 1 },

  featuresList: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  featureCheck: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, fontSize: 12.5, fontWeight: "600" },

  paymentCard: {
    backgroundColor: "#fff",
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

  faqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
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
  footerLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  footerPriceRow: { flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 2 },
  footerPrice: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  footerPeriod: { fontSize: 12, fontWeight: "600", marginBottom: 3 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    height: 50,
    borderRadius: 14,
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
