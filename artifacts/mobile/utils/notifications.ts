/**
 * Notification Service
 *
 * Handles all push / local notification logic for the Bike Courier driver app.
 * Works in Expo Go (local notifications only — no FCM/APNs push token needed).
 *
 * Channels (Android):
 *   incoming_orders  — MAX importance, sound + vibration, bypass DnD
 *   order_updates    — HIGH importance, sound + vibration
 *   driver_alerts    — DEFAULT importance
 */

import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

// ─── Channel IDs ──────────────────────────────────────────────────────────────
export const CHANNEL_ORDERS  = "incoming_orders";
export const CHANNEL_UPDATES = "order_updates";
export const CHANNEL_ALERTS  = "driver_alerts";

// ─── Foreground presentation ──────────────────────────────────────────────────
// Must be called at module-level (before any component mounts).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const channelId =
      (notification.request.content as Record<string, unknown>).channelId ??
      (notification.request.trigger as Record<string, unknown> | null)?.channelId;
    const isOrder = channelId === CHANNEL_ORDERS;

    return {
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   isOrder,
      priority: isOrder
        ? Notifications.AndroidNotificationPriority.MAX
        : Notifications.AndroidNotificationPriority.HIGH,
    };
  },
});

// ─── Deduplication tracker ────────────────────────────────────────────────────
let activeOrderNotifId: string | null = null;

// ─── Android channel setup ────────────────────────────────────────────────────
export async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(CHANNEL_ORDERS, {
    name: "Incoming Orders",
    description: "High-priority alerts for new delivery requests",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    enableLights: true,
    lightColor: "#FF4D8D",
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility:
      Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });

  await Notifications.setNotificationChannelAsync(CHANNEL_UPDATES, {
    name: "Order Updates",
    description: "Delivery status changes and confirmations",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 200, 100, 200],
    enableVibrate: true,
    showBadge: false,
  });

  await Notifications.setNotificationChannelAsync(CHANNEL_ALERTS, {
    name: "Driver Alerts",
    description: "Subscription, earnings, and account alerts",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    showBadge: false,
  });
}

// ─── Permission request ───────────────────────────────────────────────────────
// expo-notifications' PermissionResponse inherits granted/canAskAgain from
// expo-modules-core's PermissionResponse, but the TS path resolution breaks
// inside this project. Cast via unknown to keep type-safety elsewhere.
type PermStatus = { granted: boolean; canAskAgain: boolean };

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    // Emulators/simulators cannot receive push tokens but local notifs work.
    console.log(
      "[Notifications] Simulator detected — local notifications only"
    );
  }

  const existing = (await Notifications.getPermissionsAsync()) as unknown as PermStatus;
  if (existing.granted) {
    console.log("[Notifications] Permission already granted");
    return true;
  }
  if (!existing.canAskAgain) {
    console.warn(
      "[Notifications] Permission was previously denied — " +
        "driver must enable manually in device settings"
    );
    return false;
  }

  const result = (await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  })) as unknown as PermStatus;

  if (!result.granted) {
    console.warn("[Notifications] Permission not granted");
    return false;
  }

  console.log("[Notifications] Permission granted");
  return true;
}

// ─── Incoming order notification ──────────────────────────────────────────────
export interface IncomingOrderNotifParams {
  orderId:     string;
  customer:    string;
  pickup:      string;
  drop:        string;
  earning:     number;
  distanceKm:  number;
}

export async function sendIncomingOrderNotification(
  params: IncomingOrderNotifParams
): Promise<void> {
  // Cancel previous order notification first (prevent stacking)
  await cancelIncomingOrderNotification();

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "🛵  New Delivery Request!",
        body: `${params.customer} • ₹${params.earning} • ${params.distanceKm} km`,
        subtitle: `${params.pickup} → ${params.drop}`,
        data: {
          type:    "incoming_order",
          orderId: params.orderId,
          screen:  "/ride-request",
        },
        sound: "default",
        badge:    1,
        priority: "max",
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_ORDERS,
          color:     "#FF4D8D",
          vibrate:   [0, 400, 200, 400, 200, 400],
          sticky:    false,
          autoDismiss: true,
        }),
      },
      trigger: null, // fire immediately
    });

    activeOrderNotifId = id;
    console.log("[Notifications] Incoming order notification sent:", id);
  } catch (err) {
    console.error(
      "[Notifications] Failed to send incoming order notification:",
      err
    );
  }
}

// ─── Cancel active order notification ────────────────────────────────────────
export async function cancelIncomingOrderNotification(): Promise<void> {
  if (!activeOrderNotifId) return;
  try {
    await Notifications.dismissNotificationAsync(activeOrderNotifId);
  } catch {
    // Already dismissed — harmless
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(activeOrderNotifId);
  } catch {
    // Already fired — harmless
  }
  activeOrderNotifId = null;
}

// ─── Order update notification ────────────────────────────────────────────────
export async function sendOrderUpdateNotification(params: {
  title:   string;
  body:    string;
  data?:   Record<string, unknown>;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title:  params.title,
        body:   params.body,
        data:   params.data ?? {},
        sound:  "default",
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_UPDATES,
          color:     "#00C853",
        }),
      },
      trigger: null,
    });
    console.log("[Notifications] Order update sent:", params.title);
  } catch (err) {
    console.error("[Notifications] Failed to send order update:", err);
  }
}

// ─── Driver alert notification ────────────────────────────────────────────────
export async function sendDriverAlertNotification(params: {
  title: string;
  body:  string;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body:  params.body,
        sound: "default",
        ...(Platform.OS === "android" && {
          channelId: CHANNEL_ALERTS,
        }),
      },
      trigger: null,
    });
    console.log("[Notifications] Driver alert sent:", params.title);
  } catch (err) {
    console.error("[Notifications] Failed to send driver alert:", err);
  }
}

// ─── Notification tap handler ─────────────────────────────────────────────────
export function handleNotificationResponse(
  response: Notifications.NotificationResponse
): void {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | null
    | undefined;

  const type   = data?.type   as string | undefined;
  const screen = data?.screen as string | undefined;

  console.log("[Notifications] Tapped:", type, "→", screen);

  if (type === "incoming_order" && screen) {
    // Small delay ensures the app is fully foregrounded before navigating
    setTimeout(() => {
      try {
        router.push(screen as Parameters<typeof router.push>[0]);
      } catch (err) {
        console.error("[Notifications] Navigate failed:", screen, err);
      }
    }, 600);
  }
}

// ─── Clear badge ──────────────────────────────────────────────────────────────
export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Ignore
  }
}

// ─── Full initialization ──────────────────────────────────────────────────────
export async function initNotifications(): Promise<{
  permissionGranted: boolean;
}> {
  try {
    await setupAndroidChannels();
    const permissionGranted = await requestNotificationPermissions();

    if (!permissionGranted) {
      console.warn(
        "[Notifications] Notifications disabled — " +
          "in-app alerts will still work as fallback"
      );
      return { permissionGranted: false };
    }

    console.log("[Notifications] Initialization complete");
    return { permissionGranted: true };
  } catch (err) {
    console.error("[Notifications] Initialization error:", err);
    return { permissionGranted: false };
  }
}
