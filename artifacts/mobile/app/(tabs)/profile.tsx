import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import { callSupport } from "@/utils/support";

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
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}

function infoAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}


function SectionCard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.sectionCard,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      {children}
    </View>
  );
}

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
  const colors = useColors();
  const Wrap: any = onPress ? TouchableOpacity : View;
  const iconTint = iconColor ?? (destructive ? colors.error : colors.foreground);
  return (
    <>
      <Wrap
        style={styles.row}
        onPress={onPress}
        activeOpacity={0.6}
      >
        <View
          style={[
            styles.rowIcon,
            { backgroundColor: iconBg ?? colors.muted },
          ]}
        >
          {iconSet === "MCIcons" ? (
            <MaterialCommunityIcons name={icon as any} size={16} color={iconTint} />
          ) : (
            <Feather name={icon as any} size={15} color={iconTint} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.rowTitle,
              { color: destructive ? colors.error : colors.foreground },
            ]}
          >
            {title}
          </Text>
          {sub && (
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              {sub}
            </Text>
          )}
        </View>
        {right ?? (onPress && !destructive && (
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        ))}
      </Wrap>
      {divider && (
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      )}
    </>
  );
}

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
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [soundAlerts, setSoundAlerts] = useState(true);
  const [vibration, setVibration] = useState(true);

  // ── Driver identity derived from context ──────────────────────────────────
  const displayName    = profile?.name?.trim() || "Driver";
  const displayPhone   = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "Phone not available";
  const displayVehicle = vehicle?.name?.trim() || "Vehicle not added";
  const avatarInitials = displayName === "Driver"
    ? "DR"
    : displayName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  // ── Document verification status from DriverContext ────────────────────────
  const docSubtitle =
    verificationStatus === "verified"  ? "All Verified" :
    verificationStatus === "rejected"  ? "Action Required" :
    verificationStatus === "pending"   ? "Pending Review" :
    documentsSubmitted                 ? "Under Review" :
                                         "Documents Required";
  const docSubColor =
    verificationStatus === "verified"  ? colors.success :
    verificationStatus === "rejected"  ? colors.error :
    verificationStatus === "pending"   ? colors.warning :
    documentsSubmitted                 ? colors.warning :
                                         colors.error;
  const docBadgeBg =
    verificationStatus === "verified"  ? colors.successSoft :
    verificationStatus === "rejected"  ? colors.errorSoft :
    verificationStatus === "pending"   ? colors.warningSoft :
    documentsSubmitted                 ? colors.warningSoft :
                                         colors.errorSoft;

  // ── Plan data from DriverContext ──
  const PLAN_LABEL: Record<string, string>  = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const PLAN_TOTAL_DAYS: Record<string, number> = { daily: 0.5, weekly: 7, monthly: 30 };
  const MS_PER_DAY  = 86_400_000;
  const MS_PER_HOUR = 3_600_000;

  const planName       = subscriptionPlan ? (PLAN_LABEL[subscriptionPlan] ?? subscriptionPlan) : null;
  const planExpiryDate = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  const isPlanActive   = subscriptionActive;
  const planMsLeft     = planExpiryDate ? Math.max(0, planExpiryDate.getTime() - Date.now()) : 0;
  const totalPlanMs    = (subscriptionPlan ? (PLAN_TOTAL_DAYS[subscriptionPlan] ?? 30) : 30) * MS_PER_DAY;
  const remainingPercent =
    totalPlanMs > 0
      ? Math.min(100, Math.round((planMsLeft / totalPlanMs) * 100))
      : 0;
  const showHours      = planMsLeft < MS_PER_DAY;
  const remainingHours = Math.max(0, Math.ceil(planMsLeft / MS_PER_HOUR));
  const remainingDays  = Math.max(0, Math.ceil(planMsLeft / MS_PER_DAY));
  const remainingLabel = showHours
    ? `${remainingHours} hour${remainingHours !== 1 ? "s" : ""} left`
    : `${remainingDays} day${remainingDays !== 1 ? "s" : ""} left`;
  const planExpired = !!subscriptionPlan && !subscriptionActive;
  const planExpiryStr = planExpiryDate
    ? planExpiryDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";
  const planBarColor =
    remainingPercent >= 70 ? colors.success :
    remainingPercent >= 30 ? colors.warning :
                             colors.error;

  function confirmLogout() {
    confirmAction(
      "Sign out?",
      "You'll need to log in again to receive ride requests.",
      "Sign out",
      () => {
        signOut();
        router.replace("/login");
      },
      true,
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 110,
          paddingHorizontal: 16,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Settings
          </Text>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Feather name="search" size={17} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* PROFILE HERO */}
        <LinearGradient
          colors={["#1A0612", "#8B1040", "#E8336C"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHero}
        >
          {/* Glass shimmer highlight */}
          <LinearGradient
            colors={["rgba(232,51,108,0.22)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.65, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Identity row */}
          <View style={styles.profileRow}>
            <View style={styles.profileAvatarWrap}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>{avatarInitials}</Text>
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.profileName}>{displayName}</Text>
              <Text style={styles.profilePhone}>{displayPhone}</Text>
              <View style={styles.profileVehicleRow}>
                <MaterialCommunityIcons name="motorbike" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={styles.profileVehicleText}>{displayVehicle}</Text>
              </View>
            </View>
          </View>

          {/* Plan panel */}
          <View style={styles.planPanel}>
            {isPlanActive && !planExpired ? (
              <>
                <View style={styles.planTopRow}>
                  <View style={styles.planBadge}>
                    <View style={[styles.planDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.planName}>{planName}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.planCta}
                    onPress={() => router.push("/subscription")}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.planCtaText}>Manage Plan</Text>
                    <Feather name="chevron-right" size={12} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                </View>
                <View style={styles.planInfoRow}>
                  <Text style={styles.planDaysLeft}>
                    {remainingLabel}
                  </Text>
                  <Text style={styles.planExpiry}>Expires {planExpiryStr}</Text>
                </View>
                <View style={styles.planBarTrack}>
                  <View
                    style={[
                      styles.planBarFill,
                      { width: `${remainingPercent}%`, backgroundColor: planBarColor },
                    ]}
                  />
                </View>
              </>
            ) : planExpired ? (
              <>
                <View style={styles.planTopRow}>
                  <View style={styles.planBadge}>
                    <View style={[styles.planDot, { backgroundColor: colors.error }]} />
                    <Text style={[styles.planName, { color: colors.error }]}>Plan expired</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.planCta, { borderColor: "rgba(220,38,38,0.35)" }]}
                    onPress={() => router.push("/subscription")}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.planCtaText, { color: colors.error }]}>Renew Plan</Text>
                    <Feather name="chevron-right" size={12} color={colors.error} />
                  </TouchableOpacity>
                </View>
                <View style={styles.planBarTrack}>
                  <View style={[styles.planBarFill, { width: "3%", backgroundColor: colors.error }]} />
                </View>
              </>
            ) : (
              <>
                <View style={styles.planTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>No Active Plan</Text>
                    <Text style={styles.planSubtext}>Activate plan to receive orders</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.planCta}
                    onPress={() => router.push("/subscription")}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.planCtaText}>Choose Plan</Text>
                    <Feather name="chevron-right" size={12} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                </View>
                <View style={styles.planBarTrack}>
                  <View style={[styles.planBarFill, { width: "3%", backgroundColor: colors.error }]} />
                </View>
              </>
            )}
          </View>
        </LinearGradient>

        {/* DOCUMENTS & VERIFICATION */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8, paddingHorizontal: 2 }]}>
            Documents & Verification
          </Text>
          <SectionCard>
            <Row
              icon="file-text"
              iconBg={colors.successSoft}
              iconColor={colors.success}
              title="Driver Documents"
              right={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[styles.docStatusBadge, { backgroundColor: docBadgeBg }]}>
                    <Text style={[styles.docStatusText, { color: docSubColor }]}>{docSubtitle}</Text>
                  </View>
                  <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                </View>
              }
              onPress={() => router.push("/document-upload")}
            />
          </SectionCard>
        </View>

        {/* APP PREFERENCES */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8, paddingHorizontal: 2 }]}>
            App preferences
          </Text>
          <SectionCard>
            <Row
              icon="bell"
              iconBg={colors.infoSoft}
              iconColor={colors.info}
              title="Sound alerts"
              sub="Ringtone on new ride requests"
              right={
                <Switch
                  value={soundAlerts}
                  onValueChange={setSoundAlerts}
                  trackColor={{ true: colors.success, false: colors.error }}
                  thumbColor="#fff"
                  style={{ transform: [{ scaleX: 1.3 }, { scaleY: 1.3 }] }}
                />
              }
              divider
            />
            <Row
              icon="vibrate"
              iconSet="MCIcons"
              iconBg={colors.pendingSoft}
              iconColor={colors.pending}
              title="Vibration"
              right={
                <Switch
                  value={vibration}
                  onValueChange={setVibration}
                  trackColor={{ true: colors.success, false: colors.error }}
                  thumbColor="#fff"
                  style={{ transform: [{ scaleX: 1.3 }, { scaleY: 1.3 }] }}
                />
              }
              divider
            />
            <Row
              icon="picture-in-picture-top-right"
              iconSet="MCIcons"
              iconBg={colors.successSoft}
              iconColor={colors.success}
              title="Allow Ride Overlay Popup"
              sub="Coming soon — requires production Android build"
              onPress={() => {
                Alert.alert(
                  "Coming Soon",
                  "Overlay alerts require a production Android build and will be enabled in the urgent order alert update.",
                  [{ text: "OK" }],
                );
              }}
              right={
                <Switch
                  value={false}
                  onValueChange={() => {
                    Alert.alert(
                      "Coming Soon",
                      "Overlay alerts require a production Android build and will be enabled in the urgent order alert update.",
                      [{ text: "OK" }],
                    );
                  }}
                  trackColor={{ true: colors.success, false: colors.error }}
                  thumbColor="#fff"
                  style={{ transform: [{ scaleX: 1.3 }, { scaleY: 1.3 }], opacity: 0.45 }}
                />
              }
              divider
            />
            <Row
              icon="sliders"
              iconBg={colors.primarySoft}
              iconColor={colors.primary}
              title="Notification & Background Settings"
              sub="Battery, auto-start & lock-screen alert setup"
              onPress={() => router.push("/background-setup?back=1")}
            />
          </SectionCard>
        </View>

        {/* ACCOUNT */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8, paddingHorizontal: 2 }]}>
            Account
          </Text>
          <SectionCard>
            <Row
              icon="credit-card"
              iconBg={colors.moneySoft}
              iconColor={colors.money}
              title="Wallet & Payouts"
              sub="View balance & withdrawals"
              onPress={() => router.push("/wallet")}
              divider
            />
            <Row
              icon="zap"
              iconBg={colors.warningSoft}
              iconColor={colors.warning}
              title="Driver Plans"
              sub="Activate to keep 100% of fares"
              onPress={() => router.push("/subscription")}
              divider
            />
            <Row
              icon="globe"
              iconBg={colors.infoSoft}
              iconColor={colors.info}
              title="Language"
              sub="App currently supports English only."
              right={
                <View style={styles.rowValue}>
                  <Text style={[styles.rowValueText, { color: colors.foreground, fontWeight: "700" }]}>
                    English
                  </Text>
                </View>
              }
            />
          </SectionCard>
        </View>

        {/* SUPPORT & LEGAL */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8, paddingHorizontal: 2 }]}>
            Support & legal
          </Text>
          <SectionCard>
            <Row
              icon="help-circle"
              title="Help & support"
              sub="Tap to call our support team"
              onPress={callSupport}
              divider
            />
            <Row
              icon="shield"
              title="Privacy policy"
              onPress={() => infoAlert("Privacy policy", "Opens the privacy policy in your browser.")}
              divider
            />
            <Row
              icon="file-text"
              title="Terms of service"
              onPress={() => infoAlert("Terms of service", "Opens the terms in your browser.")}
            />
          </SectionCard>
        </View>

        {/* LOGOUT */}
        <SectionCard>
          <Row
            icon="log-out"
            iconBg={colors.errorSoft}
            iconColor={colors.error}
            title="Sign out"
            destructive
            onPress={confirmLogout}
          />
        </SectionCard>

        <View style={styles.appInfoBlock}>
          <View style={[styles.appInfoIcon, { backgroundColor: colors.primary }]}>
            <Feather name="navigation" size={14} color="#fff" />
          </View>
          <Text style={[styles.appInfoText, { color: colors.mutedForeground }]}>
            Driver v2.4.1 (build 4827)
          </Text>
          <Text style={[styles.appInfoSub, { color: colors.mutedForeground }]}>
            Made with care in Bengaluru · © 2026
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  headerTitle: { fontSize: 26, fontWeight: "800", letterSpacing: -0.6 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  profileHero: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#E8336C",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.40,
    shadowRadius: 18,
    elevation: 8,
  },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileAvatarWrap: { position: "relative" },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(232,51,108,0.50)",
  },
  profileAvatarText: { fontSize: 19, fontWeight: "800", color: "#fff" },
  profileName: { fontSize: 18, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  profilePhone: { fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: "600" },
  profileVehicleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  profileVehicleText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.72)",
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Plan panel
  planPanel: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 13,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  planTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  planDot: { width: 7, height: 7, borderRadius: 3.5 },
  planName: { fontSize: 13, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  planSubtext: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: "500", marginTop: 2 },
  planCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  planCtaText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  planInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planDaysLeft: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
  planExpiry: { fontSize: 11, fontWeight: "500", color: "rgba(255,255,255,0.55)" },
  planBarTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  planBarFill: { height: "100%", borderRadius: 3 },

  sectionTitle: { fontSize: 13, fontWeight: "800", letterSpacing: -0.1, textTransform: "uppercase" },

  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowSub: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  divider: { height: 1, marginLeft: 57 },

  rowValue: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowValueText: { fontSize: 12, fontWeight: "600" },

  docStatusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  docStatusText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },

  appInfoBlock: { alignItems: "center", gap: 4, marginTop: 4 },
  appInfoIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  appInfoText: { fontSize: 11, fontWeight: "700" },
  appInfoSub: { fontSize: 10, fontWeight: "500" },
});
