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
  updateDriverProfile,
  updateDriverVehicle,
  updateDriverOnlineStatus,
  updateDriverSubscription,
  listenToDispatchedOrder,
  acceptOrder,
  rejectOrder,
  type OrderDoc,
} from "@/utils/firestore";
import { verifyOtpApi } from "@/utils/auth-api";
import {
  cancelIncomingOrderNotification,
  registerOrderActionHandlers,
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

export type ActiveRide = IncomingRide & { acceptedAt: number };

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

const PLAN_DAYS:  Record<SubPlan, number> = { daily: 1,  weekly: 7,   monthly: 30  };
const PLAN_PRICE: Record<SubPlan, number> = { daily: 19, weekly: 99,  monthly: 349 };

// Phase H-3: seed transactions will be replaced by Firestore reads.
const SEED_TXNS: Txn[] = [
  { id: "s1", type: "earning",  title: "Trip · Indiranagar → Whitefield",  subtitle: "9.6 km · UPI",        amount:  186,   status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s2", type: "tip",      title: "Tip from Priya S.",                subtitle: "Trip #4827",           amount:  24,    status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s3", type: "earning",  title: "Trip · HSR → Koramangala",         subtitle: "4.1 km · Cash",        amount:  92,    status: "completed", time: "1:18 PM",  date: "Today"     },
  { id: "s4", type: "bonus",    title: "Daily streak bonus",               subtitle: "10 trips completed",   amount:  150,   status: "completed", time: "11:30 AM", date: "Today"     },
  { id: "s5", type: "withdraw", title: "Withdrawal to HDFC ••2841",        subtitle: "Instant transfer",     amount: -2400,  status: "completed", time: "9:14 AM",  date: "Today"     },
  { id: "s6", type: "earning",  title: "Trip · Airport → MG Road",         subtitle: "32 km · UPI",          amount:  478,   status: "completed", time: "8:02 PM",  date: "Yesterday" },
];

type ConfirmOtpResult = { ok: boolean; profileComplete: boolean; error?: string };

type DriverState = {
  driverUid:        string | null;
  authLoading:      boolean;
  phone:            string | null;
  isAuthenticated:  boolean;
  profile:          Profile | null;
  vehicle:          Vehicle | null;

  isOnline:         boolean;
  currentOrderId:   string | null;

  subscriptionPlan:      SubPlan | null;
  subscriptionExpiresAt: number  | null;
  subscriptionActive:    boolean;

  incomingRide: IncomingRide | null;
  activeRide:   ActiveRide   | null;
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

  setOnline:    (v: boolean) => { ok: boolean; reason?: string };
  activatePlan: (id: SubPlan) => { ok: boolean; reason?: string };

  acceptRide:    () => void;
  rejectRide:    () => void;
  endActiveRide: () => void;

  withdraw: (amount: number) => boolean;

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
    distanceKm:       order.distanceKm,
    pickupDistanceKm: order.pickupDistanceKm  ?? 0,
    durationMin:      order.durationMin,
    fareEstimate:     order.fareEstimate,
    paymentMode:      order.paymentMode,
    surge:            order.surge             ?? false,
    surgeMultiplier:  order.surgeMultiplier   ?? 1,
    passengerName:    order.customerName    ?? "Customer",
    customerPhone:    order.customerPhone   ?? "",
    passengerRating:  order.customerRating,
    parcelType:       order.parcelType      ?? "Parcel",
    parcelEmoji:      order.parcelEmoji     ?? "📦",
    parcelWeight:     order.parcelWeight    ?? "Package",
  };
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const [driverUid,   setDriverUid]   = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [phone,       setPhoneState]  = useState<string | null>(null);
  const [profile,     setProfileState]= useState<Profile | null>(null);
  const [vehicle,     setVehicleState]= useState<Vehicle | null>(null);

  const [isOnline,       setOnlineState]    = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  const [subscriptionPlan,      setSubPlan] = useState<SubPlan | null>(null);
  const [subscriptionExpiresAt, setSubExp]  = useState<number | null>(null);
  const [nowTick,               setNowTick] = useState(() => Date.now());

  const [incomingRide, setIncomingRide] = useState<IncomingRide | null>(null);
  const [activeRide,   setActiveRide]   = useState<ActiveRide   | null>(null);
  const [rideHistory,  setHistory]      = useState<ActiveRide[]>([]);

  const [walletBalance,  setBalance]      = useState(8420.5);
  const [todayEarnings,  setTodayEarnings]= useState(1248);
  const [tripsToday,     setTripsToday]   = useState(14);
  const [transactions,   setTxns]         = useState<Txn[]>(SEED_TXNS);

  const [overlayPermissionGranted, setOverlayPermissionGranted] = useState(false);

  const isAuthenticated = !!driverUid;

  // Refs used by notification action handlers (registered once, no stale closure)
  const incomingRideRef = useRef<IncomingRide | null>(null);
  const driverUidRef    = useRef<string | null>(null);
  const profileRef      = useRef<Profile | null>(null);
  useEffect(() => { incomingRideRef.current = incomingRide;  }, [incomingRide]);
  useEffect(() => { driverUidRef.current    = driverUid;     }, [driverUid]);
  useEffect(() => { profileRef.current      = profile;       }, [profile]);

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
          }
        } catch {
          // Firestore read failed — user remains authenticated, profile stays null
        }
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
  const subscriptionActive = !!(subscriptionExpiresAt && subscriptionExpiresAt > nowTick);
  useEffect(() => {
    if (!subscriptionActive && isOnline) {
      setOnlineState(false);
      if (driverUid) {
        updateDriverOnlineStatus(driverUid, false).catch(console.error);
      }
    }
  }, [subscriptionActive, isOnline]);

  // ─── Firestore incoming order listener ────────────────────────────────────
  // Runs whenever the driver is online and authenticated.
  // Listens for orders where { driverUid == uid, status == "dispatched" }.
  // Customer app writes such a document to dispatch an order to this driver.
  const lastSeenOrderId = useRef<string | null>(null);
  useEffect(() => {
    if (!isOnline || !driverUid || activeRide) return;

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
  }, [isOnline, driverUid, activeRide]);

  // ─── Auth actions ─────────────────────────────────────────────────────────
  const setPhone = (p: string) => setPhoneState(p);

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
        driverDoc = await createDriverDoc(uid, phone);
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
      }

      const profileComplete = !!(driverDoc.name && driverDoc.vehicleId);
      return { ok: true, profileComplete };
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

  const signOut = () => {
    if (driverUid) {
      updateDriverOnlineStatus(driverUid, false).catch(console.error);
    }
    firebaseSignOut(firebaseAuth).catch(console.error);
    setDriverUid(null);
    setPhoneState(null);
    setProfileState(null);
    setVehicleState(null);
    setOnlineState(false);
    setCurrentOrderId(null);
    setIncomingRide(null);
    setActiveRide(null);
    setHistory([]);
    setSubPlan(null);
    setSubExp(null);
    setBalance(0);
    setTodayEarnings(0);
    setTripsToday(0);
    setTxns([]);
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

  // ─── Ride actions ─────────────────────────────────────────────────────────
  const acceptRide = () => {
    const ride = incomingRide;
    const uid  = driverUid;
    if (!ride || !uid) return;

    // 1. Write to Firestore — customer app sees "accepted" immediately
    acceptOrder(ride.id, uid, profile?.name ?? null).catch(console.error);

    // 2. Update local state
    const accepted: ActiveRide = { ...ride, acceptedAt: Date.now() };
    setActiveRide(accepted);
    setCurrentOrderId(ride.id);
    setIncomingRide(null);
    lastSeenOrderId.current = ride.id; // prevent re-trigger

    cancelIncomingOrderNotification().catch(console.error);
    sendOrderUpdateNotification({
      title: "✅ Order Accepted",
      body:  `Heading to ${ride.pickup}`,
      data:  { type: "order_update", stage: "accepted" },
    }).catch(console.error);
  };

  const rejectRide = () => {
    const ride = incomingRide;
    const uid  = driverUid;
    if (!ride || !uid) return;

    // Write to Firestore — dispatcher can reassign to another driver
    rejectOrder(ride.id, uid).catch(console.error);

    setIncomingRide(null);
    lastSeenOrderId.current = null; // allow next dispatch to arrive
    cancelIncomingOrderNotification().catch(console.error);
  };

  const endActiveRide = () => {
    setActiveRide(null);
    setCurrentOrderId(null);
  };

  // ─── Notification action handlers (registered once on mount) ──────────────
  useEffect(() => {
    registerOrderActionHandlers({
      onAccept: () => {
        const ride = incomingRideRef.current;
        const uid  = driverUidRef.current;
        if (!ride || !uid) return;

        acceptOrder(ride.id, uid, profileRef.current?.name ?? null).catch(console.error);

        const accepted: ActiveRide = { ...ride, acceptedAt: Date.now() };
        setActiveRide(accepted);
        setCurrentOrderId(ride.id);
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

  const withdraw = (amount: number) => {
    if (amount <= 0 || amount > walletBalance) return false;
    setBalance((b) => b - amount);
    setTxns((t) => [
      {
        id:       `tx${Date.now()}`,
        type:     "withdraw",
        title:    "Withdrawal to HDFC ••2841",
        subtitle: "Instant transfer",
        amount:   -amount,
        status:   "completed",
        time:     new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        date:     "Today",
      },
      ...t,
    ]);
    return true;
  };

  // ─── Overlay permission ───────────────────────────────────────────────────
  const requestOverlayPermission = async (): Promise<{ ok: boolean; reason?: string }> => {
    if (Platform.OS !== "android") {
      const ok = Platform.OS === "ios";
      setOverlayPermissionGranted(ok);
      return ok
        ? { ok: true }
        : { ok: false, reason: "Overlay permission is only required on Android." };
    }
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.action.MANAGE_OVERLAY_PERMISSION",
      );
      setOverlayPermissionGranted(true);
      return { ok: true };
    } catch {
      setOverlayPermissionGranted(false);
      return { ok: false, reason: "Permission required for incoming ride alerts." };
    }
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
        isOnline,
        currentOrderId,
        subscriptionPlan,
        subscriptionExpiresAt,
        subscriptionActive,
        incomingRide,
        activeRide,
        rideHistory,
        walletBalance,
        todayEarnings,
        tripsToday,
        transactions,
        setPhone,
        confirmOtp,
        setProfile,
        setVehicle,
        signOut,
        setOnline,
        activatePlan,
        acceptRide,
        rejectRide,
        endActiveRide,
        withdraw,
        overlayPermissionGranted,
        requestOverlayPermission,
        setOverlayPermission: setOverlayPermissionGranted,
      }}
    >
      {children}
    </DriverContext.Provider>
  );
}
