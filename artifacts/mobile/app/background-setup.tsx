/**
 * Driver Readiness Setup Screen  (v3 — Rapido-style)
 *
 * Shown once after onboarding approval, before the main dashboard.
 * Guides the driver through up to 6 steps for reliable order delivery:
 *
 *   1. POST_NOTIFICATIONS  (required — blocks Continue)
 *   2. GPS foreground location  (required — blocks Continue)
 *   3. Battery optimization exemption  (recommended — cannot verify, user confirms)
 *   4. Background Activity  (recommended — cannot verify, user confirms)
 *   5. Auto Start — manufacturer-specific  (recommended — cannot verify, user confirms)
 *   6. Screen Wake for Order Alerts — Android 14+ only  (recommended — cannot verify, user confirms)
 *      Opens ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT via expo-intent-launcher.
 *      Fallback: APPLICATION_DETAILS_SETTINGS.
 *
 * Continue is unlocked only when notifications AND GPS are granted.
 * Steps 3-6 show "YES, I ENABLED THIS" confirmation but never block Continue.
 * Step 6 is hidden entirely on Android < 14 and on iOS.
 *
 * Re-accessible from: Profile → Notification & Background Settings
 *   router.push("/background-setup?back=1")
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

// ─── Package / brand helpers ──────────────────────────────────────────────────

const APP_PKG = "in.bikecourierservice.driver";

function getDeviceBrand(): string {
  return (
    ((Platform.constants as Record<string, unknown>).Brand as string | undefined) ?? ""
  ).toLowerCase();
}

type BrandFamily = "xiaomi" | "realme" | "samsung" | "vivo" | "generic";

function detectBrandFamily(brand: string): BrandFamily {
  if (brand.includes("xiaomi") || brand.includes("redmi") || brand.includes("poco")) return "xiaomi";
  if (brand.includes("realme") || brand.includes("oppo") || brand.includes("oneplus")) return "realme";
  if (brand.includes("samsung")) return "samsung";
  if (brand.includes("vivo") || brand.includes("iqoo")) return "vivo";
  return "generic";
}

const BRAND_LABEL: Record<BrandFamily, string> = {
  xiaomi:  "Xiaomi / Redmi / POCO",
  realme:  "Realme / Oppo / OnePlus",
  samsung: "Samsung",
  vivo:    "Vivo / iQOO",
  generic: "Your Phone",
};

const AUTO_START_STEPS: Record<BrandFamily, string[]> = {
  xiaomi: [
    "Open Settings on your phone",
    "Go to Apps → Manage Apps",
    "Find and tap Driver App",
    "Tap Permissions → Start in Background → Allow",
  ],
  realme: [
    "Open Settings on your phone",
    "Go to Apps → Manage Apps",
    "Find and tap Driver App",
    "Tap Auto Launch → Enable",
  ],
  samsung: [
    "Open Settings on your phone",
    "Go to Battery → Background Usage Limits",
    "Find Driver App under Sleeping Apps",
    "Move it to Never Sleeping Apps",
  ],
  vivo: [
    "Open Settings on your phone",
    "Go to Battery → Background App Refresh",
    "Find Driver App and toggle it On",
  ],
  generic: [
    "Open App Info below",
    "Look for Auto Start, Autorun, or Background Activity",
    "Enable it if available",
    "(Path varies by phone brand and Android version)",
  ],
};

// ─── Settings openers ─────────────────────────────────────────────────────────
// Every helper is fully wrapped — no uncaught rejection, no crash on any device.

/**
 * ACTION_APP_NOTIFICATION_SETTINGS — opens the exact per-app notification
 * channel page (Android 8+).
 * Fallback: Linking.openSettings() (generic settings root).
 */
async function openNotificationSettings(): Promise<void> {
  if (Platform.OS !== "android") { await Linking.openSettings(); return; }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.APP_NOTIFICATION_SETTINGS" as IntentLauncher.ActivityAction,
      { extra: { "android.provider.Settings.EXTRA_APP_PACKAGE": APP_PKG } },
    );
  } catch {
    await Linking.openSettings();
  }
}

/**
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — takes the driver directly to the
 * "Unrestricted / Don't optimize" dialog for this app.
 * Fallback chain: BATTERY_SAVER_SETTINGS → App Info → generic settings.
 */
async function openBatteryOptimizationRequest(): Promise<void> {
  if (Platform.OS !== "android") { await Linking.openSettings(); return; }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.BATTERY_SAVER_SETTINGS" as IntentLauncher.ActivityAction,
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
}

/**
 * APPLICATION_DETAILS_SETTINGS for this package.
 * Used for GPS-denied fallback and background-activity guidance.
 * Fallback: Linking.openSettings().
 */
async function openExactAppDetails(): Promise<void> {
  if (Platform.OS !== "android") { await Linking.openSettings(); return; }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await Linking.openSettings();
  }
}

/**
 * OEM-specific auto-start / background-activity settings page.
 *
 * Each brand path is individually try/caught so a failure on one brand-specific
 * intent immediately falls through to the next level — never crashes.
 *
 *   Xiaomi/Redmi/POCO → MIUI Security Centre autostart activity
 *   Vivo/iQOO         → Vivo Permission Manager autostart activity
 *   Samsung           → REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (controls bg limits)
 *   Realme/Oppo/OnePlus / generic → App Info (navigate manually per step guide)
 *
 * Final fallback for every brand: openExactAppDetails().
 */
async function openBackgroundActivitySettings(brand: BrandFamily): Promise<void> {
  if (Platform.OS !== "android") { await Linking.openSettings(); return; }

  if (brand === "xiaomi") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.intent.action.MAIN" as IntentLauncher.ActivityAction,
        {
          packageName: "com.miui.securitycenter",
          className:   "com.miui.permcenter.autostart.AutoStartManagementActivity",
          flags:       0x10000000, // FLAG_ACTIVITY_NEW_TASK
        },
      );
      return;
    } catch { /* fall through to App Info */ }
  }

  if (brand === "vivo") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.intent.action.MAIN" as IntentLauncher.ActivityAction,
        {
          packageName: "com.vivo.permissionmanager",
          className:   "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity",
          flags:       0x10000000,
        },
      );
      return;
    } catch { /* fall through to App Info */ }
  }

  if (brand === "samsung") {
    // Battery optimization controls background usage limits on Samsung
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
        { data: `package:${APP_PKG}` },
      );
      return;
    } catch { /* fall through to App Info */ }
  }

  // Realme/Oppo/OnePlus + generic: App Info (driver follows the on-screen step guide)
  await openExactAppDetails();
}

/**
 * MANAGE_APP_USE_FULL_SCREEN_INTENT — Android 14+ per-app toggle that allows
 * the app to wake the screen for urgent notifications (full-screen intents).
 * Fallback: APPLICATION_DETAILS_SETTINGS for this package.
 */
async function openScreenWakeSettings(): Promise<void> {
  if (Platform.OS !== "android") { await Linking.openSettings(); return; }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await openExactAppDetails();
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BackgroundSetupScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const { markBackgroundSetupShown } = useDriver();
  const params      = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  // ── Required permissions (block Continue) ──────────────────────────────────
  const [notifGranted,        setNotifGranted]        = useState(false);
  const [notifCanAskAgain,    setNotifCanAskAgain]    = useState(true);
  const [notifLoading,        setNotifLoading]        = useState(false);
  const [locationGranted,     setLocationGranted]     = useState(false);
  const [locationCanAskAgain, setLocationCanAskAgain] = useState(true);
  const [locationLoading,     setLocationLoading]     = useState(false);

  // ── Manual setup steps (user-confirmed, never block Continue) ──────────────
  const [batteryOpened,     setBatteryOpened]     = useState(false);
  const [batteryEnabled,    setBatteryEnabled]    = useState(false);
  const [bgActivityOpened,  setBgActivityOpened]  = useState(false);
  const [bgActivityEnabled, setBgActivityEnabled] = useState(false);
  const [autoStartOpened,   setAutoStartOpened]   = useState(false);
  const [autoStartEnabled,  setAutoStartEnabled]  = useState(false);
  const [screenWakeOpened,  setScreenWakeOpened]  = useState(false);
  const [screenWakeEnabled, setScreenWakeEnabled] = useState(false);

  const [saving,     setSaving]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Brand detection — static for session
  const brandFamily  = detectBrandFamily(getDeviceBrand());
  const brandLabel   = BRAND_LABEL[brandFamily];
  const autoStartSteps = AUTO_START_STEPS[brandFamily];

  // Android 14+ guard — used to conditionally show Screen Wake card and progress item
  const isAndroid14Plus = Platform.OS === "android" && Number(Platform.Version) >= 34;

  // ── Permission refresh ──────────────────────────────────────────────────────
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
      // 1. Read current state immediately so UI reflects reality.
      const [notifStatus, locStatus] = await Promise.all([
        getNotificationPermissionStatus().catch(() => ({ granted: false, canAskAgain: false })),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false, canAskAgain: false })),
      ]);
      setNotifGranted(notifStatus.granted);
      setNotifCanAskAgain(notifStatus.canAskAgain);
      setLocationGranted(locStatus.granted);
      setLocationCanAskAgain(locStatus.canAskAgain ?? false);

      // 2. Auto-show OS popups sequentially for any permission still askable.
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

    // Re-check permissions whenever driver returns from device settings.
    const handleAppState = (state: AppStateStatus) => {
      if (state === "active") void refreshPermissions();
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleEnableNotifs() {
    setNotifLoading(true);
    await requestNotificationPermissions();
    const after = await getNotificationPermissionStatus()
      .catch(() => ({ granted: false, canAskAgain: false }));
    setNotifGranted(after.granted);
    setNotifCanAskAgain(after.canAskAgain);
    setNotifLoading(false);
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
  }

  async function handleBattery() {
    await openBatteryOptimizationRequest();
    setBatteryOpened(true);
  }

  async function handleBgActivity() {
    await openExactAppDetails();
    setBgActivityOpened(true);
  }

  async function handleAutoStart() {
    await openBackgroundActivitySettings(brandFamily);
    setAutoStartOpened(true);
  }

  async function handleScreenWake() {
    await openScreenWakeSettings();
    setScreenWakeOpened(true);
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
        [{ text: "OK" }],
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

  const criticalReady    = notifGranted && locationGranted;
  const scrollPaddingTop = fromProfile ? 16 : insets.top + 16;

  const progressItems = [
    { label: "Notifications",       done: notifGranted },
    { label: "Location",            done: locationGranted },
    { label: "Battery Setup",       done: batteryEnabled },
    { label: "Background Activity", done: bgActivityEnabled },
    { label: "Auto Start",          done: autoStartEnabled },
    ...(isAndroid14Plus ? [{ label: "Screen Wake", done: screenWakeEnabled }] : []),
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {fromProfile && (
        <View
          style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}
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
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={[styles.heroIconWrap, { backgroundColor: colors.primary }]}>
            <Feather name="shield" size={30} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Driver Readiness Setup</Text>
          <Text style={styles.heroSub}>
            {"Complete these steps to receive orders reliably on your Android phone."}
          </Text>
        </LinearGradient>

        {/* ── Progress tracker ──────────────────────────────────────────────── */}
        <ProgressTracker items={progressItems} colors={colors} />

        {/* ── Card 1: Notifications ─────────────────────────────────────────── */}
        <StepCard
          num="1"
          icon="bell"
          title="Notifications"
          required
          statusOk={notifGranted}
          statusLabel={notifGranted ? "✓ Notifications Enabled" : "⚠ Notifications Required"}
          colors={colors}
        >
          {notifGranted ? (
            <DoneBadge label="Notifications Enabled" />
          ) : (
            <>
              <StepList
                steps={[
                  "Tap the Enable button below",
                  "When the system dialog appears, tap Allow",
                  "Notifications for Driver App will be active",
                ]}
                colors={colors}
              />
              {notifCanAskAgain ? (
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
                      Permission permanently denied. Open Settings and enable notifications manually.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={openNotificationSettings}
                    activeOpacity={0.85}
                  >
                    <Feather name="external-link" size={14} color="#fff" />
                    <Text style={styles.primaryBtnText}>Open Notification Settings</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </StepCard>

        {/* ── Card 2: GPS Location ──────────────────────────────────────────── */}
        <StepCard
          num="2"
          icon="map-pin"
          title="GPS Location"
          required
          statusOk={locationGranted}
          statusLabel={locationGranted ? "✓ Location Enabled" : "⚠ Location Required"}
          colors={colors}
        >
          {locationGranted ? (
            <DoneBadge label="Location Access Granted" />
          ) : (
            <>
              <StepList
                steps={[
                  "Tap the Enable GPS button below",
                  "Choose \"Allow While Using App\"",
                  "Return to Driver App",
                ]}
                colors={colors}
              />
              {locationCanAskAgain ? (
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
                      Location permission permanently denied. Open App Settings to enable it.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={openExactAppDetails}
                    activeOpacity={0.85}
                  >
                    <Feather name="external-link" size={14} color="#fff" />
                    <Text style={styles.primaryBtnText}>Open App Settings</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather name="info" size={12} color={colors.mutedForeground} style={{ marginTop: 1 }} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Only \"While Using the App\" location is used. Background location is NOT requested."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 3: Battery Optimization ──────────────────────────────────── */}
        {/* statusOk reflects user confirmation only — Android cannot expose this. */}
        <StepCard
          num="3"
          icon="battery-charging"
          title="Battery Optimization"
          required={false}
          statusOk={batteryEnabled}
          statusLabel={batteryEnabled ? "✓ Disabled by you" : "Manual setup recommended"}
          colors={colors}
        >
          {batteryEnabled ? (
            <DoneBadge label="Battery optimization disabled" />
          ) : (
            <>
              <StepList
                steps={[
                  "Tap Open Battery Settings below",
                  "Find and select Driver App in the list",
                  "Choose Unrestricted  or  Don't Optimize",
                ]}
                colors={colors}
              />
              {!batteryOpened ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={handleBattery}
                  activeOpacity={0.85}
                >
                  <Feather name="battery-charging" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Open Battery Settings</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() => setBatteryEnabled(true)}
                    activeOpacity={0.85}
                  >
                    <Feather name="check-circle" size={15} color="#fff" />
                    <Text style={styles.confirmBtnText}>YES, I ENABLED THIS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ghostBtn, { borderColor: colors.border }]}
                    onPress={handleBattery}
                    activeOpacity={0.7}
                  >
                    <Feather name="refresh-cw" size={13} color={colors.foreground} />
                    <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
                      Open Settings Again
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather name="info" size={12} color={colors.mutedForeground} style={{ marginTop: 1 }} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Prevents Android from killing the app when your screen locks. Cannot be verified automatically."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 4: Background Activity ───────────────────────────────────── */}
        {/* statusOk reflects user confirmation only — Android cannot expose this. */}
        <StepCard
          num="4"
          icon="activity"
          title="Background Activity"
          required={false}
          statusOk={bgActivityEnabled}
          statusLabel={bgActivityEnabled ? "✓ Enabled by you" : "Manual setup recommended"}
          colors={colors}
        >
          {bgActivityEnabled ? (
            <DoneBadge label="Background activity enabled" />
          ) : (
            <>
              <StepList
                steps={[
                  "Tap Open App Info below",
                  "Tap Battery",
                  "Select Allow background activity",
                  "Enable Allow background running (if available)",
                ]}
                colors={colors}
              />
              {!bgActivityOpened ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={handleBgActivity}
                  activeOpacity={0.85}
                >
                  <Feather name="smartphone" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Open App Info</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() => setBgActivityEnabled(true)}
                    activeOpacity={0.85}
                  >
                    <Feather name="check-circle" size={15} color="#fff" />
                    <Text style={styles.confirmBtnText}>YES, I ENABLED THIS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ghostBtn, { borderColor: colors.border }]}
                    onPress={handleBgActivity}
                    activeOpacity={0.7}
                  >
                    <Feather name="refresh-cw" size={13} color={colors.foreground} />
                    <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
                      Open Settings Again
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather name="alert-triangle" size={12} color="#b75d00" style={{ marginTop: 1 }} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Ensures the app receives orders while running in the background. Cannot be verified automatically."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 5: Auto Start (manufacturer-specific) ────────────────────── */}
        {/* statusOk reflects user confirmation only — no Android API exposes this. */}
        <StepCard
          num="5"
          icon="zap"
          title="Auto Start"
          required={false}
          statusOk={autoStartEnabled}
          statusLabel={autoStartEnabled ? "✓ Enabled by you" : "Manual setup recommended"}
          colors={colors}
        >
          {brandFamily !== "generic" && (
            <View style={[styles.brandChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="smartphone" size={11} color={colors.mutedForeground} />
              <Text style={[styles.brandChipText, { color: colors.mutedForeground }]}>
                {brandLabel} instructions
              </Text>
            </View>
          )}
          {autoStartEnabled ? (
            <DoneBadge label="Auto Start enabled" />
          ) : (
            <>
              <StepList steps={autoStartSteps} colors={colors} />
              {!autoStartOpened ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  onPress={handleAutoStart}
                  activeOpacity={0.85}
                >
                  <Feather name="settings" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Open App Info</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() => setAutoStartEnabled(true)}
                    activeOpacity={0.85}
                  >
                    <Feather name="check-circle" size={15} color="#fff" />
                    <Text style={styles.confirmBtnText}>YES, I ENABLED THIS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ghostBtn, { borderColor: colors.border }]}
                    onPress={handleAutoStart}
                    activeOpacity={0.7}
                  >
                    <Feather name="refresh-cw" size={13} color={colors.foreground} />
                    <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
                      Open Settings Again
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather name="alert-triangle" size={12} color="#b75d00" style={{ marginTop: 1 }} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              {"Allows Driver App to launch automatically when a delivery is assigned. Path varies by phone brand."}
            </Text>
          </View>
        </StepCard>

        {/* ── Card 6: Screen Wake (Android 14+ only) ────────────────────── */}
        {/* statusOk reflects user confirmation only — canUseFullScreenIntent()  */}
        {/* is not exposed in the expo-notifications JS API.                     */}
        {isAndroid14Plus && (
          <StepCard
            num="6"
            icon="sun"
            title="Screen Wake for Order Alerts"
            required={false}
            statusOk={screenWakeEnabled}
            statusLabel={screenWakeEnabled ? "✓ Enabled by you" : "Recommended — Android 14+"}
            colors={colors}
          >
            {screenWakeEnabled ? (
              <DoneBadge label="Screen wake enabled" />
            ) : (
              <>
                <StepList
                  steps={[
                    "Tap Open Screen Wake Setting below",
                    "Find Driver App in the list",
                    "Toggle Allow full-screen intent to On",
                    "Return to Driver App and confirm below",
                  ]}
                  colors={colors}
                />
                {!screenWakeOpened ? (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={handleScreenWake}
                    activeOpacity={0.85}
                  >
                    <Feather name="sun" size={14} color="#fff" />
                    <Text style={styles.primaryBtnText}>Open Screen Wake Setting</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.confirmBtn}
                      onPress={() => setScreenWakeEnabled(true)}
                      activeOpacity={0.85}
                    >
                      <Feather name="check-circle" size={15} color="#fff" />
                      <Text style={styles.confirmBtnText}>YES, I ENABLED THIS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ghostBtn, { borderColor: colors.border }]}
                      onPress={handleScreenWake}
                      activeOpacity={0.7}
                    >
                      <Feather name="refresh-cw" size={13} color={colors.foreground} />
                      <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
                        Open Setting Again
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
            <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
              <Feather name="info" size={12} color={colors.mutedForeground} style={{ marginTop: 1 }} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                {"Allow this app to wake the screen for urgent delivery requests when your phone is locked. Cannot be verified automatically."}
              </Text>
            </View>
          </StepCard>
        )}

        {/* ── Refresh status ────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.refreshRow}
          onPress={handleRefresh}
          activeOpacity={0.7}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          )}
          <Text style={[styles.refreshText, { color: colors.mutedForeground }]}>
            {refreshing ? "Checking…" : "Refresh permission status"}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.skipNote, { color: colors.mutedForeground }]}>
          {"Permission status refreshes automatically when you return from settings.\nSteps 3–5 cannot be verified automatically — Android does not expose these to apps."}
        </Text>

        <Text style={[styles.profileNote, { color: colors.mutedForeground }]}>
          {"These settings can be revisited later from Profile → Permissions & Background Settings."}
        </Text>
      </ScrollView>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
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
          style={[
            styles.continueBtn,
            { backgroundColor: criticalReady ? colors.primary : colors.mutedForeground },
          ]}
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
                {criticalReady ? "All Set — Continue to Home" : "Grant Permissions First"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type ColorsShape = ReturnType<typeof useColors>;

/** 5-step progress summary shown below the hero. */
function ProgressTracker({
  items,
  colors,
}: {
  items: { label: string; done: boolean }[];
  colors: ColorsShape;
}) {
  const doneCount = items.filter((i) => i.done).length;
  const allDone   = doneCount === items.length;
  return (
    <View
      style={[
        styles.progressCard,
        {
          backgroundColor: colors.surface,
          borderColor:     allDone ? "#00C853" : colors.border,
          borderWidth:     allDone ? 1.5 : 1,
        },
      ]}
    >
      <Text style={[styles.progressHeading, { color: colors.foreground }]}>
        Driver Readiness
      </Text>
      {items.map((item, i) => (
        <View key={i} style={[styles.progressRow, { borderTopColor: colors.border }]}>
          <Text
            style={[
              styles.progressLabel,
              { color: item.done ? colors.foreground : colors.mutedForeground },
            ]}
          >
            {item.label}
          </Text>
          <Feather
            name={item.done ? "check-circle" : "x-circle"}
            size={17}
            color={item.done ? "#00C853" : "#DC2626"}
          />
        </View>
      ))}
      <View style={[styles.progressCountRow, { borderTopColor: colors.border }]}>
        <Text
          style={[
            styles.progressCount,
            { color: allDone ? "#00C853" : colors.mutedForeground },
          ]}
        >
          {doneCount}/{items.length} Complete
        </Text>
      </View>
    </View>
  );
}

/** Numbered step-by-step instruction list inside a card. */
function StepList({ steps, colors }: { steps: string[]; colors: ColorsShape }) {
  return (
    <View style={styles.stepList}>
      {steps.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <View style={[styles.stepNumBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.stepNumText, { color: colors.mutedForeground }]}>{i + 1}</Text>
          </View>
          <Text style={[styles.stepText, { color: colors.foreground }]}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

/** Permission / setup card. statusOk drives border colour and number-badge style. */
function StepCard({
  num,
  icon,
  title,
  required,
  statusLabel,
  statusOk,
  colors,
  children,
}: {
  num: string;
  icon: string;
  title: string;
  required: boolean;
  statusLabel: string;
  statusOk: boolean;
  colors: ColorsShape;
  children: React.ReactNode;
}) {
  const accentColor = statusOk ? "#00C853" : required ? "#DC2626" : "#D97706";
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor:     statusOk ? "#00C853" : required ? "#FCA5A5" : colors.border,
          borderWidth:     statusOk || required ? 1.5 : 1,
        },
      ]}
    >
      {/* Header row */}
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
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
            {required && (
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredText}>Required</Text>
              </View>
            )}
          </View>
          <Text style={[styles.statusLabel, { color: accentColor }]}>{statusLabel}</Text>
        </View>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: statusOk ? "rgba(0,200,83,0.10)" : required ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)" },
          ]}
        >
          <Feather
            name={icon as React.ComponentProps<typeof Feather>["name"]}
            size={16}
            color={accentColor}
          />
        </View>
      </View>

      {/* Content */}
      <View style={styles.cardActions}>{children}</View>
    </View>
  );
}

/** Green checkmark badge shown when a step is complete. */
function DoneBadge({ label }: { label: string }) {
  return (
    <View style={styles.doneBadge}>
      <Feather name="check-circle" size={14} color="#00C853" />
      <Text style={styles.doneText}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header (fromProfile only)
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

  // Hero
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

  // Progress tracker
  progressCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  progressHeading: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressLabel: { fontSize: 14, fontWeight: "500" },
  progressCountRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  progressCount: { fontSize: 13, fontWeight: "700", textAlign: "center" },

  // Step card
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
  statusLabel: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardActions: { gap: 8 },

  // Brand chip (auto-start)
  brandChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  brandChipText: { fontSize: 11, fontWeight: "600" },

  // Numbered step list
  stepList: { gap: 7, marginBottom: 2 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNumBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: { fontSize: 11, fontWeight: "800" },
  stepText: { fontSize: 13, lineHeight: 19, flex: 1, fontWeight: "500" },

  // Buttons
  primaryBtn: {
    height: 46,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  confirmBtn: {
    height: 50,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#00C853",
  },
  confirmBtnText: { fontSize: 14, fontWeight: "800", color: "#fff", letterSpacing: 0.4 },

  ghostBtn: {
    height: 40,
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

  // Refresh
  refreshRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 4,
  },
  refreshText: { fontSize: 13, fontWeight: "600" },

  // Footer notes
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

  // Footer / continue
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
