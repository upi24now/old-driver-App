/**
 * Permission Onboarding Screen  (v5 — Delhivery-style clean wizard)
 *
 * One branded screen. One permission at a time. Real Android OS popups.
 * No checklist, no card wall, no fake success, no self-confirmation buttons.
 *
 * Steps (built at mount from device capabilities):
 *   1. Notifications  — required; OS dialog auto-fires; blocks Continue until granted
 *   2. Location       — required; OS dialog auto-fires; blocks Continue until granted
 *   3. Battery        — optional; opens REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
 *   4. Auto-start     — optional; Xiaomi/Vivo/Realme/Oppo/OnePlus brands only
 *   5. Screen Wake    — optional; Android 14+ only
 *
 * Required steps: Continue only unlocks after OS confirms permission.
 * Optional steps: Skip always available; button changes to "Continue" after settings opened.
 */

import { Feather } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
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
  const constants = Platform.constants as Record<string, unknown> | undefined;
  return ((constants?.Brand ?? "") as string).toLowerCase();
}

async function safeOpenAppSettings(): Promise<void> {
  if (Platform.OS === "web") {
    console.log("[BackgroundSetup] openSettings skipped on web");
    return;
  }
  if (typeof Linking.openSettings === "function") {
    await Linking.openSettings();
  }
}

type BrandFamily = "xiaomi" | "realme" | "samsung" | "vivo" | "generic";

function detectBrandFamily(brand: string): BrandFamily {
  if (
    brand.includes("xiaomi") ||
    brand.includes("redmi") ||
    brand.includes("poco")
  )
    return "xiaomi";
  if (
    brand.includes("realme") ||
    brand.includes("oppo") ||
    brand.includes("oneplus")
  )
    return "realme";
  if (brand.includes("samsung")) return "samsung";
  if (brand.includes("vivo") || brand.includes("iqoo")) return "vivo";
  return "generic";
}

// ─── Settings openers ─────────────────────────────────────────────────────────
// Every helper is fully wrapped — no uncaught rejection, no crash on any device.

async function openNotificationSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await safeOpenAppSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.APP_NOTIFICATION_SETTINGS" as IntentLauncher.ActivityAction,
      { extra: { "android.provider.Settings.EXTRA_APP_PACKAGE": APP_PKG } },
    );
  } catch {
    await safeOpenAppSettings();
  }
}

async function openBatteryOptimizationRequest(): Promise<void> {
  if (Platform.OS !== "android") {
    await safeOpenAppSettings();
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
        "android.settings.BATTERY_SAVER_SETTINGS" as IntentLauncher.ActivityAction,
      );
    } catch {
      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
          { data: `package:${APP_PKG}` },
        );
      } catch {
        await safeOpenAppSettings();
      }
    }
  }
}

async function openExactAppDetails(): Promise<void> {
  if (Platform.OS !== "android") {
    await safeOpenAppSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await safeOpenAppSettings();
  }
}

async function openBackgroundActivitySettings(
  brand: BrandFamily,
): Promise<void> {
  if (Platform.OS !== "android") {
    await safeOpenAppSettings();
    return;
  }
  if (brand === "xiaomi") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.intent.action.MAIN" as IntentLauncher.ActivityAction,
        {
          packageName: "com.miui.securitycenter",
          className:
            "com.miui.permcenter.autostart.AutoStartManagementActivity",
          flags: 0x10000000,
        },
      );
      return;
    } catch {
      /* fall through */
    }
  }
  if (brand === "vivo") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.intent.action.MAIN" as IntentLauncher.ActivityAction,
        {
          packageName: "com.vivo.permissionmanager",
          className:
            "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity",
          flags: 0x10000000,
        },
      );
      return;
    } catch {
      /* fall through */
    }
  }
  if (brand === "samsung") {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
        { data: `package:${APP_PKG}` },
      );
      return;
    } catch {
      /* fall through */
    }
  }
  // Realme / Oppo / OnePlus + generic → App Info
  await openExactAppDetails();
}

async function openScreenWakeSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await safeOpenAppSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await openExactAppDetails();
  }
}

// ─── Step definitions ─────────────────────────────────────────────────────────

type StepId =
  | "notifications"
  | "location"
  | "battery"
  | "autostart"
  | "screenwake";

interface WizardStep {
  id: StepId;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
  optional: boolean;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BackgroundSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { markBackgroundSetupShown } = useDriver();
  const params = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  // ── Permission state (OS-verified) ─────────────────────────────────────────
  const [notifGranted,      setNotifGranted]      = useState(false);
  const [notifCanAskAgain,  setNotifCanAskAgain]  = useState(true);
  const [locationGranted,   setLocationGranted]   = useState(false);
  const [locationCanAskAgain, setLocationCanAskAgain] = useState(true);
  const [loading,           setLoading]           = useState(false);
  const [finishing,         setFinishing]         = useState(false);

  // Flips to true after the driver opens an optional settings screen.
  // Reset to false whenever the wizard advances to a new step.
  // Used only to change the button label ("Open Setting" → "Continue").
  const [settingOpened, setSettingOpened] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);

  // Brand / OS detection — constant for the session
  const brandFamily   = detectBrandFamily(getDeviceBrand());
  const isAndroid14Plus =
    Platform.OS === "android" && Number(Platform.Version) >= 34;
  const showAutoStart =
    brandFamily === "xiaomi" ||
    brandFamily === "realme" ||
    brandFamily === "vivo";

  // Build step list once from platform constants
  const steps: WizardStep[] = [
    {
      id: "notifications",
      icon: "bell",
      title: "Enable Notifications",
      description: "Get instant delivery order alerts.",
      optional: false,
    },
    {
      id: "location",
      icon: "map-pin",
      title: "Enable Location",
      description: "Required to find nearby deliveries and navigate routes.",
      optional: false,
    },
    {
      id: "battery",
      icon: "battery-charging",
      title: "Keep App Active",
      description: "Helps receive orders when the phone is locked.",
      optional: true,
    },
    ...(showAutoStart
      ? ([
          {
            id: "autostart" as StepId,
            icon: "refresh-cw" as React.ComponentProps<typeof Feather>["name"],
            title: "Allow Background Running",
            description:
              "Helps the app receive delivery requests in the background.",
            optional: true,
          },
        ] satisfies WizardStep[])
      : []),
    ...(isAndroid14Plus
      ? ([
          {
            id: "screenwake" as StepId,
            icon: "sun" as React.ComponentProps<typeof Feather>["name"],
            title: "Allow Urgent Order Alerts",
            description: "Allows urgent order alerts to appear clearly.",
            optional: true,
          },
        ] satisfies WizardStep[])
      : []),
  ];

  const totalSteps = steps.length;
  const step       = steps[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

  // ── Permission refresh on AppState resume ──────────────────────────────────
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state !== "active") return;
      void (async () => {
        const [notifStatus, locStatus] = await Promise.all([
          getNotificationPermissionStatus().catch(() => ({
            granted: false,
            canAskAgain: false,
          })),
          Location.getForegroundPermissionsAsync().catch(() => ({
            granted: false,
            canAskAgain: false,
          })),
        ]);
        setNotifGranted(notifStatus.granted);
        setNotifCanAskAgain(notifStatus.canAskAgain);
        setLocationGranted(locStatus.granted);
        setLocationCanAskAgain(locStatus.canAskAgain ?? false);
      })();
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  // ── Auto-fire OS dialog when entering a required permission step ───────────
  // stepFiredRef prevents re-firing the OS popup on re-renders while it is open.
  const stepFiredRef = useRef<StepId | null>(null);

  useEffect(() => {
    const stepId = steps[currentStep]?.id;
    if (!stepId) return;

    setSettingOpened(false);

    if (stepId === "notifications" && stepFiredRef.current !== "notifications") {
      stepFiredRef.current = "notifications";
      void (async () => {
        const status = await getNotificationPermissionStatus().catch(() => ({
          granted: false,
          canAskAgain: true,
        }));
        setNotifGranted(status.granted);
        setNotifCanAskAgain(status.canAskAgain);
        if (status.granted || !status.canAskAgain) return;
        setLoading(true);
        await requestNotificationPermissions();
        const after = await getNotificationPermissionStatus().catch(() => ({
          granted: false,
          canAskAgain: false,
        }));
        setNotifGranted(after.granted);
        setNotifCanAskAgain(after.canAskAgain);
        setLoading(false);
      })();
    }

    if (stepId === "location" && stepFiredRef.current !== "location") {
      stepFiredRef.current = "location";
      void (async () => {
        const status = await Location.getForegroundPermissionsAsync().catch(
          () => ({ granted: false, canAskAgain: true }),
        );
        setLocationGranted(status.granted);
        setLocationCanAskAgain(status.canAskAgain ?? true);
        if (status.granted || !(status.canAskAgain ?? true)) return;
        setLoading(true);
        try {
          const result = await Location.requestForegroundPermissionsAsync();
          setLocationGranted(result.granted);
          setLocationCanAskAgain(result.canAskAgain ?? false);
        } catch {
          setLocationGranted(false);
        }
        setLoading(false);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── Navigation helpers ─────────────────────────────────────────────────────

  function advance() {
    if (isLastStep) {
      void finish();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }

  async function finish() {
    setFinishing(true);
    console.log("[PermissionOnboarding] completed");
    try {
      await markBackgroundSetupShown();
    } finally {
      setFinishing(false);
    }
    if (fromProfile) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  function handleSkip() {
    console.log("[PermissionOnboarding] skipped=", step?.id);
    advance();
  }

  async function handlePrimary() {
    if (!step) return;

    if (step.id === "notifications") {
      if (notifGranted) {
        advance();
        return;
      }
      if (notifCanAskAgain) {
        setLoading(true);
        await requestNotificationPermissions();
        const after = await getNotificationPermissionStatus().catch(() => ({
          granted: false,
          canAskAgain: false,
        }));
        setNotifGranted(after.granted);
        setNotifCanAskAgain(after.canAskAgain);
        setLoading(false);
        if (after.granted) advance();
      } else {
        await openNotificationSettings();
      }
      return;
    }

    if (step.id === "location") {
      if (locationGranted) {
        advance();
        return;
      }
      if (locationCanAskAgain) {
        setLoading(true);
        try {
          const result = await Location.requestForegroundPermissionsAsync();
          setLocationGranted(result.granted);
          setLocationCanAskAgain(result.canAskAgain ?? false);
          if (result.granted) advance();
        } catch {
          setLocationGranted(false);
        }
        setLoading(false);
      } else {
        await openExactAppDetails();
      }
      return;
    }

    // Optional steps: first tap opens system setting, second tap continues
    if (settingOpened) {
      advance();
      return;
    }
    if (step.id === "battery") {
      await openBatteryOptimizationRequest();
    } else if (step.id === "autostart") {
      await openBackgroundActivitySettings(brandFamily);
    } else if (step.id === "screenwake") {
      await openScreenWakeSettings();
    }
    setSettingOpened(true);
  }

  // Guard: steps array empty (should never happen in production)
  if (!step) return null;

  // ── Web bypass ─────────────────────────────────────────────────────────────
  // Browser has no Android notification/location APIs. Show a single button
  // so approved drivers can reach the dashboard during web preview testing.
  // Android APK never enters this branch.
  if (Platform.OS === "web") {
    return (
      <View style={[s.root, { justifyContent: "center", paddingHorizontal: 24 }]}>
        <TouchableOpacity
          style={[s.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            setFinishing(true);
            void markBackgroundSetupShown()
              .then(() => router.replace("/(tabs)"))
              .finally(() => setFinishing(false));
          }}
          activeOpacity={0.85}
          disabled={finishing}
        >
          {finishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={s.primaryBtnText}>Continue to Dashboard</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const permanentlyDenied =
    (step.id === "notifications" && !notifGranted && !notifCanAskAgain) ||
    (step.id === "location"     && !locationGranted && !locationCanAskAgain);

  let primaryLabel: string;
  if (step.id === "notifications") {
    if (notifGranted)          primaryLabel = "Continue";
    else if (!notifCanAskAgain) primaryLabel = "Open Notification Settings";
    else                        primaryLabel = "Allow Notifications";
  } else if (step.id === "location") {
    if (locationGranted)           primaryLabel = "Continue";
    else if (!locationCanAskAgain) primaryLabel = "Open Location Settings";
    else                           primaryLabel = "Allow Location";
  } else if (step.id === "battery") {
    primaryLabel = settingOpened ? "Continue" : "Continue Setup";
  } else {
    // autostart, screenwake
    primaryLabel = settingOpened ? "Continue" : "Open Setting";
  }

  const iconColor = step.optional ? "#2563EB" : colors.primary;
  const ringBg    = step.optional
    ? "rgba(37,99,235,0.08)"
    : (colors.primary as string) + "18";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Back button — profile entry only */}
      {fromProfile && (
        <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={[s.backBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <View
        style={[
          s.body,
          { paddingTop: fromProfile ? 32 : insets.top + 52 },
        ]}
      >
        {/* Brand mark */}
        <View style={s.brandRow}>
          <View style={[s.logoCircle, { backgroundColor: colors.primary }]}>
            <Feather name="truck" size={22} color="#fff" />
          </View>
          <Text style={[s.appName, { color: colors.foreground }]}>
            Driver App
          </Text>
        </View>

        {/* Step illustration */}
        <View style={s.illustrationWrap}>
          <View
            style={[
              s.iconRing,
              {
                backgroundColor: ringBg,
                borderColor: permanentlyDenied
                  ? "rgba(220,38,38,0.20)"
                  : iconColor + "28",
              },
            ]}
          >
            <Feather
              name={step.icon}
              size={64}
              color={permanentlyDenied ? "#DC2626" : iconColor}
            />
          </View>
        </View>

        {/* Title */}
        <Text style={[s.title, { color: colors.foreground }]}>
          {step.title}
        </Text>

        {/* Description */}
        <Text style={[s.description, { color: colors.mutedForeground }]}>
          {step.description}
        </Text>
      </View>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={[s.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => void handlePrimary()}
          activeOpacity={0.85}
          disabled={loading || finishing}
        >
          {loading || finishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={s.primaryBtnText}>{primaryLabel}</Text>
          )}
        </TouchableOpacity>

        {/* Skip — optional steps only */}
        {step.optional && (
          <TouchableOpacity
            style={s.skipBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={[s.skipText, { color: colors.mutedForeground }]}>
              Skip
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  body: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: "center",
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 56,
  },
  logoCircle: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },

  illustrationWrap: {
    alignItems: "center",
    marginBottom: 44,
  },
  iconRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
    marginBottom: 14,
  },

  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: 8,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 8,
  },

  primaryBtn: {
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.1,
  },

  skipBtn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
