import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Profile, Vehicle } from "@/contexts/DriverContext";

// ─── Driver doc ───────────────────────────────────────────────────────────────

/** Per-document entry stored under drivers/{uid}.documents.{docId} */
export type DriverDocEntry = {
  uri?:    string | null;
  status?: string | null;  // "pending" | "approved" | "verified" | "rejected" | null
};

export type DriverDoc = {
  uid:                    string;
  phone:                  string;
  name?:                  string;
  city?:                  string;
  gender?:                string;
  vehicleId?:             string;
  vehicleName?:           string;
  isOnline:               boolean;
  subscriptionPlan?:      string;
  subscriptionExpiresAt?: number;
  createdAt:              unknown;

  // ── Documents ─────────────────────────────────────────────────────────────
  documentsSubmitted?:   boolean;  // true after submitDriverDocuments()
  verificationStatus?:   string;   // "pending" | "verified" | "rejected"
  documents?: {
    selfie?:    DriverDocEntry;
    aadhaar?:   DriverDocEntry;
    pan?:       DriverDocEntry;
    license?:   DriverDocEntry;
    rc?:        DriverDocEntry;
    insurance?: DriverDocEntry;
  };

  // ── Wallet ────────────────────────────────────────────────────────────────
  walletBalance?:    number;  // running total, authoritative balance
  lifetimeEarnings?: number;  // cumulative all-time earnings
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
  // These fields are ONLY set for brand-new drivers during createDriverDoc().
  // They are intentionally absent on existing/old driver docs.
  // onboardingFeeApplies must be explicitly true to show the fee screen.
  onboardingFeeApplies?:  boolean;              // true for new signups when config.enabled = true
  onboardingFeeStatus?:   "pending" | "paid";   // updated to "paid" by server after Razorpay verify
  onboardingFeeAmount?:   number;               // INR amount stamped at signup time
  onboardingFeeCurrency?: string;               // "INR"
};

// ─── Completed trips ──────────────────────────────────────────────────────────

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
 * Fetch the most recent delivered orders for a driver.
 *
 * Query: orders WHERE driverUid == uid AND status == "delivered"
 *        ORDER BY deliveredAt DESC LIMIT limitCount
 *
 * Composite index required (Firestore will throw FAILED_PRECONDITION if absent):
 *   Collection : orders
 *   Fields     : driverUid ASC, status ASC, deliveredAt DESC
 */
export async function getDriverCompletedTrips(
  driverUid:  string,
  limitCount  = 20,
): Promise<CompletedTrip[]> {
  const q = query(
    collection(db, "orders"),
    where("driverUid", "==", driverUid),
    where("status", "==", "delivered"),
    orderBy("deliveredAt", "desc"),
    limit(limitCount),
  );

  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;

    // deliveredAt may be a Firestore Timestamp, a number, or absent
    let deliveredAt: number | null = null;
    const raw = data["deliveredAt"];
    if (raw != null) {
      if (typeof raw === "object" && typeof (raw as { toMillis?: () => number }).toMillis === "function") {
        deliveredAt = (raw as { toMillis: () => number }).toMillis();
      } else if (typeof raw === "number") {
        deliveredAt = raw;
      }
    }

    // ── Pickup address ────────────────────────────────────────────────────────
    // Confirmed field names from live Firestore audit (order 0n31uZHUZFrlDM0ZIWlj):
    //   "pickupAddress"  → full string already set by customer app  (preferred)
    //   "pickup"         → same value, always present
    //   "pickupSub"      → optional landmark/floor, already embedded in pickupAddress
    const strOf = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";

    const pickupAddress =
      strOf(data["pickupAddress"]) ||
      strOf(data["pickup"])        ||
      "Pickup location not available";

    // ── Drop address ──────────────────────────────────────────────────────────
    // Confirmed field names from live Firestore audit:
    //   "deliveryAddress" → full drop string set by customer app  (preferred)
    //   "drop"            → same value, always present
    //   "dropAddress"     → NOT present in any inspected document
    //   "dropCity"        → city only — already embedded in "drop" string
    const dropAddress =
      strOf(data["deliveryAddress"]) ||
      strOf(data["drop"])            ||
      "Drop location not available";

    // ── Payment mode ──────────────────────────────────────────────────────────
    // Stored as lowercase "cash"/"upi"/"card" by customer app — normalise to
    // the display capitalisation used throughout the driver app.
    const rawMode = strOf(data["paymentMode"]).toLowerCase();
    const paymentMode =
      rawMode === "upi"  ? "UPI"  :
      rawMode === "card" ? "Card" :
      rawMode === "cash" ? "Cash" :
      "Cash";

    return {
      orderId:       d.id,
      customerName:  strOf(data["customerName"]) || "Customer",
      pickupAddress,
      dropAddress,
      fareEstimate:  (data["fareEstimate"]  as number  | undefined) ?? 0,
      paymentMode,
      distanceKm:    (data["distanceKm"]    as number  | undefined),
      status:        (data["status"]        as string  | undefined) ?? "delivered",
      deliveredAt,
    };
  });
}

// ─── Onboarding fee config ────────────────────────────────────────────────────
//
// Read from Firestore: app_config/driver_onboarding
// Fields: enabled (bool), amount (number INR), currency (string), title (string), description (string)
// Falls back to defaults when the document is absent or a field is missing.

export type OnboardingFeeConfig = {
  enabled:      boolean;
  amount:       number;   // INR
  currency:     string;
  title:        string;
  description?: string;
};

const DEFAULT_FEE_CONFIG: OnboardingFeeConfig = {
  enabled:  true,
  amount:   5,
  currency: "INR",
  title:    "One-time onboarding fee",
};

export async function getOnboardingFeeConfig(): Promise<OnboardingFeeConfig> {
  try {
    const snap = await getDoc(doc(db, "app_config", "driver_onboarding"));
    if (!snap.exists()) return DEFAULT_FEE_CONFIG;
    const d = snap.data();
    return {
      enabled:     typeof d["enabled"]     === "boolean" ? d["enabled"]     : DEFAULT_FEE_CONFIG.enabled,
      amount:      typeof d["amount"]      === "number"  ? d["amount"]      : DEFAULT_FEE_CONFIG.amount,
      currency:    typeof d["currency"]    === "string"  ? d["currency"]    : DEFAULT_FEE_CONFIG.currency,
      title:       typeof d["title"]       === "string"  ? d["title"]       : DEFAULT_FEE_CONFIG.title,
      description: typeof d["description"] === "string"  ? d["description"] : undefined,
    };
  } catch {
    return DEFAULT_FEE_CONFIG;
  }
}

export async function getDriverDoc(uid: string): Promise<DriverDoc | null> {
  const snap = await getDoc(doc(db, "drivers", uid));
  return snap.exists() ? (snap.data() as DriverDoc) : null;
}

/**
 * Create a new driver document.
 * Accepts an optional OnboardingFeeConfig — when provided and enabled,
 * stamps onboardingFeeApplies/Status/Amount onto the doc so the routing
 * guard can gate new drivers through the fee screen.
 * These fields are intentionally absent on existing driver docs.
 */
export async function createDriverDoc(
  uid:        string,
  phone:      string,
  feeConfig?: OnboardingFeeConfig,
): Promise<DriverDoc> {
  const feeFields: Partial<DriverDoc> = feeConfig?.enabled
    ? {
        onboardingFeeApplies:  true,
        onboardingFeeStatus:   "pending",
        onboardingFeeAmount:   feeConfig.amount,
        onboardingFeeCurrency: feeConfig.currency,
      }
    : {};

  const data: Omit<DriverDoc, "createdAt"> & { createdAt: unknown } = {
    uid,
    phone,
    isOnline:  false,
    createdAt: serverTimestamp(),
    ...feeFields,
  };
  await setDoc(doc(db, "drivers", uid), data, { merge: true });
  return { ...data, createdAt: Date.now() } as DriverDoc;
}

export async function updateDriverProfile(uid: string, p: Profile): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    name:      p.name,
    city:      p.city,
    gender:    p.gender,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function updateDriverVehicle(uid: string, v: Vehicle): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    vehicleId:   v.id,
    vehicleName: v.name,
    updatedAt:   serverTimestamp(),
  }, { merge: true });
}

/**
 * Persist the driver's active subscription so it survives app restarts.
 * Called by activatePlan() in DriverContext.
 */
export async function updateDriverSubscription(
  uid:                  string,
  plan:                 string,
  subscriptionExpiresAt: number,
): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    subscriptionPlan:      plan,
    subscriptionExpiresAt,
    updatedAt:             serverTimestamp(),
  }, { merge: true });
}

/**
 * Mark the driver's document submission in Firestore and persist each doc's
 * URI alongside a "pending" status. Uses dot-notation field paths so that
 * existing admin-set fields on sibling docs are not overwritten.
 *
 * @param uid     - Driver UID
 * @param docUris - Map of docId → local URI (null if doc was locked/skipped)
 */
export async function submitDriverDocuments(
  uid:     string,
  docUris: Record<string, string | null>,
): Promise<void> {
  const updates: Record<string, unknown> = {
    documentsSubmitted:   true,
    verificationStatus:   "pending",
    documentsSubmittedAt: serverTimestamp(),
    updatedAt:            serverTimestamp(),
  };
  for (const [id, uri] of Object.entries(docUris)) {
    updates[`documents.${id}.uri`]    = uri ?? null;
    updates[`documents.${id}.status`] = "pending";
  }
  await updateDoc(doc(db, "drivers", uid), updates);
}

/**
 * Persist the driver's online/offline status so the customer app and
 * dispatcher can filter available drivers.
 */
export async function updateDriverOnlineStatus(
  uid:      string,
  isOnline: boolean,
): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    isOnline,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Persist the driver's FCM device push token so the server can send
 * push notifications when an order is dispatched to this driver.
 * Called once after login and whenever the token refreshes.
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
 */
export const PERMISSION_SETUP_VERSION = 4;

/**
 * Mark that the driver has completed the background-permission setup screen
 * at the current PERMISSION_SETUP_VERSION.
 *
 * Writes:
 *   backgroundSetupShown:       true         (legacy compat — keeps old routing working)
 *   permissionSetupVersion:     3            (version of the setup flow completed)
 *   permissionSetupCompletedAt: Timestamp    (when the driver tapped "Continue")
 */
export async function updateDriverBackgroundSetup(uid: string): Promise<void> {
  await setDoc(doc(db, "drivers", uid), {
    backgroundSetupShown:       true,
    permissionSetupVersion:     PERMISSION_SETUP_VERSION,
    permissionSetupCompletedAt: serverTimestamp(),
    updatedAt:                  serverTimestamp(),
  }, { merge: true });
}


// ─── Order doc ────────────────────────────────────────────────────────────────
//
// Firestore collection: "orders"
// Document ID: auto-generated by the customer app.
//
// Lifecycle written by each party:
//   Customer app  → creates doc, sets status="dispatched", driverUid=<uid>
//   Driver app    → updates status through the stage machine below
//
// Required Firestore composite index (created automatically on first query;
// Firestore prints the console link):
//   Collection: orders  |  Fields: driverUid ASC, status ASC
//
// Stage machine:
//   dispatched → accepted → to_pickup → at_pickup → to_drop → at_drop → delivered
//   Any stage  → rejected  (driver declines)
//   Any stage  → cancelled (customer cancels)

export type OrderStatus =
  | "pending"
  | "dispatched"
  | "accepted"
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

  // Route
  pickup:           string;
  pickupSub?:       string;
  pickupCity:       string;
  drop:             string;
  dropSub?:         string;
  dropCity:         string;
  distanceKm:       number;
  pickupDistanceKm?: number;
  durationMin:      number;

  // Fare
  fareEstimate:     number;
  paymentMode:      "Cash" | "UPI" | "Card";
  surge?:           boolean;
  surgeMultiplier?: number;

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
 * Listen for the single "dispatched" order assigned to this driver.
 * The customer app sets { status: "dispatched", driverUid: uid } to trigger this.
 * Returns an unsubscribe function; call it on cleanup.
 */
export async function fetchOrderById(orderId: string): Promise<OrderDoc | null> {
  try {
    const snap = await getDoc(doc(db, "orders", orderId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as OrderDoc;
  } catch {
    return null;
  }
}

export function listenToDispatchedOrder(
  uid:     string,
  onOrder: (order: OrderDoc | null) => void,
): () => void {
  const q = query(
    collection(db, "orders"),
    where("driverUid", "==", uid),
    where("status",    "==", "dispatched"),
  );
  return onSnapshot(q, (snap) => {
    if (snap.empty) {
      onOrder(null);
    } else {
      const docSnap = snap.docs[0]!;
      onOrder({ id: docSnap.id, ...docSnap.data() } as OrderDoc);
    }
  });
}

/**
 * Subscribe to a single order document.
 * Calls back with the live status string, or null if the doc no longer exists.
 * Returns an unsubscribe function; call it on cleanup.
 */
export function listenToActiveOrder(
  orderId:  string,
  onChange: (status: OrderStatus | null) => void,
): () => void {
  return onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    onChange((snap.data() as OrderDoc).status);
  });
}

/**
 * Return the single in-progress order assigned to this driver, or null.
 * Queries by driverUid only (no composite index needed), then filters
 * active statuses client-side.
 */
const ACTIVE_STATUSES = new Set<OrderStatus>([
  "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop",
]);

export async function getActiveOrderForDriver(uid: string): Promise<OrderDoc | null> {
  const snap = await getDocs(
    query(collection(db, "orders"), where("driverUid", "==", uid)),
  );
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as OrderDoc))
    .filter((o) => ACTIVE_STATUSES.has(o.status));
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const ta = (a.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tb = (b.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return active[0]!;
}

/**
 * Returns up to MAX_ACTIVE_ORDERS (3) active orders for the given driver,
 * sorted by acceptedAt descending (newest first).
 *
 * Used by the auth-restore path in DriverContext so that after an app restart
 * the driver's full multi-order set is rebuilt rather than just the newest one.
 * The cap of 3 prevents an edge-case where Firestore holds stale in-progress
 * docs from a previous session from flooding the restored state.
 */
export async function getActiveOrdersForDriver(
  uid: string,
  limit = 3,
): Promise<OrderDoc[]> {
  const snap = await getDocs(
    query(collection(db, "orders"), where("driverUid", "==", uid)),
  );
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as OrderDoc))
    .filter((o) => ACTIVE_STATUSES.has(o.status));
  active.sort((a, b) => {
    const ta = (a.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tb = (b.acceptedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return tb - ta; // newest first
  });
  return active.slice(0, limit);
}

/**
 * Typed result returned by the atomic acceptOrder transaction.
 *
 * ok: true  — transaction succeeded; this driver now owns the order.
 * ok: false — transaction aborted; reason tells the caller why:
 *   "already_claimed" — order was accepted by this driver on another code path
 *   "reassigned"      — order driverUid no longer matches this driver
 *   "not_dispatched"  — order status has moved past "dispatched"
 *   "missing"         — order document does not exist
 *   "unknown"         — unexpected Firestore error
 */
export type AcceptOrderResult =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "reassigned" | "not_dispatched" | "missing" | "unknown" };

/**
 * Atomically claim a dispatched order for this driver.
 *
 * Uses a Firestore runTransaction so exactly one driver wins when multiple
 * drivers (or multiple code paths on the same device) call this concurrently:
 *   • Reads the order doc inside the transaction.
 *   • Aborts if the doc is missing, the status is no longer "dispatched",
 *     or the driverUid has been reassigned to a different driver.
 *   • Writes status="accepted", driverUid, driverName, acceptedAt, updatedAt
 *     only when all pre-conditions pass.
 *
 * Returns AcceptOrderResult — callers MUST check result.ok before updating
 * local state.  Never set activeOrders until this returns { ok: true }.
 */
export async function acceptOrder(
  orderId:       string,
  driverUid:     string,
  driverName:    string | null,
  driverRating?: number | string,
  driverTrips?:  number,
): Promise<AcceptOrderResult> {
  try {
    await runTransaction(db, async (tx) => {
      const ref  = doc(db, "orders", orderId);
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        throw Object.assign(new Error("Order document missing"), { code: "missing" });
      }

      const data = snap.data() as OrderDoc;

      // Order must still be waiting for a driver.
      if (data.status !== "dispatched") {
        // Distinguish "this driver already accepted on another path" vs
        // "a different driver claimed it" vs "customer cancelled / timed out".
        const sameDriver = data.driverUid === driverUid;
        throw Object.assign(new Error("Order no longer dispatched"), {
          code: sameDriver ? "already_claimed" : "not_dispatched",
        });
      }

      // Order must still be assigned to this driver (not reassigned by dispatcher).
      if (data.driverUid !== driverUid) {
        throw Object.assign(new Error("Order reassigned to another driver"), { code: "reassigned" });
      }

      tx.update(ref, {
        status:       "accepted",
        driverUid,
        driverName:   driverName  ?? "",
        driverRating: driverRating ?? "5.0",
        driverTrips:  driverTrips  ?? 0,
        acceptedAt:   serverTimestamp(),
        updatedAt:    serverTimestamp(),
      });
    });

    return { ok: true };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "already_claimed") return { ok: false, reason: "already_claimed" };
    if (code === "reassigned")      return { ok: false, reason: "reassigned" };
    if (code === "missing")         return { ok: false, reason: "missing" };
    if (code === "not_dispatched")  return { ok: false, reason: "not_dispatched" };
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Safely reject a dispatched order.
 *
 * Uses a Firestore runTransaction so a stale timeout or reject tap can never
 * overwrite an order that was already accepted (by this driver or another),
 * cancelled, or reassigned by the dispatcher.
 *
 * Pre-conditions checked inside the transaction:
 *   • doc exists
 *   • status === "dispatched"  (not accepted, to_pickup, at_pickup, …)
 *   • driverUid === this driver (not reassigned to someone else)
 *
 * On success writes: status="rejected", rejectedBy arrayUnion, rejectedAt, updatedAt.
 * Returns AcceptOrderResult so callers use the same typed result shape.
 */
export async function rejectOrder(orderId: string, driverUid: string): Promise<AcceptOrderResult> {
  try {
    await runTransaction(db, async (tx) => {
      const ref  = doc(db, "orders", orderId);
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        throw Object.assign(new Error("Order document missing"), { code: "missing" });
      }

      const data = snap.data() as OrderDoc;

      if (data.status !== "dispatched") {
        // Already accepted, in-progress, or cancelled — do not overwrite.
        const sameDriver = data.driverUid === driverUid;
        throw Object.assign(new Error("Order no longer dispatched"), {
          code: sameDriver ? "already_claimed" : "not_dispatched",
        });
      }

      if (data.driverUid !== driverUid) {
        throw Object.assign(new Error("Order reassigned to another driver"), { code: "reassigned" });
      }

      tx.update(ref, {
        status:     "rejected",
        rejectedAt: serverTimestamp(),
        updatedAt:  serverTimestamp(),
        rejectedBy: arrayUnion(driverUid),
      });
    });

    return { ok: true };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "already_claimed") return { ok: false, reason: "already_claimed" };
    if (code === "reassigned")      return { ok: false, reason: "reassigned" };
    if (code === "missing")         return { ok: false, reason: "missing" };
    if (code === "not_dispatched")  return { ok: false, reason: "not_dispatched" };
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Write the current delivery stage into the order document.
 * Called by active-delivery.tsx on each stage advance so the customer app
 * can track progress in real time.
 */
export type DeliveryStage = "to_pickup" | "at_pickup" | "to_drop" | "at_drop" | "delivered";

export async function updateOrderStage(
  orderId: string,
  stage:   DeliveryStage,
): Promise<void> {
  await updateDoc(doc(db, "orders", orderId), {
    status:          stage,
    [`${stage}At`]:  serverTimestamp(),
  });
}

/**
 * Write the driver's current GPS position into the order document.
 *
 * Called by active-delivery.tsx on every watchPositionAsync callback so the
 * customer app can power a live driver map via onSnapshot.
 *
 * Update rate: controlled by the caller's watcher config (10 s / 30 m).
 * locationAccuracy is omitted when the platform returns null.
 *
 * Payload written to orders/{orderId}:
 *   driverLat         — WGS-84 latitude
 *   driverLng         — WGS-84 longitude
 *   locationUpdatedAt — server Timestamp (freshness sentinel for customer app)
 *   locationAccuracy  — estimated accuracy in metres (omitted when null)
 */
export async function updateDriverLocation(
  orderId:  string,
  position: { coords: { latitude: number; longitude: number; accuracy: number | null } },
): Promise<void> {
  const { latitude, longitude, accuracy } = position.coords;
  const payload: Record<string, unknown> = {
    driverLat:         latitude,
    driverLng:         longitude,
    locationUpdatedAt: serverTimestamp(),
  };
  if (accuracy !== null) {
    payload["locationAccuracy"] = accuracy;
  }
  await updateDoc(doc(db, "orders", orderId), payload);
}

/**
 * Credit a completed delivery earning to the driver's wallet.
 *
 * Runs inside a Firestore transaction for atomicity.
 * Idempotency: the transaction document ID is "${orderId}_earn".
 * If that document already exists the transaction aborts safely —
 * the wallet is never double-credited for the same order.
 *
 * Daily reset: if drivers/{uid}.todayDate differs from today (UTC),
 * todayEarnings and tripsToday are reset to 0 before crediting.
 */
export async function creditOrderEarning(
  driverUid:   string,
  orderId:     string,
  fareAmount:  number,
  paymentMode: "Cash" | "UPI" | "Card",
): Promise<void> {
  const txnId     = `${orderId}_earn`;
  const txnRef    = doc(db, "driver_transactions", txnId);
  const driverRef = doc(db, "drivers", driverUid);
  const today     = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  await runTransaction(db, async (tx) => {
    const [txnSnap, driverSnap] = await Promise.all([
      tx.get(txnRef),
      tx.get(driverRef),
    ]);

    // Idempotency guard — do nothing if earning already credited
    if (txnSnap.exists()) return;

    const d          = driverSnap.exists() ? (driverSnap.data() as Record<string, number | string>) : {};
    const isSameDay  = d["todayDate"] === today;

    const newWallet   = ((d["walletBalance"]    as number | undefined) ?? 0) + fareAmount;
    const newLifetime = ((d["lifetimeEarnings"] as number | undefined) ?? 0) + fareAmount;
    const newToday    = (isSameDay ? ((d["todayEarnings"] as number | undefined) ?? 0) : 0) + fareAmount;
    const newTrips    = (isSameDay ? ((d["tripsToday"]    as number | undefined) ?? 0) : 0) + 1;

    tx.set(driverRef, {
      walletBalance:    newWallet,
      lifetimeEarnings: newLifetime,
      todayEarnings:    newToday,
      tripsToday:       newTrips,
      todayDate:        today,
      updatedAt:        serverTimestamp(),
    }, { merge: true });

    tx.set(txnRef, {
      driverUid,
      orderId,
      type:        "earning",
      amount:      fareAmount,
      paymentMode,
      status:      "completed",
      createdAt:   serverTimestamp(),
    });
  });
}

// Locked balance that can never be withdrawn
const WALLET_LOCK_AMOUNT = 50;

/**
 * Create a UPI withdrawal request.
 *
 * Business rules:
 *   • locked balance = ₹50 — driver can never withdraw that amount
 *   • max withdrawable = walletBalance - 50
 *   • amount must be > 0 and ≤ max withdrawable
 *
 * Firestore writes (all in one transaction):
 *   1. drivers/{uid}                            — debit walletBalance
 *   2. withdrawal_requests/{autoId}             — request document
 *   3. driver_transactions/{autoId}_withdraw    — matching ledger entry
 *
 * The auto-ID is generated locally via doc(collection(...)) so it can be
 * referenced inside the same transaction without needing addDoc.
 *
 * Throws with a human-readable `.message` on validation failure so callers
 * can surface the reason to the driver.
 */
export async function requestWithdrawal(
  driverUid: string,
  amount:    number,
  upiId:     string,
): Promise<void> {
  const withdrawalRef = doc(collection(db, "withdrawal_requests")); // auto-ID
  const withdrawalId  = withdrawalRef.id;
  const txnRef        = doc(db, "driver_transactions", `${withdrawalId}_withdraw`);
  const driverRef     = doc(db, "drivers", driverUid);

  await runTransaction(db, async (tx) => {
    const driverSnap = await tx.get(driverRef);
    const d          = driverSnap.exists() ? (driverSnap.data() as Record<string, unknown>) : {};
    const balance    = (d["walletBalance"] as number | undefined) ?? 0;
    const maxWithdrawable = balance - WALLET_LOCK_AMOUNT;

    if (amount <= 0) {
      throw new Error("Withdrawal amount must be greater than ₹0");
    }
    if (maxWithdrawable <= 0) {
      throw new Error("Insufficient balance — ₹50 minimum must remain in wallet");
    }
    if (amount > maxWithdrawable) {
      throw new Error(
        `Maximum withdrawable is ₹${maxWithdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      );
    }

    // Debit wallet immediately
    tx.set(
      driverRef,
      { walletBalance: balance - amount, updatedAt: serverTimestamp() },
      { merge: true },
    );

    // Withdrawal request document
    tx.set(withdrawalRef, {
      driverUid,
      amount,
      upiId,
      status:      "pending",
      requestedAt: serverTimestamp(),
      createdAt:   serverTimestamp(),
    });

    // Ledger entry
    tx.set(txnRef, {
      driverUid,
      type:   "withdrawal",
      amount: -amount,
      status: "pending",
      note:   "UPI withdrawal request",
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Driver-initiated pre-pickup cancellation.
 *
 * Sets status back to "pending" so the order re-enters the dispatch pool
 * and can be assigned to another driver.  Does NOT write "cancelled" so
 * the customer never sees a permanent cancellation.
 *
 * Allowed only at stage "to_pickup" (Firestore status "accepted" or "to_pickup").
 * The caller (active-delivery.tsx) is responsible for the stage guard.
 */
export async function driverCancelOrder(
  orderId:   string,
  driverUid: string,
  reason:    string,
): Promise<void> {
  await updateDoc(doc(db, "orders", orderId), {
    status:             "pending",
    driverUid:          null,
    driverName:         "",
    driverCancelledBy:  driverUid,
    driverCancelReason: reason,
    driverCancelledAt:  serverTimestamp(),
    updatedAt:          serverTimestamp(),
  });
}
