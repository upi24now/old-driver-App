import { router } from "expo-router";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from "firebase/auth";

import { firebaseAuth } from "@/utils/firebase";
import {
  getDriverDoc,
  createDriverDoc,
  getOnboardingFeeConfig,
  updateDriverProfile,
  updateDriverVehicle,
  updateDriverOnlineStatus,
  updateDriverSubscription,
  getActiveOrderForDriver,
  getActiveOrdersForDriver,
  listenToAllDispatchedOrders,
  listenToActiveOrder,
  acceptOrder,
  rejectOrder,
  timeoutOrder,
  requestWithdrawal as fsRequestWithdrawal,
  getDriverTransactions,
  updateDriverBackgroundSetup,
  PERMISSION_SETUP_VERSION,
  type DriverDoc,
  type OrderDoc,
  type OrderStatus,
  type AcceptOrderResult,
} from "@/utils/firestore";
export type { AcceptOrderResult };
import { verifyOtpApi } from "@/utils/auth-api";
import { patchDriverStatus, postDriverLocation } from "@/utils/driver-api";
import {
  cancelIncomingOrderNotification,
  checkNotificationPermissions,
  registerDriverPushToken,
  registerOrderActionHandlers,
  sendDriverAlertNotification,
  sendIncomingOrderNotification,
  sendOrderUpdateNotification,
} from "@/utils/notifications";

// Key used to persist the last OTP-verified uid across cold starts.
// A matching uid on app restore skips the OTP gate for approved sessions.
const SESSION_VERIFIED_KEY = "@bike_courier/session_verified_uid";

export type SubPlan = "daily" | "weekly" | "monthly";

export type Vehicle = { id: string; name: string };
export type Profile = {
  name:           string;
  city:           string;
  gender:         string;
  licenseNumber?: string;
  vehicleNumber?: string;
};

/**
 * IncomingRide is the driver-side view of a Firestore order document.
 *
 * Fields map 1-to-1 from OrderDoc so that:
 *   - ride-request.tsx can display the incoming request
 *   - active-delivery.tsx receives everything it needs via route params
 *
 * `passengerName` / `passengerRating` retain their original names so
 * ride-request.tsx needs no display changes.
 */
export type IncomingRide = {
  id:               string;   // Firestore order document ID
  pickup:           string;
  pickupSub:        string;
  pickupCity:       string;
  drop:             string;
  dropSub:          string;
  dropCity:         string;
  distanceKm:       number;
  pickupDistanceKm: number;
  durationMin:      number;
  fareEstimate:     number;
  paymentMode:      "Cash" | "UPI" | "Card";
  surge:            boolean;
  surgeMultiplier:  number;
  passengerName:    string;   // = OrderDoc.customerName
  customerPhone:    string;
  passengerRating:  number;   // = OrderDoc.customerRating
  parcelType:       string;
  parcelEmoji:      string;
  parcelWeight:     string;
};

export type ActiveRide = IncomingRide & {
  acceptedAt:   number;
  orderStatus:  OrderStatus; // last known Firestore status — used to restore stage on app restart
};

// Reason an order was removed from activeOrders.
// "delivered" | "completed" — driver-initiated, normal completion (no alert).
// "cancelled" | "rejected" | "deleted" — external action (show cancellation alert).
export type RemovalReason = "delivered" | "completed" | "cancelled" | "rejected" | "deleted";

export type Txn = {
  id:       string;
  type:     "earning" | "withdraw" | "bonus" | "tip";
  title:    string;
  subtitle: string;
  amount:   number;
  status:   "completed" | "pending" | "failed";
  time:     string;
  date:     string;
};

const PLAN_DAYS:  Record<SubPlan, number> = { daily: 0.5, weekly: 7,   monthly: 30  };
const PLAN_PRICE: Record<SubPlan, number> = { daily: 3,  weekly: 19,  monthly: 100 };


type OnboardingRoute =
  | "/(tabs)"
  | "/vehicle-selection"
  | "/profile-setup"
  | "/document-upload"
  | "/onboarding-fee"
  | "/verification-pending"
  | "/background-setup";

type ConfirmOtpResult = {
  ok:              boolean;
  profileComplete: boolean;
  error?:          string;
  nextRoute?:      OnboardingRoute;
};

type DriverState = {
  driverUid:        string | null;
  authLoading:      boolean;
  // True ONLY after a successful confirmOtp() call in the current session.
  // A persisted Firebase session (onAuthStateChanged restore) does NOT set this.
  // _layout.tsx routes to /login whenever isOtpVerified is false, regardless of
  // whether driverUid is set — forcing every cold start through the OTP gate.
  isOtpVerified:    boolean;
  phone:            string | null;
  isAuthenticated:  boolean;
  profile:          Profile | null;
  vehicle:          Vehicle | null;
  verificationStatus: string | null;  // "pending" | "verified" | "rejected" | null
  documentsSubmitted: boolean;
  accountStatus:      string | null;  // "active" | "suspended" | "blocked" | null

  isOnline:         boolean;

  // ── Multi-order foundation (Phase 1/2: max 1 order; Phase 4 lifts cap) ──────
  activeOrders:          ActiveRide[];   // array of in-progress orders
  currentActiveOrderId:  string | null;  // which order the UI is focused on

  // Capacity model (Phase 3) — derived; never stored as separate state.
  maxActiveOrders:  number;   // = MAX_ACTIVE_ORDERS (3)
  activeOrderCount: number;   // = activeOrders.length
  hasCapacity:      boolean;  // activeOrderCount < MAX_ACTIVE_ORDERS
  isAtCapacity:     boolean;  // activeOrderCount >= MAX_ACTIVE_ORDERS

  // Backward-compat shims — derived from activeOrders/currentActiveOrderId.
  // Existing screens read these unchanged; remove when all consumers migrate.
  activeRide:     ActiveRide | null;   // activeOrders[focused] ?? activeOrders[0] ?? null
  currentOrderId: string     | null;   // currentActiveOrderId ?? activeRide?.id ?? null

  subscriptionPlan:      SubPlan | null;
  subscriptionExpiresAt: number  | null;
  subscriptionActive:    boolean;

  // Derived expiry states — prefer these over ad-hoc !subscriptionActive checks.
  planExpiredNoOrders:   boolean;  // plan was active, now expired, zero active orders
  planExpiredWithOrders: boolean;  // plan was active, now expired, ≥1 active order remains

  incomingRide:  IncomingRide | null;
  pendingRides:  IncomingRide[];   // ALL simultaneously-dispatched orders (slider source)
  rideHistory:   ActiveRide[];

  walletBalance:    number;
  lifetimeEarnings: number;
  todayEarnings:    number;
  tripsToday:       number;
  totalTrips:       number;
  transactions:     Txn[];

  setPhone:   (p: string) => void;
  confirmOtp: (phone: string, otp: string) => Promise<ConfirmOtpResult>;
  setProfile: (p: Profile) => void;
  setVehicle: (v: Vehicle) => void;
  signOut:    () => Promise<void>;

  setOnline:           (v: boolean) => { ok: boolean; reason?: string };
  activatePlan:        (id: SubPlan) => { ok: boolean; reason?: string };
  refreshSubscription: () => Promise<void>;

  // ── Wallet ──────────────────────────────────────────────────────────────
  // addEarningLocally:  optimistic update after delivery (before server confirms)
  // refreshWallet:      re-reads driver doc and syncs wallet fields from Firestore
  // applyWalletUpdate:  applies server-computed wallet values directly (no Firestore read)
  addEarningLocally:  (amount: number) => void;
  refreshWallet:      () => Promise<void>;
  applyWalletUpdate:  (balance: number, todayEarnings: number, tripsToday: number, todayDate: string) => void;

  acceptRide:  () => Promise<AcceptOrderResult>;
  rejectRide:  () => void;
  timeoutRide: () => void;  // timer expiry — does NOT blacklist driver (may receive order again)
  // Injects an IncomingRide fetched from outside the Firestore listener —
  // used by ride-request.tsx when the app was backgrounded/killed and the
  // Firestore listener didn't fire before the screen opened.
  recoverIncomingRide: (ride: IncomingRide) => void;
  // Removes one specific order from activeOrders by ID.
  // If the removed order was focused, focus shifts to the next remaining order
  // (or null when the last order is removed).  Replaces the Phase-3 endActiveRide()
  // full-wipe so completing Order A leaves Order B intact.
  endRide: (orderId: string) => void;
  // Sets currentActiveOrderId to the given orderId, but only if that order
  // currently exists in activeOrders.  Used by Command Center slot chips and
  // secondary order cards to shift the "focused" card without mutating the array.
  focusOrder: (orderId: string) => void;

  // Per-order removal reasons, keyed by orderId.
  // Set by the listener registry when an order reaches a terminal Firestore status.
  // Consumers (e.g. active-delivery) look up their own orderId to determine whether
  // to show a cancellation alert, guaranteeing Order A's cancellation never triggers
  // a false alert on the active-delivery screen for Order B.
  orderRemovalReasons: Record<string, RemovalReason>;

  requestWithdrawal: (amount: number, upiId: string) => Promise<{ ok: boolean; reason?: string }>;

  backgroundSetupShown:     boolean;
  permissionSetupVersion:   number;   // version of setup flow completed; 0 = never done
  markBackgroundSetupShown: () => Promise<void>;

  // ── Onboarding fee ────────────────────────────────────────────────────────
  // onboardingFeeApplies is ONLY true for brand-new signup drivers.
  // Absent on existing drivers — they are never routed to the fee screen.
  onboardingFeeApplies:         boolean;
  onboardingFeeStatus:          string | null;   // "pending" | "paid" | null
  onboardingFeeAmount:          number | null;   // INR from config at signup time
  // Called by onboarding-fee.tsx after the server has verified Razorpay payment
  // and written onboardingFeeStatus="paid" to Firestore. Updates local state only.
  markOnboardingFeePaidLocally: () => void;

  overlayPermissionGranted: boolean;
  requestOverlayPermission: () => Promise<{ ok: boolean; reason?: string }>;
  setOverlayPermission: (v: boolean) => void;
};

const DriverContext = createContext<DriverState | null>(null);

export function useDriver() {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error("useDriver must be used within DriverProvider");
  return ctx;
}

// ─── Map Firestore OrderDoc → IncomingRide ────────────────────────────────────
//
// Helper: return s if it is a non-empty string, else "".
// Safe against undefined/null coming from Firestore fields not in the TypeScript
// type (e.g. customer app writing pickupAddress instead of pickup at runtime).
function strField(s: unknown): string {
  return typeof s === "string" && s.trim().length > 0 ? s.trim() : "";
}
// Helper: return n if it is a finite number, else undefined.
function numField(n: unknown): number | undefined {
  return typeof n === "number" && isFinite(n) ? n : undefined;
}

function orderDocToRide(order: OrderDoc): IncomingRide {
  // Address fallbacks: customer app may write pickupAddress / deliveryAddress /
  // dropAddress alongside (or instead of) the canonical pickup / drop fields.
  const pickup = strField(order.pickup) || strField(order.pickupAddress);
  const drop   = strField(order.drop)   || strField(order.deliveryAddress) || strField(order.dropAddress);

  // Fare fallbacks: customer app may use totalAmount, price, amount, or deliveryFee
  // instead of (or in addition to) fareEstimate.
  const fareEstimate =
    numField(order.fareEstimate) ??
    numField(order.totalAmount)  ??
    numField(order.price)        ??
    numField(order.amount)       ??
    numField(order.deliveryFee)  ??
    0;

  return {
    id:               order.id,
    pickup,
    pickupSub:        order.pickupSub         ?? "",
    pickupCity:       order.pickupCity,
    drop,
    dropSub:          order.dropSub           ?? "",
    dropCity:         order.dropCity,
    distanceKm:       order.distanceKm        ?? 0,
    pickupDistanceKm: order.pickupDistanceKm  ?? 0,
    durationMin:      order.durationMin       ?? 0,
    fareEstimate,
    paymentMode:      order.paymentMode,
    surge:            order.surge             ?? false,
    surgeMultiplier:  order.surgeMultiplier   ?? 1,
    passengerName:    order.customerName    ?? "Customer",
    customerPhone:    order.customerPhone   ?? "",
    passengerRating:  order.customerRating  ?? 5,
    parcelType:       order.parcelType      ?? "Parcel",
    parcelEmoji:      order.parcelEmoji     ?? "📦",
    parcelWeight:     order.parcelWeight    ?? "Package",
  };
}

// ─── Stale dispatch guard ─────────────────────────────────────────────────────
// Dispatched orders older than STALE_DISPATCH_MS are ignored by the driver
// listener so that abandoned test/dev documents do not produce popup rides.
// 10 min: real-world drivers may take several minutes to come online after a
// customer places an order; 2 min was too short and silently dropped live orders.
const STALE_DISPATCH_MS = 10 * 60 * 1000; // 10 minutes

function tsToMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") return ts;
  if (typeof (ts as { toMillis?: unknown }).toMillis === "function") {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (ts instanceof Date) return ts.getTime();
  return null;
}

function isStaleDispatch(order: OrderDoc): boolean {
  const now = Date.now();
  // 1. dispatchedAt — written by round-robin dispatcher at assignment time.
  const dispMs = tsToMillis(order.dispatchedAt);
  if (dispMs !== null) return now - dispMs > STALE_DISPATCH_MS;
  // 2. dispatchTimeoutAt — if the window has already elapsed the order is stale.
  const timeoutMs = tsToMillis(order.dispatchTimeoutAt);
  if (timeoutMs !== null) return timeoutMs < now;
  // 3. fcmDispatchedAt — written by FCM dispatcher; present on customer-app
  //    direct-dispatch orders that never go through round-robin.
  const fcmMs = tsToMillis((order as unknown as Record<string, unknown>)["fcmDispatchedAt"]);
  if (fcmMs !== null) return now - fcmMs > STALE_DISPATCH_MS;
  // 4. createdAt — universal fallback; customer app always writes this.
  const createdMs = tsToMillis((order as unknown as Record<string, unknown>)["createdAt"]);
  if (createdMs !== null) return now - createdMs > STALE_DISPATCH_MS;
  // 5. No timestamp at all — cannot determine age; treat as fresh so a real
  //    customer order is never silently dropped.
  return false;
}

// ─── Capacity model ───────────────────────────────────────────────────────────
// MAX_ACTIVE_ORDERS is the maximum number of simultaneously accepted orders a
// driver may hold.  Phase 3 keeps single-order behaviour by gating dispatch at
// activeOrderCount > 0; Phase 4 will relax the gate to isAtCapacity.
const MAX_ACTIVE_ORDERS = 3;

// ─── Terminal status classification (module scope — no closure needed) ────────
// Used by the Phase 2 listener registry to decide when to free an order slot.
const ORDER_TERMINAL = new Set<OrderStatus>(["delivered", "rejected"]);
const ORDER_CANCEL_VARIANTS = new Set([
  "cancelled", "canceled", "customer_cancelled", "order_cancelled",
]);
function isOrderTerminal(status: OrderStatus | null): boolean {
  return (
    status === null ||
    ORDER_TERMINAL.has(status) ||
    ORDER_CANCEL_VARIANTS.has(status as string)
  );
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const [driverUid,     setDriverUid]     = useState<string | null>(null);
  const [authLoading,   setAuthLoading]   = useState(true);
  // isOtpVerified: only set true by confirmOtp(); never by onAuthStateChanged.
  // Resets to false on signOut() and on every cold start (React state default).
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [phone,         setPhoneState]    = useState<string | null>(null);
  const [profile,     setProfileState]= useState<Profile | null>(null);
  const [vehicle,     setVehicleState]= useState<Vehicle | null>(null);
  const [verificationStatus, setVerifStatus]  = useState<string | null>(null);
  const [documentsSubmitted, setDocsSubmitted] = useState<boolean>(false);

  const [isOnline,       setOnlineState]    = useState(false);
  const [accountStatus,  setAccountStatus]  = useState<string | null>(null);

  // ── Multi-order foundation ─────────────────────────────────────────────────
  // Phase 1: always contains at most 1 order.  Phase 3+ lifts the cap.
  const [activeOrders,         setActiveOrders]         = useState<ActiveRide[]>([]);
  const [currentActiveOrderId, setCurrentActiveOrderId] = useState<string | null>(null);
  // Per-order removal reasons — keyed by orderId, set when a listener fires a
  // terminal status.  Never reset during the session so active-delivery screens
  // that briefly re-render after dismissal still read the correct reason.
  const [orderRemovalReasons, setOrderRemovalReasons] =
    useState<Record<string, RemovalReason>>({});

  // ── Capacity model — derived each render, no extra state ────────────────────
  const activeOrderCount: number  = activeOrders.length;
  const hasCapacity:      boolean = activeOrderCount < MAX_ACTIVE_ORDERS;
  const isAtCapacity:     boolean = activeOrderCount >= MAX_ACTIVE_ORDERS;

  // Derived backward-compat shims — no extra state; computed each render.
  const activeRide: ActiveRide | null =
    activeOrders.find((o) => o.id === currentActiveOrderId) ?? activeOrders[0] ?? null;
  const currentOrderId: string | null =
    currentActiveOrderId ?? activeRide?.id ?? null;

  const [subscriptionPlan,      setSubPlan] = useState<SubPlan | null>(null);
  const [subscriptionExpiresAt, setSubExp]  = useState<number | null>(null);
  const [nowTick,               setNowTick] = useState(() => Date.now());

  const [incomingRide,  setIncomingRide] = useState<IncomingRide | null>(null);
  const [pendingRides,  setPendingRides] = useState<IncomingRide[]>([]);
  const [rideHistory,   setHistory]     = useState<ActiveRide[]>([]);

  const [walletBalance,     setBalance]          = useState(0);
  const [lifetimeEarnings,  setLifetimeEarnings] = useState(0);
  const [todayEarnings,     setTodayEarnings]    = useState(0);
  const [tripsToday,        setTripsToday]        = useState(0);
  const [transactions,      setTxns]              = useState<Txn[]>([]);
  const [driverRating,   setDriverRating] = useState<number | string>("5.0");
  const [driverTrips,    setDriverTrips]  = useState<number>(0);

  const [overlayPermissionGranted,  setOverlayPermissionGranted]  = useState(false);
  const [backgroundSetupShown,      setBackgroundSetupShown]      = useState(false);
  const [permissionSetupVersion,    setPermissionSetupVersion]    = useState(0);
  const [onboardingFeeApplies,      setOnboardingFeeApplies]      = useState(false);
  const [onboardingFeeStatus,       setOnboardingFeeStatus]       = useState<string | null>(null);
  const [onboardingFeeAmount,       setOnboardingFeeAmount]       = useState<number | null>(null);

  const isAuthenticated = !!driverUid;

  // Refs used by notification action handlers (registered once, no stale closure)
  const incomingRideRef      = useRef<IncomingRide | null>(null);
  const driverUidRef         = useRef<string | null>(null);
  // GPS location interval — cleared on go-offline and on sign-out
  const locationIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileRef      = useRef<Profile | null>(null);
  const driverRatingRef = useRef<number | string>("5.0");
  const driverTripsRef  = useRef<number>(0);
  useEffect(() => { incomingRideRef.current  = incomingRide;   }, [incomingRide]);
  useEffect(() => { driverUidRef.current     = driverUid;      }, [driverUid]);
  useEffect(() => { profileRef.current       = profile;        }, [profile]);
  useEffect(() => { driverRatingRef.current  = driverRating;   }, [driverRating]);
  useEffect(() => { driverTripsRef.current   = driverTrips;    }, [driverTrips]);

  // ─── Firebase Auth listener — restores session on app restart ──────────────
  //
  // CRITICAL BOOT PATH — keep this fast:
  //
  // setAuthLoading(false) is called immediately after the auth state is known
  // (uid present or null), BEFORE any Firestore reads. This ensures the login
  // screen appears in ~1-2 s regardless of network conditions.
  //
  // Previously setAuthLoading(false) was called AFTER getDriverDoc() AND
  // getActiveOrdersForDriver(), which could take 10-30 s or hang forever on a
  // slow/offline connection, leaving the auth overlay spinning indefinitely.
  //
  // Under the OTP-gated auth policy, session-restore Firestore data is not
  // needed for routing — the user is always sent to /login, and confirmOtp()
  // re-reads a fresh driver doc after the OTP succeeds. The background hydration
  // below is kept so that state is pre-populated for the post-OTP dashboard
  // (avoids a visible re-fetch after confirmOtp).
  useEffect(() => {
    // Cold-start diagnostics — logged once when DriverProvider mounts.
    console.log("[AUTH_COLD_START] app opened");
    console.log("[AUTH_COLD_START] firebase currentUser immediate =", firebaseAuth.currentUser?.uid ?? null);
    void AsyncStorage.getItem(SESSION_VERIFIED_KEY).then((uid) =>
      console.log("[AUTH_COLD_START] storedVerifiedUid =", uid ?? "(none)"),
    );

    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      console.log("[AUTH_STATE] onAuthStateChanged uid =", user?.uid ?? null);
      console.log("[AUTH_STATE] no user =", !user);

      if (!user) {
        setDriverUid(null);
        setAuthLoading(false);
        return;
      }

      // Set auth identity synchronously.
      setDriverUid(user.uid);
      console.log("AUTH UID =", firebaseAuth.currentUser?.uid);
      console.log("DRIVER UID =", user.uid);
      const phoneFromUid = user.uid.startsWith("91") ? user.uid.slice(2) : user.uid;
      setPhoneState(phoneFromUid);

      void (async () => {
        // ── 1. Session restore check ─────────────────────────────────────────
        // Determine whether this Firebase user has a previously OTP-verified
        // session stored in AsyncStorage from a prior login.
        let sessionValid = false;
        try {
          const storedUid = await AsyncStorage.getItem(SESSION_VERIFIED_KEY);
          console.log("[SESSION_RESTORE] firebaseUid =", user.uid);
          console.log("[SESSION_RESTORE] storedVerifiedUid =", storedUid);
          sessionValid = storedUid === user.uid;
          console.log("[SESSION_RESTORE] sessionValid =", sessionValid);
          if (sessionValid) {
            setIsOtpVerified(true);
          }
        } catch {
          // AsyncStorage read failed — falls back to OTP gate (safe default).
        }

        // ── 2. No-restore fast path ──────────────────────────────────────────
        // No saved session: unblock the layout immediately so the login screen
        // appears. Firestore reads below pre-populate state in the background.
        if (!sessionValid) {
          console.log("[AUTH_STATE] setAuthLoading false (no session restore)");
          setAuthLoading(false);
        }
        // Session restore path: keep authLoading=true (spinner overlay stays up)
        // while we fetch the driver doc and navigate to the correct screen. This
        // prevents any flash of the login screen between auth restore and
        // navigation. A 3.5 s doc-fetch timeout keeps us safely under the 5 s
        // safety timeout so the overlay never hangs indefinitely.

        // ── 3. Firestore hydration ───────────────────────────────────────────
        let driverDoc: DriverDoc | null = null;
        try {
          const docFetch = getDriverDoc(user.uid);
          driverDoc = sessionValid
            ? await Promise.race([
                docFetch,
                new Promise<null>((r) => setTimeout(() => r(null), 3500)),
              ])
            : await docFetch;

          if (driverDoc) {
            if (driverDoc.name) {
              setProfileState({
                name:          driverDoc.name          ?? "",
                city:          driverDoc.city          ?? "",
                gender:        driverDoc.gender        ?? "",
                licenseNumber: driverDoc.licenseNumber ?? "",
                vehicleNumber: driverDoc.vehicleNumber ?? "",
              });
            }
            if (driverDoc.vehicleId) {
              setVehicleState({ id: driverDoc.vehicleId, name: driverDoc.vehicleName ?? "" });
            }
            setAccountStatus(driverDoc.accountStatus ?? null);
            {
              const isSuspended =
                driverDoc.accountStatus === "suspended" ||
                driverDoc.accountStatus === "blocked";
              setOnlineState(isSuspended ? false : (driverDoc.isOnline ?? false));
            }
            if (driverDoc.subscriptionPlan)      setSubPlan(driverDoc.subscriptionPlan as SubPlan);
            if (driverDoc.subscriptionExpiresAt) setSubExp(driverDoc.subscriptionExpiresAt);
            {
              const today   = new Date().toISOString().slice(0, 10);
              const sameDay = driverDoc.todayDate === today;
              setBalance(driverDoc.walletBalance ?? 0);
              setLifetimeEarnings(driverDoc.lifetimeEarnings ?? 0);
              setTodayEarnings(sameDay ? (driverDoc.todayEarnings ?? 0) : 0);
              setTripsToday   (sameDay ? (driverDoc.tripsToday    ?? 0) : 0);
            }
            void loadDriverTransactions(user.uid);
            setVerifStatus(driverDoc.verificationStatus ?? null);
            setDocsSubmitted(driverDoc.documentsSubmitted ?? false);
            setBackgroundSetupShown(driverDoc.backgroundSetupShown ?? false);
            setPermissionSetupVersion(driverDoc.permissionSetupVersion ?? 0);
            setOnboardingFeeApplies(driverDoc.onboardingFeeApplies ?? false);
            setOnboardingFeeStatus(driverDoc.onboardingFeeStatus ?? null);
            setOnboardingFeeAmount(driverDoc.onboardingFeeAmount ?? null);
            setDriverRating(driverDoc.rating ?? "5.0");
            setDriverTrips(driverDoc.totalTrips ?? 0);
          }
          // Restore active orders (mid-delivery app restart).
          try {
            const activeOrderDocs = await getActiveOrdersForDriver(user.uid, MAX_ACTIVE_ORDERS);
            if (activeOrderDocs.length > 0) {
              const restoredRides: ActiveRide[] = activeOrderDocs.map((doc) => {
                const ride = orderDocToRide(doc);
                const acceptedAtMs =
                  (doc.acceptedAt as { toMillis?: () => number })?.toMillis?.() ??
                  Date.now();
                return { ...ride, acceptedAt: acceptedAtMs, orderStatus: doc.status };
              });
              setActiveOrders(restoredRides);
              setCurrentActiveOrderId(restoredRides[0]!.id);
            }
          } catch {
            // Active order restore failed — driver sees no active delivery after restart.
          }
        } catch (firestoreErr) {
          console.error("[Auth] background Firestore hydration failed:", firestoreErr);
        }

        // ── 4. Session restore navigation ────────────────────────────────────
        // Navigate to the correct screen BEFORE calling setAuthLoading(false).
        // This ensures the auth overlay disappears onto the dashboard (or the
        // correct onboarding step), never onto the login screen.
        if (sessionValid) {
          const nextRoute = driverDoc
            ? await deriveNextRoute(driverDoc)
            : "/(tabs)";
          console.log("[AUTH_ROUTE] chosenRoute =", nextRoute, "(session restore)");
          router.replace(nextRoute as never);
          console.log("[AUTH_STATE] setAuthLoading false (session restore)");
          setAuthLoading(false);
        }

        // Register FCM push token — fire-and-forget.
        registerDriverPushToken(user.uid).catch(console.error);
      })();
    });
    return unsub;
  }, []);

  // ─── Auth-loading safety timeout ──────────────────────────────────────────
  // Hard guarantee: if onAuthStateChanged does not fire within 5 seconds
  // (cold Firebase init, network down, Expo Go quirks on real device),
  // force authLoading=false so the login screen always appears.
  // setAuthLoading functional form lets us log ONLY when the timeout
  // actually fires (i.e. auth state had not already resolved).
  useEffect(() => {
    const tid = setTimeout(() => {
      setAuthLoading((prev) => {
        if (prev) {
          console.log("[AUTH_TIMEOUT_FALLBACK] fired — forcing authLoading=false after 5s");
        }
        return false;
      });
    }, 5000);
    return () => clearTimeout(tid);
  }, []);

  // ─── FCM token refresh on foreground ──────────────────────────────────────
  // Re-registers the FCM token whenever the app returns to the foreground.
  // Uses driverUidRef (kept in sync above) so the listener is registered once
  // and never needs to be torn down and re-created as driverUid changes.
  // This handles the case where the token stored in Firestore has been
  // invalidated (app reinstall, data clear, token rotation) without requiring
  // the driver to log out and back in.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && driverUidRef.current) {
        registerDriverPushToken(driverUidRef.current).catch(console.error);
      }
    });
    return () => sub.remove();
  }, []);

  // ─── Subscription heartbeat ────────────────────────────────────────────────
  useEffect(() => {
    if (!subscriptionExpiresAt) return;
    const msUntilExpiry = subscriptionExpiresAt - Date.now();
    if (msUntilExpiry <= 0) { setNowTick(Date.now()); return; }
    const t = setTimeout(() => setNowTick(Date.now()), msUntilExpiry + 50);
    return () => clearTimeout(t);
  }, [subscriptionExpiresAt]);

  // ─── Auto-offline on subscription expiry ──────────────────────────────────
  const subscriptionActive    = !!(subscriptionExpiresAt && subscriptionExpiresAt > nowTick);
  const planExpiredNoOrders   = !!subscriptionPlan && !subscriptionActive && activeOrders.length === 0;
  const planExpiredWithOrders = !!subscriptionPlan && !subscriptionActive && activeOrders.length > 0;

  // Force offline when plan expires with no active orders (Rule 3), or when
  // the last active order completes after expiry (Rule 5 — activeOrders.length
  // drops to 0, this effect re-fires and sets the driver offline).
  useEffect(() => {
    if (!subscriptionActive && isOnline && activeOrders.length === 0) {
      setOnlineState(false);
      if (driverUid) {
        updateDriverOnlineStatus(driverUid, false).catch(console.error);
      }
    }
  }, [subscriptionActive, isOnline, activeOrders.length]);

  // ─── Firestore dispatched-order listener (single channel) ────────────────
  // Replaces two previous effects that each ran the identical query:
  //   driverUid == uid AND status == "dispatched"
  // Running both simultaneously caused 2× Firestore reads per snapshot event.
  //
  // One listenToAllDispatchedOrders subscription now serves both purposes:
  //   • pendingRides  — full orders array for the multi-card slider (was L2)
  //   • incomingRide  — first order + notification + navigation (was L1)
  //
  // Guard conditions and dedup logic are identical to the originals.
  const lastSeenOrderId = useRef<string | null>(null);
  useEffect(() => {
    // ── Log 1: effect entry ───────────────────────────────────────────────────
    console.log("[DriverOfferListener] effect", {
      isOnline,
      driverUid,
      isAtCapacity,
      subscriptionActive,
    });

    if (!isOnline || !driverUid || isAtCapacity || !subscriptionActive) {
      const reason =
        !isOnline          ? "offline" :
        !driverUid         ? "no uid" :
        isAtCapacity       ? "at capacity" :
                             "subscription inactive";
      console.log("[DriverOfferListener] guard blocked —", reason);
      setPendingRides([]);
      return;
    }

    // ── Log 2: subscription created ──────────────────────────────────────────
    console.log("[DriverOfferListener] subscribed uid=", driverUid);

    const unsub = listenToAllDispatchedOrders(driverUid, (orders) => {
      // ── Log 3: snapshot received ──────────────────────────────────────────
      console.log("[DriverOfferListener] snapshot size=", orders.length);
      orders.forEach((o) => {
        const raw = o as unknown as Record<string, unknown>;
        console.log("[DriverOfferListener] order", {
          orderId:              o.id,
          status:               o.status,
          activeOfferDriverUids: o.activeOfferDriverUids ?? null,
          driverUid:            o.driverUid ?? null,
        });
        // ── Legacy dispatch debug (keep for backward compat with existing log searches)
        console.log("[DispatchDebug] orderId:", o.id, JSON.stringify({
          status:            o.status,
          driverUid:         o.driverUid,
          fareEstimate:      (raw["fareEstimate"]   ?? raw["totalAmount"] ?? raw["price"] ?? raw["amount"] ?? raw["deliveryFee"] ?? null),
          pickup:            (raw["pickup"]         ?? raw["pickupAddress"]   ?? null),
          drop:              (raw["drop"]           ?? raw["deliveryAddress"] ?? raw["dropAddress"] ?? null),
          dispatchedAt:      (raw["dispatchedAt"]   ?? null),
          dispatchTimeoutAt: (raw["dispatchTimeoutAt"] ?? null),
          fcmDispatchedAt:   (raw["fcmDispatchedAt"] ?? null),
          createdAt:         (raw["createdAt"]      ?? null),
          isStale:           isStaleDispatch(o),
        }));
      });

      // ── Stale-order filter ────────────────────────────────────────────────
      // Drop any dispatched doc older than STALE_DISPATCH_MS so abandoned
      // test/dev orders never surface as ride popups.
      const freshOrders = orders.filter((o) => {
        if (isStaleDispatch(o)) {
          console.warn("[Dispatch] Ignoring stale dispatched order:", o.id);
          return false;
        }
        return true;
      });

      // ── L2 purpose: keep multi-card slider in sync ───────────────────────
      setPendingRides(freshOrders.map(orderDocToRide));

      // ── L1 purpose: surface first incoming ride + notify ─────────────────
      const first = freshOrders[0] ?? null;

      if (!first) {
        // Firestore query returned empty — the customer app may have removed
        // this driver from activeOfferDriverUids before the driver's 15-second
        // local timer completed (customer-side offer window is shorter).
        //
        // Only clear incomingRide when no offer is actively being shown
        // (lastSeenOrderId is null).  If an offer IS being shown, leave
        // incomingRide intact and let the driver-side timer (timeoutRide at
        // seconds=0), an explicit reject, or an accept handle dismissal.
        // This prevents the customer-app removal from racing ahead of the
        // driver's countdown and causing early screen dismissal.
        if (!lastSeenOrderId.current) {
          setIncomingRide(null);
        }
        return;
      }

      // Avoid re-triggering for an order already being shown
      if (first.id === lastSeenOrderId.current) return;
      lastSeenOrderId.current = first.id;

      console.log("[FCM] notification received from Firestore orderId:", first.id);

      const ride = orderDocToRide(first);
      setIncomingRide(ride);

      sendIncomingOrderNotification({
        orderId:    ride.id,
        customer:   ride.passengerName,
        pickup:     ride.pickup,
        drop:       ride.drop,
        earning:    ride.fareEstimate,
        distanceKm: ride.distanceKm,
      }).catch(console.error);

      router.push("/ride-request");
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, driverUid, isAtCapacity, subscriptionActive]);

  // ─── Auth actions ─────────────────────────────────────────────────────────
  const setPhone = (p: string) => setPhoneState(p);

  /**
   * Derive the correct next screen based on the driver's onboarding state.
   * Called ONLY from confirmOtp() after a successful OTP verification.
   *
   * Priority order:
   *   1. No vehicleId              → pick a vehicle
   *   2. No name                   → complete profile
   *   3. Docs not submitted        → upload documents
   *   4. Fee applies and unpaid    → onboarding fee
   *   5. Not yet approved          → await verification
   *   6. Approved + perms missing  → background-setup (native only)
   *   7. Approved + perms ok       → main app
   */
  async function deriveNextRoute(d: DriverDoc): Promise<OnboardingRoute> {
    if (!d.vehicleId) return "/vehicle-selection";
    if (!d.name)      return "/profile-setup";

    // Approved/verified drivers skip document, fee, and verification-pending checks.
    const isApproved =
      d.verificationStatus === "approved" || d.verificationStatus === "verified";
    if (!isApproved) {
      if (!d.documentsSubmitted) return "/document-upload";
      // Fee screen: only when onboardingFeeApplies is explicitly true (brand-new signup).
      if (d.onboardingFeeApplies === true && d.onboardingFeeStatus !== "paid") {
        return "/onboarding-fee";
      }
      return "/verification-pending";
    }

    // Approved — check real-time permissions on native.
    // Web preview skips hardware permission checks entirely.
    if (Platform.OS !== "web") {
      const setupVersionOk = (d.permissionSetupVersion ?? 0) >= PERMISSION_SETUP_VERSION;
      if (!setupVersionOk) return "/background-setup";
      const [notifOk, locStatus] = await Promise.all([
        checkNotificationPermissions().catch(() => false),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      ]);
      const permsGranted = notifOk && locStatus.granted;
      if (!permsGranted) return "/background-setup";
    } else {
      if ((d.permissionSetupVersion ?? 0) < PERMISSION_SETUP_VERSION) return "/background-setup";
    }
    return "/(tabs)";
  }

  const confirmOtp = async (
    phone: string,
    otp:   string,
  ): Promise<ConfirmOtpResult> => {
    const apiResult = await verifyOtpApi(phone, otp);
    if (!apiResult.ok) return { ok: false, profileComplete: false, error: apiResult.error };

    try {
      const credential = await signInWithCustomToken(firebaseAuth, apiResult.token);
      const uid        = credential.user.uid;
      setDriverUid(uid);
      setPhoneState(phone);

      let driverDoc = await getDriverDoc(uid);
      if (!driverDoc) {
        // Brand-new driver: fetch onboarding fee config, stamp onto new driver doc.
        const feeConfig = await getOnboardingFeeConfig();
        driverDoc = await createDriverDoc(uid, phone, feeConfig);
        // Update local state for the fee fields stamped on the new doc.
        if (feeConfig.enabled) {
          setOnboardingFeeApplies(true);
          setOnboardingFeeStatus("pending");
          setOnboardingFeeAmount(feeConfig.amount);
        }
      } else {
        if (driverDoc.name) {
          setProfileState({
            name:   driverDoc.name   ?? "",
            city:   driverDoc.city   ?? "",
            gender: driverDoc.gender ?? "",
          });
        }
        if (driverDoc.vehicleId) {
          setVehicleState({ id: driverDoc.vehicleId, name: driverDoc.vehicleName ?? "" });
        }
        // Restore online status — suspended/blocked drivers are forced offline.
        setAccountStatus(driverDoc.accountStatus ?? null);
        {
          const isSuspended =
            driverDoc.accountStatus === "suspended" ||
            driverDoc.accountStatus === "blocked";
          setOnlineState(isSuspended ? false : (driverDoc.isOnline ?? false));
        }
        if (driverDoc.subscriptionPlan)      setSubPlan(driverDoc.subscriptionPlan as SubPlan);
        if (driverDoc.subscriptionExpiresAt) setSubExp(driverDoc.subscriptionExpiresAt);
        // Restore wallet
        {
          const today   = new Date().toISOString().slice(0, 10);
          const sameDay = driverDoc.todayDate === today;
          setBalance(driverDoc.walletBalance ?? 0);
          setLifetimeEarnings(driverDoc.lifetimeEarnings ?? 0);
          setTodayEarnings(sameDay ? (driverDoc.todayEarnings ?? 0) : 0);
          setTripsToday   (sameDay ? (driverDoc.tripsToday    ?? 0) : 0);
        }
        void loadDriverTransactions(uid);
        // Restore verification/document state (needed for routing below)
        setVerifStatus(driverDoc.verificationStatus ?? null);
        setDocsSubmitted(driverDoc.documentsSubmitted ?? false);
        setBackgroundSetupShown(driverDoc.backgroundSetupShown ?? false);
        setPermissionSetupVersion(driverDoc.permissionSetupVersion ?? 0);
        // Restore onboarding fee state — absent on existing/old drivers (defaults to false/null).
        setOnboardingFeeApplies(driverDoc.onboardingFeeApplies ?? false);
        setOnboardingFeeStatus(driverDoc.onboardingFeeStatus ?? null);
        setOnboardingFeeAmount(driverDoc.onboardingFeeAmount ?? null);
        setDriverRating(driverDoc.rating ?? "5.0");
        setDriverTrips(driverDoc.totalTrips ?? 0);
      }

      const profileComplete = !!(driverDoc.name && driverDoc.vehicleId);
      const nextRoute       = await deriveNextRoute(driverDoc);

      // ── OTP_ROUTE logs — required by auth policy ──────────────────────────
      console.log("[OTP_ROUTE] otp_success_uid =", uid);
      console.log("[OTP_ROUTE] driver_doc =", JSON.stringify({
        vehicleId:          driverDoc.vehicleId          ?? null,
        name:               driverDoc.name               ?? null,
        documentsSubmitted: driverDoc.documentsSubmitted ?? false,
        verificationStatus: driverDoc.verificationStatus ?? null,
        onboardingFeeStatus: driverDoc.onboardingFeeStatus ?? null,
        permissionSetupVersion: driverDoc.permissionSetupVersion ?? 0,
      }));
      console.log("[OTP_ROUTE] chosenRoute =", nextRoute);

      // Mark OTP as verified — this is the ONLY place this flag is set true.
      // _layout.tsx reads it to decide whether to gate on /login or allow the
      // post-OTP route chosen above.
      setIsOtpVerified(true);
      // Persist the verified uid so session survives app backgrounding / cold start.
      try {
        await AsyncStorage.setItem(SESSION_VERIFIED_KEY, uid);
        console.log("[OTP_SESSION] saved uid =", uid);
      } catch {
        // Non-fatal — next cold start will require re-OTP.
      }

      return { ok: true, profileComplete, nextRoute };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      return { ok: false, profileComplete: false, error: msg };
    }
  };

  const setProfile = (p: Profile) => {
    setProfileState(p);
    if (driverUid) updateDriverProfile(driverUid, p).catch(console.error);
  };

  const setVehicle = (v: Vehicle) => {
    setVehicleState(v);
    if (driverUid) updateDriverVehicle(driverUid, v).catch(console.error);
  };

  const markBackgroundSetupShown = async (): Promise<void> => {
    setBackgroundSetupShown(true);
    setPermissionSetupVersion(PERMISSION_SETUP_VERSION);
    if (driverUid) {
      await updateDriverBackgroundSetup(driverUid);
    }
  };

  // Updates local state only. Server has already written onboardingFeeStatus="paid"
  // to Firestore during the verify-payment API call. No client-side Firestore write needed.
  const markOnboardingFeePaidLocally = (): void => {
    setOnboardingFeeStatus("paid");
  };

  const signOut = async (): Promise<void> => {
    if (driverUid) {
      // Await so the offline status is written before the Firebase session is
      // cleared. Best-effort — logout continues even if the write fails.
      try {
        await updateDriverOnlineStatus(driverUid, false);
      } catch {
        // intentionally ignored
      }
    }
    // Clear the persisted OTP session BEFORE Firebase sign-out so a crash
    // between the two calls cannot leave the session key behind.
    try {
      await AsyncStorage.removeItem(SESSION_VERIFIED_KEY);
      console.log("[SIGNOUT_SESSION] cleared");
    } catch {
      // Non-fatal — Firebase session is cleared below regardless.
    }
    try {
      await firebaseSignOut(firebaseAuth);
    } catch (err) {
      console.error("[Auth] firebaseSignOut failed:", err);
      // Continue with local state cleanup regardless — the driver is logged
      // out from the app's perspective even if the remote call failed.
    }

    // Stop GPS tracking before clearing state
    if (locationIntervalRef.current !== null) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
      console.log("[GPS_STATUS] tracking stopped (sign-out)");
    }

    // Explicitly drain the listener map before clearing state so no Firestore
    // callbacks can fire after sign-out and attempt to update unmounted state.
    for (const unsub of activeOrderListenersRef.current.values()) {
      unsub();
    }
    activeOrderListenersRef.current.clear();

    setDriverUid(null);
    setIsOtpVerified(false);   // ← reset OTP gate so next cold start forces /login
    setPhoneState(null);
    setProfileState(null);
    setVehicleState(null);
    setOnlineState(false);
    setActiveOrders([]);
    setCurrentActiveOrderId(null);
    setIncomingRide(null);
    setHistory([]);
    setSubPlan(null);
    setSubExp(null);
    setBalance(0);
    setTodayEarnings(0);
    setTripsToday(0);
    setTxns([]);
    setVerifStatus(null);
    setAccountStatus(null);
    setDocsSubmitted(false);
    setBackgroundSetupShown(false);
    setPermissionSetupVersion(0);
    setOnboardingFeeApplies(false);
    setOnboardingFeeStatus(null);
    setOnboardingFeeAmount(null);
    lastSeenOrderId.current = null;
  };

  // ─── Online / subscription ────────────────────────────────────────────────

  // Polls GPS and uploads to the server. Uses refs to avoid stale closures
  // inside the setInterval callback (registered once per go-online call).
  const pollLocationAndUpload = async (): Promise<void> => {
    const uid = driverUidRef.current;
    if (!uid) return;
    console.log("[GPS_STATUS] polling uid=", uid);
    let loc: Location.LocationObject;
    try {
      loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    } catch (err) {
      console.log("[GPS_UPLOAD_FAIL] getCurrentPositionAsync error:", err instanceof Error ? err.message : String(err));
      return;
    }
    const { latitude, longitude, accuracy } = loc.coords;
    try {
      const result = await postDriverLocation(uid, {
        latitude,
        longitude,
        isOnline: true,
        accuracy: accuracy ?? undefined,
      });
      if (result.ok) {
        console.log("[GPS_UPLOAD_OK] lat=", latitude, "lon=", longitude, "acc=", accuracy);
      } else {
        console.log("[GPS_UPLOAD_FAIL] server returned ok:false");
      }
    } catch (err) {
      console.log("[GPS_UPLOAD_FAIL] fetch error:", err instanceof Error ? err.message : String(err));
    }
  };

  const setOnline: DriverState["setOnline"] = (v) => {
    if (v && (accountStatus === "suspended" || accountStatus === "blocked")) {
      return { ok: false, reason: "Your account has been suspended. Please contact support." };
    }
    if (v && !subscriptionActive) {
      return { ok: false, reason: "Your subscription has expired. Activate a plan to go online." };
    }
    setOnlineState(v);
    if (driverUid) {
      updateDriverOnlineStatus(driverUid, v).catch(console.error);
      patchDriverStatus(driverUid, v).catch(console.error);
    }
    if (v) {
      // Going online — clear any stale interval, then start fresh GPS tracking
      if (locationIntervalRef.current !== null) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
      console.log("[GPS_STATUS] tracking started");
      void pollLocationAndUpload();
      locationIntervalRef.current = setInterval(() => {
        void pollLocationAndUpload();
      }, 15_000);
    } else {
      // Going offline — stop GPS tracking and clear pending ride
      if (locationIntervalRef.current !== null) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
        console.log("[GPS_STATUS] tracking stopped");
      }
      setIncomingRide(null);
      lastSeenOrderId.current = null;
    }
    return { ok: true };
  };

  const activatePlan: DriverState["activatePlan"] = (id) => {
    const price = PLAN_PRICE[id];
    if (walletBalance < price) {
      return { ok: false, reason: "Insufficient wallet balance for this plan." };
    }
    const expiresAt = Date.now() + PLAN_DAYS[id] * 24 * 60 * 60 * 1000;
    setSubPlan(id);
    setSubExp(expiresAt);
    setBalance((b) => b - price);
    setTxns((t) => [
      {
        id:       `tx${Date.now()}`,
        type:     "withdraw",
        title:    `${id.charAt(0).toUpperCase() + id.slice(1)} Driver Plan`,
        subtitle: "Plan activation",
        amount:   -price,
        status:   "completed",
        time:     new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        date:     "Today",
      },
      ...t,
    ]);
    if (driverUid) {
      updateDriverSubscription(driverUid, id, expiresAt).catch(console.error);
    }
    return { ok: true };
  };

  const refreshSubscription = async (): Promise<void> => {
    if (!driverUid) return;
    try {
      const doc = await getDriverDoc(driverUid);
      if (!doc) return;
      if (doc.subscriptionPlan)      setSubPlan(doc.subscriptionPlan as SubPlan);
      if (doc.subscriptionExpiresAt) setSubExp(doc.subscriptionExpiresAt);
    } catch {
      // silent — stale state is preferable to an uncaught error
    }
  };

  // ── Wallet helpers ─────────────────────────────────────────────────────────

  /**
   * Optimistic local credit — called immediately after delivery so the
   * dashboard reflects the new balance before the Firestore write confirms.
   */
  const addEarningLocally = (amount: number): void => {
    setBalance((b) => b + amount);
    setTodayEarnings((e) => e + amount);
    setTripsToday((t) => t + 1);
  };

  /**
   * Reconcile local wallet state with Firestore (called after the server
   * transaction confirms).  Silently no-ops on network errors.
   */
  const refreshWallet = async (): Promise<void> => {
    if (!driverUid) return;
    try {
      const d = await getDriverDoc(driverUid);
      if (!d) return;
      const today   = new Date().toISOString().slice(0, 10);
      const sameDay = d.todayDate === today;
      setBalance(d.walletBalance ?? 0);
      setLifetimeEarnings(d.lifetimeEarnings ?? 0);
      setTodayEarnings(sameDay ? (d.todayEarnings ?? 0) : 0);
      setTripsToday   (sameDay ? (d.tripsToday    ?? 0) : 0);
    } catch {
      // silent — optimistic values remain until next successful refresh
    }
  };

  /**
   * Load the driver's transaction ledger from Firestore and map to Txn shape.
   *
   * Called on auth, after OTP login, and after each withdrawal — ensures the
   * wallet screen always shows real data with no fake seeds.
   *
   * Token mapping:  Firestore "withdrawal" → Txn "withdraw"  (type normalised here)
   *                 Firestore amount is already negative for debits
   */
  const loadDriverTransactions = async (uid: string): Promise<void> => {
    try {
      const raw      = await getDriverTransactions(uid);
      const todayStr = new Date().toISOString().slice(0, 10);
      const yestStr  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const fmtDate = (d: Date): string => {
        const s = d.toISOString().slice(0, 10);
        if (s === todayStr) return "Today";
        if (s === yestStr)  return "Yesterday";
        return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      };
      const fmtTime = (d: Date): string =>
        d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();

      const txns: Txn[] = raw.map((r) => {
        const ts      = r.createdAt as { toDate?: () => Date } | null;
        const dt      = ts?.toDate?.();
        const txnDate = dt ? fmtDate(dt) : "";
        const txnTime = dt ? fmtTime(dt) : "";

        if (r.type === "earning") {
          return {
            id:       r.id,
            type:     "earning" as const,
            title:    r.orderId
              ? `Delivery #${(r.orderId as string).slice(-6).toUpperCase()}`
              : "Delivery earning",
            subtitle: (r.paymentMode as string | undefined) ?? "UPI",
            amount:   r.amount as number,
            status:   "completed" as const,
            time:     txnTime,
            date:     txnDate,
          };
        }
        if (r.type === "withdrawal") {
          return {
            id:       r.id,
            type:     "withdraw" as const,
            title:    "Withdrawal via UPI",
            subtitle: (r.note as string | undefined) ?? "Payout",
            amount:   r.amount as number,   // already negative in Firestore
            status:   (r.status as string) === "completed"
              ? ("completed" as const)
              : ("pending"   as const),
            time:     txnTime,
            date:     txnDate,
          };
        }
        // bonus / adjustment
        return {
          id:       r.id,
          type:     "bonus" as const,
          title:    (r.note as string | undefined) ?? "Adjustment",
          subtitle: "",
          amount:   r.amount as number,
          status:   "completed" as const,
          time:     txnTime,
          date:     txnDate,
        };
      });

      setTxns(txns);
    } catch (err) {
      console.warn("[Wallet] Failed to load transactions:", err);
    }
  };

  /**
   * Apply server-computed wallet values directly to state without a Firestore read.
   *
   * Used on the delivery-completion path where POST /complete already returns
   * the freshly computed balance, todayEarnings, tripsToday, and todayDate.
   * Avoids one getDriverDoc() call per delivery.
   *
   * refreshWallet() is unchanged and still used for withdrawals and any path
   * where a Firestore re-read is genuinely required.
   */
  const applyWalletUpdate = (
    balance:      number,
    todayEarning: number,
    trips:        number,
    date:         string,
  ): void => {
    const today   = new Date().toISOString().slice(0, 10);
    const sameDay = date === today;
    setBalance(balance);
    setTodayEarnings(sameDay ? todayEarning : 0);
    setTripsToday   (sameDay ? trips        : 0);
  };

  // ─── Ride actions ─────────────────────────────────────────────────────────
  const recoverIncomingRide = (ride: IncomingRide) => {
    setIncomingRide(ride);
  };

  const acceptRide = async (): Promise<AcceptOrderResult> => {
    const ride = incomingRide;
    const uid  = driverUid;

    // Guard: no ride or driver in context.
    if (!ride || !uid) return { ok: false, reason: "missing" };

    // Defensive capacity guard — second line of defence after the dispatch gate.
    // Phase 4: blocks acceptance only when all MAX_ACTIVE_ORDERS slots are full.
    if (isAtCapacity) return { ok: false, reason: "already_claimed" };

    // 1. Firestore transaction — atomic claim; must succeed before ANY local state update.
    //    Phase 2: verifies uid is still in activeOfferDriverUids and status !== "driver_assigned",
    //    then writes status="driver_assigned", driverUid, acceptedAt, activeOfferDriverUids=[]
    //    in one atomic operation.  If another driver won the race, returns ok:false.
    const result = await acceptOrder(ride.id, uid, profile?.name ?? null, driverRating, driverTrips);

    if (!result.ok) {
      // Transaction failed — do not enter active-delivery.
      // Clear incomingRide so the ride-request screen auto-dismisses (the
      // hadRideRef useEffect in ride-request.tsx calls dismiss() when
      // incomingRide → null and didAcceptRef is false).
      setIncomingRide(null);
      lastSeenOrderId.current = null; // allow next dispatch
      cancelIncomingOrderNotification().catch(console.error);
      return result;
    }

    // 2. Transaction succeeded — safe to commit local state.
    // Append to array with duplicate guard and hard cap at MAX_ACTIVE_ORDERS.
    const accepted: ActiveRide = { ...ride, acceptedAt: Date.now(), orderStatus: "driver_assigned" };
    setActiveOrders((prev) => {
      if (prev.some((o) => o.id === accepted.id)) return prev;       // dedup
      return [...prev, accepted].slice(0, MAX_ACTIVE_ORDERS);        // cap
    });
    // Only shift focus to the newly accepted order if nothing is currently focused.
    // If the driver is already working on Order A, focus stays on Order A so that
    // active-delivery, the cancellation guard, advance(), and OTP all continue to
    // operate on the order the screen was opened for.  The new order is still
    // added to activeOrders and reachable from the Command Center.
    setCurrentActiveOrderId((prev) => prev ?? ride.id);
    setIncomingRide(null);
    lastSeenOrderId.current = ride.id; // prevent re-trigger

    cancelIncomingOrderNotification().catch(console.error);
    sendOrderUpdateNotification({
      title: "✅ Order Accepted",
      body:  `Heading to ${ride.pickup}`,
      data:  { type: "order_update", stage: "accepted" },
    }).catch(console.error);

    return result; // { ok: true }
  };

  const rejectRide = () => {
    const ride = incomingRide;
    const uid  = driverUid;
    if (!ride || !uid) return;

    // Safe conditional transaction — will not write if the order has already
    // been accepted, cancelled, or reassigned.  Now writes status="searching"
    // (not "rejected") so the order returns to the round-robin pool; the driver
    // is added to rejectedBy so they won't receive the same order again this cycle.
    rejectOrder(ride.id, uid).catch(console.error);

    // Always clear local state so the request screen dismisses cleanly.
    setIncomingRide(null);
    lastSeenOrderId.current = null; // allow next dispatch to arrive
    cancelIncomingOrderNotification().catch(console.error);
  };

  const timeoutRide = () => {
    const ride = incomingRide;
    const uid  = driverUid;
    if (!ride || !uid) return;

    // Returns order to pool (status="searching") without blacklisting the driver.
    // The driver may receive the same order again in the next dispatch cycle.
    // The server-side poller will also catch the timeout independently.
    timeoutOrder(ride.id, uid).catch(console.error);

    // Clear local state so the request screen dismisses cleanly.
    setIncomingRide(null);
    lastSeenOrderId.current = null;
    cancelIncomingOrderNotification().catch(console.error);
  };

  const focusOrder = (orderId: string) => {
    if (!activeOrders.some((o) => o.id === orderId)) return;
    setCurrentActiveOrderId(orderId);
  };

  const endRide = (orderId: string) => {
    // Remove only the completed order; all other active orders stay intact.
    setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));

    // If the completed order was the focused one, shift focus to the next
    // available order (first in remaining array), or null if none remain.
    // Uses activeOrdersRef.current (pre-removal snapshot) — same pattern as
    // the listener registry at lines 703-708.
    setCurrentActiveOrderId((prev) => {
      if (prev !== orderId) return prev;
      const remaining = activeOrdersRef.current.filter((o) => o.id !== orderId);
      return remaining[0]?.id ?? null;
    });

    // Clean up the removal-reason entry for this order now that it is fully
    // ended locally. Prevents unbounded map growth over a long driver session.
    setOrderRemovalReasons((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  };

  // ─── Phase 2: active-order listener registry ──────────────────────────────
  //
  // One Firestore listener per order in activeOrders.
  // Stored in a ref-based Map so the sync effect only adds/removes individual
  // entries and never recreates the entire set on every state update.
  //
  // Lifecycle:
  //   • Order added to activeOrders  → subscribe, store unsub in map
  //   • Order reaches terminal status → remove from activeOrders, unsub listener
  //   • Order removed externally      → useEffect cleanup loop unsubscribes
  //   • Provider unmounts             → dedicated cleanup effect unsubscribes all
  //   • signOut                       → explicit loop + clear before state reset
  //
  // Phase 1 equivalence: with a single order the map always has exactly one
  // entry and behaviour is identical to the old single-listener useEffect.

  // Map of orderId → unsubscribe function.  Never stored in React state so
  // mutations to the map never trigger re-renders.
  const activeOrderListenersRef = useRef<Map<string, () => void>>(new Map());

  // Stable ref to the current activeOrders array.  Used inside listener
  // callbacks (registered once per order) to read the latest snapshot without
  // creating stale closures.
  const activeOrdersRef = useRef<ActiveRide[]>(activeOrders);
  useEffect(() => { activeOrdersRef.current = activeOrders; }, [activeOrders]);

  // Sync listeners with activeOrders whenever the set of active order IDs changes.
  // Subscribes to orders that have no listener yet; unsubscribes from orders
  // that are no longer in the array.
  useEffect(() => {
    const listeners = activeOrderListenersRef.current;
    const currentIds = new Set(activeOrders.map((o) => o.id));

    // ── Subscribe to newly added orders ──────────────────────────────────────
    for (const order of activeOrders) {
      if (listeners.has(order.id)) continue;  // already watching

      const unsub = listenToActiveOrder(order.id, (status) => {
        if (!isOrderTerminal(status)) return;

        // ── Classify the removal reason ──────────────────────────────────────
        // This lets active-delivery distinguish a normal driver-initiated delivery
        // completion from an external cancellation, so it only shows "Order
        // Cancelled" for genuine external events, never for delivery completions.
        const s = status as string | null;
        const reason: "delivered" | "completed" | "cancelled" | "rejected" | "deleted" =
          s === null          ? "deleted"   :
          s === "delivered"   ? "delivered" :
          s === "completed"   ? "completed" :
          s === "rejected"    ? "rejected"  :
          /* any cancel variant (cancelled, canceled, customer_cancelled, …) */
                                "cancelled";

        // ── Stale-snapshot guard ─────────────────────────────────────────────
        // Problem: when a driver accepts an order, listenToActiveOrder fires an
        // initial onSnapshot immediately. If the Firestore document still holds a
        // terminal status from a previous delivery cycle (e.g. "delivered" from
        // the last test run, before acceptOrder's write propagates to the server),
        // that stale snapshot would incorrectly clear the freshly-accepted order.
        //
        // Rule: if the snapshot says the order is "delivered" or "completed" BUT
        // the local record shows the order has only ever been at "accepted" or
        // "to_pickup" (i.e. the driver never advanced past pickup), it is almost
        // certainly a stale terminal snapshot — skip it. Real customer
        // cancellations ("cancelled", "rejected", null/deleted) are NEVER skipped
        // regardless of local status, because they must always surface.
        if (reason === "delivered" || reason === "completed") {
          const localOrder = activeOrdersRef.current.find((o) => o.id === order.id);
          const localStatus = localOrder?.orderStatus;
          if (localStatus === "driver_assigned" || localStatus === "accepted" || localStatus === "to_pickup") {
            // The driver has not yet advanced past pickup on this device but
            // Firestore already shows a completion status — stale snapshot.
            // Log for debugging and bail; the next snapshot (after the
            // acceptOrder/updateOrderStage write resolves on the server) will
            // deliver the correct status.
            console.warn(
              `[DriverContext] Ignoring stale terminal snapshot for order ${order.id}: ` +
              `Firestore status="${status}", local status="${localStatus}". ` +
              `Likely a reused order doc from a prior test cycle.`,
            );
            return;
          }
        }

        // ── Cancellation alert notification ──────────────────────────────────
        // Fire a system notification so the driver is alerted even when the app
        // is backgrounded.  Only sent for externally-initiated removals; normal
        // delivery completions ("delivered"/"completed") do not use this path.
        //
        // Duplicate-spam protection: the self-cleanup block below (listeners.get
        // / listeners.delete) runs synchronously inside this same callback, so
        // Firestore cannot invoke this listener a second time for the same order
        // after we return.  The notification fires exactly once per cancellation.
        if (reason === "cancelled" || reason === "rejected" || reason === "deleted") {
          sendDriverAlertNotification({
            title: "Order Cancelled",
            body:  "A delivery has been cancelled.",
          }).catch(console.error);
        }

        // ── Record per-order removal reason before state update ─────────────
        // Keyed by orderId so active-delivery for Order B is never triggered by
        // a cancellation of Order A.
        setOrderRemovalReasons((prev) => ({ ...prev, [order.id]: reason }));

        // Remove only this order from the array (leaves other orders intact).
        setActiveOrders((prev) => prev.filter((o) => o.id !== order.id));

        // If the completed order was the focused one, shift focus to the next
        // available order (first in remaining array), or null if none left.
        setCurrentActiveOrderId((prev) => {
          if (prev !== order.id) return prev;
          // activeOrdersRef.current still holds the pre-removal snapshot here,
          // so filtering out order.id gives us the remaining candidates.
          const remaining = activeOrdersRef.current.filter((o) => o.id !== order.id);
          return remaining[0]?.id ?? null;
        });

        // Self-cleanup: remove this listener from the map.
        listeners.get(order.id)?.();
        listeners.delete(order.id);
      });

      listeners.set(order.id, unsub);
    }

    // ── Unsubscribe from orders no longer in activeOrders ────────────────────
    // Handles the case where endActiveRide() or signOut clears the array
    // externally before the listener's own terminal-status callback fires.
    for (const [id, unsub] of Array.from(listeners)) {
      if (!currentIds.has(id)) {
        unsub();
        listeners.delete(id);
      }
    }
  }, [activeOrders]);   // re-runs only when the order set changes

  // ── Provider unmount: ensure no Firestore listeners are left open ──────────
  useEffect(() => {
    return () => {
      for (const unsub of activeOrderListenersRef.current.values()) {
        unsub();
      }
      activeOrderListenersRef.current.clear();
    };
  }, []);

  // ─── Notification action handlers (registered once on mount) ──────────────
  useEffect(() => {
    registerOrderActionHandlers({
      onAccept: () => {
        // Notification action handlers must be synchronous callbacks, so the
        // async transaction runs inside a void IIFE.
        void (async () => {
          const ride = incomingRideRef.current;
          const uid  = driverUidRef.current;
          if (!ride || !uid) return;

          // Defensive capacity check using the stable ref (this handler is
          // registered once; direct state reads would be stale).
          // Phase 4: block only when all slots are full.
          if (activeOrdersRef.current.length >= MAX_ACTIVE_ORDERS) return;

          // Dedup guard: bail if this order is already in the active set.
          // Prevents a redundant Firestore round-trip when the notification
          // fires twice before React state has updated.
          if (activeOrdersRef.current.some((o) => o.id === ride.id)) return;

          // Atomic Firestore transaction — same guard as in-app acceptRide().
          const result = await acceptOrder(ride.id, uid, profileRef.current?.name ?? null, driverRatingRef.current, driverTripsRef.current);

          if (!result.ok) {
            // Another path beat us — clear the incoming ride and bail.
            setIncomingRide(null);
            lastSeenOrderId.current = null;
            cancelIncomingOrderNotification().catch(console.error);
            return;
          }

          // Transaction succeeded — commit local state then navigate.
          const accepted: ActiveRide = { ...ride, acceptedAt: Date.now(), orderStatus: "accepted" };
          setActiveOrders((prev) => {
            if (prev.some((o) => o.id === accepted.id)) return prev;   // dedup
            return [...prev, accepted].slice(0, MAX_ACTIVE_ORDERS);    // cap
          });
          // Only shift focus to the newly accepted order if nothing is currently focused.
    // If the driver is already working on Order A, focus stays on Order A so that
    // active-delivery, the cancellation guard, advance(), and OTP all continue to
    // operate on the order the screen was opened for.  The new order is still
    // added to activeOrders and reachable from the Command Center.
    setCurrentActiveOrderId((prev) => prev ?? ride.id);
          setIncomingRide(null);
          lastSeenOrderId.current = ride.id;

          cancelIncomingOrderNotification().catch(console.error);
          sendOrderUpdateNotification({
            title: "✅ Order Accepted",
            body:  `Heading to ${ride.pickup}`,
            data:  { type: "order_update", stage: "accepted" },
          }).catch(console.error);

          router.push({
            pathname: "/active-delivery",
            params: {
              orderId:     ride.id,
              customer:    ride.passengerName,
              phone:       ride.customerPhone,
              parcelType:  ride.parcelType,
              parcelEmoji: ride.parcelEmoji,
              pickup:      ride.pickup,
              pickupCity:  ride.pickupCity,
              drop:        ride.drop,
              dropCity:    ride.dropCity,
              distanceKm:  String(ride.distanceKm),
              durationMin: String(ride.durationMin),
              earning:     String(ride.fareEstimate),
              weight:      ride.parcelWeight,
            },
          });
        })();
      },
      onReject: () => {
        const ride = incomingRideRef.current;
        const uid  = driverUidRef.current;
        if (!ride || !uid) return;

        rejectOrder(ride.id, uid).catch(console.error);
        setIncomingRide(null);
        lastSeenOrderId.current = null;
        cancelIncomingOrderNotification().catch(console.error);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestWithdrawal = async (
    amount: number,
    upiId:  string,
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!driverUid) return { ok: false, reason: "Not logged in" };
    try {
      await fsRequestWithdrawal(driverUid, amount, upiId);
      // Optimistic debit already applied by Firestore transaction —
      // refresh balance and reload transaction list.
      await refreshWallet();
      void loadDriverTransactions(driverUid);
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Withdrawal failed";
      return { ok: false, reason };
    }
  };

  // ─── Overlay permission ───────────────────────────────────────────────────
  // Not yet implemented: real overlay support requires a native Android module
  // (WindowManager + SYSTEM_ALERT_WINDOW) and a custom production build.
  // requestOverlayPermission() is kept for API compatibility but always returns
  // ok: false — the toggle in profile.tsx is locked and shows a "Coming soon" alert.
  const requestOverlayPermission = async (): Promise<{ ok: boolean; reason?: string }> => {
    return {
      ok: false,
      reason: "Overlay alerts are not enabled in this build yet.",
    };
  };

  return (
    <DriverContext.Provider
      value={{
        driverUid,
        authLoading,
        isOtpVerified,
        phone,
        isAuthenticated,
        profile,
        vehicle,
        verificationStatus,
        documentsSubmitted,
        accountStatus,
        isOnline,
        // Multi-order foundation
        activeOrders,
        currentActiveOrderId,
        // Capacity model (Phase 3)
        maxActiveOrders:  MAX_ACTIVE_ORDERS,
        activeOrderCount,
        hasCapacity,
        isAtCapacity,
        // Backward-compat shims (derived above)
        activeRide,
        currentOrderId,
        subscriptionPlan,
        subscriptionExpiresAt,
        subscriptionActive,
        planExpiredNoOrders,
        planExpiredWithOrders,
        incomingRide,
        pendingRides,
        rideHistory,
        walletBalance,
        lifetimeEarnings,
        todayEarnings,
        tripsToday,
        totalTrips: driverTrips,
        transactions,
        addEarningLocally,
        refreshWallet,
        applyWalletUpdate,
        setPhone,
        confirmOtp,
        setProfile,
        setVehicle,
        signOut,
        setOnline,
        activatePlan,
        refreshSubscription,
        acceptRide,
        rejectRide,
        timeoutRide,
        recoverIncomingRide,
        endRide,
        focusOrder,
        orderRemovalReasons,
        requestWithdrawal,
        backgroundSetupShown,
        permissionSetupVersion,
        markBackgroundSetupShown,
        onboardingFeeApplies,
        onboardingFeeStatus,
        onboardingFeeAmount,
        markOnboardingFeePaidLocally,
        overlayPermissionGranted,
        requestOverlayPermission,
        setOverlayPermission: setOverlayPermissionGranted,
      }}
    >
      {children}
    </DriverContext.Provider>
  );
}
