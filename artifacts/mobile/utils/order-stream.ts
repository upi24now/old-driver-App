/**
 * PG-backed realtime-ish listeners for the Driver App's incoming-order flow
 * (Phase 5J-Tier-6, receive-layer fix).
 *
 * Drop-in replacements for the two Firestore onSnapshot listeners the Driver
 * App originally relied on:
 *   • listenToAllDispatchedOrders — was firestore.ts L1 (offer set)
 *   • listenToActiveOrder         — was firestore.ts L2 (single order status)
 *
 * Both expose the EXACT same signatures and callback contracts as the
 * Firestore versions (and the prior SSE versions), so callers (DriverContext)
 * needed NO changes.
 *
 * ── Why polling instead of SSE ──────────────────────────────────────────────
 * This used to be an EventSource (react-native-sse) stream against
 * GET /api/drivers/me/offer-stream / GET /api/orders/:orderId/stream.
 *
 * Root cause of "no popup" confirmed in production logs:
 *   • Backend dispatch is correct: active_offer_driver_uids contains the
 *     driver uid, "DISPATCH OFFER ADDED" fires, and the server repeatedly
 *     logs OFFER_STREAM_SEND (i.e. it IS writing SSE frames to the socket).
 *   • The Driver App logs OFFER_STREAM_OPEN (the EventSource reaches
 *     readyState OPEN — the HTTP response headers were received) but NEVER
 *     logs OFFER_STREAM_MESSAGE — no "message" event is ever dispatched by
 *     react-native-sse, even though the server is actively writing frames on
 *     that same open connection.
 *   • This is a known limitation of React Native's XHR implementation on
 *     Android: react-native-sse is built entirely on XMLHttpRequest, reading
 *     incremental data from `xhr.responseText` on readyState-3 (LOADING)
 *     progress events. On Android, RN's XHR (backed by OkHttp) does not
 *     reliably deliver incremental `responseText` growth for a long-lived,
 *     chunked, keep-alive connection — the socket opens (readyState reaches
 *     OPEN/3), but no further "readystatechange" progress fires until the
 *     response ends, which never happens for a stream that is designed to
 *     stay open indefinitely. iOS's XHR does not have this limitation, which
 *     is consistent with this being an Android-only symptom.
 *   • This exactly matches the evidence: proxy/server-side writes succeed
 *     (OFFER_STREAM_SEND, dispatch logs all correct), the socket opens
 *     client-side (OFFER_STREAM_OPEN), but body chunks never surface to JS
 *     (no OFFER_STREAM_MESSAGE) — a client-side receive-layer defect, not a
 *     backend dispatch defect.
 *
 * Fix: replace ONLY the receive layer with short-interval polling against
 * plain JSON REST endpoints that return the exact same PG-backed data the SSE
 * streams were pushing:
 *   • GET /api/drivers/me/offers   (new — mirrors the offer-stream snapshot)
 *   • GET /api/orders/:orderId     (already existed — used for L2 status)
 *
 * No backend dispatch, FCM, PG write paths, or any other working flow (login,
 * KYC, duty toggle, subscription, location heartbeat) are touched.
 */

import { firebaseAuth } from "@/utils/firebase";
import { getSessionIdSync } from "@/utils/session";
import type { OrderDoc, OrderStatus } from "@/utils/firestore";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// Fast enough that a new offer surfaces almost instantly (backend dispatch is
// already instant; this interval is the only added latency), slow enough to
// stay well within normal REST-call budgets for a single lightweight query.
const POLL_INTERVAL_MS      = 3_000;
const ERROR_BACKOFF_MS      = 8_000;
const TOKEN_RETRY_MS        = 2_000;

async function freshIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function authedGet<T>(path: string): Promise<T | null> {
  const token = await freshIdToken();
  if (!token) return null;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const sid = getSessionIdSync();
  if (sid) headers["x-session-id"] = sid;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  // 404 (e.g. an order that no longer exists) still carries a meaningful JSON
  // body ({ ok: false, error: "not_found" }) that callers use to converge on
  // "gone" — only genuine transport/server failures should trip the error
  // backoff below.
  if (!res.ok && res.status !== 404) {
    throw new Error(`GET ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Generic polling loop, parameterised on a fetcher instead of a fixed path.
 * Identical scheduling/backoff behaviour to `poll` below — extracted so
 * `listenToActiveOrder` can supply a fetcher with bespoke terminal-status
 * handling (see `fetchOrderStatus`) while `listenToAllDispatchedOrders` keeps
 * using the plain `authedGet` path-based fetcher via `poll`.
 */
function pollWith<T>(
  fetcher: () => Promise<T | null>,
  onData: (value: T) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    let nextDelay = POLL_INTERVAL_MS;
    try {
      const data = await fetcher();
      if (stopped) return;
      if (data === null) {
        // Not authenticated yet — retry soon without treating it as an error.
        nextDelay = TOKEN_RETRY_MS;
      } else {
        onData(data);
      }
    } catch (err) {
      console.log("OFFER_POLL_ERROR", { err: err instanceof Error ? err.message : String(err) });
      nextDelay = ERROR_BACKOFF_MS;
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(() => { void tick(); }, nextDelay);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Fetch a single order's status for the active-order poller, with explicit
 * terminal handling for 404 (order no longer exists) and 403 (driver no
 * longer owns/has access to this order — e.g. the customer cancelled and the
 * backend revoked the driver's assignment before this poll tick landed).
 *
 * Both cases previously fell through to `authedGet`'s generic "non-200 !=
 * 404 → throw" path for 403, which surfaced as a transient OFFER_POLL_ERROR
 * and was retried forever on the error backoff — the driver app never
 * learned the order was gone, so the active-order screen stayed stuck
 * showing the last known in-flight stage (e.g. "En Route to Pickup") even
 * though the order was already cancelled server-side. Treating 403 as a
 * terminal "gone" signal (same as 404) fixes that: the caller
 * (`listenToActiveOrder`) always converges on `status: null`, driving the
 * same terminal cleanup path as a real cancelled/customer_cancelled status.
 */
async function fetchOrderStatus(
  orderId: string,
): Promise<{ status: OrderStatus | null } | null> {
  const token = await freshIdToken();
  if (!token) return null;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const sid = getSessionIdSync();
  if (sid) headers["x-session-id"] = sid;

  const res = await fetch(`${BASE_URL}/orders/${orderId}`, { headers });

  if (res.status === 404) {
    console.log("[DRIVER_ORDER_FETCH_TERMINAL_CANCELLED]", { orderId, httpStatus: res.status });
    return { status: null };
  }
  if (res.status === 403) {
    console.log("[DRIVER_ORDER_ACCESS_REVOKED_CLEAR]", { orderId, httpStatus: res.status });
    return { status: null };
  }
  if (!res.ok) {
    // Genuine transport/server failure — not a terminal signal. Throw so the
    // caller's error backoff retries instead of clearing a possibly-live order.
    throw new Error(`GET /orders/${orderId} → ${res.status}`);
  }

  const payload = await res.json() as { ok?: boolean; order?: { status?: OrderStatus } };
  return { status: payload.ok && payload.order?.status ? payload.order.status : null };
}

/**
 * Generic polling loop: repeatedly GETs `path`, and calls `onData` with the
 * parsed payload whenever a fetch succeeds. Errors (network blip, transient
 * 401 before a token refresh, etc.) are swallowed and retried on a slightly
 * longer backoff — the next successful poll always re-syncs full state, so a
 * missed tick never causes a stuck UI. Returns an unsubscribe function.
 */
function poll<T>(
  path: string,
  onData: (value: T) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    let nextDelay = POLL_INTERVAL_MS;
    try {
      const data = await authedGet<T>(path);
      if (stopped) return;
      if (data === null) {
        // Not authenticated yet — retry soon without treating it as an error.
        nextDelay = TOKEN_RETRY_MS;
      } else {
        onData(data);
      }
    } catch (err) {
      console.log("OFFER_POLL_ERROR", { path, err: err instanceof Error ? err.message : String(err) });
      nextDelay = ERROR_BACKOFF_MS;
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(() => { void tick(); }, nextDelay);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Listen for ALL orders currently offered to this driver (replaces L1).
 * Calls back with the full OrderDoc array on every poll. Returns unsubscribe.
 */
export function listenToAllDispatchedOrders(
  uid:      string,
  onOrders: (orders: OrderDoc[]) => void,
): () => void {
  // uid is implied by the authenticated token server-side; kept in the
  // signature for drop-in parity with the Firestore/SSE versions.
  void uid;
  return poll<{ orders: OrderDoc[] }>(
    "/drivers/me/offers",
    (payload) => onOrders(payload.orders ?? []),
  );
}

/**
 * Subscribe to a single order's status (replaces L2).
 * Calls back with the live status string, or null if the order no longer
 * exists or is not assigned to this driver. Returns unsubscribe.
 */
export function listenToActiveOrder(
  orderId:  string,
  onChange: (status: OrderStatus | null) => void,
): () => void {
  // GET /api/orders/:orderId responds { ok, order } — same shape already
  // consumed elsewhere (see utils/firestore.ts fetchOrderById). A non-ok / 404
  // response means the order no longer exists, and a 403 means the driver no
  // longer owns/has access to it (e.g. the customer cancelled) — both are
  // reported as null, matching the previous SSE/Firestore "gone" signal. See
  // `fetchOrderStatus` for why 403 must be treated as terminal here rather
  // than a transient poll error.
  return pollWith<{ status: OrderStatus | null }>(
    () => fetchOrderStatus(orderId),
    (result) => onChange(result.status),
  );
}
