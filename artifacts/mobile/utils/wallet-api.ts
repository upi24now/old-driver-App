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
 * Wallet summary as returned by GET /api/wallet/:uid.
 *
 * Field names mirror the legacy Firestore WalletDoc so call sites can swap the
 * data source without reshaping. lastUpdatedAt is intentionally omitted — the
 * mobile app never consumed it.
 */
export interface WalletSummary {
  balance:             number;
  totalEarnings:       number;
  totalPaid:           number;
  completedDeliveries: number;
}

/**
 * GET /api/wallet/:uid  (PostgreSQL primary, Firestore fallback server-side).
 *
 * Replaces the direct Firestore wallets/{uid} read (getWalletDoc). Returns null
 * on missing wallet or any network/auth error so callers stay fire-and-forget
 * safe and keep their existing optimistic values.
 */
export async function getWallet(uid: string): Promise<WalletSummary | null> {
  const idToken = await getIdToken();
  if (!idToken) return null;
  try {
    const res = await fetch(`${BASE_URL}/wallet/${uid}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; wallet?: Partial<WalletSummary> };
    if (!json.ok || !json.wallet) return null;
    const w = json.wallet;
    return {
      balance:             w.balance             ?? 0,
      totalEarnings:       w.totalEarnings       ?? 0,
      totalPaid:           w.totalPaid           ?? 0,
      completedDeliveries: w.completedDeliveries ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Shape of a single wallet transaction returned by
 * GET /api/wallet/:uid/transactions.
 *
 * createdAt is always an ISO 8601 string (the server normalises Dates with
 * .toISOString() before responding).  paymentMode is not included in the PG
 * path; callers should fall back to "UPI" when it is absent.
 */
export interface WalletTransaction {
  id:          string;
  driverUid:   string;
  orderId:     string | null;
  type:        string;
  amount:      number;
  status:      string | null;
  description: string | null;
  createdAt:   string | null;
}

/**
 * GET /api/wallet/:uid/transactions
 *
 * PG-primary, Firestore-fallback on the server side — the mobile app no longer
 * reads the Firestore "transactions" collection directly.
 *
 * Returns an empty array on any network/auth error so callers are
 * fire-and-forget safe.
 */
export async function getWalletTransactions(uid: string): Promise<WalletTransaction[]> {
  const idToken = await getIdToken();
  if (!idToken) return [];
  try {
    const res = await fetch(`${BASE_URL}/wallet/${uid}/transactions`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; transactions?: WalletTransaction[] };
    return json.ok && Array.isArray(json.transactions) ? json.transactions : [];
  } catch {
    return [];
  }
}

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
