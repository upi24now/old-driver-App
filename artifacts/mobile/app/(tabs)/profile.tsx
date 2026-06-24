import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#F8FAFC";
const CARD    = "#FFFFFF";
const PRIMARY = "#FF6B00";
const TEXT    = "#0F172A";
const MUTED   = "#64748B";
const BORDER  = "#E2E8F0";
const SUCCESS = "#059669";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  destructive = false,
) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}

function infoAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={p.section}>
      {title && <Text style={p.sectionTitle}>{title}</Text>}
      <View style={p.sectionCard}>{children}</View>
    </View>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function Row({
  icon,
  iconColor,
  iconBg,
  iconSet = "Feather",
  title,
  sub,
  right,
  onPress,
  divider,
  destructive,
}: {
  icon: string;
  iconColor?: string;
  iconBg?: string;
  iconSet?: "Feather" | "MCIcons";
  title: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  divider?: boolean;
  destructive?: boolean;
}) {
  const Wrap: any = onPress ? TouchableOpacity : View;
  const tint = iconColor ?? (destructive ? "#DC2626" : TEXT);
  return (
    <>
      <Wrap style={p.row} onPress={onPress} activeOpacity={0.6}>
        <View style={[p.rowIcon, { backgroundColor: iconBg ?? "#F1F5F9" }]}>
          {iconSet === "MCIcons" ? (
            <MaterialCommunityIcons name={icon as any} size={16} color={tint} />
          ) : (
            <Feather name={icon as any} size={15} color={tint} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[p.rowTitle, destructive && { color: "#DC2626" }]}>{title}</Text>
          {sub && <Text style={p.rowSub}>{sub}</Text>}
        </View>
        {right ?? (onPress && !destructive && (
          <Feather name="chevron-right" size={17} color={MUTED} />
        ))}
      </Wrap>
      {divider && <View style={p.rowDivider} />}
    </>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const {
    signOut,
    overlayPermissionGranted,
    requestOverlayPermission,
    setOverlayPermission,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionActive,
    profile,
    vehicle,
    phone,
    verificationStatus,
    documentsSubmitted,
  } = useDriver();
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();

  const [soundAlerts, setSoundAlerts] = useState(true);
  const [vibration,   setVibration]   = useState(true);

  // ── Driver identity ──────────────────────────────────────────────────────
  const displayName    = profile?.name?.trim() || "Driver";
  const displayPhone   = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "Phone not added";
  const displayVehicle = vehicle?.name?.trim() || "Vehicle not added";
  const avatarInitials = displayName === "Driver"
    ? "DR"
    : displayName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  // ── Document / verification ──────────────────────────────────────────────
  const docLabel =
    verificationStatus === "verified"  ? "Verified" :
    verificationStatus === "rejected"  ? "Action Required" :
    verificationStatus === "pending"   ? "Pending Review" :
    documentsSubmitted                 ? "Under Review" :
                                         "Docs Required";
  const docColor =
    verificationStatus === "verified" ? SUCCESS :
    verificationStatus === "rejected" ? "#DC2626" :
    verificationStatus === "pending"  ? "#D97706" :
    documentsSubmitted                ? "#D97706" : "#DC2626";
  const docBg =
    verificationStatus === "verified" ? "#ECFDF5" :
    verificationStatus === "rejected" ? "#FEE2E2" :
    verificationStatus === "pending"  ? "#FEF3C7" :
    documentsSubmitted                ? "#FEF3C7" : "#FEE2E2";

  // ── Plan data ────────────────────────────────────────────────────────────
  const PLAN_LABEL: Record<string, string>     = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const PLAN_TOTAL_DAYS: Record<string, number> = { daily: 0.5, weekly: 7, monthly: 30 };
  const MS_PER_DAY  = 86_400_000;
  const MS_PER_HOUR = 3_600_000;

  const planName        = subscriptionPlan ? (PLAN_LABEL[subscriptionPlan] ?? subscriptionPlan) : null;
  const planExpiryDate  = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  const isPlanActive    = subscriptionActive;
  const planMsLeft      = planExpiryDate ? Math.max(0, planExpiryDate.getTime() - Date.now()) : 0;
  const totalPlanMs     = (subscriptionPlan ? (PLAN_TOTAL_DAYS[subscriptionPlan] ?? 30) : 30) * MS_PER_DAY;
  const remainingPct    = totalPlanMs > 0 ? Math.min(100, Math.round((planMsLeft / totalPlanMs) * 100)) : 0;
  const showHours       = planMsLeft < MS_PER_DAY;
  const remainingHours  = Math.max(0, Math.ceil(planMsLeft / MS_PER_HOUR));
  const remainingDays   = Math.max(0, Math.ceil(planMsLeft / MS_PER_DAY));
  const remainingLabel  = showHours
    ? `${remainingHours}h left`
    : `${remainingDays}d left`;
  const planExpired     = !!subscriptionPlan && !subscriptionActive;
  const planExpiryStr   = planExpiryDate
    ? planExpiryDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";
  const planBarColor    = remainingPct >= 70 ? SUCCESS : remainingPct >= 30 ? "#D97706" : "#DC2626";

  // ── Logout ───────────────────────────────────────────────────────────────
  function confirmLogout() {
    confirmAction(
      "Sign out?",
      "You'll need to log in again to receive ride requests.",
      "Sign out",
      () => { signOut(); router.replace("/login"); },
      true,
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 16,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── SCREEN TITLE ───────────────────────────────────────────────── */}
        <Text style={p.screenTitle}>Profile</Text>

        {/* ── DRIVER IDENTITY HERO ───────────────────────────────────────── */}
        <View style={p.heroCard}>
          {/* Avatar + name */}
          <View style={p.heroTop}>
            <View style={p.avatarWrap}>
              <View style={p.avatar}>
                <Text style={p.avatarText}>{avatarInitials}</Text>
              </View>
              {/* Verification dot */}
              <View style={[p.verDot, { backgroundColor: docColor }]}>
                <Feather
                  name={verificationStatus === "verified" ? "check" : "alert-circle"}
                  size={8}
                  color="#fff"
                />
              </View>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={p.heroName}>{displayName}</Text>
              <Text style={p.heroPhone}>{displayPhone}</Text>
              <View style={p.heroVehicleRow}>
                <MaterialCommunityIcons name="motorbike" size={12} color={MUTED} />
                <Text style={p.heroVehicleText}>{displayVehicle}</Text>
              </View>
            </View>
            {/* Edit button */}
            <TouchableOpacity
              style={p.editBtn}
              onPress={() => router.push("/document-upload")}
              activeOpacity={0.7}
            >
              <Feather name="edit-3" size={14} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          {/* Verification badge */}
          <TouchableOpacity
            style={[p.verBadge, { backgroundColor: docBg }]}
            onPress={() => router.push("/document-upload")}
            activeOpacity={0.8}
          >
            <Feather name={verificationStatus === "verified" ? "shield" : "alert-triangle"} size={13} color={docColor} />
            <Text style={[p.verBadgeText, { color: docColor }]}>{docLabel}</Text>
            {verificationStatus !== "verified" && (
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={[p.verBadgeAction, { color: docColor }]}>View →</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* ── Plan strip ─────────────────────────────────────────────── */}
          <View style={p.planStrip}>
            {isPlanActive && !planExpired ? (
              <>
                <View style={p.planStripLeft}>
                  <View style={[p.planDot, { backgroundColor: SUCCESS }]} />
                  <Text style={p.planName}>{planName} Plan</Text>
                  <Text style={p.planDaysLeft}>{remainingLabel}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={p.planBarTrack}>
                    <View style={[p.planBarFill, { width: `${remainingPct}%`, backgroundColor: planBarColor }]} />
                  </View>
                </View>
                <TouchableOpacity style={p.planManageBtn} onPress={() => router.push("/subscription")} activeOpacity={0.8}>
                  <Text style={p.planManageText}>Manage</Text>
                </TouchableOpacity>
              </>
            ) : planExpired ? (
              <>
                <View style={p.planStripLeft}>
                  <View style={[p.planDot, { backgroundColor: "#DC2626" }]} />
                  <Text style={[p.planName, { color: "#DC2626" }]}>Plan Expired</Text>
                </View>
                <TouchableOpacity
                  style={[p.planManageBtn, { backgroundColor: "#FEE2E2", borderColor: "#DC2626" }]}
                  onPress={() => router.push("/subscription")}
                  activeOpacity={0.8}
                >
                  <Text style={[p.planManageText, { color: "#DC2626" }]}>Renew</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={p.planStripLeft}>
                  <View style={[p.planDot, { backgroundColor: MUTED }]} />
                  <Text style={[p.planName, { color: MUTED }]}>No Active Plan</Text>
                </View>
                <TouchableOpacity
                  style={[p.planManageBtn, { backgroundColor: "#FFF3EC", borderColor: "#FFD0B0" }]}
                  onPress={() => router.push("/subscription")}
                  activeOpacity={0.8}
                >
                  <Text style={[p.planManageText, { color: PRIMARY }]}>Activate</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* ── DOCUMENTS ──────────────────────────────────────────────────── */}
        <Section title="Documents & Verification">
          <Row
            icon="file-text"
            iconBg="#ECFDF5"
            iconColor={SUCCESS}
            title="Driver Documents"
            right={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[p.docBadge, { backgroundColor: docBg }]}>
                  <Text style={[p.docBadgeText, { color: docColor }]}>{docLabel}</Text>
                </View>
                <Feather name="chevron-right" size={15} color={MUTED} />
              </View>
            }
            onPress={() => router.push("/document-upload")}
          />
        </Section>

        {/* ── APP PREFERENCES ────────────────────────────────────────────── */}
        <Section title="Preferences">
          <Row
            icon="bell"
            iconBg="#EFF6FF"
            iconColor="#2563EB"
            title="Sound alerts"
            sub="Ringtone on new ride requests"
            right={
              <Switch
                value={soundAlerts}
                onValueChange={setSoundAlerts}
                trackColor={{ true: SUCCESS, false: "#CBD5E1" }}
                thumbColor="#fff"
              />
            }
            divider
          />
          <Row
            icon="vibrate"
            iconSet="MCIcons"
            iconBg="#EDE9FE"
            iconColor="#7C3AED"
            title="Vibration"
            right={
              <Switch
                value={vibration}
                onValueChange={setVibration}
                trackColor={{ true: SUCCESS, false: "#CBD5E1" }}
                thumbColor="#fff"
              />
            }
            divider
          />
          <Row
            icon="picture-in-picture-top-right"
            iconSet="MCIcons"
            iconBg="#ECFDF5"
            iconColor={SUCCESS}
            title="Ride Overlay Popup"
            sub="Coming soon — requires production build"
            onPress={() =>
              Alert.alert("Coming Soon", "Overlay alerts require a production Android build.", [{ text: "OK" }])
            }
            right={
              <Switch
                value={false}
                onValueChange={() =>
                  Alert.alert("Coming Soon", "Overlay alerts require a production Android build.", [{ text: "OK" }])
                }
                trackColor={{ true: SUCCESS, false: "#CBD5E1" }}
                thumbColor="#fff"
                style={{ opacity: 0.45 }}
              />
            }
            divider
          />
          <Row
            icon="sliders"
            iconBg="#FFF3EC"
            iconColor={PRIMARY}
            title="Notification & Background"
            sub="Battery, auto-start & lock-screen setup"
            onPress={() => router.push("/background-setup?back=1")}
          />
        </Section>

        {/* ── ACCOUNT ────────────────────────────────────────────────────── */}
        <Section title="Account">
          <Row
            icon="credit-card"
            iconBg="#ECFDF5"
            iconColor={SUCCESS}
            title="Wallet & Payouts"
            sub="View balance & withdrawals"
            onPress={() => router.push("/wallet")}
            divider
          />
          <Row
            icon="zap"
            iconBg="#FEF3C7"
            iconColor="#D97706"
            title="Driver Plans"
            sub="Activate to keep 100% of fares"
            onPress={() => router.push("/subscription")}
            divider
          />
          <Row
            icon="globe"
            iconBg="#EFF6FF"
            iconColor="#2563EB"
            title="Language"
            sub="English only — more coming soon"
            right={
              <View style={p.langChip}>
                <Text style={p.langChipText}>EN</Text>
              </View>
            }
          />
        </Section>

        {/* ── SUPPORT & LEGAL ────────────────────────────────────────────── */}
        <Section title="Support & Legal">
          <Row
            icon="help-circle"
            iconBg="#F0FDF4"
            iconColor={SUCCESS}
            title="Help & Support"
            sub="View tickets & get help"
            onPress={() => router.push("/support")}
            divider
          />
          <Row
            icon="shield"
            iconBg="#F8FAFC"
            iconColor={MUTED}
            title="Privacy Policy"
            onPress={() => router.push("/privacy-policy")}
            divider
          />
          <Row
            icon="file-text"
            iconBg="#F8FAFC"
            iconColor={MUTED}
            title="Terms & Conditions"
            onPress={() => router.push("/terms-and-conditions")}
          />
        </Section>

        {/* ── SIGN OUT ────────────────────────────────────────────────────── */}
        <Section>
          <Row
            icon="log-out"
            iconBg="#FEE2E2"
            iconColor="#DC2626"
            title="Sign out"
            destructive
            onPress={confirmLogout}
          />
        </Section>

        {/* App footer */}
        <View style={p.footer}>
          <View style={p.footerIcon}>
            <Feather name="navigation" size={12} color="#fff" />
          </View>
          <Text style={p.footerText}>Driver v2.4.1 (build 4827)</Text>
          <Text style={p.footerSub}>Made with care in Bengaluru · © 2026</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const p = StyleSheet.create({
  screenTitle: { fontSize: 28, fontWeight: "800", color: TEXT, letterSpacing: -0.5, paddingHorizontal: 2 },

  // Hero card
  heroCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#FFF3EC",
    borderWidth: 2,
    borderColor: "#FFD0B0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "800", color: PRIMARY },
  verDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: CARD,
  },
  heroName: { fontSize: 18, fontWeight: "800", color: TEXT },
  heroPhone: { fontSize: 13, fontWeight: "500", color: MUTED },
  heroVehicleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  heroVehicleText: { fontSize: 11, fontWeight: "600", color: MUTED },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FFF3EC",
    borderWidth: 1,
    borderColor: "#FFD0B0",
    alignItems: "center",
    justifyContent: "center",
  },

  // Verification badge
  verBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  verBadgeText: { fontSize: 13, fontWeight: "700" },
  verBadgeAction: { fontSize: 12, fontWeight: "700" },

  // Plan strip
  planStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  planStripLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  planDot: { width: 7, height: 7, borderRadius: 3.5 },
  planName: { fontSize: 13, fontWeight: "700", color: TEXT },
  planDaysLeft: { fontSize: 11, fontWeight: "600", color: MUTED, marginLeft: 2 },
  planBarTrack: { height: 4, borderRadius: 2, backgroundColor: BORDER, flex: 1, overflow: "hidden" },
  planBarFill: { height: "100%", borderRadius: 2 },
  planManageBtn: {
    backgroundColor: "#FFF3EC",
    borderWidth: 1,
    borderColor: "#FFD0B0",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  planManageText: { fontSize: 11, fontWeight: "700", color: PRIMARY },

  // Section
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: MUTED, letterSpacing: 0.5, paddingHorizontal: 2 },
  sectionCard: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
    minHeight: 54,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "600", color: TEXT },
  rowSub: { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginLeft: 62 },

  // Misc
  docBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  docBadgeText: { fontSize: 11, fontWeight: "700" },
  langChip: { backgroundColor: "#F1F5F9", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  langChipText: { fontSize: 11, fontWeight: "700", color: TEXT },

  // Footer
  footer: { alignItems: "center", gap: 6, paddingVertical: 8 },
  footerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  footerText: { fontSize: 12, fontWeight: "600", color: MUTED },
  footerSub: { fontSize: 10, color: MUTED },
});
