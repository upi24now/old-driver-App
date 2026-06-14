/**
 * Centralised permission utilities — Bike Courier driver app.
 *
 * Covers three mandatory driver permissions:
 *   1. Notifications          (expo-notifications — via notifications.ts)
 *   2. Location foreground    (expo-location)
 *   3. Background Location    (expo-location — Android needs foreground first)
 *
 * Battery optimisation status cannot be read from JS without a native module.
 * The dashboard health card exposes openBatterySettings() so the driver can
 * manually exempt the app; we track whether the settings page was opened and
 * show an optimistic ✅ after the driver returns from it.
 */

import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { Alert, Linking, Platform } from "react-native";

import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
} from "./notifications";

// ─── App package name ─────────────────────────────────────────────────────────
export const APP_PKG = "in.bikecourierservice.driver";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermStatus {
  granted: boolean;
  canAskAgain: boolean;
}

export interface AllPermissionsStatus {
  notifications: PermStatus;
  location: PermStatus;
  backgroundLocation: PermStatus;
}

// ─── Settings openers ─────────────────────────────────────────────────────────

async function openAppDetails(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings().catch(() => {});
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings().catch(() => {});
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.APP_NOTIFICATION_SETTINGS" as IntentLauncher.ActivityAction,
      { extra: { "android.provider.Settings.EXTRA_APP_PACKAGE": APP_PKG } },
    );
  } catch {
    await openAppDetails();
  }
}

export async function openPermissionSettings(): Promise<void> {
  await openAppDetails();
}

export async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== "android") return;

  console.log("[BATTERY_SETTINGS_OPEN_START] starting battery settings flow — package:", APP_PKG);

  // ── A: App-specific battery optimization dialog ───────────────────────────
  // Opens a direct "Allow <app> to ignore battery optimizations?" dialog.
  // Requires android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in manifest.
  // Works in production builds; in Expo Go this throws SecurityException because
  // Expo Go's manifest does not declare that permission.
  console.log("[BATTERY_SETTINGS_INTENT_TRY] ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
      { data: `package:${APP_PKG}` },
    );
    console.log("[BATTERY_SETTINGS_INTENT_SUCCESS] ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS opened");
    return;
  } catch (errA) {
    console.log("[BATTERY_SETTINGS_INTENT_FAIL] ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS —", String(errA));
  }

  // ── B: Global battery optimization list ──────────────────────────────────
  // Opens Android Settings → Battery → Battery optimization (lists all apps).
  // No special permission required; driver can search for the app manually.
  // May fail on some OEM ROMs (Samsung/Xiaomi/Oppo) with manufacturer overlays.
  console.log("[BATTERY_SETTINGS_INTENT_TRY] ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS" as IntentLauncher.ActivityAction,
    );
    console.log("[BATTERY_SETTINGS_INTENT_SUCCESS] ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS opened");
    return;
  } catch (errB) {
    console.log("[BATTERY_SETTINGS_INTENT_FAIL] ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS —", String(errB));
  }

  // ── C: App Info for the currently running app ─────────────────────────────
  // Linking.openSettings() opens App Info for whichever app is running right now:
  //   - Expo Go in development  → Expo Go App Info (driver can find Battery there)
  //   - Production build        → Driver App Info (correct)
  // This avoids the hardcoded-package failure when in.bikecourierservice.driver
  // is not installed on the device (e.g. during Expo Go testing).
  console.log("[BATTERY_SETTINGS_FALLBACK_APP_SETTINGS] falling back to Linking.openSettings()");
  try {
    await Linking.openSettings();
    console.log("[BATTERY_SETTINGS_INTENT_SUCCESS] Linking.openSettings() opened");
    return;
  } catch (errC) {
    console.log("[BATTERY_SETTINGS_INTENT_FAIL] Linking.openSettings() —", String(errC));
  }

  // ── D: All methods failed — show manual instructions ─────────────────────
  console.log("[BATTERY_SETTINGS_INTENT_FAIL] all intents failed — showing Alert");
  Alert.alert(
    "Settings Open Nahi Ho Paaye",
    "Manually open karo:\nSettings → Apps → Driver App → Battery → Unrestricted",
    [{ text: "OK" }],
  );
}

// ─── Permission checks ────────────────────────────────────────────────────────

export async function checkBackgroundLocation(): Promise<PermStatus> {
  if (Platform.OS === "web") return { granted: false, canAskAgain: false };
  try {
    const s = await Location.getBackgroundPermissionsAsync();
    return { granted: s.granted, canAskAgain: s.canAskAgain ?? false };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

export async function checkAllPermissions(): Promise<AllPermissionsStatus> {
  const [notif, loc, bgLoc] = await Promise.all([
    getNotificationPermissionStatus().catch(() => ({
      granted: false,
      canAskAgain: false,
    })),
    Location.getForegroundPermissionsAsync().catch(() => ({
      granted: false,
      canAskAgain: false,
    })),
    checkBackgroundLocation(),
  ]);

  return {
    notifications: { granted: notif.granted, canAskAgain: notif.canAskAgain },
    location: { granted: loc.granted, canAskAgain: loc.canAskAgain ?? false },
    backgroundLocation: bgLoc,
  };
}

// ─── Permission requests ──────────────────────────────────────────────────────

export { requestNotificationPermissions };

export async function requestForegroundLocation(): Promise<PermStatus> {
  if (Platform.OS === "web") return { granted: false, canAskAgain: false };
  try {
    const r = await Location.requestForegroundPermissionsAsync();
    return { granted: r.granted, canAskAgain: r.canAskAgain ?? false };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

export async function requestBackgroundLocation(): Promise<PermStatus> {
  if (Platform.OS === "web") return { granted: false, canAskAgain: false };
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return { granted: false, canAskAgain: true };
    const r = await Location.requestBackgroundPermissionsAsync();
    return { granted: r.granted, canAskAgain: r.canAskAgain ?? false };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}
