/**
 * Permission Onboarding Screen  (v4 — Rapido/Delhivery-style wizard)
 *
 * One clean branded screen, one permission at a time, real Android OS popups.
 * No checklist wall, no card wall, no fake-green self-confirmation buttons.
 *
 * Steps (built at mount from device capabilities):
 *   1. Notifications  — required, OS dialog auto-fires, blocks Continue
 *   2. Location       — required, OS dialog auto-fires, blocks Continue
 *   3. Battery        — optional, opens REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
 *   4. Auto-start     — optional, Xiaomi/Vivo/Realme/Oppo/OnePlus brands only
 *   5. Screen Wake    — optional, Android 14+ only
 *
 * Rules:
 *   • Required steps: "Continue" only unlocks after OS confirms permission.
 *   • Optional steps: honest amber "Settings Opened" note, no fake green.
 *   • "Skip" is always available on optional steps.
 *
 * Re-accessible from Profile → Notification & Background Settings
 *   router.push("/background-setup?back=1")
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
  return (
    (
      (Platform.constants as Record<string, unknown>).Brand as
        | string
        | undefined
    ) ?? ""
  ).toLowerCase();
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
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.APP_NOTIFICATION_SETTINGS" as IntentLauncher.ActivityAction,
      { extra: { "android.provider.Settings.EXTRA_APP_PACKAGE": APP_PKG } },
    );
  } catch {
    await Linking.openSettings();
  }
}

async function openBatteryOptimizationRequest(): Promise<void> {
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

async function openExactAppDetails(): Promise<void> {
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

async function openBackgroundActivitySettings(
  brand: BrandFamily,
): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
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
  // Realme/Oppo/OnePlus + generic → App Info
  await openExactAppDetails();
}

async function openScreenWakeSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
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
  const [notifGranted, setNotifGranted] = useState(false);
  const [notifCanAskAgain, setNotifCanAskAgain] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationCanAskAgain, setLocationCanAskAgain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // After returning from an optional settings screen, settingOpened flips to
  // true so the primary button changes from "Open Settings" → "Continue".
  // Reset to false whenever the wizard advances to a new step.
  const [settingOpened, setSettingOpened] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);

  // Brand / OS detection — constant for session
  const brandFamily = detectBrandFamily(getDeviceBrand());
  const isAndroid14Plus =
    Platform.OS === "android" && Number(Platform.Version) >= 34;
  // Auto-start is only relevant on brands that restrict background activity
  const showAutoStart =
    brandFamily === "xiaomi" ||
    brandFamily === "realme" ||
    brandFamily === "vivo";

  // Build step list once (values derived only from platform constants)
  const steps: WizardStep[] = [
    {
      id: "notifications",
      icon: "bell",
      title: "Allow Notifications",
      description:
        "Driver App needs notification permission to alert you when a new delivery order arrives.",
      optional: false,
    },
    {
      id: "location",
      icon: "map-pin",
      title: "Allow Location Access",
      description:
        "Your location is used for navigation to pickup and drop points and to match you with nearby orders.",
      optional: false,
    },
    {
      id: "battery",
      icon: "battery-charging",
      title: "Disable Battery Restriction",
      description:
        "Unrestricted battery access keeps order alerts active when your screen is off. Tap Open to allow.",
      optional: true,
    },
    ...(showAutoStart
      ? ([
          {
            id: "autostart" as StepId,
            icon: "refresh-cw" as React.ComponentProps<typeof Feather>["name"],
            title: "Enable Auto-start",
            description:
              brandFamily === "xiaomi"
                ? "On Xiaomi / Redmi / POCO phones, auto-start must be enabled for the app to receive orders in the background."
                : brandFamily === "vivo"
                  ? "On Vivo / iQOO phones, background app refresh must be enabled for reliable order delivery."
                  : "On Realme / Oppo / OnePlus phones, auto-launch must be enabled for the app to run in background.",
            optional: true,
          },
        ] satisfies WizardStep[])
      : []),
    ...(isAndroid14Plus
      ? ([
          {
            id: "screenwake" as StepId,
            icon: "sun" as React.ComponentProps<typeof Feather>["name"],
            title: "Allow Screen Wake",
            description:
              "On Android 14+, enable full-screen alerts so the app can wake your screen when an urgent order arrives.",
            optional: true,
          },
        ] satisfies WizardStep[])
      : []),
  ];

  const totalSteps = steps.length;
  const step = steps[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

  // ── Permission refresh — called on AppState resume ─────────────────────────
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
  // stepFiredRef prevents re-firing the OS popup if the component re-renders
  // while the dialog is still open.
  const stepFiredRef = useRef<StepId | null>(null);

  useEffect(() => {
    const stepId = steps[currentStep]?.id;
    if (!stepId) return;

    // Reset per-step "setting opened" state on every step change
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
        console.log(
          "[PermissionOnboarding] step=notifications granted=",
          status.granted,
        );
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
        console.log(
          "[PermissionOnboarding] granted notification=",
          after.granted,
        );
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
        console.log(
          "[PermissionOnboarding] step=location granted=",
          status.granted,
        );
        if (status.granted || !(status.canAskAgain ?? true)) return;
        setLoading(true);
        try {
          const result = await Location.requestForegroundPermissionsAsync();
          setLocationGranted(result.granted);
          setLocationCanAskAgain(result.canAskAgain ?? false);
          console.log(
            "[PermissionOnboarding] granted location=",
            result.granted,
          );
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
    const [notifStatus, locStatus] = await Promise.all([
      getNotificationPermissionStatus().catch(() => ({
        granted: false,
        canAskAgain: false,
      })),
      Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
    ]);
    console.log(
      "[PermissionOnboarding] granted notification=",
      notifStatus.granted,
      "location=",
      locStatus.granted,
    );
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

  async function handleOpenSetting() {
    if (!step) return;
    console.log("[PermissionOnboarding] opened setting=", step.id);
    if (step.id === "battery") {
      await openBatteryOptimizationRequest();
    } else if (step.id === "autostart") {
      await openBackgroundActivitySettings(brandFamily);
    } else if (step.id === "screenwake") {
      await openScreenWakeSettings();
    }
    setSettingOpened(true);
  }

  async function handleNotifAction() {
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
  }

  async function handleLocationAction() {
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
  }

  async function handlePrimary() {
    if (!step) return;
    if (step.id === "notifications") {
      await handleNotifAction();
    } else if (step.id === "location") {
      await handleLocationAction();
    } else {
      // Optional steps: first tap opens settings, second tap continues
      if (settingOpened) {
        advance();
      } else {
        await handleOpenSetting();
      }
    }
  }

  // ── Guard: steps array empty (should never happen) ────────────────────────
  if (!step) return null;

  // ── Derived render values ─────────────────────────────────────────────────

  const isRequired = !step.optional;

  const requiredGranted =
    step.id === "notifications"
      ? notifGranted
      : step.id === "location"
        ? locationGranted
        : false;

  const permanentlyDenied =
    (step.id === "notifications" && !notifGranted && !notifCanAskAgain) ||
    (step.id === "location" && !locationGranted && !locationCanAskAgain);

  let primaryLabel: string;
  if (step.id === "notifications") {
    if (notifGranted) primaryLabel = "Continue";
    else if (!notifCanAskAgain) primaryLabel = "Open Notification Settings";
    else primaryLabel = "Allow Notifications";
  } else if (step.id === "location") {
    if (locationGranted) primaryLabel = "Continue";
    else if (!locationCanAskAgain) primaryLabel = "Open Location Settings";
    else primaryLabel = "Allow Location";
  } else {
    if (settingOpened) primaryLabel = "Continue";
    else if (step.id === "battery") primaryLabel = "Open Battery Settings";
    else if (step.id === "autostart") primaryLabel = "Open Auto-start Settings";
    else primaryLabel = "Open Screen Wake Settings";
  }

  // Primary button color
  const primaryColor =
    isRequired && requiredGranted
      ? "#00C853"
      : colors.primary;

  // Icon / ring color
  const iconColor =
    isRequired && requiredGranted
      ? "#00C853"
      : isRequired && permanentlyDenied
        ? "#DC2626"
        : isRequired
          ? colors.primary
          : "#2563EB";

  const ringBg =
    isRequired && requiredGranted
      ? "rgba(0,200,83,0.10)"
      : isRequired && permanentlyDenied
        ? "rgba(220,38,38,0.08)"
        : isRequired
          ? (colors.primary as string) + "18"
          : "rgba(37,99,235,0.08)";

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* ── Top bar (fromProfile only) ───────────────────────────────────── */}
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

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <View
        style={[
          s.body,
          { paddingTop: fromProfile ? 24 : insets.top + 40 },
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

        {/* Step progress dots */}
        <View style={s.dotsRow}>
          {steps.map((st, i) => (
            <View
              key={st.id}
              style={[
                s.dot,
                {
                  backgroundColor: colors.primary,
                  width: i === currentStep ? 22 : 8,
                  opacity: i < currentStep ? 0.35 : i === currentStep ? 1 : 0.18,
                },
              ]}
            />
          ))}
        </View>

        {/* Illustration */}
        <View style={s.illustrationWrap}>
          <View
            style={[
              s.iconRing,
              { backgroundColor: ringBg, borderColor: iconColor + "30" },
            ]}
          >
            <Feather name={step.icon} size={56} color={iconColor} />
          </View>

          {isRequired && requiredGranted && (
            <View style={s.grantedBadge}>
              <Feather name="check-circle" size={16} color="#166534" />
              <Text style={s.grantedText}>Granted</Text>
            </View>
          )}

          {permanentlyDenied && (
            <View style={s.deniedBadge}>
              <Feather name="alert-circle" size={15} color="#DC2626" />
              <Text style={s.deniedText}>
                Permission denied — tap the button below to open Settings
              </Text>
            </View>
          )}
        </View>

        {/* Step counter */}
        <Text style={[s.stepCounter, { color: colors.mutedForeground }]}>
          Step {currentStep + 1} of {totalSteps}
        </Text>

        {/* Title */}
        <Text style={[s.title, { color: colors.foreground }]}>
          {step.title}
        </Text>

        {/* Description */}
        <Text style={[s.description, { color: colors.mutedForeground }]}>
          {step.description}
        </Text>

        {/* Honest "settings opened" note for optional steps */}
        {step.optional && settingOpened && (
          <View style={s.openedNote}>
            <Feather name="check" size={14} color="#92400E" />
            <Text style={s.openedNoteText}>
              Settings opened — tap Continue when done
            </Text>
          </View>
        )}
      </View>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity
          style={[s.primaryBtn, { backgroundColor: primaryColor }]}
          onPress={() => void handlePrimary()}
          activeOpacity={0.85}
          disabled={loading || finishing}
        >
          {loading || finishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={s.primaryBtnText}>{primaryLabel}</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        {/* Skip — optional steps only, before setting has been opened */}
        {step.optional && !settingOpened && (
          <TouchableOpacity
            style={s.skipBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={[s.skipText, { color: colors.mutedForeground }]}>
              Skip for now
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

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
    paddingHorizontal: 28,
    alignItems: "center",
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 36,
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

  dotsRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    marginBottom: 48,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },

  illustrationWrap: {
    alignItems: "center",
    gap: 16,
    marginBottom: 36,
  },
  iconRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },

  grantedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  grantedText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
  },

  deniedBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    maxWidth: 280,
  },
  deniedText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#DC2626",
    flex: 1,
    lineHeight: 17,
  },

  stepCounter: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  title: {
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
    marginBottom: 14,
  },

  description: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    paddingHorizontal: 4,
  },

  openedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 20,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  openedNoteText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 10,
  },

  primaryBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 16,
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
    fontSize: 14,
    fontWeight: "500",
  },
});
