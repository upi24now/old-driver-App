import { firebaseAuth } from "@/utils/firebase";

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
