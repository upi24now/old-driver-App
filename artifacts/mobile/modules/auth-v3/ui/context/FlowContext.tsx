/**
 * COMPARTMENT 8 (UI sub-layer) — Flow Context
 *
 * Single responsibility: share transient inter-screen state within the V3
 * auth stack (phone, OTP verify token, created PIN, signup form data).
 *
 * This is pure UI-layer state transport — it has no business logic.
 * Screens write into it; the Engine reads from it via screen-mediated calls.
 * The context clears automatically when the V3 stack unmounts.
 *
 * Rules:
 *   ✓ Pure React state + context — no async operations
 *   ✗ No API calls, no Firebase, no storage, no navigation
 *
 * Debugging scope: if state disappears between screens or persists across
 *   sessions unexpectedly → this file.
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
  /** Full E.164 phone (+91XXXXXXXXXX). Written by login, signup-form, forgot-pin. */
  phone:           string;
  /** Firebase custom-auth token returned after OTP verification. */
  verifyToken:     string;
  /** Optional session ID returned alongside the verify token. */
  verifySessionId: string | null;
  /** 6-digit PIN chosen on the create-pin screen. */
  createdPin:      string;
  /** Signup form data — present only during new-driver signup flow. */
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
