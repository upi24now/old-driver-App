/**
 * PG-backed SSE realtime listeners (Phase 5J-Tier-6).
 *
 * Drop-in replacements for the two Firestore onSnapshot listeners that the
 * Driver App relied on:
 *   • listenToAllDispatchedOrders — was firestore.ts L1 (offer set)
 *   • listenToActiveOrder         — was firestore.ts L2 (single order status)
 *
 * Both expose the EXACT same signatures and callback contracts as the Firestore
 * versions, so DriverContext only needs to swap the import path. Under the hood
 * they consume the api-server SSE streams:
 *   GET /api/drivers/me/offer-stream
 *   GET /api/orders/:orderId/stream
 *
 * Connection management:
 *   • A fresh Firebase ID token is fetched before every (re)connect — long-lived
 *     SSE connections must not pin a token that expires after ~1h.
 *   • Auto-reconnect is handled manually (react-native-sse's own polling is
 *     disabled with pollingInterval: 0) so each retry gets a fresh token and
 *     resumes from the last seen event id via the Last-Event-ID header.
 *   • The server always re-emits current state on connect, so every reconnect is
 *     self-healing — the callback always converges on true current state.
 */

import EventSource from "react-native-sse";
import { firebaseAuth } from "@/utils/firebase";
import type { OrderDoc, OrderStatus } from "@/utils/firestore";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

async function freshIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Generic SSE subscription with token refresh, exponential-backoff reconnect,
 * and Last-Event-ID resume. `onData` receives each parsed message payload.
 * Returns an unsubscribe function.
 */
function subscribe<T>(
  path: string,
  parse: (raw: string) => T,
  onData: (value: T) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let lastId: string | null = null;
  let backoff = RECONNECT_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  };

  const connect = async () => {
    if (closed) return;

    const token = await freshIdToken();
    if (!token) {
      // Not authenticated yet — retry shortly without escalating backoff hard.
      scheduleReconnect();
      return;
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (lastId) headers["Last-Event-ID"] = lastId;

    es = new EventSource(`${BASE_URL}${path}`, {
      headers,
      pollingInterval: 0, // disable built-in reconnect; we manage it manually
    });

    es.addEventListener("open", () => {
      backoff = RECONNECT_MIN_MS; // healthy connection resets backoff
    });

    es.addEventListener("message", (event) => {
      if (event.lastEventId) lastId = event.lastEventId;
      if (!event.data) return;
      try {
        onData(parse(event.data));
      } catch {
        // Ignore malformed frames; the next event re-syncs state.
      }
    });

    es.addEventListener("error", () => {
      es?.removeAllEventListeners();
      es?.close();
      es = null;
      scheduleReconnect();
    });
  };

  void connect();

  return () => {
    closed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    es?.removeAllEventListeners();
    es?.close();
    es = null;
  };
}

/**
 * Listen for ALL orders currently offered to this driver (replaces L1).
 * Calls back with the full OrderDoc array on every change. Returns unsubscribe.
 */
export function listenToAllDispatchedOrders(
  uid:      string,
  onOrders: (orders: OrderDoc[]) => void,
): () => void {
  // uid is implied by the authenticated token server-side; kept in the signature
  // for drop-in parity with the Firestore version.
  void uid;
  return subscribe<OrderDoc[]>(
    "/drivers/me/offer-stream",
    (raw) => JSON.parse(raw) as OrderDoc[],
    onOrders,
  );
}

/**
 * Subscribe to a single order's status (replaces L2).
 * Calls back with the live status string, or null if the order no longer exists
 * or is not assigned to this driver. Returns unsubscribe.
 */
export function listenToActiveOrder(
  orderId:  string,
  onChange: (status: OrderStatus | null) => void,
): () => void {
  return subscribe<{ status: OrderStatus | null }>(
    `/orders/${orderId}/stream`,
    (raw) => JSON.parse(raw) as { status: OrderStatus | null },
    (msg) => onChange(msg.status),
  );
}
