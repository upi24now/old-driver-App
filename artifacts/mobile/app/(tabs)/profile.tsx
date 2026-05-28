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

type DocStatus = "verified" | "pending" | "expiring" | "rejected";

const DOCS: {
  id: string;
  title: string;
  sub: string;
  status: DocStatus;
  icon: string;
}[] = [
  { id: "aadhaar", title: "Aadhaar Card", sub: "Verified · Jan 12, 2026", status: "verified", icon: "credit-card" },
  { id: "license", title: "Driving License", sub: "Expires in 45 days", status: "expiring", icon: "file-text" },
  { id: "rc", title: "Vehicle RC", sub: "Verified · Feb 04, 2026", status: "verified", icon: "truck" },
  { id: "insurance", title: "Insurance", sub: "Under review", status: "pending", icon: "shield" },
];

const STATUS_META: Record<DocStatus, { label: string; color: string; bg: string }> = {
  verified: { label: "Verified", color: "#00C853", bg: "#f0fdf4" },
  pending: { label: "Pending", color: "#b75d00", bg: "#fff5e6" },
  expiring: { label: "Expiring", color: "#FF6F00", bg: "#fff3e0" },
  rejected: { label: "Rejected", color: "#FF3B30", bg: "#ffebee" },
};

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

  const [autoAccept, setAutoAccept] = useState(false);
  const [language, setLanguage] = useState<"English" | "हिन्दी" | "ಕನ್ನಡ">("English");
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [longTrips, setLongTrips] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [navVoice, setNavVoice] = useState(true);

  const verifiedCount = DOCS.filter((d) => d.status === "verified").length;
  const needsAttention = DOCS.length - verifiedCount;

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
    <View style={{ flex: 1, backgroundColor: "#fafafa" }}>
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
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHero}
        >
          <View style={styles.profileRow}>
            <View style={styles.profileAvatarWrap}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>AK</Text>
              </View>
              <View style={[styles.profileVerified, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={9} color="#fff" />
              </View>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.profileName}>Arjun Kumar</Text>
              <Text style={styles.profilePhone}>+91 98765 43210</Text>
              <View style={styles.profileMetaRow}>
                <Feather name="star" size={11} color="#FFB300" />
                <Text style={styles.profileMetaText}>4.92</Text>
                <View style={styles.metaDotDark} />
                <Text style={styles.profileMetaText}>1,284 trips</Text>
                <View style={styles.metaDotDark} />
                <Text style={styles.profileMetaText}>3y · DR4827</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.editProfileBtn} activeOpacity={0.7}>
              <Feather name="edit-2" size={13} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.statsStrip}>
            {[
              { label: "Tier", value: "Gold" },
              { label: "Acceptance", value: "94%" },
              { label: "Completion", value: "98%" },
            ].map((s, i) => (
              <View key={s.label} style={styles.statBox}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
                {i < 2 && <View style={styles.statDivider} />}
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* VEHICLE STRIP */}
        <TouchableOpacity
          style={[styles.vehicleCard, { borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <View style={[styles.vehicleIcon, { backgroundColor: "#fff5e6" }]}>
            <Feather name="truck" size={18} color="#b75d00" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.vehicleTitle, { color: colors.foreground }]}>
              Honda Activa 6G
            </Text>
            <Text style={[styles.vehicleSub, { color: colors.mutedForeground }]}>
              KA 05 MN 4827 · White · Bike
            </Text>
          </View>
          <View style={[styles.vehiclePill, { backgroundColor: "#f0fdf4" }]}>
            <View style={[styles.vehiclePillDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.vehiclePillText, { color: colors.primary }]}>
              Active
            </Text>
          </View>
        </TouchableOpacity>

        {/* DOCUMENTS */}
        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Documents
            </Text>
            <View style={styles.sectionMeta}>
              <View
                style={[
                  styles.sectionBadge,
                  { backgroundColor: needsAttention > 0 ? "#fff5e6" : "#f0fdf4" },
                ]}
              >
                <Text
                  style={[
                    styles.sectionBadgeText,
                    { color: needsAttention > 0 ? "#b75d00" : colors.primary },
                  ]}
                >
                  {verifiedCount}/{DOCS.length} verified
                </Text>
              </View>
            </View>
          </View>
          <SectionCard>
            {DOCS.map((d, i) => {
              const meta = STATUS_META[d.status];
              return (
                <Row
                  key={d.id}
                  icon={d.icon}
                  iconBg={meta.bg}
                  iconColor={meta.color}
                  title={d.title}
                  sub={d.sub}
                  divider={i < DOCS.length - 1}
                  onPress={() => router.push("/document-upload")}
                  right={
                    <View style={styles.docRight}>
                      <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.statusPillText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                    </View>
                  }
                />
              );
            })}
          </SectionCard>
        </View>

        {/* APP PREFERENCES */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 8, paddingHorizontal: 2 }]}>
            App preferences
          </Text>
          <SectionCard>
            <Row
              icon="zap"
              iconBg="#fff3e0"
              iconColor="#FF6F00"
              title="Auto-accept requests"
              sub="Accept rides within 15s automatically"
              right={
                <Switch
                  value={autoAccept}
                  onValueChange={setAutoAccept}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
              divider
            />
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
              icon="navigation"
              iconBg="#f0fdf4"
              iconColor="#00C853"
              title="Voice navigation"
              sub="Spoken turn-by-turn directions"
              right={
                <Switch
                  value={navVoice}
                  onValueChange={setNavVoice}
                  trackColor={{ true: colors.primary, false: "#e5e5e5" }}
                  thumbColor="#fff"
                />
              }
              divider
            />
            <Row
              icon="trending-up"
              iconBg="#fce4ec"
              iconColor="#E91E63"
              title="Long trips only"
              sub="Show requests over 5 km only"
              right={
                <Switch
                  value={longTrips}
                  onValueChange={setLongTrips}
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
                    const res = await requestOverlayPermission();
                    if (!res.ok) {
                      Alert.alert(
                        "Permission required",
                        res.reason ?? "Permission required for incoming ride alerts",
                      );
                    }
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
              divider
            />
            <Row
              icon="map-pin"
              iconBg="#fce4ec"
              iconColor="#E91E63"
              title="Service area"
              right={
                <View style={styles.rowValue}>
                  <Text style={[styles.rowValueText, { color: colors.mutedForeground }]}>
                    Bengaluru
                  </Text>
                  <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                </View>
              }
              onPress={() =>
                infoAlert(
                  "Service area",
                  "You're currently operating in Bengaluru. Contact support to change your city.",
                )
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

  profileHero: { borderRadius: 20, padding: 16, gap: 14 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileAvatarWrap: { position: "relative" },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff5e6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  profileAvatarText: { fontSize: 17, fontWeight: "800", color: "#b75d00" },
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
    borderColor: "#0a0a0a",
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
