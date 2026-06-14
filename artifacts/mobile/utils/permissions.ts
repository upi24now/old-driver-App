/**
 * Centralised permission utilities — Bike Courier driver app.
 *
 * Covers four mandatory driver permissions:
 *   1. Notifications          (expo-notifications — via notifications.ts)
 *   2. Location foreground    (expo-location)
 *   3. Background Location    (expo-location — Android needs foreground first)
 *   4. Phone Call             (PermissionsAndroid — Android only, CALL_PHONE)
 *
 * Battery optimisation status cannot be read from JS without a native module.
 * The dashboard health card exposes openBatterySettings() so the driver can
 * manually exempt the app; we track whether the settings page was opened and
 * show an optimistic ✅ after the driver returns from it.
 */

import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { Linking, PermissionsAndroid, Platform } from "react-native";

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
  phoneCall: PermStatus;
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

export async function checkPhonePermission(): Promise<PermStatus> {
  if (Platform.OS !== "android") return { granted: true, canAskAgain: false };
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    );
    return { granted, canAskAgain: !granted };
  } catch {
    return { granted: false, canAskAgain: true };
  }
}

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
  const [notif, loc, bgLoc, phone] = await Promise.all([
    getNotificationPermissionStatus().catch(() => ({
      granted: false,
      canAskAgain: false,
    })),
    Location.getForegroundPermissionsAsync().catch(() => ({
      granted: false,
      canAskAgain: false,
    })),
    checkBackgroundLocation(),
    checkPhonePermission(),
  ]);

  return {
    notifications: { granted: notif.granted, canAskAgain: notif.canAskAgain },
    location: { granted: loc.granted, canAskAgain: loc.canAskAgain ?? false },
    backgroundLocation: bgLoc,
    phoneCall: phone,
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

export async function requestPhonePermission(): Promise<PermStatus> {
  if (Platform.OS !== "android") return { granted: true, canAskAgain: false };

  console.log("[PHONE_PERMISSION_START] requesting CALL_PHONE via PermissionsAndroid");

  // ── Timeout guard ─────────────────────────────────────────────────────────
  // PermissionsAndroid.request(CALL_PHONE) hangs indefinitely when:
  //   (a) CALL_PHONE is absent from the AndroidManifest (Expo Go, or a build
  //       that hasn't been re-built after adding the permission to app.json).
  //   (b) The OS silently drops the dialog for any other reason.
  // A 10 s timeout ensures the spinner always clears so the driver can still
  //  tap "Open Settings" to grant the permission manually.
  const TIMEOUT_MS = 10_000;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<PermStatus>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.log(
        "[PHONE_PERMISSION_ERROR] PermissionsAndroid.request timed out after",
        TIMEOUT_MS,
        "ms — CALL_PHONE may be missing from AndroidManifest (Expo Go) or dialog was silently dropped",
      );
      resolve({ granted: false, canAskAgain: false });
    }, TIMEOUT_MS);
  });

  const requestPromise = (async (): Promise<PermStatus> => {
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
        {
          title: "Phone Call Permission",
          message:
            "Bike Courier uses this permission to connect you directly with customers.",
          buttonPositive: "Allow",
          buttonNegative: "Deny",
        },
      );
      const granted     = result === PermissionsAndroid.RESULTS.GRANTED;
      const canAskAgain = result === PermissionsAndroid.RESULTS.DENIED;
      console.log("[PHONE_PERMISSION_RESULT] result =", result, "| granted =", granted, "| canAskAgain =", canAskAgain);
      return { granted, canAskAgain };
    } catch (err) {
      console.log("[PHONE_PERMISSION_ERROR] PermissionsAndroid.request threw:", err instanceof Error ? err.message : String(err));
      return { granted: false, canAskAgain: true };
    }
  })();

  const status = await Promise.race([requestPromise, timeoutPromise]);

  // Cancel the timeout if the real request won the race.
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);

  return status;
}
