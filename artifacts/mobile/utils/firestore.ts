import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db, firebaseAuth } from "./firebase";

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

/**
 * Persist the driver's FCM device push token to Firestore drivers/{uid}.
 *
 * Phase 4A/4B: the FCM token is dual-written — PG is primary (saveDriverFcmToken
 * in utils/driver-api.ts) and this Firestore write is the shadow/fallback the
 * server's FCM dispatcher reads if the PG token lookup misses. Retained until
 * the Firestore token fallback is retired.
 * Fields:
 *   fcmToken           — raw Android FCM registration token
 *   fcmTokenUpdatedAt  — server timestamp of last write
 */
export async function updateDriverPushToken(
  uid:   string,
  token: string,
): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    fcmToken:          token,
    fcmTokenUpdatedAt: serverTimestamp(),
  }, { merge: true });
}

// ─── Order doc ────────────────────────────────────────────────────────────────
//
// Firestore collection: "orders"
// Document ID: auto-generated by the customer app.
//
// NOTE (Phase 5J): order WRITES (accept/stage/location/reject/timeout/cancel)
// are now PG-authoritative via REST (utils/delivery-api.ts + the reject/timeout/
// driver-cancel wrappers below). The remaining direct Firestore READS here
// (fetchOrderById, getActiveOrdersForDriver) are REST-primary with a Firestore
// fallback for cold-start recovery.

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
 * REST-primary with Firestore fallback:
 *   1. If a Firebase auth token is available, call GET /api/orders/:orderId on
 *      the server (PG-primary read).
 *   2. If the server call fails for any reason (network, auth, 4xx/5xx), fall
 *      back to a direct Firestore read so cold-start recovery is never blocked.
 */
export async function fetchOrderById(orderId: string): Promise<OrderDoc | null> {
  // ── Server (PG-primary) path ────────────────────────────────────────────────
  try {
    const user = firebaseAuth.currentUser;
    if (user) {
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
      // Server returned non-ok (e.g. 404) — fall through to Firestore
    }
  } catch {
    // Network failure or auth error — fall through to direct Firestore read
  }

  // ── Firestore fallback ────────────────────────────────────────────────────
  try {
    const snap = await getDoc(doc(db, "orders", orderId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as OrderDoc;
  } catch {
    return null;
  }
}

/**
 * Active statuses used for Firestore-level filtering in the fallback path.
 * Stored as an array so it can be passed directly to `where("status","in",…)`.
 */
const ACTIVE_STATUSES: OrderStatus[] = [
  "driver_assigned", "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop",
];

/**
 * Returns up to maxResults (default 3) active orders for the given driver,
 * sorted by acceptedAt descending (newest first).
 *
 * REST-primary with Firestore fallback:
 *   1. Call GET /api/drivers/:uid/active-orders on the server (Bearer token).
 *   2. If the server call fails (network, auth, 4xx/5xx), fall back to a
 *      direct Firestore read so the auth-restore path is never blocked.
 */
export async function getActiveOrdersForDriver(
  uid: string,
  maxResults = 3,
): Promise<OrderDoc[]> {
  // ── Server (PG-primary) path ────────────────────────────────────────────────
  try {
    const user = firebaseAuth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      const res   = await fetch(`${_BASE_URL}/drivers/${uid}/active-orders?max=${maxResults}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json() as { ok?: boolean; orders?: OrderDoc[] };
        if (json.ok && Array.isArray(json.orders)) {
          return json.orders;
        }
      }
      // Server returned non-ok — fall through to Firestore
    }
  } catch {
    // Network failure or auth error — fall through to direct Firestore read
  }

  // ── Firestore fallback ────────────────────────────────────────────────────
  try {
    const snap = await getDocs(
      query(
        collection(db, "orders"),
        where("driverUid", "==", uid),
        where("status", "in", ACTIVE_STATUSES),
        limit(maxResults),
      ),
    );
    const active = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderDoc));
    active.sort((a, b) => {
      const ta = (a.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
      const tb = (b.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
      return tb - ta; // newest first
    });
    return active;
  } catch {
    return [];
  }
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
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("not authenticated");
  const token = await user.getIdToken();
  const res = await fetch(`${_BASE_URL}/orders/${orderId}/driver-cancel`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    throw new Error(`driver-cancel failed (${res.status})`);
  }
}
