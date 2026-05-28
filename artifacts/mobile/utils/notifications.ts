/**
 * Notification Service
 *
 * Handles all push / local notification logic for the Bike Courier driver app.
 *
 * EXPO GO COMPATIBILITY NOTE
 * ──────────────────────────
 * expo-notifications removed Android push support from Expo Go in SDK 53.
 * The module now throws on import when running inside Expo Go on Android.
 * We safe-require it at runtime so the rest of the app never crashes.
 * All exported functions silently no-op when the module isn't available.
 * In a development build or production APK everything works normally.
 *
 * Channels (Android):
 *   incoming_orders  — MAX importance, sound + vibration, bypass DnD
 *   order_updates    — HIGH importance, sound + vibration
 *   driver_alerts    — DEFAULT importance
 */

import * as Device from "expo-device";
import type * as NotificationsType from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

// ─── Safe runtime import ──────────────────────────────────────────────────────
// expo-notifications throws on import inside Expo Go on Android SDK 53+.
// We catch the error here so the app loads normally; all callers check `Notif`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notif: typeof NotificationsType | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as typeof NotificationsType;
  } catch {
    console.warn(
      "[Notifications] expo-notifications unavailable (Expo Go on Android). " +
        "System notifications disabled — in-app alerts work as fallback."
    );
    return null;
  }
})();

// ─── Channel IDs ──────────────────────────────────────────────────────────────
export const CHANNEL_ORDERS  = "incoming_orders";
export const CHANNEL_UPDATES = "order_updates";
export const CHANNEL_ALERTS  = "driver_alerts";

// ─── Notification action identifiers ─────────────────────────────────────────
// These appear as buttons on the lock-screen / heads-up notification.
export const ACTION_ACCEPT   = "accept_order";
export const ACTION_REJECT   = "reject_order";
export const CATEGORY_ORDERS = "incoming_order_actions";

// ─── Order action handler registry ───────────────────────────────────────────
// DriverContext registers these so notification button taps can call
// acceptRide() / rejectRide() even when the app is in the background.
type OrderActionHandlers = {
  onAccept: () => void;
  onReject: () => void;
};
let orderHandlers: OrderActionHandlers | null = null;

export function registerOrderActionHandlers(
  handlers: OrderActionHandlers
): void {
  orderHandlers = handlers;
}

// ─── Foreground presentation ──────────────────────────────────────────────────
// Set notification handler at module init time (safe-guarded).
if (Notif) {
  Notif.setNotificationHandler({
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
          ? Notif!.AndroidNotificationPriority.MAX
          : Notif!.AndroidNotificationPriority.HIGH,
      };
    },
  });
}

// ─── Deduplication tracker ────────────────────────────────────────────────────
let activeOrderNotifId: string | null = null;

// ─── Notification category setup (action buttons) ────────────────────────────
// Creates Accept / Reject buttons that appear directly on the lock-screen
// heads-up notification. Works on Android; iOS shows them as swipe actions.
export async function setupNotificationCategories(): Promise<void> {
  if (!Notif) return;
  try {
    await Notif.setNotificationCategoryAsync(CATEGORY_ORDERS, [
      {
        identifier: ACTION_ACCEPT,
        buttonTitle: "✅  Accept",
        options: { opensAppToForeground: true, isDestructive: false },
      },
      {
        identifier: ACTION_REJECT,
        buttonTitle: "❌  Reject",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
    console.log("[Notifications] Category registered:", CATEGORY_ORDERS);
  } catch (err) {
    console.warn("[Notifications] setupNotificationCategories error:", err);
  }
}

// ─── Android channel setup ────────────────────────────────────────────────────
export async function setupAndroidChannels(): Promise<void> {
  if (!Notif || Platform.OS !== "android") return;

  await Notif.setNotificationChannelAsync(CHANNEL_ORDERS, {
    name: "Incoming Orders",
    description: "High-priority alerts for new delivery requests",
    importance: Notif.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    enableLights: true,
    lightColor: "#FF4D8D",
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notif.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });

  await Notif.setNotificationChannelAsync(CHANNEL_UPDATES, {
    name: "Order Updates",
    description: "Delivery status changes and confirmations",
    importance: Notif.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 200, 100, 200],
    enableVibrate: true,
    showBadge: false,
  });

  await Notif.setNotificationChannelAsync(CHANNEL_ALERTS, {
    name: "Driver Alerts",
    description: "Subscription, earnings, and account alerts",
    importance: Notif.AndroidImportance.DEFAULT,
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
  if (!Notif) return false;

  if (!Device.isDevice) {
    console.log(
      "[Notifications] Simulator detected — local notifications only"
    );
  }

  const existing = (await Notif.getPermissionsAsync()) as unknown as PermStatus;
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

  const result = (await Notif.requestPermissionsAsync({
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
  if (!Notif) return;

  // Cancel previous order notification first (prevent stacking)
  await cancelIncomingOrderNotification();

  try {
    const id = await Notif.scheduleNotificationAsync({
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
        categoryIdentifier: CATEGORY_ORDERS,
        ...(Platform.OS === "android" && {
          channelId:   CHANNEL_ORDERS,
          color:       "#FF4D8D",
          vibrate:     [0, 400, 200, 400, 200, 400],
          sticky:      false,
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
  if (!Notif || !activeOrderNotifId) return;
  try {
    await Notif.dismissNotificationAsync(activeOrderNotifId);
  } catch {
    // Already dismissed — harmless
  }
  try {
    await Notif.cancelScheduledNotificationAsync(activeOrderNotifId);
  } catch {
    // Already fired — harmless
  }
  activeOrderNotifId = null;
}

// ─── Order update notification ────────────────────────────────────────────────
export async function sendOrderUpdateNotification(params: {
  title:  string;
  body:   string;
  data?:  Record<string, unknown>;
}): Promise<void> {
  if (!Notif) return;
  try {
    await Notif.scheduleNotificationAsync({
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
  if (!Notif) return;
  try {
    await Notif.scheduleNotificationAsync({
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

// ─── Notification tap / action handler ───────────────────────────────────────
// Called for both plain taps and action button taps (Accept / Reject).
// The parameter type is inlined so callers don't import from expo-notifications.
export function handleNotificationResponse(
  response: NotificationsType.NotificationResponse
): void {
  const { actionIdentifier, notification } = response;
  const data = notification.request.content.data as
    | Record<string, unknown>
    | null
    | undefined;

  const type   = data?.type   as string | undefined;
  const screen = data?.screen as string | undefined;

  console.log("[Notifications] Response:", actionIdentifier, "type:", type);

  if (type !== "incoming_order") return;

  if (actionIdentifier === ACTION_ACCEPT) {
    // ── Accept action button ───────────────────────────────────────────────
    // Call DriverContext handler (accepts the ride in state), then navigate
    // directly to the active trip screen — skip the slider UI.
    console.log("[Notifications] → Accept action");
    orderHandlers?.onAccept();
    setTimeout(() => {
      try {
        router.replace("/trip/active" as Parameters<typeof router.replace>[0]);
      } catch (err) {
        console.error("[Notifications] Navigate (accept) failed:", err);
      }
    }, 600);

  } else if (actionIdentifier === ACTION_REJECT) {
    // ── Reject action button ───────────────────────────────────────────────
    // The app may stay backgrounded — no navigation needed.
    console.log("[Notifications] → Reject action");
    orderHandlers?.onReject();

  } else {
    // ── Plain notification tap ─────────────────────────────────────────────
    // Opens the in-app slider order UI so the driver can review & swipe.
    const dest = screen ?? "/ride-request";
    console.log("[Notifications] → Default tap →", dest);
    setTimeout(() => {
      try {
        router.push(dest as Parameters<typeof router.push>[0]);
      } catch (err) {
        console.error("[Notifications] Navigate (tap) failed:", dest, err);
      }
    }, 600);
  }
}

// ─── Clear badge ──────────────────────────────────────────────────────────────
export async function clearBadge(): Promise<void> {
  if (!Notif) return;
  try {
    await Notif.setBadgeCountAsync(0);
  } catch {
    // Ignore
  }
}

// ─── Full initialization ──────────────────────────────────────────────────────
export async function initNotifications(): Promise<{
  permissionGranted: boolean;
}> {
  if (!Notif) {
    console.warn(
      "[Notifications] Skipping init — expo-notifications unavailable. " +
        "Use a development build for full notification support."
    );
    return { permissionGranted: false };
  }

  try {
    await setupAndroidChannels();
    await setupNotificationCategories(); // Register Accept / Reject action buttons
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
