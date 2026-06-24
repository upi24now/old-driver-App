/**
 * useNotifications
 *
 * Root-level hook — mount once in _layout.tsx.
 * Handles:
 *   - Initialization (channels + permissions) on app start
 *   - Foreground notification listener (logs receipt)
 *   - Response listener (handles notification tap / action button → navigate)
 *   - Cold-start: handles notification that opened the app from killed state
 *
 * EXPO GO: expo-notifications is unavailable in Expo Go on Android (SDK 53+).
 * We safe-require it here; the hook is a no-op when the module isn't present.
 */

import type * as NotificationsType from "expo-notifications";
import { useEffect, useRef } from "react";
import { Alert, Linking, Platform } from "react-native";

import {
  clearBadge,
  handleNotificationResponse,
  initNotifications,
} from "@/utils/notifications";

// Safe runtime import — same pattern as utils/notifications.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notif: typeof NotificationsType | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as typeof NotificationsType;
  } catch {
    return null;
  }
})();

export function useNotifications(): void {
  // Prevents showing the permission-denied Alert more than once per app session.
  const permissionAlertShown = useRef(false);

  useEffect(() => {
    // Nothing to do on web or when the module is unavailable (Expo Go Android).
    if (Platform.OS === "web" || !Notif) return;

    // Init: channels + permissions + action categories
    initNotifications()
      .then(({ permissionGranted }) => {
        if (!permissionGranted && !permissionAlertShown.current) {
          permissionAlertShown.current = true;
          Alert.alert(
            "Enable Notifications",
            "Order alerts are disabled. Please enable notifications to receive delivery requests.",
            [
              {
                text: "Open Settings",
                onPress: () => Linking.openSettings().catch(() => {}),
              },
              { text: "Later", style: "cancel" },
            ],
            { cancelable: true }
          );
        }
      })
      .catch((err) =>
        console.error("[useNotifications] init error:", err)
      );

    // Clear stale badge on open
    clearBadge().catch(() => {});

    // Listener: notification received while app is foregrounded
    const foregroundSub = Notif.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data as Record<string, unknown> | null;
        console.log(
          "[FCM] notification received foreground type:", data?.type ?? "unknown",
          "id:", notification.request.identifier,
        );
        // The in-app ride-request screen already handles incoming orders visually;
        // no extra action needed here.
      }
    );

    // Listener: user tapped a notification OR tapped an action button
    const responseSub = Notif.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationResponse(response);
      }
    );

    // Cold-start: was the app launched by tapping a notification?
    //
    // STALENESS GUARD: offer windows are ≤ 60 s, so any FCM notification older
    // than 2 minutes cannot correspond to a live order offer.  Without this
    // guard, Android caches the last notification tap indefinitely — every
    // subsequent app launch (including after a fresh login) would replay the
    // same stale notification and navigate to the ride-request screen for an
    // order that no longer exists.
    Notif.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;

        const ageMs = Date.now() - response.notification.date * 1000;
        if (ageMs > 2 * 60 * 1000) {
          console.log(
            "[FCM] ignoring stale cold-start notification age:",
            Math.round(ageMs / 1000), "s orderId:",
            (response.notification.request.content.data as Record<string, unknown> | null)?.orderId ?? "(none)",
          );
          return;
        }

        const data = response.notification.request.content.data as Record<string, unknown> | null;
        const orderId = (data?.orderId as string | undefined) ?? "(none)";
        console.log(
          "[FCM] notification tap orderId:", orderId,
          "id:", response.notification.request.identifier,
        );
        handleNotificationResponse(response);
      })
      .catch((err) =>
        console.error(
          "[FCM] action failed (getLastNotificationResponseAsync):", err,
        )
      );

    return () => {
      foregroundSub.remove();
      responseSub.remove();
    };
  }, []);
}
