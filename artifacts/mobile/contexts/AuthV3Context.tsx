/**
 * AuthV3Context.tsx — Authentication V3 State Machine
 *
 * Owns all auth state: driverUid, phone, authLoading, isOtpVerified, isOtpVerifying.
 *
 * Bug Fix #1 (stale sessionKeyRef):
 *   Calls AsyncStorage.getItem(SESSION_VERIFIED_KEY) FRESH on every
 *   onAuthStateChanged invocation instead of reading a mount-time promise
 *   snapshot that becomes stale after signOut() without a full remount.
 *
 * Bug Fix #2 (React-state flash guard race):
 *   Checks `isVerifyingRef.current` (a useRef, updated SYNCHRONOUSLY) as the
 *   very first operation in onAuthStateChanged — before any await or setState —
 *   so the guard is always committed by the time Firebase fires the callback,
 *   even when React hasn't yet flushed the batched isOtpVerifying=true setState.
 *
 * Session restore:
 *   When cold-start restore is detected (sessionValid=true), delegates profile
 *   hydration + navigation to DriverContext via the module-level auth-v3-bridge.
 *   AuthV3Context controls the authLoading gate: it stays true until the
 *   DriverContext handler resolves (or the 8s safety timeout fires).
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";

import { firebaseAuth } from "@/utils/firebase";
import { callV3SessionRestoreHandler } from "@/utils/auth-v3-bridge";

// Same key as DriverContext — shared across the two modules.
const SESSION_VERIFIED_KEY = "@bike_courier/session_verified_uid";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthV3Value = {
  // ── State ──────────────────────────────────────────────────────────────────
  driverUid:    string | null;
  phone:        string | null;
  authLoading:  boolean;
  isOtpVerified:  boolean;
  isOtpVerifying: boolean;

  // ── Methods for DriverContext to call during login ─────────────────────────
  /**
   * Called by DriverContext's establishSession / signInForSession BEFORE
   * signInWithCustomToken. Sets isVerifyingRef.current=true synchronously
   * (Bug Fix #2) and queues isOtpVerifying=true for React.
   */
  beginVerify: () => void;
  /**
   * Called by DriverContext's establishSession after a fully-established session.
   * Atomically: setIsOtpVerified(true) + setIsOtpVerifying(false) + setDriverUid
   * + setPhone + clears isVerifyingRef.
   */
  endVerifySuccess: (uid: string, phone: string) => void;
  /**
   * Called by DriverContext's establishSession / signInForSession in the catch
   * block. Clears the verifying guard without setting isOtpVerified.
   */
  endVerifyFailure: () => void;
  /**
   * Called by DriverContext's signInForSession (PIN-setup-only path) after
   * signInWithCustomToken resolves but before the full session is established.
   * Sets driverUid + phone WITHOUT clearing isVerifyingRef or isOtpVerifying
   * (those stay blocked until confirmPin → establishSession → endVerifySuccess).
   */
  setPinSetupIdentity: (uid: string, phone: string) => void;
  /**
   * Called by DriverContext's signOut to reset all auth state.
   */
  clearAuth: () => void;
  /**
   * Allows DriverContext / screens to update phone independently.
   */
  setPhone: (p: string) => void;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthV3Context = createContext<AuthV3Value | null>(null);

export function useAuthV3(): AuthV3Value {
  const ctx = useContext(AuthV3Context);
  if (!ctx) throw new Error("useAuthV3 must be used within AuthV3Provider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthV3Provider({ children }: { children: ReactNode }) {
  const [driverUid,      setDriverUid]      = useState<string | null>(null);
  const [phoneState,     setPhoneState]      = useState<string | null>(null);
  const [authLoading,    setAuthLoading]    = useState(true);
  const [isOtpVerified,  setIsOtpVerified]  = useState(false);
  const [isOtpVerifying, setIsOtpVerifying] = useState(false);

  // ── BUG FIX #2: synchronous flash guard ────────────────────────────────────
  // A useRef is updated synchronously (unlike setState which is batched).
  // Checked as the VERY FIRST operation in onAuthStateChanged — before any
  // await — so it is always seen even if React has not yet flushed the
  // corresponding isOtpVerifying=true setState batch.
  const isVerifyingRef = useRef(false);

  // Prevents running the full session-restore flow more than once per session
  // (e.g. a Firebase reconnect event re-fires onAuthStateChanged with the same
  // user; we don't want to re-navigate and re-fetch profile unnecessarily).
  const sessionAlreadyRestoredRef = useRef(false);

  // ── Firebase auth listener ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (user) => {
      console.log("[AUTH_V3] onAuthStateChanged uid =", user?.uid ?? "null",
        "| isVerifyingRef =", isVerifyingRef.current);

      // ── BUG FIX #2: synchronous ref check — FIRST, before any await ─────
      // If a login is actively in progress (beginVerify was called), the
      // Firebase user transitions (null → user) during signInWithCustomToken
      // must be completely ignored. establishSession/signInForSession will call
      // endVerifySuccess/endVerifyFailure to update state when they're done.
      if (isVerifyingRef.current) {
        console.log("[AUTH_V3] isVerifyingRef=true — skipping (login in flight)");
        return;
      }

      // ── No user ──────────────────────────────────────────────────────────
      if (!user) {
        console.log("[AUTH_V3] no user → clearing uid + setAuthLoading(false)");
        setDriverUid(null);
        setAuthLoading(false);
        return;
      }

      const phone = user.uid.startsWith("91") ? user.uid.slice(2) : user.uid;
      setDriverUid(user.uid);
      setPhoneState(phone);

      // ── BUG FIX #1: fresh AsyncStorage.getItem each time ─────────────────
      // The old code stored a mount-time promise in sessionKeyRef.current.
      // After signOut() removes SESSION_VERIFIED_KEY, the stale promise still
      // resolves to the previous uid → false sessionValid=true on re-login.
      // Reading fresh here guarantees we always see the current AsyncStorage value.
      let storedUid: string | null = null;
      try {
        storedUid = await AsyncStorage.getItem(SESSION_VERIFIED_KEY);
      } catch {
        // AsyncStorage failure → treat as no session (safe default)
      }
      const sessionValid = storedUid === user.uid;

      console.log("[AUTH_V3] storedUid =", storedUid ?? "(none)",
        "| user.uid =", user.uid, "| sessionValid =", sessionValid);

      if (!sessionValid) {
        // No persisted session — hand off to _layout.tsx which will route to login.
        console.log("[AUTH_V3] sessionValid=false → setAuthLoading(false)");
        setAuthLoading(false);
        return;
      }

      // ── Session restore ───────────────────────────────────────────────────
      // Prevent running the restore handler more than once per session.
      if (sessionAlreadyRestoredRef.current) {
        console.log("[AUTH_V3] sessionAlreadyRestored=true — suppressing duplicate restore");
        return;
      }
      sessionAlreadyRestoredRef.current = true;
      setIsOtpVerified(true);
      // authLoading stays true while DriverContext fetches profile + navigates.
      console.log("[AUTH_V3] session restore — setIsOtpVerified(true), calling restore handler");
      try {
        await callV3SessionRestoreHandler(user.uid, phone);
      } catch (err) {
        console.error("[AUTH_V3] session restore handler threw:", err);
      } finally {
        setAuthLoading(false);
        console.log("[AUTH_V3] session restore complete — setAuthLoading(false)");
      }
    });

    return unsub;
  }, []);

  // ── Auth-loading safety timeout ────────────────────────────────────────────
  // Hard guarantee: if onAuthStateChanged does not fire within 8 seconds
  // (cold Firebase init, network down, Expo Go quirks), force authLoading=false.
  useEffect(() => {
    const tid = setTimeout(() => {
      setAuthLoading((prev) => {
        if (prev) {
          console.log("[AUTH_V3] safety timeout fired — forcing authLoading=false after 8s");
        }
        return false;
      });
    }, 8000);
    return () => clearTimeout(tid);
  }, []);

  // ── Methods ───────────────────────────────────────────────────────────────

  const beginVerify = () => {
    // Synchronous ref — committed immediately, before any await.
    isVerifyingRef.current = true;
    // React state — for UI spinner and _layout.tsx flash guard.
    setIsOtpVerifying(true);
    console.log("[AUTH_V3] beginVerify — isVerifyingRef=true, isOtpVerifying=true queued");
  };

  const endVerifySuccess = (uid: string, p: string) => {
    // Release guard and set verified state atomically.
    isVerifyingRef.current = false;
    sessionAlreadyRestoredRef.current = true; // prevent session-restore from re-running
    setIsOtpVerified(true);
    setIsOtpVerifying(false);
    setDriverUid(uid);
    setPhoneState(p);
    console.log("[AUTH_V3] endVerifySuccess uid =", uid);
  };

  const endVerifyFailure = () => {
    isVerifyingRef.current = false;
    setIsOtpVerifying(false);
    console.log("[AUTH_V3] endVerifyFailure — guard cleared");
  };

  const setPinSetupIdentity = (uid: string, p: string) => {
    // PIN-setup-only path: sets identity but keeps isVerifyingRef=true and
    // isOtpVerified=false until confirmPin → establishSession completes.
    setDriverUid(uid);
    setPhoneState(p);
    console.log("[AUTH_V3] setPinSetupIdentity uid =", uid);
  };

  const clearAuth = () => {
    isVerifyingRef.current = false;
    sessionAlreadyRestoredRef.current = false;
    setDriverUid(null);
    setPhoneState(null);
    setIsOtpVerified(false);
    setIsOtpVerifying(false);
    // authLoading stays false — sign-out never shows the auth overlay.
    console.log("[AUTH_V3] clearAuth — all auth state reset");
  };

  const setPhone = (p: string) => {
    setPhoneState(p);
  };

  return (
    <AuthV3Context.Provider
      value={{
        driverUid,
        phone: phoneState,
        authLoading,
        isOtpVerified,
        isOtpVerifying,
        beginVerify,
        endVerifySuccess,
        endVerifyFailure,
        setPinSetupIdentity,
        clearAuth,
        setPhone,
      }}
    >
      {children}
    </AuthV3Context.Provider>
  );
}
