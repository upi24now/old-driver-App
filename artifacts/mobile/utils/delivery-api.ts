import { firebaseAuth } from "@/utils/firebase";
import { type AcceptOrderResult, type DeliveryStage } from "@/utils/firestore";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

export type CompleteDeliveryResult =
  | { ok: true;  newBalance: number; todayEarnings: number; tripsToday: number; todayDate: string }
  | { ok: false; error: string };

/**
 * Call the server-side delivery completion endpoint.
 *
 * Server responsibilities:
 *   - reads OTP from Firestore (driver never sees it)
 *   - verifies otpEntered matches
 *   - atomically sets order status=delivered, credits driver wallet
 *
 * Client responsibilities:
 *   - send only the digits the driver typed
 *   - attach the Firebase ID token (driverUid comes from the token server-side)
 *   - do NOT send fareAmount or paymentMode
 */
export async function completeDelivery(
  orderId:    string,
  otpEntered: string,
): Promise<CompleteDeliveryResult> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return { ok: false, error: "not_authenticated" };

    const token = await user.getIdToken();

    const url = `${BASE_URL}/orders/${orderId}/complete`;
    console.log("[OTP] fetch →", url);

    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ otpEntered }),
    });

    console.log("[OTP] HTTP", res.status, res.statusText);

    const json = (await res.json()) as {
      ok?:            boolean;
      newBalance?:    number;
      todayEarnings?: number;
      tripsToday?:    number;
      todayDate?:     string;
      error?:         string;
    };

    console.log("[OTP] body:", JSON.stringify(json));

    if (json.ok === true) {
      return {
        ok:            true,
        newBalance:    json.newBalance    ?? 0,
        todayEarnings: json.todayEarnings ?? 0,
        tripsToday:    json.tripsToday    ?? 0,
        todayDate:     json.todayDate     ?? "",
      };
    }
    return { ok: false, error: json.error ?? "server_error" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * Map server-side (PG) accept rejection reasons to the Driver App's
 * AcceptOrderResult vocabulary so existing call sites need no behaviour change.
 */
function mapAcceptReason(reason: string | undefined): Extract<AcceptOrderResult, { ok: false }>["reason"] {
  switch (reason) {
    case "already_claimed": return "already_claimed";
    case "not_in_offer":    return "reassigned";
    case "expired":         return "reassigned";
    case "order_missing":   return "missing";
    default:                return "unknown";
  }
}

/**
 * Phase 5J-Tier-4: PG-authoritative driver accept via REST.
 *
 * Replaces the Firestore acceptOrder transaction.  driverUid is derived from the
 * verified ID token server-side; only display fields are sent in the body.  The
 * server atomically claims the order in PostgreSQL and projects the result to
 * Firestore (so FCM + the customer app keep working).
 *
 * Returns the same AcceptOrderResult shape as the old Firestore path, so callers
 * (DriverContext.acceptRide + notification accept handler) are unchanged.
 */
export async function acceptOrderViaApi(
  orderId:       string,
  driverName:    string | null,
  driverRating?: number | string,
  driverTrips?:  number,
): Promise<AcceptOrderResult> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return { ok: false, reason: "unknown" };

    const token = await user.getIdToken();

    const res = await fetch(`${BASE_URL}/orders/${orderId}/accept`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ driverName, driverRating, driverTrips }),
    });

    const json = (await res.json()) as { ok?: boolean; reason?: string };
    if (json.ok === true) return { ok: true };
    return { ok: false, reason: mapAcceptReason(json.reason) };
  } catch {
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Phase 5J-Tier-4: PG-authoritative delivery-stage advance via REST.
 *
 * Replaces the Firestore updateOrderStage write.  Fire-and-forget compatible —
 * resolves void and never throws, so callers keep using `.catch(console.error)`.
 * The server authoritatively advances the stage in PostgreSQL and mirrors it to
 * Firestore for the customer app's live tracking.
 */
export async function updateOrderStageViaApi(
  orderId: string,
  stage:   DeliveryStage,
): Promise<void> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();

    await fetch(`${BASE_URL}/orders/${orderId}/stage`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ stage }),
    });
  } catch {
    // Fire-and-forget: PG is authoritative; a missed mirror is reconciled by the
    // next stage advance or the completion call.
  }
}
