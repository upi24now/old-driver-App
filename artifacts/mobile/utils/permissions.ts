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
import { Linking, Platform } from "react-native";

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
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS" as IntentLauncher.ActivityAction,
      );
    } catch {
      await openAppDetails();
    }
  }
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
