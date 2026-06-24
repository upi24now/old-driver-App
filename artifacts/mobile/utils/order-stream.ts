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

// The infra/proxy in front of the SSE endpoint terminates long-lived streams at
// ~300s as a CLEAN HTTP completion (readyState DONE, status 200). react-native-sse
// (with pollingInterval:0) dispatches NEITHER "error" NOR "close" on that path, so
// the stream silently dies and the app's error-only reconnect never fires.
//
// To survive that, a watchdog proactively recycles the connection a bit BEFORE the
// proxy's cap so we never reach the silent clean-close. It also recycles a
// connection that never reaches "open" (a stalled connect). NOTE: the server
// heartbeat is a comment frame (": ping"), which react-native-sse ignores — it
// produces no "message" event — so liveness cannot be tracked from heartbeats;
// connection age is the reliable signal instead.
const CONNECTION_MAX_MS = 270_000; // recycle before the ~300s infra cap
const OPEN_TIMEOUT_MS   = 30_000;  // recycle if "open" never arrives after connect
const WATCHDOG_TICK_MS  = 15_000;  // how often the watchdog checks

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
 * Last-Event-ID resume, and an age/stall watchdog that recovers from the infra
 * proxy's silent ~300s clean-close. `onData` receives each parsed message
 * payload. Returns an unsubscribe function.
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
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let connectedAt = 0;      // when the current EventSource was constructed
  let openedAt = 0;         // when "open" fired for the current connection (0 = not yet)
  let lastMessageAt = 0;    // last "message" frame timestamp (diagnostic)
  let generation = 0;       // bumped on every (re)connect/teardown; guards stale async connects

  const teardownEs = (reason: string) => {
    generation += 1; // invalidate any in-flight connect() for the old connection
    if (!es) return;
    console.log("OFFER_STREAM_CLOSED", { path, reason });
    es.removeAllEventListeners();
    es.close();
    es = null;
    openedAt = 0;
  };

  const scheduleReconnect = (reason: string) => {
    if (closed || retryTimer) return;
    console.log("OFFER_STREAM_RETRY", { path, reason, inMs: backoff });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  };

  const startWatchdog = () => {
    if (watchdog) return;
    watchdog = setInterval(() => {
      if (closed || !es) return;
      const now = Date.now();
      // Stalled connect: constructed but never reached "open".
      if (openedAt === 0 && now - connectedAt >= OPEN_TIMEOUT_MS) {
        console.log("OFFER_STREAM_WATCHDOG_RECONNECT", { path, reason: "open-timeout" });
        teardownEs("open-timeout");
        scheduleReconnect("open-timeout");
        return;
      }
      // Proactively recycle before the proxy's silent ~300s clean-close.
      if (now - connectedAt >= CONNECTION_MAX_MS) {
        console.log("OFFER_STREAM_WATCHDOG_RECONNECT", {
          path,
          reason: "max-age",
          ageMs: now - connectedAt,
          lastMessageAgoMs: lastMessageAt ? now - lastMessageAt : null,
        });
        teardownEs("max-age");
        scheduleReconnect("max-age");
      }
    }, WATCHDOG_TICK_MS);
  };

  const stopWatchdog = () => {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  };

  const connect = async () => {
    if (closed) return;

    // Capture the generation BEFORE awaiting so we can detect an unsubscribe or
    // recycle that happened while the token was being fetched — otherwise the
    // resolved promise would construct an orphan EventSource (zombie connection).
    const myGeneration = generation;

    const token = await freshIdToken();
    if (closed || generation !== myGeneration) return;
    if (!token) {
      // Not authenticated yet — retry shortly without escalating backoff hard.
      console.log("OFFER_STREAM_TOKEN_NULL", { path });
      scheduleReconnect("token-null");
      return;
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (lastId) headers["Last-Event-ID"] = lastId;

    connectedAt = Date.now();
    openedAt = 0;

    es = new EventSource(`${BASE_URL}${path}`, {
      headers,
      pollingInterval: 0, // disable built-in reconnect; we manage it manually (fresh token per retry)
    });
    console.log("OFFER_STREAM_EVENTSOURCE_CREATED", { path });

    es.addEventListener("open", () => {
      openedAt = Date.now();
      backoff = RECONNECT_MIN_MS; // healthy connection resets backoff
      console.log("OFFER_STREAM_OPEN", { path });
    });

    es.addEventListener("message", (event) => {
      lastMessageAt = Date.now();
      if (event.lastEventId) lastId = event.lastEventId;
      if (!event.data) return;
      console.log("OFFER_STREAM_MESSAGE", { path, bytes: event.data.length });
      try {
        onData(parse(event.data));
      } catch {
        // Ignore malformed frames; the next event re-syncs state.
      }
    });

    es.addEventListener("error", (event) => {
      console.log("OFFER_STREAM_ERROR", { path, event });
      teardownEs("error");
      scheduleReconnect("error");
    });

    startWatchdog();
  };

  void connect();

  return () => {
    closed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    stopWatchdog();
    teardownEs("unsubscribe");
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
