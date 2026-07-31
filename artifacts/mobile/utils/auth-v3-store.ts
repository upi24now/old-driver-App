/**
 * auth-v3-store.ts — In-memory transient state for the V3 auth flow
 *
 * Holds data that needs to cross screen boundaries during authentication
 * (e.g. OTP token from otp.tsx → confirm-pin.tsx). Cleared when the flow
 * completes or is abandoned.
 *
 * No React, no AsyncStorage — plain module singleton.
 * Only consumed by app/auth-v3/* screens.
 */

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
  /** Full E.164 phone number (+91XXXXXXXXXX) */
  phone:           string;
  /** Opaque OTP request ID returned by the backend */
  otpId:           string;
  /** Firebase custom-auth token returned after OTP verification */
  verifyToken:     string;
  /** Optional session ID from the backend */
  verifySessionId: string | null;
  /** PIN digits entered by the driver on the create-pin screen */
  createdPin:      string;
  /** Signup form data — only set during new-driver signup */
  signup:          V3SignupData | null;
};

const defaultState = (): V3FlowState => ({
  phone:           "",
  otpId:           "",
  verifyToken:     "",
  verifySessionId: null,
  createdPin:      "",
  signup:          null,
});

let _state: V3FlowState = defaultState();

export const v3Store = {
  get:             (): Readonly<V3FlowState> => _state,

  setPhone:        (phone: string) =>
                     (_state = { ..._state, phone }),

  setOtpId:        (otpId: string) =>
                     (_state = { ..._state, otpId }),

  setVerifyToken:  (token: string, sessionId: string | null) =>
                     (_state = { ..._state, verifyToken: token, verifySessionId: sessionId }),

  setCreatedPin:   (pin: string) =>
                     (_state = { ..._state, createdPin: pin }),

  setSignup:       (signup: V3SignupData) =>
                     (_state = { ..._state, signup }),

  /** Call after successful auth or when the user exits the flow */
  clear:           () => { _state = defaultState(); },
};
