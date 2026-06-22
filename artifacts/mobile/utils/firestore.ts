import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
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
import { db, firebaseAuth } from "./firebase";
import type { Profile, Vehicle } from "@/contexts/DriverContext";

// ─── API base URL (dual-read path for PG comparison) ─────────────────────────
const _DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const _BASE_URL = _DOMAIN ? `https://${_DOMAIN}/api` : "/api";

// ─── Driver doc ───────────────────────────────────────────────────────────────

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
  amount:   10,
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
 * Real-time listener for a driver's own Firestore document.
 * Used by DriverContext to detect accountStatus changes (suspend / blacklist)
 * while the app is open without requiring a re-login.
 *
 * Returns an unsubscribe function — call it on cleanup.
 */
export function subscribeDriverDoc(
  uid: string,
  cb: (driverDoc: DriverDoc | null) => void,
): () => void {
  const ref = doc(db, "drivers", uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) { cb(null); return; }
      cb({ uid: snap.id, ...snap.data() } as DriverDoc);
    },
    (err) => {
      console.error("[subscribeDriverDoc] snapshot error:", err);
    },
  );
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
    ...(p.licenseNumber ? { licenseNumber: p.licenseNumber.trim().toUpperCase() } : {}),
    ...(p.vehicleNumber ? { vehicleNumber: p.vehicleNumber.trim().toUpperCase() } : {}),
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
 * download URL alongside a "pending" status.
 *
 * Uses setDoc with merge:true instead of updateDoc so this succeeds even if
 * the driver document was never created (e.g. timing edge-case on first signup).
 *
 * Dot-notation field paths ensure existing admin-set fields on sibling docs
 * are not overwritten.
 *
 * @param uid     - Driver UID (must match Firebase Auth UID)
 * @param docUris - Map of docId → VPS download URL (or null if skipped)
 */
export async function submitDriverDocuments(
  uid:     string,
  docUris: Record<string, string | null>,
): Promise<void> {
  // Strip undefined values — Firestore rejects them.
  // null is intentional (clears a previous URI); undefined is a bug.
  const safeUris: Record<string, string | null> = {};
  for (const [id, uri] of Object.entries(docUris)) {
    if (uri !== undefined) safeUris[id] = uri;
  }

  const updates: Record<string, unknown> = {
    documentsSubmitted:   true,
    verificationStatus:   "pending",
    documentsSubmittedAt: serverTimestamp(),
    updatedAt:            serverTimestamp(),
    // Clear any top-level rejection reason so the driver's next visit to
    // verification-pending.tsx does not show stale rejection data.
    kycRejectionReason:   deleteField(),
  };
  console.log("[submitDriverDocuments] kycRejectionReason → DELETE_SENTINEL");
  for (const [id, uri] of Object.entries(safeUris)) {
    // CRITICAL: dot-notation keys MUST be written via updateDoc, not setDoc.
    // setDoc (even with merge:true) stores "documents.pan.url" as a LITERAL
    // root-level field name — the nested `documents` MAP is never created.
    // updateDoc interprets dot-notation as nested Firestore path separators,
    // producing:  { documents: { pan: { url: "...", status: "pending" } } }
    updates[`documents.${id}.url`]        = uri;
    updates[`documents.${id}.status`]     = "pending";
    updates[`documents.${id}.uploadedAt`] = serverTimestamp();
  }

  console.log("[submitDriverDocuments] uid:", uid);
  console.log("[submitDriverDocuments] docIds being written:", JSON.stringify(Object.keys(safeUris)));

  // updateDoc interprets dot-notation keys as nested paths → correct MAP.
  // Fallback: if the driver doc was somehow deleted, create a minimal stub
  // then retry — this should never happen in normal flow.
  const driverRef = doc(db, "drivers", uid);
  try {
    await updateDoc(driverRef, updates);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not-found") {
      console.warn("[submitDriverDocuments] doc not-found — creating stub then retrying");
      await setDoc(driverRef, { uid }, { merge: true });
      await updateDoc(driverRef, updates);
    } else {
      throw err;
    }
  }

  console.log("[submitDriverDocuments] write completed");

  // ── Runtime proof: read the doc back and verify nested documents MAP ─────
  console.log("[KYC_WRITE_VERIFY] uploaded doc ids:", Object.keys(safeUris));
  try {
    const verifySnap = await getDoc(driverRef);
    const verifyData = verifySnap.data() as Record<string, unknown> | undefined;
    const docMap = verifyData?.["documents"] as Record<string, unknown> | undefined;
    console.log("[KYC_WRITE_VERIFY] documents map exists:", docMap !== undefined);
    if (docMap) {
      for (const id of Object.keys(safeUris)) {
        const entry = docMap[id] as Record<string, unknown> | undefined;
        console.log(`[KYC_WRITE_VERIFY] documents.${id}.status =`, entry?.["status"] ?? "(missing)");
      }
    } else {
      console.error("[KYC_WRITE_VERIFY] documents map still undefined — updateDoc may have failed silently");
    }
  } catch (verifyErr) {
    console.warn("[KYC_WRITE_VERIFY] post-write read failed:", verifyErr);
  }
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
    onlineStatus: isOnline ? "online" : "offline",
    lastSeenAt:   serverTimestamp(),
    updatedAt:    serverTimestamp(),
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
 *   5 — Clean rebuild; exact Delhivery-style labels, white bg, no badges/notes
 */
export const PERMISSION_SETUP_VERSION = 6;

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
 * Phase 2B-1 dual-read strategy:
 *   1. If a Firebase auth token is available, call GET /api/orders/:orderId on
 *      the server.  The server reads BOTH Firestore and PostgreSQL in parallel,
 *      logs [PG_COMPARE_MATCH] or [PG_COMPARE_DIFF], and returns Firestore data.
 *      This path is verification-only — the user always receives Firestore data.
 *   2. If the server call fails for any reason (network, auth, 4xx/5xx), fall
 *      back to a direct Firestore read so cold-start recovery is never blocked.
 */
export async function fetchOrderById(orderId: string): Promise<OrderDoc | null> {
  // ── Server dual-read path ───────────────────────────────────────────────────
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

  // ── Firestore fallback (original path) ────────────────────────────────────
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
  // Phase 2: query by activeOfferDriverUids membership, not driverUid assignment.
  const q = query(
    collection(db, "orders"),
    where("activeOfferDriverUids", "array-contains", uid),
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
 * Listen for ALL orders currently offered to this driver simultaneously.
 * Phase 2: the customer app writes activeOfferDriverUids instead of a single
 * driverUid, so multiple drivers can hold the same offer concurrently.
 * Returns the full array so the UI can render a multi-order slider.
 * Returns an unsubscribe function; call it on cleanup.
 *
 * Query: activeOfferDriverUids array-contains uid
 * No composite index required — single array-contains uses the auto-index.
 */
export function listenToAllDispatchedOrders(
  uid:      string,
  onOrders: (orders: OrderDoc[]) => void,
): () => void {
  const q = query(
    collection(db, "orders"),
    where("activeOfferDriverUids", "array-contains", uid),
  );
  return onSnapshot(q, (snap) => {
    onOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderDoc)));
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
 * Active statuses used for both Firestore-level filtering and any local guards.
 * Stored as an array so it can be passed directly to Firestore's `where("status","in",…)`.
 * Previously this was a Set used for client-side filtering; the filter is now
 * pushed into the query, so Firestore only returns the ≤3 docs we actually need.
 *
 * Composite index required: (driverUid ASC, status ASC) — create in Firebase Console
 * or via firestore.indexes.json if not already present.
 */
const ACTIVE_STATUSES: OrderStatus[] = [
  "driver_assigned", "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop",
];

/**
 * Return the single most-recently-accepted in-progress order for this driver,
 * or null if none exists.
 *
 * Both filters are evaluated by Firestore, so only active-status docs for this
 * driver are downloaded.  Previously all orders for the driver were fetched and
 * filtered client-side, which scanned the driver's entire order history on every
 * app restart.
 */
export async function getActiveOrderForDriver(uid: string): Promise<OrderDoc | null> {
  // Delegates to getActiveOrdersForDriver so both functions share the same
  // Phase 2B-2B dual-read path (server comparison + Firestore fallback).
  const all = await getActiveOrdersForDriver(uid, 3);
  return all[0] ?? null;
}

/**
 * Returns up to maxResults (default 3) active orders for the given driver,
 * sorted by acceptedAt descending (newest first).
 *
 * Phase 2B-2B dual-read strategy:
 *   1. Call GET /api/drivers/:uid/active-orders on the server (Bearer token).
 *      The server reads BOTH Firestore and PG in parallel, logs
 *      [PG_ACTIVE_MATCH] or [PG_ACTIVE_DIFF], and returns Firestore data.
 *      PG is verification-only — Firestore data is always returned.
 *   2. If the server call fails (network, auth, 4xx/5xx), fall back to a
 *      direct Firestore read so the auth-restore path is never blocked.
 */
export async function getActiveOrdersForDriver(
  uid: string,
  maxResults = 3,
): Promise<OrderDoc[]> {
  // ── Server dual-read path ───────────────────────────────────────────────────
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

  // ── Firestore fallback (original path) ────────────────────────────────────
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
 * Typed result returned by the atomic acceptOrder transaction.
 *
 * ok: true  — transaction succeeded; this driver now owns the order.
 * ok: false — transaction aborted; reason tells the caller why:
 *   "already_claimed" — order already has status "driver_assigned" (another driver won)
 *   "reassigned"      — this driver is no longer in activeOfferDriverUids
 *   "not_dispatched"  — order is in an unexpected state (cancelled, expired, etc.)
 *   "missing"         — order document does not exist
 *   "unknown"         — unexpected Firestore error
 */
export type AcceptOrderResult =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "reassigned" | "not_dispatched" | "missing" | "unknown" };

/**
 * Atomically claim an offered order for this driver.
 *
 * Phase 2: the customer app broadcasts the order to multiple drivers via
 * activeOfferDriverUids.  Exactly one driver wins the race:
 *   • Reads the order doc inside the transaction.
 *   • Guard 1 — aborts if status === "driver_assigned" (another driver won).
 *   • Guard 2 — aborts if this driver's UID is no longer in activeOfferDriverUids
 *               (order cancelled, offer expired, or driver removed from list).
 *   • Writes status="driver_assigned", driverUid, driverName, acceptedAt,
 *     activeOfferDriverUids=[] in one atomic operation.
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

      // Guard 1: another driver already claimed this order.
      if (data.status === "driver_assigned") {
        throw Object.assign(new Error("Order already accepted by another driver"), {
          code: "already_claimed",
        });
      }

      // Guard 2: this driver is no longer in the active offer list — the order
      // was cancelled, the offer expired, or the driver was removed from the list.
      if (!(data.activeOfferDriverUids ?? []).includes(driverUid)) {
        throw Object.assign(new Error("Driver no longer in offer list"), {
          code: "reassigned",
        });
      }

      tx.update(ref, {
        status:                "driver_assigned",
        driverUid,
        driverName:            driverName  ?? "",
        driverRating:          driverRating ?? "5.0",
        driverTrips:           driverTrips  ?? 0,
        acceptedAt:            serverTimestamp(),
        activeOfferDriverUids: [],
        updatedAt:             serverTimestamp(),
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
 * Reject an offered order — removes this driver from the offer list.
 *
 * Phase 2: uses arrayRemove so only this driver's UID is removed from
 * activeOfferDriverUids; all other drivers in the offer are unaffected.
 * No transaction needed — arrayRemove is an atomic Firestore field transform.
 *
 * The customer order is NOT cancelled — it stays alive for the remaining
 * drivers in the offer list (or until the customer explicitly cancels).
 */
export async function rejectOrder(orderId: string, driverUid: string): Promise<AcceptOrderResult> {
  try {
    await updateDoc(doc(db, "orders", orderId), {
      activeOfferDriverUids: arrayRemove(driverUid),
      updatedAt:             serverTimestamp(),
    });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Handle a dispatch timeout — driver ignored the order for the full timer duration.
 *
 * Phase 2: unlike rejectOrder, timeout does NOT record the driver in any
 * blacklist, so they may receive the same order again if re-offered.
 * Uses arrayRemove to remove only this driver from activeOfferDriverUids;
 * other drivers in the offer are unaffected.
 *
 * The server-side poller handles timeouts independently via offerStartedAt,
 * but this client-side call provides an immediate response when the timer fires.
 */
export async function timeoutOrder(orderId: string, driverUid: string): Promise<void> {
  try {
    await updateDoc(doc(db, "orders", orderId), {
      activeOfferDriverUids: arrayRemove(driverUid),
      updatedAt:             serverTimestamp(),
    });
  } catch {
    // Fire-and-forget: the server-side poller will catch it if this fails.
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

// ─── Wallet document ──────────────────────────────────────────────────────────
//
//  wallets/{driverUid}   (created on first delivery completion)
//
export interface WalletDoc {
  balance:             number;   // current spendable balance
  totalEarnings:       number;   // cumulative lifetime earnings
  totalPaid:           number;   // cumulative amount paid out to driver
  completedDeliveries: number;   // total completed deliveries (all-time)
  lastUpdatedAt?:      unknown;  // Firestore server timestamp
}

/**
 * Fetch the wallets/{driverUid} document.
 * Returns null if the wallet has never been created (new driver).
 * Always returns WalletDoc with zero defaults when the doc exists.
 */
export async function getWalletDoc(driverUid: string): Promise<WalletDoc | null> {
  const snap = await getDoc(doc(db, "wallets", driverUid));
  if (!snap.exists()) return null;
  const d = snap.data() as Partial<WalletDoc>;
  return {
    balance:             d.balance             ?? 0,
    totalEarnings:       d.totalEarnings       ?? 0,
    totalPaid:           d.totalPaid           ?? 0,
    completedDeliveries: d.completedDeliveries ?? 0,
    lastUpdatedAt:       d.lastUpdatedAt,
  };
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
  const txnRef    = doc(db, "transactions", txnId);          // idempotency doc
  const driverRef = doc(db, "drivers",     driverUid);
  const walletRef = doc(db, "wallets",     driverUid);
  const today     = new Date().toISOString().slice(0, 10);   // "YYYY-MM-DD"

  await runTransaction(db, async (tx) => {
    const [txnSnap, driverSnap, walletSnap] = await Promise.all([
      tx.get(txnRef),
      tx.get(driverRef),
      tx.get(walletRef),
    ]);

    // Idempotency guard — do nothing if earning already credited
    if (txnSnap.exists()) return;

    // Wallet arithmetic — wallets/{uid} is the authoritative balance
    const w               = walletSnap.exists() ? (walletSnap.data() as Record<string, unknown>) : {};
    const prevBalance     = (w["balance"]             as number | undefined) ?? 0;
    const prevTotalEarn   = (w["totalEarnings"]       as number | undefined) ?? 0;
    const prevCompleted   = (w["completedDeliveries"] as number | undefined) ?? 0;
    const newBalance      = prevBalance + fareAmount;

    // Daily stats arithmetic — driver doc, reset if date rolled over
    const d         = driverSnap.exists() ? (driverSnap.data() as Record<string, unknown>) : {};
    const isSameDay = d["todayDate"] === today;
    const newToday  = (isSameDay ? ((d["todayEarnings"] as number | undefined) ?? 0) : 0) + fareAmount;
    const newTrips  = (isSameDay ? ((d["tripsToday"]    as number | undefined) ?? 0) : 0) + 1;

    // Wallet document — balance, totalEarnings, completedDeliveries
    tx.set(walletRef, {
      balance:             newBalance,
      totalEarnings:       prevTotalEarn + fareAmount,
      completedDeliveries: prevCompleted + 1,
      lastUpdatedAt:       serverTimestamp(),
    }, { merge: true });

    // Driver document — daily stats only (no balance fields)
    tx.set(driverRef, {
      todayEarnings: newToday,
      tripsToday:    newTrips,
      todayDate:     today,
      updatedAt:     serverTimestamp(),
    }, { merge: true });

    // Transaction ledger entry
    tx.set(txnRef, {
      driverUid,
      orderId,
      type:          "credit",
      amount:        fareAmount,
      description:   `Delivery #${orderId.slice(-6).toUpperCase()}`,
      paymentMode,
      balanceBefore: prevBalance,
      balanceAfter:  newBalance,
      createdAt:     serverTimestamp(),
    });
  });
}

// Locked balance that can never be withdrawn
const WALLET_LOCK_AMOUNT = 50;

/**
 * Create a UPI withdrawal request (client-side Firestore path).
 *
 * NOTE: DriverContext routes withdrawals through POST /api/payouts/request
 * instead of calling this function directly. This function is schema-aligned
 * with the backend for any non-context callers.
 *
 * Business rules:
 *   • locked balance = ₹50 — driver can never withdraw that amount
 *   • max withdrawable = balance - 50
 *   • amount must be > 0 and ≤ max withdrawable
 *
 * Firestore writes (all in one transaction):
 *   1. wallets/{uid}               — debit balance, increment totalPaid
 *   2. withdrawalRequests/{autoId} — request document (admin panel reads)
 *   3. transactions/{autoId}       — ledger entry, type = "payout"
 */
export async function requestWithdrawal(
  driverUid: string,
  amount:    number,
  upiId:     string,
): Promise<void> {
  const withdrawalRef = doc(collection(db, "withdrawalRequests")); // was: "withdrawal_requests"
  const withdrawalId  = withdrawalRef.id;
  const txnRef        = doc(db, "transactions", `${withdrawalId}_withdraw`); // was: "driver_transactions"
  const walletRef     = doc(db, "wallets", driverUid);                       // was: "drivers"

  await runTransaction(db, async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const w          = walletSnap.exists() ? (walletSnap.data() as Record<string, unknown>) : {};
    const balance    = (w["balance"]   as number | undefined) ?? 0;  // was: "walletBalance"
    const prevPaid   = (w["totalPaid"] as number | undefined) ?? 0;
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

    const newBalance = balance - amount;

    // Debit wallet document
    tx.set(walletRef, {
      balance:       newBalance,
      totalPaid:     prevPaid + amount,
      lastUpdatedAt: serverTimestamp(),
    }, { merge: true });

    // Withdrawal request document (admin panel reads this)
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
      type:          "payout",         // was: "withdrawal"
      amount:        -amount,
      description:   "UPI withdrawal request",
      balanceBefore: balance,
      balanceAfter:  newBalance,
      createdAt:     serverTimestamp(),
    });
  });
}

/**
 * Fetch the most recent transaction ledger entries for a driver.
 *
 * Returns raw Firestore document data (newest-first).
 * Callers map the raw shape to their own display types.
 */
export async function getDriverTransactions(
  driverUid:  string,
  limitCount = 50,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const q = query(
    collection(db, "transactions"),
    where("driverUid", "==", driverUid),
    orderBy("createdAt", "desc"),
    limit(limitCount),
  );
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }),
  );
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
