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

const PLAN_DAYS: Record<SubPlan, number> = { daily: 1, weekly: 7, monthly: 30 };
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
  { id: "s1", type: "earning", title: "Trip · Indiranagar → Whitefield", subtitle: "9.6 km · UPI", amount: 186, status: "completed", time: "2:42 PM", date: "Today" },
  { id: "s2", type: "tip", title: "Tip from Priya S.", subtitle: "Trip #4827", amount: 24, status: "completed", time: "2:42 PM", date: "Today" },
  { id: "s3", type: "earning", title: "Trip · HSR → Koramangala", subtitle: "4.1 km · Cash", amount: 92, status: "completed", time: "1:18 PM", date: "Today" },
  { id: "s4", type: "bonus", title: "Daily streak bonus", subtitle: "10 trips completed", amount: 150, status: "completed", time: "11:30 AM", date: "Today" },
  { id: "s5", type: "withdraw", title: "Withdrawal to HDFC ••2841", subtitle: "Instant transfer", amount: -2400, status: "completed", time: "9:14 AM", date: "Today" },
  { id: "s6", type: "earning", title: "Trip · Airport → MG Road", subtitle: "32 km · UPI", amount: 478, status: "completed", time: "8:02 PM", date: "Yesterday" },
];

type DriverState = {
  phone: string | null;
  isVerified: boolean;
  isAuthenticated: boolean;
  profile: Profile | null;
  vehicle: Vehicle | null;

  isOnline: boolean;

  subscriptionPlan: SubPlan | null;
  subscriptionExpiresAt: number | null;
  subscriptionActive: boolean;

  incomingRide: IncomingRide | null;
  activeRide: ActiveRide | null;
  rideHistory: ActiveRide[];

  walletBalance: number;
  todayEarnings: number;
  tripsToday: number;
  transactions: Txn[];

  setPhone: (p: string) => void;
  verifyOtp: () => void;
  setProfile: (p: Profile) => void;
  setVehicle: (v: Vehicle) => void;
  signOut: () => void;

  setOnline: (v: boolean) => { ok: boolean; reason?: string };
  activatePlan: (id: SubPlan) => { ok: boolean; reason?: string };

  triggerIncomingRide: (mode?: "modal" | "lock") => void;
  acceptRide: () => void;
  rejectRide: () => void;
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
  const [phone, setPhoneState] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [vehicle, setVehicleState] = useState<Vehicle | null>(null);

  const [isOnline, setOnlineState] = useState(false);

  const [subscriptionPlan, setSubPlan] = useState<SubPlan | null>(null);
  const [subscriptionExpiresAt, setSubExp] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [incomingRide, setIncomingRide] = useState<IncomingRide | null>(null);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [rideHistory, setHistory] = useState<ActiveRide[]>([]);

  const [walletBalance, setBalance] = useState(8420.5);
  const [todayEarnings, setTodayEarnings] = useState(1248);
  const [tripsToday, setTripsToday] = useState(14);
  const [transactions, setTxns] = useState<Txn[]>(SEED_TXNS);
  const [overlayPermissionGranted, setOverlayPermissionGranted] = useState(false);

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
    } catch (e) {
      setOverlayPermissionGranted(false);
      return {
        ok: false,
        reason: "Permission required for incoming ride alerts.",
      };
    }
  };

  const subscriptionActive = !!(
    subscriptionExpiresAt && subscriptionExpiresAt > nowTick
  );
  const isAuthenticated = !!phone && isVerified;

  // Heartbeat to reactively detect subscription expiry
  useEffect(() => {
    if (!subscriptionExpiresAt) return;
    const msUntilExpiry = subscriptionExpiresAt - Date.now();
    if (msUntilExpiry <= 0) {
      setNowTick(Date.now());
      return;
    }
    const t = setTimeout(() => setNowTick(Date.now()), msUntilExpiry + 50);
    return () => clearTimeout(t);
  }, [subscriptionExpiresAt]);

  // Auto-offline if subscription expires
  useEffect(() => {
    if (!subscriptionActive && isOnline) {
      setOnlineState(false);
    }
  }, [subscriptionActive, isOnline]);

  // Auto-trigger an incoming ride when online and idle
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (incomingTimer.current) clearTimeout(incomingTimer.current);
    if (isOnline && !incomingRide && !activeRide) {
      incomingTimer.current = setTimeout(() => {
        const sample = SAMPLE_RIDES[Math.floor(Math.random() * SAMPLE_RIDES.length)];
        setIncomingRide({ ...sample, id: `r${Date.now()}` });
        router.push("/ride-request");
      }, 12000);
    }
    return () => {
      if (incomingTimer.current) clearTimeout(incomingTimer.current);
    };
  }, [isOnline, incomingRide, activeRide]);

  const setPhone = (p: string) => setPhoneState(p);
  const verifyOtp = () => setIsVerified(true);
  const setProfile = (p: Profile) => setProfileState(p);
  const setVehicle = (v: Vehicle) => setVehicleState(v);

  const signOut = () => {
    setPhoneState(null);
    setIsVerified(false);
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

  const triggerIncomingRide: DriverState["triggerIncomingRide"] = (mode = "modal") => {
    if (activeRide) return;
    const sample = SAMPLE_RIDES[Math.floor(Math.random() * SAMPLE_RIDES.length)];
    setIncomingRide({ ...sample, id: `r${Date.now()}` });
    router.push(mode === "lock" ? "/lock-alert" : "/ride-request");
  };

  const acceptRide = () => {
    if (!incomingRide) return;
    setActiveRide({ ...incomingRide, stage: "to_pickup", acceptedAt: Date.now() });
    setIncomingRide(null);
  };

  const rejectRide = () => setIncomingRide(null);

  const advanceStage = () => {
    if (!activeRide) return;
    if (activeRide.stage === "to_pickup") {
      setActiveRide({ ...activeRide, stage: "arrived" });
    } else if (activeRide.stage === "arrived") {
      setActiveRide({ ...activeRide, stage: "in_trip" });
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

  return (
    <DriverContext.Provider
      value={{
        phone,
        isVerified,
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
        verifyOtp,
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
