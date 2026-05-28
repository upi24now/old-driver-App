/**
 * useNotifications
 *
 * Root-level hook — mount once in _layout.tsx.
 * Handles:
 *   - Initialization (channels + permission) on app start
 *   - Foreground notification listener (logs receipt)
 *   - Response listener (handles notification tap → navigate)
 *   - Cold-start: handles notification that opened the app from killed state
 */

import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import {
  clearBadge,
  handleNotificationResponse,
  initNotifications,
} from "@/utils/notifications";

export function useNotifications(): void {
  useEffect(() => {
    // Notifications are native-only; nothing to do on web.
    if (Platform.OS === "web") return;

    // Init: channels + permissions
    initNotifications().catch((err) =>
      console.error("[useNotifications] init error:", err)
    );

    // Clear stale badge on open
    clearBadge().catch(() => {});

    // Listener: notification received while app is foregrounded
    const foregroundSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log(
          "[Notifications] Received in foreground:",
          notification.request.identifier,
          notification.request.content.title
        );
        // The in-app modal/ride-request screen already handles this visually;
        // no extra action needed here.
      }
    );

    // Listener: user tapped a notification (foreground OR background)
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationResponse(response);
      }
    );

    // Cold-start: was the app launched by tapping a notification?
    Notifications.getLastNotificationResponseAsync()
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
