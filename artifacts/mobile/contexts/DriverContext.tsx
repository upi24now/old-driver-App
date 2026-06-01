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
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from "firebase/auth";

import { firebaseAuth } from "@/utils/firebase";
import {
  getDriverDoc,
  createDriverDoc,
  updateDriverProfile,
  updateDriverVehicle,
} from "@/utils/firestore";
import { verifyOtpApi } from "@/utils/auth-api";
import {
  cancelIncomingOrderNotification,
  registerOrderActionHandlers,
  sendDriverAlertNotification,
  sendIncomingOrderNotification,
  sendOrderUpdateNotification,
} from "@/utils/notifications";

export type SubPlan = "daily" | "weekly" | "monthly";
export type RideStage = "to_pickup" | "arrived" | "in_trip" | "completed";

export type Vehicle = { id: string; name: string };
export type Profile = { name: string; city: string; gender: string };

export type IncomingRide = {
  id: string;
  pickup: string;
  pickupSub: string;
  drop: string;
  dropSub: string;
  distanceKm: number;
  pickupDistanceKm: number;
  fareEstimate: number;
  passengerName: string;
  passengerRating: number;
  paymentMode: "Cash" | "UPI" | "Card";
};

export type ActiveRide = IncomingRide & { stage: RideStage; acceptedAt: number };

export type Txn = {
  id: string;
  type: "earning" | "withdraw" | "bonus" | "tip";
  title: string;
  subtitle: string;
  amount: number;
  status: "completed" | "pending" | "failed";
  time: string;
  date: string;
};

const PLAN_DAYS: Record<SubPlan, number>  = { daily: 1, weekly: 7, monthly: 30 };
const PLAN_PRICE: Record<SubPlan, number> = { daily: 19, weekly: 99, monthly: 349 };

const SAMPLE_RIDES: Omit<IncomingRide, "id">[] = [
  {
    pickup: "Indiranagar 100ft Rd",
    pickupSub: "Near Sony World Junction",
    drop: "Whitefield ITPL",
    dropSub: "Gate 3, Main Road",
    distanceKm: 9.6,
    pickupDistanceKm: 1.2,
    fareEstimate: 186,
    passengerName: "Priya S.",
    passengerRating: 4.9,
    paymentMode: "UPI",
  },
  {
    pickup: "Koramangala 5th Block",
    pickupSub: "Forum Mall",
    drop: "HSR Layout Sector 2",
    dropSub: "27th Main",
    distanceKm: 4.1,
    pickupDistanceKm: 0.8,
    fareEstimate: 92,
    passengerName: "Rahul M.",
    passengerRating: 4.8,
    paymentMode: "Cash",
  },
  {
    pickup: "MG Road Metro",
    pickupSub: "Gate B",
    drop: "Kempegowda Airport",
    dropSub: "Terminal 1 Departure",
    distanceKm: 32,
    pickupDistanceKm: 2.4,
    fareEstimate: 478,
    passengerName: "Ananya K.",
    passengerRating: 5.0,
    paymentMode: "UPI",
  },
  {
    pickup: "BTM 2nd Stage",
    pickupSub: "16th Main Road",
    drop: "Marathahalli Bridge",
    dropSub: "Outer Ring Road",
    distanceKm: 12.3,
    pickupDistanceKm: 1.6,
    fareEstimate: 215,
    passengerName: "Vikram R.",
    passengerRating: 4.7,
    paymentMode: "UPI",
  },
];

const SEED_TXNS: Txn[] = [
  { id: "s1", type: "earning",  title: "Trip · Indiranagar → Whitefield", subtitle: "9.6 km · UPI",    amount: 186,   status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s2", type: "tip",      title: "Tip from Priya S.",               subtitle: "Trip #4827",       amount: 24,    status: "completed", time: "2:42 PM",  date: "Today"     },
  { id: "s3", type: "earning",  title: "Trip · HSR → Koramangala",        subtitle: "4.1 km · Cash",    amount: 92,    status: "completed", time: "1:18 PM",  date: "Today"     },
  { id: "s4", type: "bonus",    title: "Daily streak bonus",              subtitle: "10 trips completed", amount: 150,  status: "completed", time: "11:30 AM", date: "Today"     },
  { id: "s5", type: "withdraw", title: "Withdrawal to HDFC ••2841",       subtitle: "Instant transfer",  amount: -2400, status: "completed", time: "9:14 AM",  date: "Today"     },
  { id: "s6", type: "earning",  title: "Trip · Airport → MG Road",        subtitle: "32 km · UPI",       amount: 478,  status: "completed", time: "8:02 PM",  date: "Yesterday" },
];

type ConfirmOtpResult = { ok: boolean; profileComplete: boolean; error?: string };

type DriverState = {
  driverUid:   string | null;
  authLoading: boolean;
  phone:       string | null;
  isAuthenticated: boolean;
  profile:     Profile | null;
  vehicle:     Vehicle | null;

  isOnline: boolean;

  subscriptionPlan:      SubPlan | null;
  subscriptionExpiresAt: number | null;
  subscriptionActive:    boolean;

  incomingRide: IncomingRide | null;
  activeRide:   ActiveRide | null;
  rideHistory:  ActiveRide[];

  walletBalance:  number;
  todayEarnings:  number;
  tripsToday:     number;
  transactions:   Txn[];

  setPhone:    (p: string) => void;
  confirmOtp:  (phone: string, otp: string) => Promise<ConfirmOtpResult>;
  setProfile:  (p: Profile) => void;
  setVehicle:  (v: Vehicle) => void;
  signOut:     () => void;

  setOnline:     (v: boolean) => { ok: boolean; reason?: string };
  activatePlan:  (id: SubPlan) => { ok: boolean; reason?: string };

  triggerIncomingRide: (mode?: "modal" | "lock") => void;
  acceptRide:  () => void;
  rejectRide:  () => void;
  advanceStage: () => void;
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

export function DriverProvider({ children }: { children: ReactNode }) {
  const [driverUid,   setDriverUid]    = useState<string | null>(null);
  const [authLoading, setAuthLoading]  = useState(true);
  const [phone,       setPhoneState]   = useState<string | null>(null);
  const [profile,     setProfileState] = useState<Profile | null>(null);
  const [vehicle,     setVehicleState] = useState<Vehicle | null>(null);

  const [isOnline, setOnlineState] = useState(false);

  const [subscriptionPlan,      setSubPlan] = useState<SubPlan | null>(null);
  const [subscriptionExpiresAt, setSubExp]  = useState<number | null>(null);
  const [nowTick,               setNowTick] = useState(() => Date.now());

  const [incomingRide, setIncomingRide] = useState<IncomingRide | null>(null);
  const [activeRide,   setActiveRide]   = useState<ActiveRide | null>(null);
  const [rideHistory,  setHistory]      = useState<ActiveRide[]>([]);

  const [walletBalance,  setBalance]       = useState(8420.5);
  const [todayEarnings,  setTodayEarnings] = useState(1248);
  const [tripsToday,     setTripsToday]    = useState(14);
  const [transactions,   setTxns]          = useState<Txn[]>(SEED_TXNS);
  const [overlayPermissionGranted, setOverlayPermissionGranted] = useState(false);

  const isAuthenticated = !!driverUid;

  // ─── Firebase Auth listener — restores session on app restart ─────────────
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

  // ─── Subscription heartbeat ───────────────────────────────────────────────
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
    if (!subscriptionActive && isOnline) setOnlineState(false);
  }, [subscriptionActive, isOnline]);

  // ─── Continuous ride queue ────────────────────────────────────────────────
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rideCursor    = useRef(0);
  useEffect(() => {
    if (incomingTimer.current) clearTimeout(incomingTimer.current);
    if (isOnline && !incomingRide && !activeRide) {
      incomingTimer.current = setTimeout(() => {
        const sample = SAMPLE_RIDES[rideCursor.current % SAMPLE_RIDES.length]!;
        rideCursor.current += 1;
        const ride: IncomingRide = { ...sample, id: `r${Date.now()}` };
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
      }, 3500);
    }
    return () => { if (incomingTimer.current) clearTimeout(incomingTimer.current); };
  }, [isOnline, incomingRide, activeRide]);

  // ─── Auth actions ─────────────────────────────────────────────────────────
  const setPhone = (p: string) => setPhoneState(p);

  const confirmOtp = async (
    phone: string,
    otp:   string,
  ): Promise<ConfirmOtpResult> => {
    const apiResult = await verifyOtpApi(phone, otp);
    if (!apiResult.ok) return { ok: false, profileComplete: false, error: apiResult.error };

    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, apiResult.email, apiResult.password);
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
    firebaseSignOut(firebaseAuth).catch(console.error);
    setDriverUid(null);
    setPhoneState(null);
    setProfileState(null);
    setVehicleState(null);
    setOnlineState(false);
    setIncomingRide(null);
    setActiveRide(null);
    setHistory([]);
    setSubPlan(null);
    setSubExp(null);
    setBalance(0);
    setTodayEarnings(0);
    setTripsToday(0);
    setTxns([]);
  };

  // ─── Online / subscription ────────────────────────────────────────────────
  const setOnline: DriverState["setOnline"] = (v) => {
    if (v && !subscriptionActive) {
      return { ok: false, reason: "Your subscription has expired. Activate a plan to go online." };
    }
    setOnlineState(v);
    return { ok: true };
  };

  const activatePlan: DriverState["activatePlan"] = (id) => {
    const price = PLAN_PRICE[id];
    if (walletBalance < price) {
      return { ok: false, reason: "Insufficient wallet balance for this plan." };
    }
    setSubPlan(id);
    setSubExp(Date.now() + PLAN_DAYS[id] * 24 * 60 * 60 * 1000);
    setBalance((b) => b - price);
    setTxns((t) => [
      {
        id: `tx${Date.now()}`,
        type: "withdraw",
        title: `${id.charAt(0).toUpperCase() + id.slice(1)} Driver Plan`,
        subtitle: "Plan activation",
        amount: -price,
        status: "completed",
        time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        date: "Today",
      },
      ...t,
    ]);
    return { ok: true };
  };

  // ─── Ride actions ─────────────────────────────────────────────────────────
  const triggerIncomingRide: DriverState["triggerIncomingRide"] = (mode = "modal") => {
    if (activeRide) return;
    const sample = SAMPLE_RIDES[rideCursor.current % SAMPLE_RIDES.length]!;
    rideCursor.current += 1;
    const ride: IncomingRide = { ...sample, id: `r${Date.now()}` };
    setIncomingRide(ride);
    sendIncomingOrderNotification({
      orderId:    ride.id,
      customer:   ride.passengerName,
      pickup:     ride.pickup,
      drop:       ride.drop,
      earning:    ride.fareEstimate,
      distanceKm: ride.distanceKm,
    }).catch(console.error);
    router.push(mode === "lock" ? "/lock-alert" : "/ride-request");
  };

  const incomingRideRef = useRef<IncomingRide | null>(null);
  useEffect(() => { incomingRideRef.current = incomingRide; }, [incomingRide]);

  useEffect(() => {
    registerOrderActionHandlers({
      onAccept: () => {
        const ride = incomingRideRef.current;
        if (!ride) return;
        setActiveRide({ ...ride, stage: "to_pickup", acceptedAt: Date.now() });
        setIncomingRide(null);
        cancelIncomingOrderNotification().catch(console.error);
        sendOrderUpdateNotification({
          title: "✅ Order Accepted",
          body:  `Heading to ${ride.pickup}`,
          data:  { type: "order_update", stage: "to_pickup" },
        }).catch(console.error);
      },
      onReject: () => {
        setIncomingRide(null);
        cancelIncomingOrderNotification().catch(console.error);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptRide = () => {
    if (!incomingRide) return;
    setActiveRide({ ...incomingRide, stage: "to_pickup", acceptedAt: Date.now() });
    setIncomingRide(null);
    cancelIncomingOrderNotification().catch(console.error);
    sendOrderUpdateNotification({
      title: "✅ Order Accepted",
      body:  `Heading to ${incomingRide.pickup}`,
      data:  { type: "order_update", stage: "to_pickup" },
    }).catch(console.error);
  };

  const rejectRide = () => {
    setIncomingRide(null);
    cancelIncomingOrderNotification().catch(console.error);
  };

  const advanceStage = () => {
    if (!activeRide) return;
    if (activeRide.stage === "to_pickup") {
      setActiveRide({ ...activeRide, stage: "arrived" });
      sendOrderUpdateNotification({
        title: "📍 Arrived at Pickup",
        body:  `Waiting at ${activeRide.pickup}`,
        data:  { type: "order_update", stage: "arrived" },
      }).catch(console.error);
    } else if (activeRide.stage === "arrived") {
      setActiveRide({ ...activeRide, stage: "in_trip" });
      sendOrderUpdateNotification({
        title: "🚀 Trip Started",
        body:  `Delivering to ${activeRide.drop}`,
        data:  { type: "order_update", stage: "in_trip" },
      }).catch(console.error);
    } else if (activeRide.stage === "in_trip") {
      const completed: ActiveRide = { ...activeRide, stage: "completed" };
      const earning = completed.fareEstimate;
      setActiveRide(completed);
      setTodayEarnings((t) => t + earning);
      setTripsToday((t) => t + 1);
      setBalance((b) => b + earning);
      setHistory((h) => [completed, ...h]);
      setTxns((t) => [
        {
          id: `tx${Date.now()}`,
          type: "earning",
          title: `Trip · ${completed.pickup} → ${completed.drop}`,
          subtitle: `${completed.distanceKm} km · ${completed.paymentMode}`,
          amount: earning,
          status: "completed",
          time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          date: "Today",
        },
        ...t,
      ]);
      sendOrderUpdateNotification({
        title: "🎉 Delivery Complete!",
        body:  `₹${earning} earned — ${completed.distanceKm} km trip`,
        data:  { type: "order_update", stage: "completed", earning },
      }).catch(console.error);
    }
  };

  const endActiveRide = () => setActiveRide(null);

  const withdraw = (amount: number) => {
    if (amount <= 0 || amount > walletBalance) return false;
    setBalance((b) => b - amount);
    setTxns((t) => [
      {
        id: `tx${Date.now()}`,
        type: "withdraw",
        title: "Withdrawal to HDFC ••2841",
        subtitle: "Instant transfer",
        amount: -amount,
        status: "completed",
        time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        date: "Today",
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
      return ok ? { ok: true } : { ok: false, reason: "Overlay permission is only required on Android." };
    }
    try {
      await IntentLauncher.startActivityAsync("android.settings.action.MANAGE_OVERLAY_PERMISSION");
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
        triggerIncomingRide,
        acceptRide,
        rejectRide,
        advanceStage,
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
