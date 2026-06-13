import { firebaseAuth } from "@/utils/firebase";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

async function getIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export type RequestPayoutResult =
  | { ok: true;  requestId: string }
  | { ok: false; error: string };

/**
 * POST /api/payouts/request
 *
 * Routes a driver withdrawal through the backend so it:
 *   - validates balance server-side (atomic Firestore transaction)
 *   - writes to withdrawalRequests/{autoId}  (admin sees it immediately)
 *   - writes to transactions/{autoId}        (type "payout", ledger entry)
 *   - debits   wallets/{driverUid}.balance / .totalPaid
 *
 * driverUid is taken from the Firebase ID token by the server —
 * never passed in the request body.
 */
export async function requestPayout(
  amount: number,
  upiId:  string,
): Promise<RequestPayoutResult> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "not_authenticated" };

  try {
    const res  = await fetch(`${BASE_URL}/payouts/request`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({ amount, upiId }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; requestId?: string };
    if (!json.ok) {
      return { ok: false, error: json.error ?? "withdrawal_failed" };
    }
    return { ok: true, requestId: json.requestId ?? "" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
