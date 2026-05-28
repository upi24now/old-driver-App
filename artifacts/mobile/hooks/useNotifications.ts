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
import { useEffect } from "react";
import { Platform } from "react-native";

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
  useEffect(() => {
    // Nothing to do on web or when the module is unavailable (Expo Go Android).
    if (Platform.OS === "web" || !Notif) return;

    // Init: channels + permissions + action categories
    initNotifications().catch((err) =>
      console.error("[useNotifications] init error:", err)
    );

    // Clear stale badge on open
    clearBadge().catch(() => {});

    // Listener: notification received while app is foregrounded
    const foregroundSub = Notif.addNotificationReceivedListener(
      (notification) => {
        console.log(
          "[Notifications] Received in foreground:",
          notification.request.identifier,
          notification.request.content.title
        );
        // The in-app ride-request screen already handles this visually;
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
    Notif.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          console.log(
            "[Notifications] App launched from notification:",
            response.notification.request.identifier
          );
          handleNotificationResponse(response);
        }
      })
      .catch((err) =>
        console.error(
          "[Notifications] getLastNotificationResponseAsync error:",
          err
        )
      );

    return () => {
      foregroundSub.remove();
      responseSub.remove();
    };
  }, []);
}
