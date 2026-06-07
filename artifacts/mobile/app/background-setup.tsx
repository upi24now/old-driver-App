/**
 * Background Permission Setup Screen
 *
 * Shown once after onboarding approval, before the main dashboard.
 * Guides the driver to enable four Android settings required for
 * reliable order-alert delivery and GPS navigation:
 *
 *   1. POST_NOTIFICATIONS permission
 *   2. GPS / Location (foreground only — no background location)
 *   3. Battery optimization exemption
 *   4. Auto-start / background activity (manufacturer-specific)
 *
 * After the driver taps "Continue", a Firestore flag (backgroundSetupShown)
 * is written so this screen is not shown again on subsequent logins.
 *
 * Re-accessible from: Profile → Notification & Background Settings
 *   router.push("/background-setup?back=1")
 *
 * AppState listener re-checks permissions automatically whenever the driver
 * returns from the device settings screen.
 */

import { Feather } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
} from "@/utils/notifications";

const APP_PKG = "in.bikecourierservice.driver";

async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        { data: `package:${APP_PKG}` },
      );
    } catch {
      await Linking.openSettings();
    }
  }
}

async function openAppDetails(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await Linking.openSettings();
  }
}

export default function BackgroundSetupScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const { markBackgroundSetupShown } = useDriver();
  const params   = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  const [notifGranted,       setNotifGranted]       = useState(false);
  const [notifCanAskAgain,   setNotifCanAskAgain]   = useState(true);
  const [notifLoading,       setNotifLoading]       = useState(false);
  const [locationGranted,    setLocationGranted]    = useState(false);
  const [locationCanAskAgain,setLocationCanAskAgain]= useState(true);
  const [locationLoading,    setLocationLoading]    = useState(false);
  const [batteryOpened,      setBatteryOpened]      = useState(false);
  const [autostartOpened,    setAutostartOpened]    = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [refreshing,         setRefreshing]         = useState(false);

  // ── Permission refresh ─────────────────────────────────────────────────────
  // Runs on mount and whenever the app returns to the foreground (after the
  // driver has been to device settings). This keeps the status badges live.
  async function refreshPermissions(): Promise<void> {
    const [notifStatus, locStatus] = await Promise.all([
      getNotificationPermissionStatus().catch(() => ({ granted: false, canAskAgain: false })),
      Location.getForegroundPermissionsAsync().catch(() => ({ granted: false, canAskAgain: false })),
    ]);
    setNotifGranted(notifStatus.granted);
    setNotifCanAskAgain(notifStatus.canAskAgain);
    setLocationGranted(locStatus.granted);
    setLocationCanAskAgain(locStatus.canAskAgain ?? false);
  }

  useEffect(() => {
    async function initPermissions(): Promise<void> {
      // Read current state so the UI reflects reality immediately.
      const [notifStatus, locStatus] = await Promise.all([
        getNotificationPermissionStatus().catch(() => ({ granted: false, canAskAgain: false })),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false, canAskAgain: false })),
      ]);
      setNotifGranted(notifStatus.granted);
      setNotifCanAskAgain(notifStatus.canAskAgain);
      setLocationGranted(locStatus.granted);
      setLocationCanAskAgain(locStatus.canAskAgain ?? false);

      // Auto-show OS popups for any ungranted permission the system will prompt
      // for. Sequential so the driver sees one dialog at a time.
      if (!notifStatus.granted && notifStatus.canAskAgain) {
        setNotifLoading(true);
        await requestNotificationPermissions();
        const after = await getNotificationPermissionStatus()
          .catch(() => ({ granted: false, canAskAgain: false }));
        setNotifGranted(after.granted);
        setNotifCanAskAgain(after.canAskAgain);
        setNotifLoading(false);
      }

      if (!locStatus.granted && (locStatus.canAskAgain ?? true)) {
        setLocationLoading(true);
        try {
          const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
          setLocationGranted(status === Location.PermissionStatus.GRANTED);
          setLocationCanAskAgain(canAskAgain ?? false);
        } catch {
          setLocationGranted(false);
        }
        setLocationLoading(false);
      }
    }

    void initPermissions();

    const handleAppState = (state: AppStateStatus) => {
      if (state === "active") void refreshPermissions();
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleEnableNotifs() {
    setNotifLoading(true);
    await requestNotificationPermissions();
    const after = await getNotificationPermissionStatus()
      .catch(() => ({ granted: false, canAskAgain: false }));
    setNotifGranted(after.granted);
    setNotifCanAskAgain(after.canAskAgain);
    setNotifLoading(false);
    // No auto-open settings — UI renders the settings button when canAskAgain=false
  }

  async function handleEnableLocation() {
    setLocationLoading(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      setLocationGranted(status === Location.PermissionStatus.GRANTED);
      setLocationCanAskAgain(canAskAgain ?? false);
    } catch {
      setLocationGranted(false);
    }
    setLocationLoading(false);
    // No auto-open settings — UI renders the settings button when canAskAgain=false
  }

  async function handleBattery() {
    await openBatterySettings();
    setBatteryOpened(true);
  }

  async function handleAutostart() {
    await openAppDetails();
    setAutostartOpened(true);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await refreshPermissions();
    setRefreshing(false);
  }

  async function handleContinue() {
    if (!criticalReady) {
      Alert.alert(
        "Permissions Required",
        "Notifications and GPS Location must be granted before you can continue. These are required to receive delivery orders.",
        [{ text: "OK" }]
      );
      return;
    }
    setSaving(true);
    try {
      await markBackgroundSetupShown();
    } finally {
      setSaving(false);
    }
    if (fromProfile) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  const scrollPaddingTop = fromProfile ? 16 : insets.top + 16;
  const criticalReady = notifGranted && locationGranted;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {fromProfile && (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 8,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {"Permissions & Background Settings"}
          </Text>
          <View style={{ width: 38 }} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: scrollPaddingTop, paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View
            style={[styles.heroIconWrap, { backgroundColor: colors.primary }]}
          >
            <Feather name="shield" size={30} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Enable Delivery Permissions</Text>
          <Text style={styles.heroSub}>
            {"GPS and notifications are required to receive orders reliably. Battery settings improve background delivery on Indian OEM phones."}
          </Text>
        </LinearGradient>

        {/* ── Card 1: Notifications ──────────────────────────────────────── */}
        <StepCard
          num="1"
          icon="bell"
          title="Notifications"
          required
          statusLabel={notifGranted ? "Allowed" : "Not allowed"}
          statusOk={notifGranted}
          body="Required to display order alerts and play the ringtone when a delivery is assigned to you."
          colors={colors}
        >
          {notifGranted ? (
            <DoneBadge label="Notifications allowed" />
          ) : notifCanAskAgain ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleEnableNotifs}
              activeOpacity={0.85}
              disabled={notifLoading}
            >
              {notifLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="bell" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Enable Notifications</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <View style={[styles.deniedBox, { backgroundColor: colors.muted }]}>
                <Feather name="alert-circle" size={13} color="#b75d00" />
                <Text style={[styles.deniedText, { color: colors.mutedForeground }]}>
                  Permission permanently denied. Open Settings to enable.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={() => Linking.openSettings()}
                activeOpacity={0.85}
              >
                <Feather name="external-link" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </>
          )}
        </StepCard>

        {/* ── Card 2: GPS Location ───────────────────────────────────────── */}
        <StepCard
          num="2"
          icon="map-pin"
          title="GPS Location"
          required
          statusLabel={locationGranted ? "Allowed" : "Not allowed"}
          statusOk={locationGranted}
          body="Required for navigation to pickup and drop points. Only foreground (while-in-use) location is requested — no background tracking."
          colors={colors}
        >
          {locationGranted ? (
            <DoneBadge label="Location access granted" />
          ) : locationCanAskAgain ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleEnableLocation}
              activeOpacity={0.85}
              disabled={locationLoading}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="map-pin" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Enable GPS Location</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <View style={[styles.deniedBox, { backgroundColor: colors.muted }]}>
                <Feather name="alert-circle" size={13} color="#b75d00" />
                <Text style={[styles.deniedText, { color: colors.mutedForeground }]}>
                  Permission permanently denied. Open Settings to enable.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={openAppDetails}
                activeOpacity={0.85}
              >
                <Feather name="external-link" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather
              name="info"
              size={12}
              color={colors.mutedForeground}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Only \"While Using the App\" location is used. Background location is NOT requested."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 3: Battery Optimization ──────────────────────────────── */}
        {/* statusOk is always false — Android does not expose battery exemption  */}
        {/* status to apps. Opening settings is not the same as applying the fix. */}
        <StepCard
          num="3"
          icon="battery-charging"
          title="Unrestricted Battery"
          required={false}
          statusLabel={batteryOpened ? "Opened — verify manually" : "Recommended"}
          statusOk={false}
          body={"Open battery settings and set this app to \"Unrestricted\", \"Don't optimize\", or \"Allow background activity\"."}
          colors={colors}
        >
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleBattery}
            activeOpacity={0.85}
          >
            <Feather name="battery-charging" size={14} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {batteryOpened ? "Open Battery Settings Again" : "Open Battery Settings"}
            </Text>
          </TouchableOpacity>
          {batteryOpened && (
            <View style={[styles.doneBadge, { backgroundColor: "transparent" }]}>
              <Feather name="info" size={13} color={colors.mutedForeground} />
              <Text style={[styles.doneText, { color: colors.mutedForeground }]}>
                {"Select \"Unrestricted\" or \"Don't optimize\" in the settings page."}
              </Text>
            </View>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather
              name="info"
              size={12}
              color={colors.mutedForeground}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Without this, Android may delay or block delivery alerts when your phone is locked or idle for a few minutes. Cannot be verified automatically."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 4: Auto-start / Background Activity ───────────────────── */}
        {/* statusOk is always false — auto-start state is not queryable by apps  */}
        {/* on any Android OEM. Opening App Info does not confirm the toggle is on. */}
        <StepCard
          num="4"
          icon="smartphone"
          title={"Auto-start & Background Activity"}
          required={false}
          statusLabel={autostartOpened ? "Opened — verify manually" : "Recommended"}
          statusOk={false}
          body={"On Realme, Oppo, Vivo, Xiaomi, and Samsung: open App Info and enable Auto Start and Background Activity if available."}
          colors={colors}
        >
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleAutostart}
            activeOpacity={0.85}
          >
            <Feather name="settings" size={14} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {autostartOpened ? "Open App Info Again" : "Open App Info"}
            </Text>
          </TouchableOpacity>
          {autostartOpened && (
            <View style={[styles.doneBadge, { backgroundColor: "transparent" }]}>
              <Feather name="info" size={13} color={colors.mutedForeground} />
              <Text style={[styles.doneText, { color: colors.mutedForeground }]}>
                {"Look for \"Auto Start\" or \"Background Activity\" and enable it."}
              </Text>
            </View>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather
              name="alert-triangle"
              size={12}
              color="#b75d00"
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Path varies by brand — look for Battery \u2192 Unrestricted, or a dedicated \"Auto Start\" toggle in App Info. This cannot be enabled automatically."}
            </Text>
          </View>
        </StepCard>

        {/* ── Refresh status ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.refreshRow}
          onPress={handleRefresh}
          activeOpacity={0.7}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={13} color={colors.primary} />
          )}
          <Text style={[styles.refreshText, { color: colors.primary }]}>
            {refreshing ? "Checking permissions…" : "Check permission status again"}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.skipNote, { color: colors.mutedForeground }]}>
          {"Permission status updates automatically when you return from device settings.\nSettings 3 & 4 cannot be verified by the app — Android does not expose them to apps."}
        </Text>

        <Text style={[styles.profileNote, { color: colors.mutedForeground }]}>
          {"These settings can be changed later from Profile \u2192 Permissions & Background Settings."}
        </Text>
      </ScrollView>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        {!criticalReady && (
          <View style={[styles.warningBanner, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
            <Feather name="alert-triangle" size={13} color="#92400E" />
            <Text style={styles.warningText}>
              {"Notifications and GPS are required to receive delivery orders."}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: criticalReady ? colors.primary : colors.mutedForeground }]}
          onPress={handleContinue}
          activeOpacity={0.85}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="check-circle" size={18} color="#fff" />
              <Text style={styles.continueBtnText}>
                {criticalReady ? "All set — Continue" : "Grant Permissions First"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

type ColorsShape = ReturnType<typeof useColors>;

function StepCard({
  num,
  icon,
  title,
  body,
  required,
  statusLabel,
  statusOk,
  colors,
  children,
}: {
  num: string;
  icon: string;
  title: string;
  body: string;
  required: boolean;
  statusLabel: string;
  statusOk: boolean;
  colors: ColorsShape;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: statusOk ? "#00C853" : required ? "#FCA5A5" : colors.border,
          borderWidth: statusOk || required ? 1.5 : 1,
        },
      ]}
    >
      {/* Card header row */}
      <View style={styles.cardRow}>
        <View
          style={[
            styles.numBadge,
            { backgroundColor: statusOk ? "#00C853" : "rgba(0,200,83,0.1)" },
          ]}
        >
          {statusOk ? (
            <Feather name="check" size={14} color="#fff" />
          ) : (
            <Text style={styles.numText}>{num}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {title}
            </Text>
            {required && (
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredText}>Required</Text>
              </View>
            )}
          </View>
          <Text style={[styles.statusLabel, { color: statusOk ? "#00C853" : required ? "#DC2626" : colors.mutedForeground }]}>
            {statusLabel}
          </Text>
        </View>
        <View style={styles.iconCircle}>
          <Feather
            name={icon as React.ComponentProps<typeof Feather>["name"]}
            size={16}
            color="#00C853"
          />
        </View>
      </View>

      <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
        {body}
      </Text>
      <View style={styles.cardActions}>{children}</View>
    </View>
  );
}

function DoneBadge({ label }: { label: string }) {
  return (
    <View style={styles.doneBadge}>
      <Feather name="check-circle" size={14} color="#00C853" />
      <Text style={styles.doneText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: { paddingHorizontal: 16, gap: 14 },

  hero: {
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  heroIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  heroSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 4,
  },

  card: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  numBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  numText: { fontSize: 13, fontWeight: "800", color: "#00C853" },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  requiredBadge: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  requiredText: { fontSize: 10, fontWeight: "700", color: "#DC2626" },
  statusLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(0,200,83,0.08)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardBody: { fontSize: 13, lineHeight: 18 },
  cardActions: { gap: 8 },

  primaryBtn: {
    height: 42,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  ghostBtn: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ghostBtnText: { fontSize: 13, fontWeight: "600" },

  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 10,
    padding: 10,
  },
  infoText: { fontSize: 12, lineHeight: 17, flex: 1 },

  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  doneText: { fontSize: 13, fontWeight: "600", color: "#00C853" },

  deniedBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 10,
    padding: 10,
  },
  deniedText: { fontSize: 12, lineHeight: 17, flex: 1 },

  refreshRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 4,
  },
  refreshText: { fontSize: 13, fontWeight: "600" },

  skipNote: {
    textAlign: "center",
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 8,
  },
  profileNote: {
    textAlign: "center",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 8,
  },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },

  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  warningText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400E",
    flex: 1,
    lineHeight: 16,
  },

  continueBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
