/**
 * FlowContext.tsx — V3 Auth Flow State
 *
 * Provides the transient state that needs to cross screen boundaries within
 * the V3 auth stack (phone, OTP verify token, created PIN, signup data).
 *
 * Scoped to app/auth-v3/_layout.tsx — automatically cleared when the user
 * exits the V3 stack entirely. This eliminates module-level mutable singletons
 * and the stale-value bugs they cause between sessions.
 *
 * No B2 dependencies.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type V3SignupData = {
  name:          string;
  city:          string;
  gender:        string;
  vehicleId:     string;
  vehicleName:   string;
  licenseNumber: string;
  vehicleNumber: string;
};

type V3FlowState = {
  /** Full E.164 phone number (+91XXXXXXXXXX). Set by login, signup-form, forgot-pin. */
  phone:           string;
  /** Firebase custom-auth token returned after OTP verification. */
  verifyToken:     string;
  /** Optional session ID returned alongside the verify token. */
  verifySessionId: string | null;
  /** 6-digit PIN chosen by the driver on the create-pin screen. */
  createdPin:      string;
  /** Signup form data — only present during new-driver signup flow. */
  signup:          V3SignupData | null;
};

const INITIAL_STATE: V3FlowState = {
  phone:           "",
  verifyToken:     "",
  verifySessionId: null,
  createdPin:      "",
  signup:          null,
};

// ─── Context ──────────────────────────────────────────────────────────────────

type V3FlowContextValue = {
  flow:            Readonly<V3FlowState>;
  setPhone:        (phone: string) => void;
  setVerifyResult: (token: string, sessionId: string | null) => void;
  setCreatedPin:   (pin: string) => void;
  setSignup:       (data: V3SignupData) => void;
  clearFlow:       () => void;
};

const V3FlowContext = createContext<V3FlowContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function V3FlowProvider({ children }: { children: React.ReactNode }) {
  const [flow, setFlow] = useState<V3FlowState>(INITIAL_STATE);

  const setPhone = useCallback(
    (phone: string) => setFlow((f) => ({ ...f, phone })),
    [],
  );

  const setVerifyResult = useCallback(
    (verifyToken: string, verifySessionId: string | null) =>
      setFlow((f) => ({ ...f, verifyToken, verifySessionId })),
    [],
  );

  const setCreatedPin = useCallback(
    (createdPin: string) => setFlow((f) => ({ ...f, createdPin })),
    [],
  );

  const setSignup = useCallback(
    (signup: V3SignupData) => setFlow((f) => ({ ...f, signup })),
    [],
  );

  const clearFlow = useCallback(() => setFlow(INITIAL_STATE), []);

  return (
    <V3FlowContext.Provider
      value={{ flow, setPhone, setVerifyResult, setCreatedPin, setSignup, clearFlow }}
    >
      {children}
    </V3FlowContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useV3Flow(): V3FlowContextValue {
  const ctx = useContext(V3FlowContext);
  if (!ctx) throw new Error("useV3Flow must be used inside <V3FlowProvider>");
  return ctx;
}
