/**
 * auth-v2-store.ts — V2 auth module-level store (compat shim)
 * Used by: app/create-pin-v2.tsx, app/forgot-pin-v2.tsx
 *
 * Holds phone + pending OTP/session data across the V2 forgot-PIN / first-PIN
 * screens. Kept as a simple module-level object so no React context is needed.
 */

let _phone: string | null = null;
let _otpId: string | null = null;
let _pendingToken: string | null = null;
let _pendingSessionId: string | null = null;

export const AuthV2Store = {
  getPhone:          () => _phone ?? "",
  setPhone:          (p: string) => { _phone = p; },

  getOtpId:          () => _otpId,
  setOtpId:          (id: string) => { _otpId = id; },

  getPendingToken:   () => _pendingToken,
  setPendingToken:   (t: string) => { _pendingToken = t; },

  getPendingSessionId: () => _pendingSessionId,
  setPendingSessionId: (id: string | null) => { _pendingSessionId = id; },

  clear: () => {
    _phone          = null;
    _otpId          = null;
    _pendingToken   = null;
    _pendingSessionId = null;
  },
};
