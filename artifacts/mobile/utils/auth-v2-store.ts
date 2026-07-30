/**
 * auth-v2-store.ts
 * Module-level store for V2 transient authentication state.
 * Survives screen navigations within the same JS session (not persisted to disk).
 */

let _phone            = "";
let _otpId: string | null = null;
let _pendingToken: string | null = null;     // Firebase custom token from verifyOtp
let _pendingSessionId: string | null = null; // sessionId from verifyOtp

export const AuthV2Store = {
  getPhone:            ()                 => _phone,
  setPhone:            (p: string)        => { _phone = p; },
  getOtpId:            ()                 => _otpId,
  setOtpId:            (id: string|null)  => { _otpId = id; },
  getPendingToken:     ()                 => _pendingToken,
  setPendingToken:     (t: string|null)   => { _pendingToken = t; },
  getPendingSessionId: ()                 => _pendingSessionId,
  setPendingSessionId: (s: string|null)   => { _pendingSessionId = s; },
  clear: () => {
    _phone = "";
    _otpId = null;
    _pendingToken = null;
    _pendingSessionId = null;
  },
};
