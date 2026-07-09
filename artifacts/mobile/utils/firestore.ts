import { firebaseAuth } from "./firebase";

// ─── API base URL ─────────────────────────────────────────────────────────────
const _DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const _BASE_URL = _DOMAIN ? `https://${_DOMAIN}/api` : "/api";

// ─── Driver doc ───────────────────────────────────────────────────────────────
//
// NOTE (Phase 5J Firestore retirement): the driver-doc READ/WRITE helpers
// (getDriverDoc, subscribeDriverDoc, createDriverDoc, updateDriverProfile,
// updateDriverVehicle, submitDriverDocuments, updateDriverOnlineStatus,
// updateDriverBackgroundSetup) have been migrated to PG-backed REST in
// utils/profile-api.ts + utils/driver-api.ts and removed from this file. The
// DriverDoc / DriverDocEntry types are retained because they remain the typed
// shape consumed by DriverContext.

/** Per-document entry stored under drivers/{uid}.documents.{documentType} */
export type DriverDocEntry = {
  /** Public VPS URL — written by submitDriverDocuments (v2+) */
  url?:             string | null;
  /** Legacy field name kept for backward compatibility with older submissions */
  uri?:             string | null;
  status?:          string | null;  // "pending" | "approved" | "verified" | "rejected" | null
  uploadedAt?:      unknown;        // Firestore server timestamp
  rejectionReason?: string | null;  // set by admin on per-doc reject
  rejectedAt?:      unknown;        // Firestore server timestamp of rejection
};

export type DriverDoc = {
  uid:                    string;
  phone:                  string;
  name?:                  string;
  city?:                  string;
  gender?:                string;
  vehicleId?:             string;
  vehicleName?:           string;
  licenseNumber?:         string;
  vehicleNumber?:         string;
  isOnline:               boolean;
  onlineStatus?:          "online" | "offline";
  lastSeenAt?:            unknown;
  accountStatus?:         string;   // "active" | "suspended" | "blacklisted" | "blocked"
  suspendReason?:         string;   // admin-supplied reason written at suspend time
  blacklistReason?:       string;   // admin-supplied reason written at blacklist time
  subscriptionPlan?:      string;
  subscriptionExpiresAt?: number;
  createdAt:              unknown;

  // ── Documents ─────────────────────────────────────────────────────────────
  documentsSubmitted?:   boolean;   // true after submitDriverDocuments()
  verificationStatus?:   string;    // "pending" | "approved" | "verified" | "rejected"
  kycRejectionReason?:   string;    // top-level reason set by admin on reject
  rejectedDocuments?:    string[];  // top-level array of rejected docIds — fallback for driver app
  documents?: {
    selfie?:       DriverDocEntry;
    aadhaarFront?: DriverDocEntry;
    aadhaarBack?:  DriverDocEntry;
    pan?:          DriverDocEntry;
    licenseFront?: DriverDocEntry;
    licenseBack?:  DriverDocEntry;
    rcFront?:      DriverDocEntry;
    rcBack?:       DriverDocEntry;
  };

  // ── Daily stats — authoritative balance now lives in wallets/{uid} ─────────
  todayEarnings?:    number;  // earnings on todayDate (UTC)
  tripsToday?:       number;  // completed deliveries on todayDate
  todayDate?:        string;  // "YYYY-MM-DD" sentinel for daily reset

  // ── Driver stats (shown on customer app driver card) ─────────────────────
  rating?:     number;  // driver rating; default 5.0 when absent
  totalTrips?: number;  // all-time completed trip count; default 0 when absent

  // ── Background permission setup ───────────────────────────────────────────
  backgroundSetupShown?:        boolean;  // true after driver has seen the setup screen once
  permissionSetupVersion?:      number;   // version of the setup flow completed; see PERMISSION_SETUP_VERSION
  permissionSetupCompletedAt?:  unknown;  // Firestore server Timestamp; set when version is written

  // ── Onboarding fee ────────────────────────────────────────────────────────
  onboardingFeeApplies?:  boolean;              // true for new signups when config.enabled = true
  onboardingFeeStatus?:   "pending" | "paid";   // updated to "paid" by server after Razorpay verify
  onboardingFeeAmount?:   number;               // INR amount stamped at signup time
  onboardingFeeCurrency?: string;               // "INR"
};

// ─── Completed trips ──────────────────────────────────────────────────────────
//
// NOTE: the Firestore query helper (getDriverCompletedTrips) has been migrated
// to PG-backed REST in utils/driver-api.ts (getDriverTrips). The CompletedTrip
// type is retained because trips.tsx still consumes it.

export type CompletedTrip = {
  orderId:       string;
  customerName:  string;
  pickupAddress: string;
  dropAddress:   string;
  fareEstimate:  number;
  paymentMode:   string;
  deliveredAt:   number | null;  // ms epoch, null if field absent
  distanceKm?:   number;
  status:        string;
};

/**
 * Version sentinel for the permission setup flow.
 * Increment this whenever the setup screen adds new required steps so that
 * existing drivers (who have only completed an older version) are re-routed
 * to the screen on their next app start.
 *
 * History:
 *   1 — original boolean-only gate (backgroundSetupShown: true)
 *   2 — versioned gate; notifications + foreground GPS required
 *   3 — readiness gate v3; auto-request on mount, canAskAgain denial UX
 *   4 — Rapido/Delhivery-style wizard; one step per screen, no fake-green
 *   5 — Clean rebuild; exact Delhivery-style labels, white bg, no badges/notes
 */
export const PERMISSION_SETUP_VERSION = 6;

// ─── Order doc ────────────────────────────────────────────────────────────────
//
// Firestore collection: "orders"
// Document ID: auto-generated by the customer app.
//
// NOTE (Phase 5J): order WRITES (accept/stage/location/reject/timeout/cancel)
// are now PG-authoritative via REST (utils/delivery-api.ts + the reject/timeout/
// driver-cancel wrappers below). Order READS are also PG-authoritative:
// getActiveOrdersForDriver and fetchOrderById are both PG-only via REST — there
// is NO Firestore fallback anywhere. PostgreSQL is the single source of truth.

export type OrderStatus =
  | "searching"        // in the driver-assignment pool (round-robin status)
  | "pending"          // legacy pool status (driverCancelOrder still writes this)
  | "dispatched"       // Phase 1 legacy: single-driver direct dispatch
  | "driver_assigned"  // Phase 2: written atomically when a driver wins the offer
  | "accepted"         // legacy alias kept for backward compatibility
  | "rejected"
  | "to_pickup"
  | "at_pickup"
  | "to_drop"
  | "at_drop"
  | "delivered"
  | "cancelled";

export type OrderDoc = {
  id:               string;
  status:           OrderStatus;
  driverUid:        string | null;

  // Customer identity
  customerId:       string;
  customerName:     string;
  customerPhone:    string;
  customerRating:   number;

  // Parcel
  parcelType:       string;
  parcelEmoji:      string;
  parcelWeight:     string;

  // Route — primary fields; customer app may also write pickupAddress / deliveryAddress
  pickup:           string;
  pickupAddress?:   string;
  pickupSub?:       string;
  pickupCity:       string;
  drop:             string;
  deliveryAddress?: string;
  dropAddress?:     string;
  dropSub?:         string;
  dropCity:         string;
  distanceKm:       number;
  pickupDistanceKm?: number;
  durationMin:      number;

  // Fare — primary field used by this app; customer app may use alternate names
  fareEstimate:     number;
  totalAmount?:     number;
  price?:           number;
  amount?:          number;
  deliveryFee?:     number;
  paymentMode:      "Cash" | "UPI" | "Card";
  surge?:           boolean;
  surgeMultiplier?: number;

  // Phase 2 multi-driver offer fields — written by the customer app during dispatch
  activeOfferDriverUids?: string[];             // drivers currently holding the offer
  offerStartedAt?:        Record<string, unknown>; // map of driverUid → Firestore Timestamp

  // Round-robin dispatch fields — written by round-robin-dispatcher.ts (server)
  dispatchTimeoutAt?:       unknown;  // JS Date / Firestore Timestamp; poller resets order when elapsed
  lastDispatchedDriverUid?: string;   // used to advance the round-robin cursor

  // Timestamps — set by serverTimestamp() at each transition
  createdAt:    unknown;
  dispatchedAt?: unknown;
  acceptedAt?:  unknown;
  rejectedAt?:  unknown;
  to_pickupAt?: unknown;
  at_pickupAt?: unknown;
  to_dropAt?:   unknown;
  at_dropAt?:   unknown;
  deliveredAt?: unknown;

  // Rejection history — dispatcher reads to avoid re-assigning the same driver
  rejectedBy?: string[];

  // Written by driver on accept
  driverName?:    string;
  driverRating?:  number | string;  // shown on customer driver card; fallback "5.0"
  driverTrips?:   number;           // shown on customer driver card; fallback 0

  // Live location — written by driver app during active delivery (~every 10 s / 30 m)
  driverLat?:         number;
  driverLng?:         number;
  locationUpdatedAt?: unknown;  // Firestore server Timestamp
  locationAccuracy?:  number;   // metres; omitted when platform returns null

};

/**
 * Fetch a single order by ID.
 *
 * PG-AUTHORITATIVE via GET /api/orders/:orderId. PostgreSQL is the single source
 * of truth — there is NO Firestore fallback. Returns null when there is no
 * authenticated user, the server responds non-ok (e.g. 404), or the request
 * fails (network / auth error).
 */
export async function fetchOrderById(orderId: string): Promise<OrderDoc | null> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    const res   = await fetch(`${_BASE_URL}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json() as { ok?: boolean; order?: OrderDoc };
      if (json.ok && json.order) {
        return json.order;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the active orders for the given driver.
 *
 * PG-AUTHORITATIVE — no Firestore fallback for business data (Phase 5J+):
 *   • `GET /api/drivers/:uid/active-orders` is the single source of truth.
 *   • Any HTTP 200 response is authoritative. The server's `orders` array is
 *     returned verbatim — an empty array means "this driver has no active
 *     order" and the caller MUST clear any stale local/current active-order
 *     state. The `ok` flag is intentionally ignored: the server returns
 *     `{ ok: false, orders: [] }` on a genuine PG miss, which is still an
 *     authoritative "no active order" answer, NOT a reason to read Firestore.
 *   • The previous Firestore active-order fallback has been removed. Firestore
 *     is never consulted for active orders — not even when the array is empty.
 *   • If the server is unreachable or returns a non-200 (network / auth / 5xx),
 *     this THROWS so the caller can leave existing state untouched rather than
 *     resurrecting stale data. It must never silently return Firestore rows.
 */
export async function getActiveOrdersForDriver(
  uid: string,
  maxResults = 3,
): Promise<OrderDoc[]> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    // No auth session: the authoritative PG source cannot be queried. Signal the
    // caller to leave current state untouched — never fall back to Firestore.
    throw new Error("active-orders: no authenticated user");
  }
  const token = await user.getIdToken();
  const res   = await fetch(`${_BASE_URL}/drivers/${uid}/active-orders?max=${maxResults}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // 403 (uid mismatch / access revoked) and 404 (order/driver not found) are
    // TERMINAL signals — the server is telling us this driver no longer has an
    // active order. Return an empty array so the caller clears local state,
    // just as it does on a genuine HTTP 200 empty response.
    // All other non-200 codes (5xx, network failure, etc.) are NOT authoritative —
    // throw so the caller preserves current state rather than clearing it.
    const status = res.status;
    if (status === 403 || status === 404) {
      console.log(`[ORDER_POLL_TERMINAL_CLEAR] HTTP ${status} on active-orders — treating as no-active-order`);
      return [];
    }
    throw new Error(`active-orders: HTTP ${status}`);
  }
  // HTTP 200 is authoritative. Return the server's orders array verbatim (an
  // empty array means the driver has no active order). Never read Firestore.
  const json = await res.json() as { ok?: boolean; orders?: OrderDoc[] };
  return Array.isArray(json.orders) ? json.orders : [];
}

/**
 * Typed result returned by the order-claim REST wrappers.
 *
 * ok: true  — succeeded; this driver now owns the order.
 * ok: false — aborted; reason tells the caller why:
 *   "already_claimed" — order already claimed by another driver
 *   "reassigned"      — this driver is no longer in the offer
 *   "not_dispatched"  — order is in an unexpected state (cancelled, expired, etc.)
 *   "missing"         — order document does not exist
 *   "unknown"         — unexpected error
 */
export type AcceptOrderResult =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "reassigned" | "not_dispatched" | "missing" | "unknown" };

/**
 * Reject an offered order — removes this driver from the offer list.
 *
 * Phase 5J-Tier-9B: PG-authoritative via POST /api/orders/:orderId/reject. The
 * server records the rejection in PostgreSQL (order_offers + orders.rejected_by,
 * the canonical dispatch state), drops the driver from the active_offer_driver_uids
 * read-model the PG offer stream reads, and projects the arrayRemove to Firestore.
 * driverUid is derived server-side from the verified ID token (param ignored).
 *
 * The customer order is NOT cancelled — it stays alive for the remaining
 * drivers in the offer list (or until the customer explicitly cancels).
 */
export async function rejectOrder(orderId: string, _driverUid: string): Promise<AcceptOrderResult> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return { ok: false, reason: "unknown" };
    const token = await user.getIdToken();
    const res   = await fetch(`${_BASE_URL}/orders/${orderId}/reject`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json() as { ok?: boolean };
      if (json.ok) return { ok: true };
    }
    return { ok: false, reason: "unknown" };
  } catch {
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Handle a dispatch timeout — driver ignored the order for the full timer duration.
 *
 * Phase 5J-Tier-9B: PG-authoritative via POST /api/orders/:orderId/timeout.
 * Unlike rejectOrder, timeout does NOT add the driver to orders.rejected_by, so
 * they may receive the same order again if re-offered. The server marks the
 * offer timed_out, drops the driver from the active_offer_driver_uids read-model,
 * and projects the arrayRemove to Firestore. driverUid is derived server-side.
 *
 * The server-side poller handles timeouts independently via offerStartedAt,
 * but this client-side call provides an immediate response when the timer fires.
 */
export async function timeoutOrder(orderId: string, _driverUid: string): Promise<void> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch(`${_BASE_URL}/orders/${orderId}/timeout`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Fire-and-forget: the server-side poller will catch it if this fails.
  }
}

/** Delivery stage labels shared by the order REST wrappers and active-delivery UI. */
export type DeliveryStage = "to_pickup" | "at_pickup" | "to_drop" | "at_drop" | "delivered";

/**
 * Driver-initiated pre-pickup cancellation.
 *
 * Phase 5J-Tier-9C: PG-authoritative via POST /api/orders/:orderId/driver-cancel.
 * The server returns the order to the dispatch pool in PostgreSQL (status back to
 * "pending", driver cleared, offer set cleared, cancel metadata stamped) and
 * projects the return-to-pool to Firestore so the customer app keeps live state.
 * The order is NOT terminally cancelled, so the customer never sees a permanent
 * cancellation and the PG dispatcher re-offers it to another driver.
 *
 * driverUid is derived server-side from the verified ID token (param ignored).
 * Allowed only pre-pickup; the caller (active-delivery.tsx) still guards on stage.
 */
export async function driverCancelOrder(
  orderId:    string,
  _driverUid: string,
  reason:     string,
): Promise<void> {
  // Client-side reason guard — must never reach the API without a reason.
  // The UI already enforces this via disabled button, but this is a defensive
  // backstop against any direct or legacy call path that bypasses the modal.
  if (!reason || !reason.trim()) {
    throw new Error("driver-cancel: reason is required — open the cancel modal to select one");
  }

  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("not authenticated");
  const token = await user.getIdToken();
  const res = await fetch(`${_BASE_URL}/orders/${orderId}/driver-cancel`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason: reason.trim() }),
  });
  if (!res.ok) {
    const status = res.status;
    if (status === 400) {
      throw new Error("driver-cancel: API rejected — cancel reason is required");
    }
    throw new Error(`driver-cancel failed (${status})`);
  }
}
