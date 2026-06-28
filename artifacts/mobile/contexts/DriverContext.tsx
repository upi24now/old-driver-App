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
  getActiveOrdersForDriver,
  rejectOrder,
  timeoutOrder,
  PERMISSION_SETUP_VERSION,
  type DriverDoc,
  type OrderDoc,
  type OrderStatus,
  type AcceptOrderResult,
} from "@/utils/firestore";
import {
  listenToAllDispatchedOrders,
  listenToActiveOrder,
} from "@/utils/order-stream";
import {
  getDriverProfile,
  getDriverPlanStatus,
  getDriverVerificationStatus,
  patchDriverProfile,
  patchDriverVehicle,
  patchDriverBackgroundSetup,
  ensureDriverSignup,
  getLastProfileFetchDebug,
  type PgDriverProfile,
} from "@/utils/profile-api";
import { requestPayout, getWalletTransactions, getWallet } from "@/utils/wallet-api";
import { acceptOrderViaApi } from "@/utils/delivery-api";
export type { AcceptOrderResult };
import { verifyOtpApi, verifyPinApi } from "@/utils/auth-api";
import { loadSessionId, setSessionId, clearSessionId } from "@/utils/session";
import { installSessionFetchInterceptor, setSessionReplacedHandler } from "@/utils/api-client";
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

// Key that caches the locally-completed permission setup version.
// Written by markBackgroundSetupShown and synced from Firestore on each login.
// Lets the boot path check the permission gate without a live Firestore read.
const LOCAL_PERMISSION_KEY = "@bike_courier/local_permission_version";

// Key that caches the last known verificationStatus for this driver.
// Written whenever a Firestore driver doc is successfully loaded (both
// onAuthStateChanged hydration and confirmOtp paths).
// Read by the session-restore timeout path so an approved driver is never
// stranded at /verification-pending when Firestore cold-start exceeds 3.5 s.
const LOCAL_VERIFICATION_KEY = "@bike_courier/local_verification_status";

// Key that caches the last known subscriptionPlan + subscriptionExpiresAt.
// Written after every successful Firestore driver doc read.
// Read by the session-restore Firestore-timeout path so a driver with an
// active plan does not see "no plan" while waiting for the live listener
// to deliver its first snapshot (which can take several seconds on a cold
// start when Firestore is slow).
const LOCAL_SUBSCRIPTION_KEY = "@bike_courier/subscription_cache";

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
  | "/registration"
  | "/vehicle-selection"
  | "/profile-setup"
  | "/document-upload"
  | "/onboarding-fee"
  | "/verification-pending"
  | "/background-setup"
  | "/account-blocked";

type ConfirmOtpResult = {
  ok:              boolean;
  profileComplete: boolean;
  error?:          string;
  nextRoute?:      OnboardingRoute;
  debugLog?:       string[];
  // PIN login only: true when verify-pin reported this account has no PIN set
  // yet, so the login screen can route into first-time OTP + PIN setup.
  pinNotFound?:    boolean;
};

type DriverState = {
  driverUid:        string | null;
  authLoading:      boolean;
  // True ONLY after a successful confirmOtp() call in the current session.
  // A persisted Firebase session (onAuthStateChanged restore) does NOT set this.
  // _layout.tsx routes to /login whenever isOtpVerified is false, regardless of
  // whether driverUid is set — forcing every cold start through the OTP gate.
  isOtpVerified:    boolean;
  // True from the moment confirmOtp() calls signInWithCustomToken() until
  // setIsOtpVerified(true) fires (same render batch).  _layout.tsx must not
  // redirect to /login while this is true — it is the guard against the flash
  // caused by onAuthStateChanged setting driverUid before isOtpVerified is ready.
  isOtpVerifying:   boolean;
  phone:            string | null;
  isAuthenticated:  boolean;
  profile:          Profile | null;
  vehicle:          Vehicle | null;
  verificationStatus:  string | null;  // "pending" | "verified" | "rejected" | null
  documentsSubmitted:  boolean;
  kycRejectionReason:  string | null;
  kycDocuments:        NonNullable<DriverDoc['documents']> | null;
  refreshKycStatus:    () => Promise<void>;
  accountStatus:       string | null;  // "active" | "suspended" | "blocked" | null
  suspendReason:       string | null;  // admin-supplied reason shown on the blocked screen
  blacklistReason:     string | null;  // admin-supplied reason shown on the blocked screen

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
  totalPaid:        number;
  todayEarnings:    number;
  tripsToday:       number;
  totalTrips:       number;
  transactions:     Txn[];

  setPhone:   (p: string) => void;
  confirmOtp: (phone: string, otp: string) => Promise<ConfirmOtpResult>;
  confirmPin: (phone: string, pin: string) => Promise<ConfirmOtpResult>;
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
  permissionSetupVersion:   number;         // Firestore-sourced; 0 = never done
  localPermissionVersion:   number | null;  // AsyncStorage-cached; null until boot read completes
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

// Persists the driver's subscription plan and expiry to AsyncStorage so the
// session-restore Firestore-timeout path can immediately show the correct plan
// state without waiting for the live Firestore listener's first snapshot.
function persistSubscriptionCache(plan: SubPlan | null, expiresAt: number | null): void {
  void AsyncStorage.setItem(
    LOCAL_SUBSCRIPTION_KEY,
    JSON.stringify({ plan, expiresAt }),
  ).catch(() => {});
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
  const [isOtpVerified,  setIsOtpVerified]  = useState(false);
  // isOtpVerifying: true while confirmOtp() is in flight (between signInWithCustomToken
  // and the final setIsOtpVerified call). Prevents _layout.tsx from routing to /login
  // when onAuthStateChanged fires driverUid before isOtpVerified is ready.
  const [isOtpVerifying, setIsOtpVerifying] = useState(false);
  const [phone,         setPhoneState]    = useState<string | null>(null);
  const [profile,     setProfileState]= useState<Profile | null>(null);
  const [vehicle,     setVehicleState]= useState<Vehicle | null>(null);
  const [verificationStatus, setVerifStatus]      = useState<string | null>(null);
  const [documentsSubmitted, setDocsSubmitted]     = useState<boolean>(false);
  const [kycRejectionReason, setKycRejectionReason] = useState<string | null>(null);
  const [kycDocuments,       setKycDocuments]       = useState<NonNullable<DriverDoc['documents']> | null>(null);

  const [isOnline,        setOnlineState]    = useState(false);
  const [accountStatus,   setAccountStatus]  = useState<string | null>(null);
  const [suspendReason,   setSuspendReason]   = useState<string | null>(null);
  const [blacklistReason, setBlacklistReason] = useState<string | null>(null);

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
  const [totalPaid,         setTotalPaid]        = useState(0);
  const [todayEarnings,     setTodayEarnings]    = useState(0);
  const [tripsToday,        setTripsToday]        = useState(0);
  const [transactions,      setTxns]              = useState<Txn[]>([]);
  const [driverRating,   setDriverRating] = useState<number | string>("5.0");
  const [driverTrips,    setDriverTrips]  = useState<number>(0);

  const [overlayPermissionGranted,  setOverlayPermissionGranted]  = useState(false);
  const [backgroundSetupShown,      setBackgroundSetupShown]      = useState(false);
  const [permissionSetupVersion,    setPermissionSetupVersion]    = useState(0);
  const [localPermissionVersion,    setLocalPermissionVersion]    = useState<number | null>(null);
  const [onboardingFeeApplies,      setOnboardingFeeApplies]      = useState(false);
  const [onboardingFeeStatus,       setOnboardingFeeStatus]       = useState<string | null>(null);
  const [onboardingFeeAmount,       setOnboardingFeeAmount]       = useState<number | null>(null);

  const isAuthenticated = !!driverUid;

  // Refs used by notification action handlers (registered once, no stale closure)
  const incomingRideRef      = useRef<IncomingRide | null>(null);
  const driverUidRef         = useRef<string | null>(null);
  // GPS location interval — cleared on go-offline and on sign-out
  const locationIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Navigation guard — ensures router.replace("/account-blocked") fires AT MOST
  // ONCE per session regardless of how many times onAuthStateChanged or the
  // subscribeDriverDoc listener fires. Prevents remount blinks on reconnect.
  const hasNavigatedToBlockedRef = useRef(false);
  const profileRef      = useRef<Profile | null>(null);
  const driverRatingRef = useRef<number | string>("5.0");
  const driverTripsRef  = useRef<number>(0);
  useEffect(() => { incomingRideRef.current  = incomingRide;   }, [incomingRide]);
  useEffect(() => { driverUidRef.current     = driverUid;      }, [driverUid]);
  useEffect(() => { profileRef.current       = profile;        }, [profile]);
  useEffect(() => { driverRatingRef.current  = driverRating;   }, [driverRating]);
  useEffect(() => { driverTripsRef.current   = driverTrips;    }, [driverTrips]);

  // Pre-started AsyncStorage promises — kicked off before onAuthStateChanged fires
  // so both reads are resolved (or near-resolved) before the auth callback runs.
  // Default resolved values are replaced inside the mount effect milliseconds later.
  const sessionKeyRef   = useRef<Promise<string | null>>(Promise.resolve(null));
  const localPermVerRef = useRef<Promise<number>>(Promise.resolve(0));

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
    // ── Pre-start AsyncStorage reads ─────────────────────────────────────────
    // Kick off both reads immediately so they resolve (usually <50 ms on any
    // healthy device) long before onAuthStateChanged fires (100-500 ms cold
    // start) and certainly before the 8 s safety timeout. Assigning to the
    // refs here (inside the effect) guarantees React strict-mode doesn't start
    // duplicate reads on a second mount.
    sessionKeyRef.current   = AsyncStorage.getItem(SESSION_VERIFIED_KEY);
    localPermVerRef.current = AsyncStorage.getItem(LOCAL_PERMISSION_KEY).then((v) => {
      const n = v !== null ? parseInt(v, 10) : 0;
      setLocalPermissionVersion(n);
      console.log("[PERMISSION_GATE] localPermissionVersion read from AsyncStorage =", n);
      return n;
    });

    // ── Single-device login wiring ───────────────────────────────────────────
    // 1. Load the persisted session id into the in-memory cache so the fetch
    //    interceptor / SSE connector can read it synchronously from the very
    //    first authenticated request.
    // 2. Install the global fetch interceptor (injects x-session-id + detects
    //    SESSION_REPLACED).
    // 3. Register the SESSION_REPLACED handler: a different device has claimed
    //    this account, so sign out and force the login screen. signOut() resets
    //    isOtpVerified/driverUid (which _layout.tsx routes on) and clearSessionId;
    //    the explicit router.replace guarantees the user lands on /login.
    void loadSessionId();
    installSessionFetchInterceptor();
    setSessionReplacedHandler(() => {
      console.warn("[SESSION_REPLACED] account claimed on another device — signing out");
      console.log("[FLOW] DriverContext: SESSION_REPLACED handler fired → signOut() → router.replace('/login') (THIS is the bounce to login)");
      void signOut().finally(() => {
        try {
          router.replace("/login");
        } catch {
          // Navigation may fail if the router is not mounted yet — _layout.tsx
          // already routes to /login once signOut resets the auth flags.
        }
      });
    });

    // Cold-start diagnostics — logged once when DriverProvider mounts.
    console.log("[BOOT_ROUTE] app opened");
    console.log("[BOOT_ROUTE] firebase currentUser immediate =", firebaseAuth.currentUser?.uid ?? null);
    void sessionKeyRef.current.then((uid) =>
      console.log("[SESSION_STATE] storedVerifiedUid =", uid ?? "(none)"),
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
          // Await the already-started promise (kicked off at mount time, not now).
          // On a normal device this resolves in <50 ms — well before this code runs.
          const storedUid = await sessionKeyRef.current;
          console.log("[PERF] auth_state_ready ts=" + Date.now());
          console.log("[AUTH_RESTORE] firebaseUid =", user.uid);
          console.log("[AUTH_RESTORE] storedVerifiedUid =", storedUid);
          sessionValid = storedUid === user.uid;
          console.log("[SESSION_STATE] sessionValid =", sessionValid);
          if (sessionValid) {
            setIsOtpVerified(true);
          }
        } catch {
          // AsyncStorage read failed — falls back to OTP gate (safe default).
        }

        // ── 2. No-restore fast path ──────────────────────────────────────────
        // No saved session: unblock the layout immediately so the login screen
        // or permission gate appears.
        if (!sessionValid) {
          console.log("[ROUTE_DECISION] no valid session → handing off to _layout gate");
          setAuthLoading(false);
        }
        // Session restore path: keep authLoading=true (spinner overlay stays up)
        // while we fetch the driver doc and navigate to the correct screen. This
        // prevents any flash of the login screen between auth restore and
        // navigation. A 3.5 s doc-fetch timeout keeps us safely under the 5 s
        // safety timeout so the overlay never hangs indefinitely.

        // ── 3. Profile hydration ─────────────────────────────────────────────
        // Primary source: PostgreSQL (profile, KYC, verification, onboarding, account status).
        // Remaining Firestore reads (background): subscription + daily stats (not yet in PG).
        let pgProfile: PgDriverProfile | null = null;
        try {
          console.log("[PERF] get_driver_profile_start ts=" + Date.now());
          const profileFetch = getDriverProfile();
          pgProfile = sessionValid
            ? await Promise.race([
                profileFetch,
                new Promise<null>((r) => setTimeout(() => r(null), 3500)),
              ])
            : await profileFetch;
          console.log("[PERF] get_driver_profile_end ts=" + Date.now() + " pgProfile=" + (pgProfile ? "ok" : "null"));

          if (pgProfile) {
            console.log("[PG_PROFILE_RESTORE] onAuthStateChanged uid=" + user.uid + " name=" + (pgProfile.name ?? "(null)") + " vehicleId=" + (pgProfile.vehicleId ?? "(null)") + " verificationStatus=" + (pgProfile.verificationStatus ?? "(null)"));
            if (pgProfile.name) {
              setProfileState({
                name:          pgProfile.name          ?? "",
                city:          pgProfile.city          ?? "",
                gender:        pgProfile.gender        ?? "",
                licenseNumber: pgProfile.licenseNumber ?? "",
                vehicleNumber: pgProfile.vehicleNumber ?? "",
              });
            }
            if (pgProfile.vehicleId) {
              setVehicleState({ id: pgProfile.vehicleId, name: pgProfile.vehicleName ?? "" });
            }
            setAccountStatus(pgProfile.accountStatus ?? null);
            setSuspendReason(pgProfile.suspendReason ?? null);
            setBlacklistReason(pgProfile.blacklistReason ?? null);
            if (pgProfile.suspendReason)   console.log("[ACCOUNT_SUSPEND_REASON] session restore:", pgProfile.suspendReason);
            if (pgProfile.blacklistReason) console.log("[ACCOUNT_BLACKLIST_REASON] session restore:", pgProfile.blacklistReason);
            {
              const isSuspended =
                pgProfile.accountStatus === "suspended" ||
                pgProfile.accountStatus === "blacklisted" ||
                pgProfile.accountStatus === "blocked";
              setOnlineState(isSuspended ? false : false); // isOnline not stored in PG; always start offline
            }
            // Subscription: restore from AsyncStorage cache (subscriptionPlan not yet in PG).
            try {
              const subRaw = await AsyncStorage.getItem(LOCAL_SUBSCRIPTION_KEY).catch(() => null);
              if (subRaw) {
                const sub = JSON.parse(subRaw) as { plan?: string; expiresAt?: number };
                if (sub.plan)      setSubPlan(sub.plan as SubPlan);
                if (sub.expiresAt) setSubExp(sub.expiresAt);
                console.log("[SESSION_RESTORE_SUB] plan restored from cache —", sub.plan, "exp", sub.expiresAt);
              }
            } catch {}
            // Subscription is NOT carried by GET /api/drivers/me — read the
            // authoritative status from GET /api/driver-plans/status. The cache
            // restored above is the instant-display value until this resolves;
            // on failure we keep the cache rather than clearing it to null.
            void syncSubscriptionFromServer();
            {
              const today   = new Date().toISOString().slice(0, 10);
              const sameDay = pgProfile.todayDate === today;
              setTodayEarnings(sameDay ? (pgProfile.todayEarnings ?? 0) : 0);
              setTripsToday   (sameDay ? (pgProfile.tripsToday    ?? 0) : 0);
              setDriverRating(String(pgProfile.rating ?? 5.0));
            }
            // Wallet — fire-and-forget REST read (must NOT block navigation)
            console.log("[PERF] wallet_fetch_start");
            void getWallet(user.uid).then((walletDoc) => {
              console.log("[PERF] wallet_fetch_end");
              if (!walletDoc) return;
              setBalance(walletDoc.balance ?? 0);
              setLifetimeEarnings(walletDoc.totalEarnings ?? 0);
              setTotalPaid(walletDoc.totalPaid ?? 0);
              setDriverTrips(walletDoc.completedDeliveries ?? 0);
            }).catch(() => {});
            void loadDriverTransactions(user.uid);
            setVerifStatus(pgProfile.verificationStatus ?? null);
            if (pgProfile.verificationStatus) {
              void AsyncStorage.setItem(LOCAL_VERIFICATION_KEY, pgProfile.verificationStatus).catch(() => {});
            }
            setDocsSubmitted(pgProfile.documentsSubmitted ?? false);
            setKycRejectionReason(pgProfile.kycRejectionReason ?? null);
            setKycDocuments(pgProfile.documents as unknown as NonNullable<DriverDoc["documents"]>);
            setBackgroundSetupShown(pgProfile.backgroundSetupShown ?? false);
            {
              const pgPermVer = pgProfile.permissionSetupVersion ?? 0;
              setPermissionSetupVersion(pgPermVer);
              // Sync local AsyncStorage cache — PG is authoritative when reachable.
              const localVer = await localPermVerRef.current;
              if (pgPermVer > localVer) {
                localPermVerRef.current = Promise.resolve(pgPermVer);
                setLocalPermissionVersion(pgPermVer);
                void AsyncStorage.setItem(LOCAL_PERMISSION_KEY, String(pgPermVer)).catch(() => {});
                console.log("[PERMISSION_GATE] local cache updated from PG:", pgPermVer);
              }
            }
            setOnboardingFeeApplies(pgProfile.onboardingFeeApplies ?? false);
            setOnboardingFeeStatus(pgProfile.onboardingFeeStatus ?? null);
            setOnboardingFeeAmount(pgProfile.onboardingFeeAmount ?? null);
          }
          // Restore active orders — fire-and-forget (must NOT block navigation)
          console.log("[PERF] active_orders_restore_start");
          void getActiveOrdersForDriver(user.uid, MAX_ACTIVE_ORDERS).then((activeOrderDocs) => {
            console.log("[PERF] active_orders_restore_end count=" + activeOrderDocs.length);
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
            } else {
              // PG is authoritative (HTTP 200): an empty result means this driver
              // has NO active order. Immediately clear any stale local/current
              // active-order state so the active-ride screen disappears and the
              // home screen returns to the available/online state. No Firestore.
              setActiveOrders([]);
              setCurrentActiveOrderId(null);
            }
          }).catch(() => {
            // Server unreachable / non-200 — NOT authoritative. Leave existing
            // state untouched (never resurrect stale data from Firestore).
          });
        } catch (err) {
          console.error("[Auth] background profile hydration failed:", err);
        }

        // ── 4. Session restore navigation ────────────────────────────────────
        // Navigate to the correct screen BEFORE calling setAuthLoading(false).
        // This ensures the auth overlay disappears onto the dashboard (or the
        // correct onboarding step), never onto the login screen.
        if (sessionValid) {
          const localVer = await localPermVerRef.current;
          let nextRoute: OnboardingRoute;
          if (pgProfile) {
            // PG responded in time — use authoritative pgProfile.
            console.log("[SESSION_RESTORE_DOC] PG success —", JSON.stringify({
              verificationStatus:     pgProfile.verificationStatus     ?? null,
              vehicleId:              pgProfile.vehicleId              ?? null,
              name:                   pgProfile.name                   ?? null,
              documentsSubmitted:     pgProfile.documentsSubmitted     ?? false,
              permissionSetupVersion: pgProfile.permissionSetupVersion ?? 0,
            }));
            console.log("[KYC_GATE] PG success — running deriveNextRoute");
            const serverRoute = pgProfile.nextRoute as string | undefined;
            nextRoute = serverRoute
              ? mapServerNextRoute(serverRoute)
              : await deriveNextRoute(pgProfile);
            {
              const profileComplete = !!(pgProfile.name && pgProfile.city);
              const vehicleComplete = !!pgProfile.vehicleId;
              const docsComplete    = pgProfile.documentsSubmitted ?? false;
              const feePaid         = !pgProfile.onboardingFeeApplies || pgProfile.onboardingFeeStatus === "paid";
              console.log(
                "[ROUTE_DECISION]",
                "uid=" + user.uid,
                "profileComplete=" + profileComplete,
                "vehicleComplete=" + vehicleComplete,
                "docsComplete="    + docsComplete,
                "feePaid="         + feePaid,
                "verificationStatus=" + (pgProfile.verificationStatus ?? "null"),
                "nextRoute="       + nextRoute,
              );
            }
          } else {
            // Fix B: Firestore timed out (>3.5 s) — verificationStatus unknown from
            // live doc.  Read the local AsyncStorage cache written on the last
            // successful Firestore fetch.  Approved/verified drivers go straight to
            // /(tabs) instead of being blocked at /verification-pending.
            const cachedVerifStatus = await AsyncStorage.getItem(LOCAL_VERIFICATION_KEY).catch(() => null);
            const cachedApproved =
              cachedVerifStatus === "approved" || cachedVerifStatus === "verified";
            console.log("[SESSION_RESTORE_DOC] Firestore timeout — driverDoc null; cachedVerifStatus =", cachedVerifStatus ?? "(none)");

            // Write the cached status into context state NOW so that any screen
            // we route to (e.g. /verification-pending) sees the real value.
            // Without this, verificationStatus stays null and the rejected branch
            // never fires even though the route is correct.
            if (cachedVerifStatus) {
              setVerifStatus(cachedVerifStatus);
            }

            // Restore subscription from AsyncStorage cache so the dashboard
            // immediately shows the driver's active plan even when Firestore
            // timed out (the live listener may take several more seconds).
            try {
              const subRaw = await AsyncStorage.getItem(LOCAL_SUBSCRIPTION_KEY).catch(() => null);
              if (subRaw) {
                const sub = JSON.parse(subRaw) as { plan?: string; expiresAt?: number };
                if (sub.plan)      setSubPlan(sub.plan as SubPlan);
                if (sub.expiresAt) setSubExp(sub.expiresAt);
                console.log("[SESSION_RESTORE_SUB] plan restored from cache —", sub.plan, "exp", sub.expiresAt);
              }
            } catch {
              // Non-fatal — live listener will hydrate plan once Firestore responds
            }

            if (cachedApproved) {
              console.log("[APPROVED_DRIVER_CACHE_HIT] local cache confirms", cachedVerifStatus, "— bypassing /verification-pending");
              nextRoute = "/(tabs)";
              console.log("[APPROVED_DRIVER_ROUTE] approved (cached) → /(tabs)");
            } else {
              // Cannot confirm onboarding state without a live server response.
              // /registration is the safe default: it never bypasses a required step,
              // and a genuinely-pending driver (docs submitted) will be correctly
              // routed by the next successful session restore once the server responds.
              // NEVER route to /verification-pending here — that requires server-confirmed
              // state (documentsSubmitted + feePaid + !rejected), which local cache
              // cannot reliably provide (cache may contain "unsubmitted" written at signup).
              console.log("[DOC_TIMEOUT_APPROVED_UNKNOWN] cachedVerifStatus =", cachedVerifStatus ?? "(none)", "— using safe default /registration (server did not respond in time)");
              nextRoute = "/registration";
              console.log("[SAFE_FALLBACK_ROUTE] → /registration (onboarding state unconfirmed; must not assume verification-pending from cache)");
            }
            console.log("[ROUTE_DECISION] session restore chosenRoute =", nextRoute, "(PG timeout fallback)");
          }
          // Guard: only navigate to /account-blocked once per session.
          // If onAuthStateChanged re-fires (e.g. Firebase reconnect), skip the
          // router.replace so the already-mounted blocked screen does not remount.
          if (nextRoute === "/account-blocked" && hasNavigatedToBlockedRef.current) {
            console.log("[ACCOUNT_ENFORCEMENT_REFRESH] session restore re-fired — blocked screen already mounted, suppressing router.replace");
          } else {
            if (nextRoute === "/account-blocked") {
              hasNavigatedToBlockedRef.current = true;
            }
            router.replace(nextRoute as never);
          }
          console.log("[AUTH_RESTORE] setAuthLoading false (session restore complete)");
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
    // 8 s gives the pre-started AsyncStorage reads (~50 ms) + onAuthStateChanged
    // (~500 ms cold start) + session-key await + Firestore 3.5 s timeout plenty
    // of headroom before the safety net fires. 5 s was too tight on slow Android.
    const tid = setTimeout(() => {
      setAuthLoading((prev) => {
        if (prev) {
          console.log("[AUTH_RESTORE] safety timeout fired — forcing authLoading=false after 8s");
        }
        return false;
      });
    }, 8000);
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
        patchDriverStatus(driverUid, false).catch(console.error);
      }
    }
  }, [subscriptionActive, isOnline, activeOrders.length]);

  // ─── Account-status polling ────────────────────────────────────────────────
  // Replaces the Firestore subscribeDriverDoc real-time listener.
  // Polls GET /api/drivers/me every 30 s to detect admin account-status changes
  // (suspend / blacklist / block) while the app is open.
  //
  // LOOP GUARD: enforcing a block sets isOnline=false via patchDriverStatus.
  // Unlike the Firestore listener, an HTTP poll is not re-triggered by our own
  // write — no infinite loop is possible. The guard is kept for safety.
  useEffect(() => {
    if (!driverUid) return;

    let hasEnforcedBlock = false;

    const poll = async () => {
      const profile = await getDriverProfile().catch(() => null);
      if (!profile) return;

      const blocked =
        profile.accountStatus === "suspended" ||
        profile.accountStatus === "blacklisted" ||
        profile.accountStatus === "blocked";

      setAccountStatus(profile.accountStatus ?? null);
      setSuspendReason(profile.suspendReason ?? null);
      setBlacklistReason(profile.blacklistReason ?? null);
      if (profile.suspendReason)   console.log("[ACCOUNT_SUSPEND_REASON] poll update:", profile.suspendReason);
      if (profile.blacklistReason) console.log("[ACCOUNT_BLACKLIST_REASON] poll update:", profile.blacklistReason);

      // Also propagate verificationStatus so the verification-pending screen's
      // isApproved flag reacts to admin approval without waiting for its own
      // refreshKycStatus interval.
      if (profile.verificationStatus) {
        setVerifStatus(profile.verificationStatus);
        void AsyncStorage.setItem(LOCAL_VERIFICATION_KEY, profile.verificationStatus).catch(() => {});
        console.log("[ACCOUNT_STATUS_POLL] verificationStatus =", profile.verificationStatus);
      }

      if (blocked) {
        if (hasEnforcedBlock) {
          console.log("[ACCOUNT_STATUS_POLL] still blocked — skipping (loop guard active)");
          return;
        }
        hasEnforcedBlock = true;
        console.log("[ACCOUNT_STATUS_POLL] blocked — accountStatus =", profile.accountStatus, "→ enforcing ONCE");
        setOnlineState(false);
        patchDriverStatus(driverUid, false).catch(console.error);
        if (locationIntervalRef.current !== null) {
          clearInterval(locationIntervalRef.current);
          locationIntervalRef.current = null;
          console.log("[GPS_STATUS] tracking stopped (account blocked)");
        }
        if (hasNavigatedToBlockedRef.current) {
          console.log("[ACCOUNT_ENFORCEMENT_REFRESH] blocked screen already mounted — navigation suppressed");
        } else {
          hasNavigatedToBlockedRef.current = true;
          router.replace("/account-blocked");
        }
      }
    };

    // First poll after 5 s (profile already hydrated in onAuthStateChanged).
    // Subsequent polls every 30 s.
    const initialDelay = setTimeout(() => { void poll(); }, 5_000);
    const intervalId   = setInterval(() => { void poll(); }, 30_000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverUid]);

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
   *
   * Accepts DriverDoc (Firestore) or PgDriverProfile (PostgreSQL) — both satisfy
   * the RoutingDoc structural type that uses only fields present in both sources.
   */
  // ─── Server nextRoute → client OnboardingRoute mapping ───────────────────────
  //
  // The server emits specific sub-screens (/vehicle-selection, /profile-setup,
  // /document-upload, /onboarding-fee) that the client does not expose directly.
  // All pre-completion onboarding is handled by the single /registration screen.
  // Only confirmed post-completion routes are forwarded verbatim.
  //
  // NEVER forward the server's /verification-pending via stale local cache —
  // only use it when the server has actively confirmed the route this session.
  function mapServerNextRoute(serverRoute: string): OnboardingRoute {
    switch (serverRoute) {
      case "/(tabs)":
      case "/account-blocked":
      case "/background-setup":
      case "/verification-pending":
      case "/onboarding-fee":
        return serverRoute as OnboardingRoute;
      default:
        // /vehicle-selection, /profile-setup, /document-upload
        // and any unknown future steps all collapse to /registration.
        return "/registration";
    }
  }

  type RoutingDoc = {
    accountStatus?:          string | null;
    vehicleId?:              string | null;
    name?:                   string | null;
    documentsSubmitted?:     boolean | null;
    onboardingFeeApplies?:   boolean | null;
    onboardingFeeStatus?:    string | null;
    permissionSetupVersion?: number  | null;
    verificationStatus?:     string | null;
  };
  async function deriveNextRoute(d: RoutingDoc): Promise<OnboardingRoute> {
    // Block check FIRST — suspended / blacklisted drivers must never reach the home screen.
    const isBlocked =
      d.accountStatus === "suspended" ||
      d.accountStatus === "blacklisted" ||
      d.accountStatus === "blocked";
    if (isBlocked) {
      console.log("[DERIVE_NEXT_ROUTE_REASON] accountStatus =", d.accountStatus, "→ /account-blocked");
      return "/account-blocked";
    }

    const isApproved =
      d.verificationStatus === "approved" || d.verificationStatus === "verified";

    console.log("[KYC_ROUTE_DECISION]", JSON.stringify({
      vehicleId:              d.vehicleId              ?? null,
      name:                   d.name                   ?? null,
      isApproved,
      verificationStatus:     d.verificationStatus     ?? null,
      documentsSubmitted:     d.documentsSubmitted     ?? false,
      onboardingFeeApplies:   d.onboardingFeeApplies   ?? false,
      onboardingFeeStatus:    d.onboardingFeeStatus    ?? null,
      permissionSetupVersion: d.permissionSetupVersion ?? 0,
    }));

    // Any incomplete onboarding step → single registration screen.
    const needsRegistration =
      !d.vehicleId ||
      !d.name ||
      (!isApproved && !d.documentsSubmitted) ||
      (!isApproved && d.onboardingFeeApplies === true && d.onboardingFeeStatus !== "paid");

    if (needsRegistration) {
      console.log("[DERIVE_NEXT_ROUTE_REASON] onboarding incomplete → /registration", JSON.stringify({
        vehicleId:          d.vehicleId ?? null,
        name:               d.name ?? null,
        documentsSubmitted: d.documentsSubmitted,
        feeApplies:         d.onboardingFeeApplies,
        feeStatus:          d.onboardingFeeStatus ?? null,
      }));
      return "/registration";
    }

    if (!isApproved) {
      console.log("[DERIVE_NEXT_ROUTE_REASON] not approved + docs submitted → /verification-pending");
      return "/verification-pending";
    }

    // Approved — check real-time permissions on native.
    // Web preview skips hardware permission checks entirely.
    if (Platform.OS !== "web") {
      const setupVersionOk = (d.permissionSetupVersion ?? 0) >= PERMISSION_SETUP_VERSION;
      if (!setupVersionOk) {
        console.log("[DERIVE_NEXT_ROUTE_REASON] approved + permSetup incomplete (ver =", d.permissionSetupVersion ?? 0, ") → /background-setup");
        return "/background-setup";
      }
      const [notifOk, locStatus] = await Promise.all([
        checkNotificationPermissions().catch(() => false),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      ]);
      const permsGranted = notifOk && locStatus.granted;
      if (!permsGranted) {
        console.log("[DERIVE_NEXT_ROUTE_REASON] approved + perms not granted (notif =", notifOk, "loc =", locStatus.granted, ") → /background-setup");
        return "/background-setup";
      }
    } else {
      if ((d.permissionSetupVersion ?? 0) < PERMISSION_SETUP_VERSION) {
        console.log("[DERIVE_NEXT_ROUTE_REASON] web + permSetup incomplete → /background-setup");
        return "/background-setup";
      }
    }

    console.log("[APPROVED_DRIVER_ROUTE] verificationStatus =", d.verificationStatus, "+ all checks passed → /(tabs)");
    return "/(tabs)";
  }

  // Shared post-credential session establishment used by BOTH confirmOtp and
  // confirmPin. Given a Firebase custom token (returned by verify-otp OR
  // verify-pin), it signs in, loads the PostgreSQL profile, computes the next
  // route, and releases the layout route-guard via isOtpVerified. Callers store
  // the single-device sessionId BEFORE invoking this, so the profile fetch
  // already carries the x-session-id header.
  const establishSession = async (
    token: string,
    phone: string,
  ): Promise<ConfirmOtpResult> => {
    // ── Block the layout route-guard BEFORE touching Firebase Auth ────────────
    // onAuthStateChanged fires synchronously inside signInWithCustomToken and
    // immediately sets driverUid via setDriverUid(). If isOtpVerified is still
    // false at that moment, _layout.tsx routes to /login → flash.
    // Setting isOtpVerifying=true here tells _layout.tsx to skip all routing
    // until we clear the flag together with setIsOtpVerified(true) below.
    console.log("[PERF] otp_verify_start ts=" + Date.now());
    console.log("[OTP_VERIFY_START] blocking layout route-guard; about to call signInWithCustomToken");
    setIsOtpVerifying(true);

    try {
      const credential = await signInWithCustomToken(firebaseAuth, token);
      const uid        = credential.user.uid;
      console.log("[FLOW] establishSession — signInWithCustomToken SUCCESS, uid:", uid);
      console.log("[OTP_VERIFY_SESSION_READY] Firebase session established — uid =", uid, "| isOtpVerifying guard is active");
      setDriverUid(uid);
      console.log("[FLOW] establishSession — setDriverUid called");
      setPhoneState(phone);

      // ── Get a fresh ID token directly from the credential user ────────────
      // On React Native, firebaseAuth.currentUser may not be synchronised yet
      // when signInWithCustomToken's promise resolves. Using credential.user
      // directly avoids that race: the credential object IS the signed-in user
      // and getIdToken() always works on it immediately.
      let freshIdToken: string | undefined;
      try {
        freshIdToken = await credential.user.getIdToken(/* forceRefresh= */ false);
        console.log("[OTP_ID_TOKEN] obtained from credential.user —", freshIdToken.slice(0, 12) + "...");
      } catch (e) {
        console.error("[OTP_ID_TOKEN] getIdToken from credential.user failed:", e instanceof Error ? e.message : String(e));
        // Falls back to firebaseAuth.currentUser inside getDriverProfile
      }

      // ── Try PostgreSQL profile first (primary path) ──────────────────────
      console.log("[PERF] get_driver_profile_start confirmOtp ts=" + Date.now());
      let pgProfile = await getDriverProfile(freshIdToken);
      console.log("[PERF] get_driver_profile_end confirmOtp ts=" + Date.now() + " pgProfile=" + (pgProfile ? "ok" : "null"));

      // ── Retry once on null (e.g. transient token or network blip) ─────────
      if (!pgProfile) {
        console.warn("[OTP_PROFILE_RETRY] first getDriverProfile returned null — retrying after 400ms");
        await new Promise<void>((r) => setTimeout(r, 400));
        // Re-fetch idToken in case the first one expired (unlikely but safe)
        let retryToken: string | undefined = freshIdToken;
        try {
          retryToken = await credential.user.getIdToken(/* forceRefresh= */ false);
        } catch { /* fall back to freshIdToken */ }
        pgProfile = await getDriverProfile(retryToken);
        console.log("[OTP_PROFILE_RETRY] result:", pgProfile ? "ok" : "still null");
      }

      let routingDoc: RoutingDoc;               // used for deriveNextRoute
      let serverNextRoute: string | undefined;  // nextRoute from server (PG path; primary)

      if (!pgProfile) {
        // ── Guard: distinguish 404 (new driver) from server errors ──────────
        // A 404 means the driver has no PG row → brand-new driver, safe to
        // call ensureDriverSignup. Any other outcome (network failure, 500,
        // wrong domain, HTML "Cannot GET", etc.) means we must NOT call
        // ensureDriverSignup — that would create a spurious PG row for an
        // existing driver whose profile fetch happened to fail.
        const retryFetchDbg = getLastProfileFetchDebug();
        if (retryFetchDbg?.source !== "404") {
          const errDetail = retryFetchDbg
            ? `status=${retryFetchDbg.status ?? "??"} src=${retryFetchDbg.source} url=${retryFetchDbg.url}`
            : "no fetch debug";
          console.error("[OTP_PROFILE_GATE] source ≠ 404 — skipping ensureDriverSignup:", errDetail);
          console.error("[OTP_PROFILE_GATE] body sample:", retryFetchDbg?.rawBody?.slice(0, 200));
          setIsOtpVerifying(false);
          return {
            ok:              false,
            profileComplete: false,
            error:           `Could not load driver profile (${errDetail}). Check your connection and try again.`,
          };
        }
        // ── Brand-new driver: 404 = no PG row yet ───────────────────────────
        // Firestore fallback removed (Phase 1 migration complete). Create the
        // PG row directly via ensureDriverSignup, then re-fetch so all state
        // is always sourced from PostgreSQL — no Firestore reads in this path.
        console.log("[FIRESTORE_FALLBACK_BLOCKED] uid=" + uid + " — pgProfile null after retry (404); calling ensureDriverSignup");
        const signupResult = await ensureDriverSignup({ phone });
        if (signupResult.ok) {
          console.log("[PG_PROFILE_RESTORE] ensureDriverSignup ok — re-fetching PG profile for uid =", uid);
        } else {
          console.warn("[PG_PROFILE_RESTORE] ensureDriverSignup failed (non-fatal) — using safe defaults uid =", uid);
        }
        // Pass fresh token here too — same race applies to this second fetch.
        const pg2 = await getDriverProfile(freshIdToken);
        console.log("[PG_PROFILE_RESTORE] re-fetch after ensureDriverSignup —", pg2 ? "ok nextRoute=" + (pg2.nextRoute ?? "none") : "still null (using safe defaults)");

        const feeApplies = pg2?.onboardingFeeApplies ?? true;
        const feeStatus  = pg2?.onboardingFeeStatus  ?? "pending";
        const feeAmount  = pg2?.onboardingFeeAmount  ?? 10;

        if (pg2?.name) {
          setProfileState({
            name:          pg2.name          ?? "",
            city:          pg2.city          ?? "",
            gender:        pg2.gender        ?? "",
            licenseNumber: pg2.licenseNumber ?? "",
            vehicleNumber: pg2.vehicleNumber ?? "",
          });
        }
        if (pg2?.vehicleId) {
          setVehicleState({ id: pg2.vehicleId, name: pg2.vehicleName ?? "" });
        }
        setAccountStatus(pg2?.accountStatus ?? null);
        setSuspendReason(pg2?.suspendReason ?? null);
        setBlacklistReason(pg2?.blacklistReason ?? null);
        setOnlineState(false); // isOnline not stored in PG; always start offline
        // Subscription is NOT carried by GET /api/drivers/me — read the
        // authoritative status from GET /api/driver-plans/status (fire-and-forget).
        void syncSubscriptionFromServer();
        {
          const today   = new Date().toISOString().slice(0, 10);
          const sameDay = pg2?.todayDate === today;
          setTodayEarnings(sameDay ? (pg2?.todayEarnings ?? 0) : 0);
          setTripsToday   (sameDay ? (pg2?.tripsToday    ?? 0) : 0);
          setDriverRating(String(pg2?.rating ?? 5.0));
        }
        // Wallet — fire-and-forget REST read (must NOT block OTP→next-screen routing)
        void getWallet(uid).then((walletDoc) => {
          if (!walletDoc) return;
          setBalance(walletDoc.balance ?? 0);
          setLifetimeEarnings(walletDoc.totalEarnings ?? 0);
          setTotalPaid(walletDoc.totalPaid ?? 0);
          setDriverTrips(walletDoc.completedDeliveries ?? 0);
        }).catch(() => {});
        void loadDriverTransactions(uid);
        setVerifStatus(pg2?.verificationStatus ?? null);
        if (pg2?.verificationStatus) {
          void AsyncStorage.setItem(LOCAL_VERIFICATION_KEY, pg2.verificationStatus).catch(() => {});
        }
        setDocsSubmitted(pg2?.documentsSubmitted ?? false);
        setKycRejectionReason(pg2?.kycRejectionReason ?? null);
        setKycDocuments((pg2?.documents ?? null) as unknown as NonNullable<DriverDoc["documents"]>);
        setBackgroundSetupShown(pg2?.backgroundSetupShown ?? false);
        {
          const pgPermVer = pg2?.permissionSetupVersion ?? 0;
          setPermissionSetupVersion(pgPermVer);
          if (pgPermVer > 0) {
            setLocalPermissionVersion(pgPermVer);
            void AsyncStorage.setItem(LOCAL_PERMISSION_KEY, String(pgPermVer)).catch(() => {});
            console.log("[PERMISSION_GATE] confirmOtp new-driver — localVer synced =", pgPermVer);
          }
        }
        setOnboardingFeeApplies(feeApplies);
        setOnboardingFeeStatus(feeStatus);
        setOnboardingFeeAmount(feeAmount);
        serverNextRoute = pg2?.nextRoute;
        routingDoc = {
          accountStatus:          pg2?.accountStatus          ?? "active",
          vehicleId:              pg2?.vehicleId              ?? null,
          name:                   pg2?.name                   ?? null,
          documentsSubmitted:     pg2?.documentsSubmitted     ?? false,
          onboardingFeeApplies:   feeApplies,
          onboardingFeeStatus:    feeStatus,
          permissionSetupVersion: pg2?.permissionSetupVersion ?? 0,
          verificationStatus:     pg2?.verificationStatus     ?? null,
        };
      } else {
        // ── PG path: existing driver with PostgreSQL row (primary) ────────────
        if (pgProfile.name) {
          setProfileState({
            name:          pgProfile.name          ?? "",
            city:          pgProfile.city          ?? "",
            gender:        pgProfile.gender        ?? "",
            licenseNumber: pgProfile.licenseNumber ?? "",
            vehicleNumber: pgProfile.vehicleNumber ?? "",
          });
        }
        if (pgProfile.vehicleId) {
          setVehicleState({ id: pgProfile.vehicleId, name: pgProfile.vehicleName ?? "" });
        }
        setAccountStatus(pgProfile.accountStatus ?? null);
        setSuspendReason(pgProfile.suspendReason ?? null);
        setBlacklistReason(pgProfile.blacklistReason ?? null);
        {
          const isSuspended =
            pgProfile.accountStatus === "suspended" ||
            pgProfile.accountStatus === "blacklisted" ||
            pgProfile.accountStatus === "blocked";
          setOnlineState(isSuspended ? false : false); // isOnline not stored in PG
        }
        // Subscription is NOT carried by GET /api/drivers/me — read the
        // authoritative status from GET /api/driver-plans/status (fire-and-forget).
        void syncSubscriptionFromServer();
        {
          const today   = new Date().toISOString().slice(0, 10);
          const sameDay = pgProfile.todayDate === today;
          setTodayEarnings(sameDay ? (pgProfile.todayEarnings ?? 0) : 0);
          setTripsToday   (sameDay ? (pgProfile.tripsToday    ?? 0) : 0);
          setDriverRating(String(pgProfile.rating ?? 5.0));
        }
        // Wallet — fire-and-forget REST read (must NOT block OTP→next-screen routing)
        console.log("[PERF] wallet_fetch_start confirmOtp_pg");
        void getWallet(uid).then((walletDoc) => {
          console.log("[PERF] wallet_fetch_end confirmOtp_pg");
          if (!walletDoc) return;
          setBalance(walletDoc.balance ?? 0);
          setLifetimeEarnings(walletDoc.totalEarnings ?? 0);
          setTotalPaid(walletDoc.totalPaid ?? 0);
          setDriverTrips(walletDoc.completedDeliveries ?? 0);
        }).catch(() => {});
        void loadDriverTransactions(uid);
        setVerifStatus(pgProfile.verificationStatus ?? null);
        if (pgProfile.verificationStatus) {
          void AsyncStorage.setItem(LOCAL_VERIFICATION_KEY, pgProfile.verificationStatus).catch(() => {});
        }
        setDocsSubmitted(pgProfile.documentsSubmitted ?? false);
        setKycRejectionReason(pgProfile.kycRejectionReason ?? null);
        setKycDocuments(pgProfile.documents as unknown as NonNullable<DriverDoc["documents"]>);
        setBackgroundSetupShown(pgProfile.backgroundSetupShown ?? false);
        {
          const pgPermVer = pgProfile.permissionSetupVersion ?? 0;
          setPermissionSetupVersion(pgPermVer);
          if (pgPermVer > 0) {
            setLocalPermissionVersion(pgPermVer);
            void AsyncStorage.setItem(LOCAL_PERMISSION_KEY, String(pgPermVer)).catch(() => {});
            console.log("[PERMISSION_GATE] confirmOtp — localVer synced =", pgPermVer);
          }
        }
        setOnboardingFeeApplies(pgProfile.onboardingFeeApplies ?? false);
        setOnboardingFeeStatus(pgProfile.onboardingFeeStatus ?? null);
        setOnboardingFeeAmount(pgProfile.onboardingFeeAmount ?? null);
        serverNextRoute = pgProfile.nextRoute;
        routingDoc = pgProfile;
      }

      const profileComplete = !!(routingDoc.name && routingDoc.vehicleId);
      console.log("[PERF] next_route_start confirmOtp ts=" + Date.now());
      const nextRoute = serverNextRoute
        ? mapServerNextRoute(serverNextRoute)
        : await deriveNextRoute(routingDoc);
      console.log("[PERF] next_route_end confirmOtp ts=" + Date.now() + " nextRoute=" + nextRoute);
      {
        const vehicleComplete = !!routingDoc.vehicleId;
        const docsComplete    = routingDoc.documentsSubmitted ?? false;
        const feePaid         = !routingDoc.onboardingFeeApplies || routingDoc.onboardingFeeStatus === "paid";
        console.log(
          "[ROUTE_DECISION]",
          "uid=" + uid,
          "profileComplete=" + profileComplete,
          "vehicleComplete=" + vehicleComplete,
          "docsComplete="    + docsComplete,
          "feePaid="         + feePaid,
          "verificationStatus=" + (routingDoc.verificationStatus ?? "null"),
          "nextRoute="       + nextRoute,
        );
      }

      // ── OTP_ROUTE logs — required by auth policy ──────────────────────────
      console.log("[OTP_ROUTE] otp_success_uid =", uid);
      console.log("[OTP_ROUTE] driver_doc =", JSON.stringify({
        vehicleId:              routingDoc.vehicleId              ?? null,
        name:                   routingDoc.name                   ?? null,
        documentsSubmitted:     routingDoc.documentsSubmitted     ?? false,
        verificationStatus:     routingDoc.verificationStatus     ?? null,
        onboardingFeeStatus:    routingDoc.onboardingFeeStatus    ?? null,
        permissionSetupVersion: routingDoc.permissionSetupVersion ?? 0,
      }));
      console.log("[OTP_ROUTE] chosenRoute =", nextRoute);

      // Mark OTP as verified — this is the ONLY place this flag is set true.
      // _layout.tsx reads it to decide whether to gate on /login or allow the
      // post-OTP route chosen above.
      //
      // IMPORTANT: setIsOtpVerifying(false) is batched in the SAME React render
      // as setIsOtpVerified(true). This guarantees _layout.tsx never sees a state
      // where isOtpVerifying=false AND isOtpVerified=false simultaneously, which
      // would cause it to route back to /login.
      console.log("[OTP_FINAL_ROUTE] releasing layout guard — isOtpVerified=true, isOtpVerifying=false, nextRoute =", nextRoute);
      setIsOtpVerified(true);
      setIsOtpVerifying(false);
      // Persist the verified uid so session survives app backgrounding / cold start.
      try {
        await AsyncStorage.setItem(SESSION_VERIFIED_KEY, uid);
        console.log("[OTP_SESSION] saved uid =", uid);
      } catch {
        // Non-fatal — next cold start will require re-OTP.
      }

      // ── Debug log for OTP overlay (diagnostic, shown on physical device) ──
      // Collect all 11 runtime items so the debug overlay in login.tsx can
      // display them before routing. Non-fatal: any failure is swallowed.
      const debugLog: string[] = [];
      try {
        const fetchDbg = getLastProfileFetchDebug();
        const [pvRaw, vsRaw, svRaw] = await Promise.all([
          AsyncStorage.getItem(LOCAL_PERMISSION_KEY).catch(() => null),
          AsyncStorage.getItem(LOCAL_VERIFICATION_KEY).catch(() => null),
          AsyncStorage.getItem(SESSION_VERIFIED_KEY).catch(() => null),
        ]);
        // Item 8: quick verification-status ping
        let vsStatus = "skipped"; let vsBody = "";
        try {
          const base    = fetchDbg?.url?.replace("/drivers/me", "") ?? "/api/drivers";
          const ctrl    = new AbortController();
          const tmo     = setTimeout(() => ctrl.abort(), 3000);
          const vsRes   = await fetch(`${base}/drivers/verification-status`, {
            headers: { Authorization: `Bearer ${freshIdToken ?? ""}` },
            signal: ctrl.signal,
          });
          clearTimeout(tmo);
          vsStatus = String(vsRes.status);
          vsBody   = (await vsRes.text().catch(() => "")).slice(0, 150);
        } catch (e) {
          vsStatus = "ERR";
          vsBody   = e instanceof Error ? e.message.slice(0, 80) : String(e);
        }
        debugLog.push(`1. DOMAIN: ${process.env["EXPO_PUBLIC_DOMAIN"] || "(not set)"}`);
        debugLog.push(`2. BASE_URL: ${fetchDbg?.url?.replace("/drivers/me", "") ?? "?"}`);
        debugLog.push(`3. UID: ${uid}`);
        debugLog.push(`4. Token: credential.user — ${freshIdToken ? freshIdToken.slice(0, 16) + "..." : "FAILED"}`);
        debugLog.push(`5. /drivers/me URL: ${fetchDbg?.url ?? "?"}`);
        debugLog.push(`6. /drivers/me status: ${fetchDbg?.status ?? "??"}`);
        debugLog.push(`7. /drivers/me body: ${(fetchDbg?.rawBody ?? "(none)").slice(0, 200)}`);
        debugLog.push(`8. /verification-status: ${vsStatus} → ${vsBody}`);
        debugLog.push(`9. serverNextRoute: ${serverNextRoute ?? "(none — deriveNextRoute used)"}`);
        debugLog.push(`10. router target: ${nextRoute}`);
        debugLog.push(`11. AS: permVer=${pvRaw ?? "none"} verifSt=${vsRaw ?? "none"} sessUid=${svRaw ?? "none"}`);
      } catch { /* non-fatal */ }

      return { ok: true, profileComplete, nextRoute, debugLog };
    } catch (err) {
      // Release the layout route-guard on any failure so normal auth routing resumes.
      setIsOtpVerifying(false);
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      return { ok: false, profileComplete: false, error: msg };
    }
  };

  // OTP path — first-time PIN setup and forgot/reset only. Verifies the OTP,
  // claims this device with the server-minted session id, then establishes the
  // Firebase session and routing.
  const confirmOtp = async (
    phone: string,
    otp:   string,
  ): Promise<ConfirmOtpResult> => {
    const apiResult = await verifyOtpApi(phone, otp);
    console.log("[FLOW] DriverContext.confirmOtp — verifyOtpApi ok:", apiResult.ok, "| token present:", apiResult.ok ? !!apiResult.token : false, "| sessionId returned:", apiResult.ok ? !!apiResult.sessionId : false);
    if (!apiResult.ok) return { ok: false, profileComplete: false, error: apiResult.error };
    if (apiResult.sessionId) {
      await setSessionId(apiResult.sessionId);
      console.log("[FLOW] DriverContext.confirmOtp — setSessionId called with verify-otp sessionId");
    } else {
      console.warn("[FLOW] DriverContext.confirmOtp — verify-otp returned NO sessionId; keeping existing session");
    }
    return establishSession(apiResult.token, phone);
  };

  // PIN path — the daily login factor (phone + 6-digit PIN). Same single-device
  // session + routing contract as confirmOtp; the server enforces the 3-attempt
  // / 24h lockout.
  const confirmPin = async (
    phone: string,
    pin:   string,
  ): Promise<ConfirmOtpResult> => {
    const apiResult = await verifyPinApi(phone, pin);
    if (!apiResult.ok) {
      return {
        ok:              false,
        profileComplete: false,
        error:           apiResult.error,
        pinNotFound:     apiResult.pinNotFound,
      };
    }
    if (apiResult.sessionId) await setSessionId(apiResult.sessionId);
    return establishSession(apiResult.token, phone);
  };

  const setProfile = (p: Profile) => {
    setProfileState(p);
    if (driverUid) {
      console.log("[PG_PROFILE_SAVE] uid=" + driverUid + " name=" + (p.name ?? "(null)"));
      patchDriverProfile(p).catch(console.error);
    }
  };

  const setVehicle = (v: Vehicle) => {
    setVehicleState(v);
    if (driverUid) {
      console.log("[PG_VEHICLE_SAVE] uid=" + driverUid + " vehicleId=" + (v.id ?? "(null)"));
      patchDriverVehicle(v).catch(console.error);
    }
  };

  const markBackgroundSetupShown = async (): Promise<void> => {
    setBackgroundSetupShown(true);
    setPermissionSetupVersion(PERMISSION_SETUP_VERSION);
    setLocalPermissionVersion(PERMISSION_SETUP_VERSION);
    // Write both the Firestore record and the local AsyncStorage cache so the
    // boot-time permission gate is accurate even when Firestore times out.
    await AsyncStorage.setItem(LOCAL_PERMISSION_KEY, String(PERMISSION_SETUP_VERSION)).catch(() => {});
    localPermVerRef.current = Promise.resolve(PERMISSION_SETUP_VERSION);
    console.log("[PERMISSION_GATE] markBackgroundSetupShown — localVer written =", PERMISSION_SETUP_VERSION);
    if (driverUid) {
      await patchDriverBackgroundSetup({
        backgroundSetupShown:       true,
        permissionSetupVersion:     PERMISSION_SETUP_VERSION,
        permissionSetupCompletedAt: new Date().toISOString(),
      });
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
        await patchDriverStatus(driverUid, false);
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
    // Clear the single-device session id so the next request carries none and
    // the device no longer claims the (now-released) server session.
    await clearSessionId();
    // Clear the subscription cache so a different driver logging in on the same
    // device cannot inherit this driver's cached plan state.
    void AsyncStorage.removeItem(LOCAL_SUBSCRIPTION_KEY).catch(() => {});
    // Reset blocked-screen navigation guard so a re-login session starts fresh.
    hasNavigatedToBlockedRef.current = false;
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
    if (v && (accountStatus === "suspended" || accountStatus === "blacklisted" || accountStatus === "blocked")) {
      return { ok: false, reason: "Your account has been suspended. Please contact support." };
    }
    if (v && !subscriptionActive) {
      return { ok: false, reason: "Your subscription has expired. Activate a plan to go online." };
    }
    setOnlineState(v);
    if (driverUid) {
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

  // DISABLED (PG source-of-truth): the legacy wallet-based local activation used to
  // set subscriptionPlan/subscriptionExpiresAt on the client (Date.now() + N days),
  // creating a local "active plan" that bypassed the backend. The ONLY authoritative
  // activation is now the server: POST /api/driver-plans/verify-payment writes PG
  // driver_plans, and the app reads it back via GET /api/driver-plans/status
  // (syncSubscriptionFromServer). This function no longer writes any local plan,
  // expiry, wallet, or transaction state so no client path can fabricate a plan.
  const activatePlan: DriverState["activatePlan"] = (_id) => {
    return {
      ok: false,
      reason: "Activate your plan from the subscription screen — it is confirmed by the server after payment.",
    };
  };

  // Authoritative subscription sync. The production backend serves the active
  // plan ONLY from GET /api/driver-plans/status (fallback /current); GET
  // /api/drivers/me does NOT carry subscription fields, so reading the profile
  // left the plan inactive after purchase and re-triggered the renewal prompt.
  const syncSubscriptionFromServer = async (): Promise<void> => {
    const status = await getDriverPlanStatus();
    if (!status) return; // network/auth failure — keep last-known (cached) state
    const normalizePlan = (id: string | null): SubPlan | null =>
      id === "daily" || id === "weekly" || id === "monthly" ? id : null;
    const plan      = status.active ? normalizePlan(status.planId) : null;
    const expiresAt = status.active ? status.expiresAt : null;
    console.log("[syncSubscription] active:", status.active, "planId:", status.planId, "expiresAt:", expiresAt);
    // Unconditional updates so an expired/removed plan is always cleared locally.
    setSubPlan(plan);
    setSubExp(expiresAt);
    persistSubscriptionCache(plan, expiresAt);
  };

  const refreshSubscription = async (): Promise<void> => {
    if (!driverUid) return;
    try {
      await syncSubscriptionFromServer();
    } catch {
      // silent — stale state is preferable to an uncaught error
    }
  };

  const refreshKycStatus = async (): Promise<void> => {
    if (!driverUid) return;
    try {
      const doc = await getDriverVerificationStatus();
      if (!doc) return;
      setVerifStatus(doc.verificationStatus ?? null);
      setDocsSubmitted(doc.documentsSubmitted ?? false);
      setKycRejectionReason(doc.kycRejectionReason ?? null);
      setKycDocuments(doc.documents as unknown as NonNullable<DriverDoc["documents"]>);
      if (doc.verificationStatus) {
        void AsyncStorage.setItem(LOCAL_VERIFICATION_KEY, doc.verificationStatus).catch(() => {});
      }
      console.log("[PG_VERIFICATION_STATUS] uid=" + driverUid + " verificationStatus=" + (doc.verificationStatus ?? "(null)") + " documentsSubmitted=" + (doc.documentsSubmitted ?? false));
      console.log("[refreshKycStatus] complete — verificationStatus:", doc.verificationStatus ?? "(null)", "kycRejectionReason:", doc.kycRejectionReason ?? "(absent/deleted)", "isRejected:", doc.verificationStatus === "rejected");
    } catch {
      // silent — stale state is fine while offline
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
   * Reconcile local wallet state via REST (called after the server
   * transaction confirms).  Silently no-ops on network errors.
   */
  const refreshWallet = async (): Promise<void> => {
    if (!driverUid) return;
    try {
      const [pgDoc, w] = await Promise.all([
        getDriverProfile(),
        getWallet(driverUid),
      ]);
      // Apply wallet totals independently — a missing/unreachable driver doc
      // must not prevent the balance from being updated (e.g. after a payout).
      if (!pgDoc && !w) return;
      if (w) {
        setBalance(w.balance ?? 0);
        setLifetimeEarnings(w.totalEarnings ?? 0);
        setTotalPaid(w.totalPaid ?? 0);
      }
      if (pgDoc) {
        const today   = new Date().toISOString().slice(0, 10);
        const sameDay = pgDoc.todayDate === today;
        setTodayEarnings(sameDay ? (pgDoc.todayEarnings ?? 0) : 0);
        setTripsToday   (sameDay ? (pgDoc.tripsToday    ?? 0) : 0);
      }
    } catch {
      // silent — optimistic values remain until next successful refresh
    }
  };

  /**
   * Load the driver's transaction ledger via REST and map to Txn shape.
   *
   * Calls GET /api/wallet/:uid/transactions (PG-primary, Firestore-fallback on
   * the server).  The mobile app no longer reads the Firestore "transactions"
   * collection directly (R5 migration — Phase 5J-Tier-2).
   *
   * Called on auth, after OTP login, and after each withdrawal — ensures the
   * wallet screen always shows real data with no fake seeds.
   *
   * Token mapping:  REST "credit"     → Txn "earning"   (delivery completed)
   *                 REST "payout"     → Txn "withdraw"  (withdrawal request)
   *                 REST "adjustment" → Txn "bonus"     (manual credit/debit)
   *                 payout amounts are already normalised negative by the server
   */
  const loadDriverTransactions = async (uid: string): Promise<void> => {
    try {
      const raw      = await getWalletTransactions(uid);
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
        // createdAt is an ISO 8601 string from the REST endpoint.
        const dt      = r.createdAt ? new Date(r.createdAt) : null;
        const txnDate = dt ? fmtDate(dt) : "";
        const txnTime = dt ? fmtTime(dt) : "";

        if (r.type === "credit") {
          return {
            id:       r.id,
            type:     "earning" as const,
            title:    r.orderId
              ? `Delivery #${r.orderId.slice(-6).toUpperCase()}`
              : "Delivery earning",
            subtitle: "UPI",
            amount:   r.amount,
            status:   "completed" as const,
            time:     txnTime,
            date:     txnDate,
          };
        }
        if (r.type === "payout") {
          return {
            id:       r.id,
            type:     "withdraw" as const,
            title:    "Withdrawal via UPI",
            subtitle: r.description ?? "Payout",
            amount:   r.amount,   // normalised negative by the server
            status:   r.status === "completed"
              ? ("completed" as const)
              : ("pending"   as const),
            time:     txnTime,
            date:     txnDate,
          };
        }
        // adjustment / unknown → bonus
        return {
          id:       r.id,
          type:     "bonus" as const,
          title:    r.description ?? "Adjustment",
          subtitle: "",
          amount:   r.amount,
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
    const result = await acceptOrderViaApi(ride.id, profile?.name ?? null, driverRating, driverTrips);

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
          const result = await acceptOrderViaApi(ride.id, profileRef.current?.name ?? null, driverRatingRef.current, driverTripsRef.current);

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
    // Route through server — atomic balance check, admin visibility, ledger entry
    const result = await requestPayout(amount, upiId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        insufficient_balance: "Insufficient balance — ₹50 minimum must remain in wallet",
        exceeds_withdrawable:  "Amount exceeds your withdrawable balance",
        amount_invalid:        "Withdrawal amount must be greater than ₹0",
        upi_id_required:       "Please enter a valid UPI ID",
        network_error:         "Network error — please check your connection",
        not_authenticated:     "Please log in again and retry",
      };
      return { ok: false, reason: messages[result.error] ?? result.error };
    }
    await refreshWallet();
    void loadDriverTransactions(driverUid);
    return { ok: true };
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
        isOtpVerifying,
        phone,
        isAuthenticated,
        profile,
        vehicle,
        verificationStatus,
        documentsSubmitted,
        kycRejectionReason,
        kycDocuments,
        refreshKycStatus,
        accountStatus,
        suspendReason,
        blacklistReason,
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
        totalPaid,
        todayEarnings,
        tripsToday,
        totalTrips: driverTrips,
        transactions,
        addEarningLocally,
        refreshWallet,
        applyWalletUpdate,
        setPhone,
        confirmOtp,
        confirmPin,
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
        localPermissionVersion,
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
