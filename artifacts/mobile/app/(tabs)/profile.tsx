import { Feather } from "@expo/vector-icons";
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
import { useTheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

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
    <View style={[styles.sectionCard, { borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Row({
  icon,
  iconColor,
  iconBg,
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
  title: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  divider?: boolean;
  destructive?: boolean;
}) {
  const colors = useColors();
  const Wrap: any = onPress ? TouchableOpacity : View;
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
            { backgroundColor: iconBg ?? "#f5f5f5" },
          ]}
        >
          <Feather
            name={icon as any}
            size={15}
            color={iconColor ?? (destructive ? "#FF3B30" : "#0a0a0a")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.rowTitle,
              { color: destructive ? "#FF3B30" : colors.foreground },
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
  const { signOut, overlayPermissionGranted, requestOverlayPermission, setOverlayPermission } = useDriver();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { isDark, setDark } = useTheme();
  const [language, setLanguage] = useState<"English" | "हिन्दी" | "ಕನ್ನಡ">("English");
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [vibration, setVibration] = useState(true);
  const darkMode = isDark;
  const setDarkMode = setDark;

  // ── Plan mock data (UI model only — replace with real data when backend ready) ──
  const planName = "Weekly Pro";
  const planStartDate = new Date("2026-05-30");
  const planExpiryDate = new Date("2026-06-08");
  const isPlanActive = true;
  const msPerDay = 86_400_000;
  const today = new Date();
  const remainingDays = Math.max(
    0,
    Math.ceil((planExpiryDate.getTime() - today.getTime()) / msPerDay),
  );
  const totalPlanDays = Math.round(
    (planExpiryDate.getTime() - planStartDate.getTime()) / msPerDay,
  );
  const remainingPercent =
    totalPlanDays > 0
      ? Math.min(100, Math.round((remainingDays / totalPlanDays) * 100))
      : 0;
  const planExpired = isPlanActive && remainingDays === 0;
  const planExpiryStr = planExpiryDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  const planBarColor =
    remainingPercent >= 70 ? "#00C853" : remainingPercent >= 30 ? "#FF8F00" : "#FF3B30";

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
            style={[styles.iconBtn, { backgroundColor: "#fff", borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Feather name="search" size={17} color="#0a0a0a" />
          </TouchableOpacity>
        </View>

        {/* PROFILE HERO */}
        <LinearGradient
          colors={["#3A0A50", "#5E1675", "#A32CC4"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHero}
        >
          {/* Glass shimmer highlight */}
          <LinearGradient
            colors={["rgba(216,107,255,0.18)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.65, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Identity row */}
          <View style={styles.profileRow}>
            <View style={styles.profileAvatarWrap}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>AK</Text>
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.profileName}>Arjun Kumar</Text>
              <Text style={styles.profilePhone}>+91 98765 43210</Text>
              <View style={styles.profileMetaRow}>
                <Feather name="star" size={11} color="#FFB300" />
                <Text style={styles.profileMetaText}>4.92</Text>
                <View style={styles.metaDotDark} />
                <Text style={styles.profileMetaText}>1,284 trips</Text>
              </View>
              <View style={styles.profileVehicleRow}>
                <Feather name="truck" size={10} color="rgba(255,255,255,0.5)" />
                <Text style={styles.profileVehicleText}>KA 05 MN 4827</Text>
              </View>
            </View>
          </View>

          {/* Plan panel */}
          <View style={styles.planPanel}>
            {isPlanActive && !planExpired ? (
              <>
                <View style={styles.planTopRow}>
                  <View style={styles.planBadge}>
                    <View style={[styles.planDot, { backgroundColor: "#00C853" }]} />
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
                    {remainingDays} day{remainingDays !== 1 ? "s" : ""} left
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
                    <View style={[styles.planDot, { backgroundColor: "#FF3B30" }]} />
                    <Text style={[styles.planName, { color: "#FF8080" }]}>Plan expired</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.planCta, { borderColor: "rgba(255,59,48,0.35)" }]}
                    onPress={() => router.push("/subscription")}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.planCtaText, { color: "#FF8080" }]}>Renew Plan</Text>
                    <Feather name="chevron-right" size={12} color="#FF8080" />
                  </TouchableOpacity>
                </View>
                <View style={styles.planBarTrack}>
                  <View style={[styles.planBarFill, { width: "3%", backgroundColor: "#FF3B30" }]} />
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
                  <View style={[styles.planBarFill, { width: "3%", backgroundColor: "#FF3B30" }]} />
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
              iconBg="#e8f5e9"
              iconColor="#00C853"
              title="Driver Documents"
              sub="Selfie, Aadhaar, DL, PAN, RC, Insurance"
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
              icon="volume-2"
              iconBg="#e3f2fd"
              iconColor="#1976D2"
              title="Sound alerts"
              sub="Ringtone on new ride requests"
              right={
                <Switch
                  value={soundAlerts}
                  onValueChange={setSoundAlerts}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
              divider
            />
            <Row
              icon="smartphone"
              iconBg="#f3e5f5"
              iconColor="#9C27B0"
              title="Vibration"
              right={
                <Switch
                  value={vibration}
                  onValueChange={setVibration}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
              divider
            />
            <Row
              icon="moon"
              iconBg="#eceff1"
              iconColor="#455A64"
              title="Dark mode"
              right={
                <Switch
                  value={darkMode}
                  onValueChange={setDarkMode}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
              divider
            />
            <Row
              icon="layers"
              iconBg="#e8f5e9"
              iconColor="#00C853"
              title="Allow Ride Overlay Popup"
              sub="Show ride alerts over other apps & lock screen"
              right={
                <Switch
                  value={overlayPermissionGranted}
                  onValueChange={async (next) => {
                    if (!next) {
                      setOverlayPermission(false);
                      return;
                    }
                    if (Platform.OS !== "android") {
                      setOverlayPermission(true);
                      return;
                    }
                    await requestOverlayPermission();
                  }}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
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
              iconBg="#f0fdf4"
              iconColor="#00C853"
              title="Wallet & Payouts"
              sub="HDFC Bank ••2841"
              onPress={() => router.push("/wallet")}
              divider
            />
            <Row
              icon="zap"
              iconBg="#fff3e0"
              iconColor="#FF6F00"
              title="Driver Plans"
              sub="Activate to keep 100% of fares"
              onPress={() => router.push("/subscription")}
              divider
            />
            <Row
              icon="globe"
              iconBg="#e3f2fd"
              iconColor="#1976D2"
              title="Language"
              sub="Tap to switch · English / हिन्दी / ಕನ್ನಡ"
              right={
                <View style={styles.rowValue}>
                  <Text style={[styles.rowValueText, { color: colors.foreground, fontWeight: "700" }]}>
                    {language}
                  </Text>
                  <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                </View>
              }
              onPress={() => {
                const order: Array<"English" | "हिन्दी" | "ಕನ್ನಡ"> = [
                  "English",
                  "हिन्दी",
                  "ಕನ್ನಡ",
                ];
                const next = order[(order.indexOf(language) + 1) % order.length];
                setLanguage(next);
              }}
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
              onPress={() =>
                infoAlert(
                  "Help & support",
                  "Our team is available 24×7 at support@driver.app or +91 80000 00000.",
                )
              }
              divider
            />
            <Row
              icon="alert-triangle"
              iconBg="#ffebee"
              iconColor="#FF3B30"
              title="Emergency SOS"
              sub="Quick contact for safety"
              onPress={() =>
                confirmAction(
                  "Emergency SOS",
                  "This will alert police, your emergency contact, and our safety team.",
                  "Send alert",
                  () => infoAlert("Alert sent", "Help is on the way."),
                  true,
                )
              }
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
            iconBg="#ffebee"
            iconColor="#FF3B30"
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
    shadowColor: "#5E1675",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
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
    borderColor: "rgba(216,107,255,0.45)",
  },
  profileAvatarText: { fontSize: 19, fontWeight: "800", color: "#fff" },
  profileVerified: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#122847",
  },
  profileName: { fontSize: 18, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  profilePhone: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  profileMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  profileMetaText: { fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: "600" },
  metaDotDark: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.3)" },
  editProfileBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },

  statsStrip: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 13,
    padding: 12,
  },
  statBox: { flex: 1, alignItems: "center", position: "relative", gap: 2 },
  statValue: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  statLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  statDivider: {
    position: "absolute",
    right: 0,
    top: 4,
    bottom: 4,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
  },

  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  vehicleIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleTitle: { fontSize: 14, fontWeight: "800" },
  vehicleSub: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  vehiclePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  vehiclePillDot: { width: 6, height: 6, borderRadius: 3 },
  vehiclePillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: "800", letterSpacing: -0.1, textTransform: "uppercase", color: "#0a0a0a" },
  sectionMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  sectionBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },

  sectionCard: {
    backgroundColor: "#fff",
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

  docRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  statusPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },

  // Plan panel
  planPanel: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 13,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  profileVehicleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  profileVehicleText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.72)",
    fontWeight: "700",
    letterSpacing: 0.5,
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
