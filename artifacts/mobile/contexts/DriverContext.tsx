import { router } from "expo-router";
import * as IntentLauncher from "expo-intent-launcher";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
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
  listenToDispatchedOrder,
  listenToActiveOrder,
  acceptOrder,
  rejectOrder,
  requestWithdrawal as fsRequestWithdrawal,
  updateDriverBackgroundSetup,
  type DriverDoc,
  type OrderDoc,
  type OrderStatus,
  type AcceptOrderResult,
} from "@/utils/firestore";
export type { AcceptOrderResult };
import { verifyOtpApi } from "@/utils/auth-api";
import {
  cancelIncomingOrderNotification,
  registerDriverPushToken,
  registerOrderActionHandlers,
  sendDriverAlertNotification,
  sendIncomingOrderNotification,
  sendOrderUpdateNotification,
} from "@/utils/notifications";

export type SubPlan = "daily" | "weekly" | "monthly";

export type Vehicle = { id: string; name: string };
export type Profile = { name: string; city: string; gender: string };

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

// Phase H-3: seed transactions will be replaced by Firestore reads.
const SEED_TXNS: Txn[] = [
  { id: "s1", type: "earning",  title: "Trip · Indiranagar → Whitefield",  subtitle: "9.6 km · UPI",        amount:  186,   status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s2", type: "tip",      title: "Tip from Priya S.",                subtitle: "Trip #4827",           amount:  24,    status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s3", type: "earning",  title: "Trip · HSR → Koramangala",         subtitle: "4.1 km · Cash",        amount:  92,    status: "completed", time: "1:18 PM",  date: "Today"     },
  { id: "s4", type: "bonus",    title: "Daily streak bonus",               subtitle: "10 trips completed",   amount:  150,   status: "completed", time: "11:30 AM", date: "Today"     },
  { id: "s5", type: "withdraw", title: "Withdrawal to HDFC ••2841",        subtitle: "Instant transfer",     amount: -2400,  status: "completed", time: "9:14 AM",  date: "Today"     },
  { id: "s6", type: "earning",  title: "Trip · Airport → MG Road",         subtitle: "32 km · UPI",          amount:  478,   status: "completed", time: "8:02 PM",  date: "Yesterday" },
];

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
  phone:            string | null;
  isAuthenticated:  boolean;
  profile:          Profile | null;
  vehicle:          Vehicle | null;
  verificationStatus: string | null;  // "pending" | "verified" | "rejected" | null
  documentsSubmitted: boolean;

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

  incomingRide: IncomingRide | null;
  rideHistory:  ActiveRide[];

  walletBalance:  number;
  todayEarnings:  number;
  tripsToday:     number;
  transactions:   Txn[];

  setPhone:   (p: string) => void;
  confirmOtp: (phone: string, otp: string) => Promise<ConfirmOtpResult>;
  setProfile: (p: Profile) => void;
  setVehicle: (v: Vehicle) => void;
  signOut:    () => void;

  setOnline:           (v: boolean) => { ok: boolean; reason?: string };
  activatePlan:        (id: SubPlan) => { ok: boolean; reason?: string };
  refreshSubscription: () => Promise<void>;

  // ── Wallet ──────────────────────────────────────────────────────────────
  // addEarningLocally: optimistic update after delivery (before server confirms)
  // refreshWallet:     re-reads driver doc and syncs wallet fields from Firestore
  addEarningLocally: (amount: number) => void;
  refreshWallet:     () => Promise<void>;

  acceptRide: () => Promise<AcceptOrderResult>;
  rejectRide: () => void;
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
function orderDocToRide(order: OrderDoc): IncomingRide {
  return {
    id:               order.id,
    pickup:           order.pickup,
    pickupSub:        order.pickupSub         ?? "",
    pickupCity:       order.pickupCity,
    drop:             order.drop,
    dropSub:          order.dropSub           ?? "",
    dropCity:         order.dropCity,
    distanceKm:       order.distanceKm        ?? 0,
    pickupDistanceKm: order.pickupDistanceKm  ?? 0,
    durationMin:      order.durationMin       ?? 0,
    fareEstimate:     order.fareEstimate      ?? 0,
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
  const [driverUid,   setDriverUid]   = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [phone,       setPhoneState]  = useState<string | null>(null);
  const [profile,     setProfileState]= useState<Profile | null>(null);
  const [vehicle,     setVehicleState]= useState<Vehicle | null>(null);
  const [verificationStatus, setVerifStatus]  = useState<string | null>(null);
  const [documentsSubmitted, setDocsSubmitted] = useState<boolean>(false);

  const [isOnline, setOnlineState] = useState(false);

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

  const [incomingRide, setIncomingRide] = useState<IncomingRide | null>(null);
  const [rideHistory,  setHistory]      = useState<ActiveRide[]>([]);

  const [walletBalance,  setBalance]      = useState(0);
  const [todayEarnings,  setTodayEarnings]= useState(0);
  const [tripsToday,     setTripsToday]   = useState(0);
  const [transactions,   setTxns]         = useState<Txn[]>(SEED_TXNS);
  const [driverRating,   setDriverRating] = useState<number | string>("5.0");
  const [driverTrips,    setDriverTrips]  = useState<number>(0);

  const [overlayPermissionGranted,  setOverlayPermissionGranted]  = useState(false);
  const [backgroundSetupShown,      setBackgroundSetupShown]      = useState(false);
  const [onboardingFeeApplies,      setOnboardingFeeApplies]      = useState(false);
  const [onboardingFeeStatus,       setOnboardingFeeStatus]       = useState<string | null>(null);
  const [onboardingFeeAmount,       setOnboardingFeeAmount]       = useState<number | null>(null);

  const isAuthenticated = !!driverUid;

  // Refs used by notification action handlers (registered once, no stale closure)
  const incomingRideRef = useRef<IncomingRide | null>(null);
  const driverUidRef    = useRef<string | null>(null);
  const profileRef      = useRef<Profile | null>(null);
  const driverRatingRef = useRef<number | string>("5.0");
  const driverTripsRef  = useRef<number>(0);
  useEffect(() => { incomingRideRef.current  = incomingRide;   }, [incomingRide]);
  useEffect(() => { driverUidRef.current     = driverUid;      }, [driverUid]);
  useEffect(() => { profileRef.current       = profile;        }, [profile]);
  useEffect(() => { driverRatingRef.current  = driverRating;   }, [driverRating]);
  useEffect(() => { driverTripsRef.current   = driverTrips;    }, [driverTrips]);

  // ─── Firebase Auth listener — restores session on app restart ──────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        setDriverUid(user.uid);
        const phoneFromUid = user.uid.startsWith("91") ? user.uid.slice(2) : user.uid;
        setPhoneState(phoneFromUid);
        try {
          const driverDoc = await getDriverDoc(user.uid);
          if (driverDoc) {
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
            // Restore persisted online status and subscription
            setOnlineState(driverDoc.isOnline ?? false);
            if (driverDoc.subscriptionPlan) {
              setSubPlan(driverDoc.subscriptionPlan as SubPlan);
            }
            if (driverDoc.subscriptionExpiresAt) {
              setSubExp(driverDoc.subscriptionExpiresAt);
            }
            // Restore wallet — apply daily reset if todayDate has changed
            {
              const today     = new Date().toISOString().slice(0, 10);
              const sameDay   = driverDoc.todayDate === today;
              setBalance(driverDoc.walletBalance ?? 0);
              setTodayEarnings(sameDay ? (driverDoc.todayEarnings ?? 0) : 0);
              setTripsToday   (sameDay ? (driverDoc.tripsToday    ?? 0) : 0);
            }
            // Document verification status
            setVerifStatus(driverDoc.verificationStatus ?? null);
            setDocsSubmitted(driverDoc.documentsSubmitted ?? false);
            setBackgroundSetupShown(driverDoc.backgroundSetupShown ?? false);
            setOnboardingFeeApplies(driverDoc.onboardingFeeApplies ?? false);
            setOnboardingFeeStatus(driverDoc.onboardingFeeStatus ?? null);
            setOnboardingFeeAmount(driverDoc.onboardingFeeAmount ?? null);
            setDriverRating(driverDoc.rating ?? "5.0");
            setDriverTrips(driverDoc.totalTrips ?? 0);
          }
          // Restore up to 3 active orders if driver app was restarted mid-delivery.
          // getActiveOrdersForDriver returns newest-first, capped at MAX_ACTIVE_ORDERS.
          try {
            const activeOrderDocs = await getActiveOrdersForDriver(user.uid, MAX_ACTIVE_ORDERS);
            if (activeOrderDocs.length > 0) {
              const restoredRides: ActiveRide[] = activeOrderDocs.map((doc) => {
                const ride = orderDocToRide(doc);
                // Use the real Firestore acceptedAt so ElapsedTimer shows true elapsed time
                // after an app restart. Firestore Timestamps expose .toMillis(); fall back
                // to Date.now() only if the field is missing (e.g. very old orders).
                const acceptedAtMs =
                  (doc.acceptedAt as { toMillis?: () => number })?.toMillis?.() ??
                  Date.now();
                return { ...ride, acceptedAt: acceptedAtMs, orderStatus: doc.status };
              });
              setActiveOrders(restoredRides);
              // Focus the newest order (index 0 — sorted by acceptedAt desc).
              setCurrentActiveOrderId(restoredRides[0]!.id);
            }
          } catch {
            // Active order restore failed — driver sees no active delivery after restart
          }
        } catch {
          // Firestore read failed — user remains authenticated, profile stays null
        }

        // Register FCM push token — fire-and-forget, never blocks auth or navigation.
        // No-ops safely in Expo Go and when google-services.json is absent from the build.
        registerDriverPushToken(user.uid).catch(console.error);
      } else {
        setDriverUid(null);
      }
      setAuthLoading(false);
    });
    return unsub;
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

  // ─── Firestore incoming order listener ────────────────────────────────────
  // Runs whenever the driver is online and authenticated.
  // Listens for orders where { driverUid == uid, status == "dispatched" }.
  // Customer app writes such a document to dispatch an order to this driver.
  const lastSeenOrderId = useRef<string | null>(null);
  useEffect(() => {
    // Capacity gate: only listen for new orders when a slot is free and plan is active.
    // Phase 4: isAtCapacity allows up to MAX_ACTIVE_ORDERS concurrent orders.
    if (!isOnline || !driverUid || isAtCapacity || !subscriptionActive) return;

    const unsub = listenToDispatchedOrder(driverUid, (order) => {
      if (!order) {
        // No dispatched order — clear incoming state if it was from Firestore
        setIncomingRide((prev) =>
          prev && prev.id === lastSeenOrderId.current ? null : prev,
        );
        return;
      }

      // Avoid re-triggering for an order already being shown
      if (order.id === lastSeenOrderId.current) return;
      lastSeenOrderId.current = order.id;

      const ride = orderDocToRide(order);
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
  // Use .length (not the array) so the effect only re-runs when the slot count
  // changes, not on every internal order-status update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, driverUid, activeOrders.length, subscriptionActive]);

  // ─── Auth actions ─────────────────────────────────────────────────────────
  const setPhone = (p: string) => setPhoneState(p);

  /**
   * Derive the correct next screen based on the driver's onboarding state.
   * Applied consistently after OTP verify and after auth restore.
   *
   * Priority order:
   *   1. No vehicleId         → pick a vehicle
   *   2. No name              → complete profile
   *   3. Docs not submitted   → upload documents
   *   4. Not yet approved     → await verification
   *   5. Approved             → main app
   */
  function deriveNextRoute(d: DriverDoc): OnboardingRoute {
    if (!d.vehicleId)          return "/vehicle-selection";
    if (!d.name)               return "/profile-setup";
    if (!d.documentsSubmitted) return "/document-upload";
    // Show the fee screen ONLY when ALL three conditions are true:
    //   1. onboardingFeeApplies is explicitly true (set at createDriverDoc time)
    //   2. fee has not been paid yet
    //   3. driver is not yet approved (approved = already past onboarding)
    // Existing drivers NEVER have onboardingFeeApplies set, so they skip entirely.
    if (d.onboardingFeeApplies === true && d.onboardingFeeStatus !== "paid" && d.verificationStatus !== "approved") {
      return "/onboarding-fee";
    }
    if (d.verificationStatus !== "approved") return "/verification-pending";
    if (!d.backgroundSetupShown)             return "/background-setup";
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
        setOnlineState(driverDoc.isOnline ?? false);
        if (driverDoc.subscriptionPlan)      setSubPlan(driverDoc.subscriptionPlan as SubPlan);
        if (driverDoc.subscriptionExpiresAt) setSubExp(driverDoc.subscriptionExpiresAt);
        // Restore wallet
        {
          const today   = new Date().toISOString().slice(0, 10);
          const sameDay = driverDoc.todayDate === today;
          setBalance(driverDoc.walletBalance ?? 0);
          setTodayEarnings(sameDay ? (driverDoc.todayEarnings ?? 0) : 0);
          setTripsToday   (sameDay ? (driverDoc.tripsToday    ?? 0) : 0);
        }
        // Restore verification/document state (needed for routing below)
        setVerifStatus(driverDoc.verificationStatus ?? null);
        setDocsSubmitted(driverDoc.documentsSubmitted ?? false);
        setBackgroundSetupShown(driverDoc.backgroundSetupShown ?? false);
        // Restore onboarding fee state — absent on existing/old drivers (defaults to false/null).
        setOnboardingFeeApplies(driverDoc.onboardingFeeApplies ?? false);
        setOnboardingFeeStatus(driverDoc.onboardingFeeStatus ?? null);
        setOnboardingFeeAmount(driverDoc.onboardingFeeAmount ?? null);
        setDriverRating(driverDoc.rating ?? "5.0");
        setDriverTrips(driverDoc.totalTrips ?? 0);
      }

      const profileComplete = !!(driverDoc.name && driverDoc.vehicleId);
      const nextRoute       = deriveNextRoute(driverDoc);
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
    if (driverUid) {
      await updateDriverBackgroundSetup(driverUid);
    }
  };

  // Updates local state only. Server has already written onboardingFeeStatus="paid"
  // to Firestore during the verify-payment API call. No client-side Firestore write needed.
  const markOnboardingFeePaidLocally = (): void => {
    setOnboardingFeeStatus("paid");
  };

  const signOut = () => {
    if (driverUid) {
      updateDriverOnlineStatus(driverUid, false).catch(console.error);
    }
    firebaseSignOut(firebaseAuth).catch(console.error);

    // Explicitly drain the listener map before clearing state so no Firestore
    // callbacks can fire after sign-out and attempt to update unmounted state.
    for (const unsub of activeOrderListenersRef.current.values()) {
      unsub();
    }
    activeOrderListenersRef.current.clear();

    setDriverUid(null);
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
    setDocsSubmitted(false);
    setBackgroundSetupShown(false);
    setOnboardingFeeApplies(false);
    setOnboardingFeeStatus(null);
    setOnboardingFeeAmount(null);
    lastSeenOrderId.current = null;
  };

  // ─── Online / subscription ────────────────────────────────────────────────
  const setOnline: DriverState["setOnline"] = (v) => {
    if (v && !subscriptionActive) {
      return { ok: false, reason: "Your subscription has expired. Activate a plan to go online." };
    }
    setOnlineState(v);
    if (driverUid) {
      updateDriverOnlineStatus(driverUid, v).catch(console.error);
    }
    if (!v) {
      // Going offline — clear any pending incoming ride
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
      setTodayEarnings(sameDay ? (d.todayEarnings ?? 0) : 0);
      setTripsToday   (sameDay ? (d.tripsToday    ?? 0) : 0);
    } catch {
      // silent — optimistic values remain until next successful refresh
    }
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
    //    The transaction reads the order doc, verifies status==="dispatched" and
    //    driverUid===uid, then writes accepted fields in a single atomic operation.
    //    If another driver beat us, the transaction throws and we get ok:false.
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
    const accepted: ActiveRide = { ...ride, acceptedAt: Date.now(), orderStatus: "accepted" };
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
    // been accepted, cancelled, or reassigned.  Fire-and-forget is fine here:
    // the UI clears immediately regardless of the Firestore result, and the
    // transaction's no-op on failure is the correct behaviour (do not overwrite
    // an already-accepted order with "rejected").
    rejectOrder(ride.id, uid).catch(console.error);

    // Always clear local state so the request screen dismisses cleanly.
    setIncomingRide(null);
    lastSeenOrderId.current = null; // allow next dispatch to arrive
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
          if (localStatus === "accepted" || localStatus === "to_pickup") {
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
      // refresh to get the server-confirmed balance.
      await refreshWallet();
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
        phone,
        isAuthenticated,
        profile,
        vehicle,
        verificationStatus,
        documentsSubmitted,
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
        rideHistory,
        walletBalance,
        todayEarnings,
        tripsToday,
        transactions,
        addEarningLocally,
        refreshWallet,
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
        recoverIncomingRide,
        endRide,
        focusOrder,
        orderRemovalReasons,
        requestWithdrawal,
        backgroundSetupShown,
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
