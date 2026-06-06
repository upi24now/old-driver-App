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
 *   incoming_orders_v2 — MAX importance, sound + vibration, bypass DnD (v2: forced fresh channel)
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
export const CHANNEL_ORDERS  = "incoming_orders_v2";
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

      if (isOrder) {
        // setNotificationHandler only fires when the app is foregrounded.
        // For incoming orders the ride-request screen is already opening with
        // its own looping ringtone + repeating vibration — suppress the system
        // notification sound/banner to prevent a double-alert.  The entry still
        // lands in the notification drawer (shouldShowList: true) and the badge
        // increments so the driver can access it later if needed.
        return {
          shouldShowBanner: false,
          shouldShowList:   true,
          shouldPlaySound:  false,
          shouldSetBadge:   true,
          priority: Notif!.AndroidNotificationPriority.MAX,
        };
      }

      return {
        shouldShowBanner: true,
        shouldShowList:   true,
        shouldPlaySound:  true,
        shouldSetBadge:   false,
        priority: Notif!.AndroidNotificationPriority.HIGH,
      };
    },
  });
}

// ─── Deduplication tracker ────────────────────────────────────────────────────
let activeOrderNotifId: string | null = null;

// ─── Notification category setup (action buttons) ────────────────────────────
// Creates Accept / Reject buttons that appear directly on the lock-screen
// heads-up notification for LOCAL notifications.
// Called eagerly at module load AND from initNotifications() — idempotent.
//
// NOTE ON REMOTE FCM NOTIFICATIONS:
// setNotificationCategoryAsync only affects LOCAL notifications posted by
// Expo's JS layer (via scheduleNotificationAsync).  Remote FCM notifications
// displayed by the Android system carry no Expo category — action buttons only
// appear on them AFTER the background task (below) re-posts them as local.
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
    name: "Urgent Order Alerts",
    description: "High-priority alerts for new delivery requests",
    importance: Notif.AndroidImportance.MAX,
    sound: "ringtone",
    vibrationPattern: [0, 1200, 200, 1200, 200, 1200, 500],
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

/**
 * Check whether notification permission is currently granted without prompting.
 * Returns false when expo-notifications is unavailable (Expo Go on Android).
 */
export async function checkNotificationPermissions(): Promise<boolean> {
  if (!Notif) return false;
  const status = (await Notif.getPermissionsAsync()) as unknown as PermStatus;
  return status.granted;
}

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
          type:        "incoming_order",
          orderId:     params.orderId,
          customer:    params.customer,
          pickup:      params.pickup,
          drop:        params.drop,
          earning:     String(params.earning),
          distanceKm:  String(params.distanceKm),
          screen:      "/ride-request",
        },
        sound: "ringtone.wav",
        badge:    1,
        priority: "max",
        categoryIdentifier: CATEGORY_ORDERS,
        ...(Platform.OS === "android" && {
          channelId:   CHANNEL_ORDERS,
          color:       "#FF4D8D",
          vibrate:     [0, 1200, 200, 1200, 200, 1200, 500],
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
    // Delegate entirely to the DriverContext handler, which runs the Firestore
    // accept transaction and then navigates to /active-delivery with full
    // route params.  No secondary navigation here — a second router call after
    // onAccept() would land the driver on a different screen with no params.
    console.log("[Notifications] → Accept action");
    orderHandlers?.onAccept();

  } else if (actionIdentifier === ACTION_REJECT) {
    // ── Reject action button ───────────────────────────────────────────────
    // The app may stay backgrounded — no navigation needed.
    console.log("[Notifications] → Reject action");
    orderHandlers?.onReject();

  } else {
    // ── Plain notification tap ─────────────────────────────────────────────
    // Navigate to ride-request, passing orderId + order fields so the screen
    // can fetch the order directly if incomingRide is not yet set (background
    // or killed-app scenario — Firestore listener may not have fired yet).
    const orderId    = (data?.orderId    as string | undefined) ?? "";
    const customer   = (data?.customer   as string | undefined) ?? "";
    const pickup     = (data?.pickup     as string | undefined) ?? "";
    const pickupCity = (data?.pickupCity as string | undefined) ?? "";
    const drop       = (data?.drop       as string | undefined) ?? "";
    const dropCity   = (data?.dropCity   as string | undefined) ?? "";
    const earning    = (data?.earning    as string | undefined) ?? "";
    const distanceKm = (data?.distanceKm as string | undefined) ?? "";
    const durationMin = (data?.durationMin as string | undefined) ?? "";

    console.log("[Notifications] → Default tap, orderId:", orderId || "(none)");
    setTimeout(() => {
      try {
        if (orderId) {
          router.push({
            pathname: "/ride-request",
            params: {
              orderId, customer, pickup, pickupCity,
              drop, dropCity, earning, distanceKm, durationMin,
            },
          });
        } else {
          router.push(screen ? (screen as Parameters<typeof router.push>[0]) : "/ride-request");
        }
      } catch (err) {
        console.error("[Notifications] Navigate (tap) failed:", err);
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

// ─── FCM device push token registration ──────────────────────────────────────
/**
 * Collect the device's raw FCM push token and persist it to
 * drivers/{uid}.fcmToken in Firestore.
 *
 * Must be called after notification permission has been granted and after
 * google-services.json is baked into the build (EAS build / dev APK).
 * Fails safely in Expo Go (module unavailable) and when google-services.json
 * is absent — logs the error but never throws.
 *
 * The token is intentionally NOT logged in full to avoid accidental exposure
 * in production log aggregators.
 */
export async function registerDriverPushToken(uid: string): Promise<void> {
  if (!Notif || Platform.OS !== "android") return;

  try {
    // Ensure permission is granted before attempting token fetch.
    const { granted } = (await Notif.getPermissionsAsync()) as unknown as {
      granted: boolean;
    };
    if (!granted) {
      console.warn(
        "[Notifications] Push token skipped — notification permission not granted"
      );
      return;
    }

    // getDevicePushTokenAsync returns the raw FCM registration token on Android.
    // Throws if google-services.json is absent or native FCM config is missing.
    const tokenData = await Notif.getDevicePushTokenAsync();
    if (!tokenData?.data) {
      console.warn("[Notifications] Push token empty — skipping Firestore write");
      return;
    }

    const { updateDriverPushToken } = await import("./firestore");
    await updateDriverPushToken(uid, tokenData.data as string);

    // Log only the token prefix so the entry is useful for debugging without
    // exposing the full 152-character FCM token in plaintext logs.
    const preview = (tokenData.data as string).slice(0, 8) + "…";
    console.log(`[Notifications] FCM push token registered (${preview})`);
  } catch (err) {
    // Common causes: google-services.json not baked into the build (Expo Go),
    // no network, or Play Services unavailable on the device.
    console.warn("[Notifications] Failed to register FCM push token:", err);
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
