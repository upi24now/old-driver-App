# Compartment 2 — Authentication Engine

## Purpose
Orchestrate all authentication operations. This is the only compartment
that combines API + Firebase + Session + Validation to produce a typed
authentication result. It is the heart of the module.

## Public Interface (index.ts only — never import internal _*.ts files)
```ts
type V3Session     = { uid: string; phone: string }
type FinishAuthParams = {
  verifyToken, verifySessionId, pin, phone,
  signupData?: { name, city, gender, vehicleId, vehicleName, licenseNumber?, vehicleNumber? }
}
type OtpVerifyData = { token: string; sessionId: string | null }

engineLogin(phone, pin):              Promise<AuthV3Result<V3Session>>
engineSendOtp(phone):                 Promise<AuthV3Result<{ otpId: string }>>
engineVerifyOtp(phone, otp):          Promise<AuthV3Result<OtpVerifyData>>
engineFinishAuth(params):             Promise<AuthV3Result<V3Session>>
engineLogout():                       Promise<AuthV3VoidResult>
engineRestoreSession():               Promise<AuthV3Result<V3Session | null>>
```

## Internal structure
```
engine/
  index.ts      ← Public contract (ONLY file to import)
  _login.ts     ← engineLogin implementation
  _otp.ts       ← engineSendOtp, engineVerifyOtp
  _signup.ts    ← engineFinishAuth (signup + forgot-PIN paths)
  _session.ts   ← engineRestoreSession, engineLogout
```

## Inputs
- Phone (E.164), PIN (6 digits), OTP (6 digits) from UI screens.
- `FinishAuthParams` assembled by the ConfirmPIN screen from FlowContext.

## Outputs
- `AuthV3Result<V3Session>` — callers navigate to Home on success.
- `AuthV3Result<V3Session | null>` — null means no session (not an error).
- Never throws.

## Dependencies
- Validation (C7), Errors (C9), Types
- API (C5), Firebase (C6), Session (C3)

## MUST NOT
- Import from Navigation, UI, or screens.
- Know about React, FlowContext, or component state.
- Call `router.push` or any navigation primitive.
- Directly access AsyncStorage or Firebase outside their compartments.

## Testability
Each internal `_*.ts` file can be tested in isolation by mocking its
dependencies. Example (Jest):
```ts
jest.mock("../api");     // replace API with mock
jest.mock("../firebase"); // replace Firebase with mock
jest.mock("../session");  // replace Session with mock
import { engineLogin } from "./_login";
```
No changes to Engine or UI are needed to run these tests.

## Replaceability
To add biometric login: add `_biometric.ts` and export from `index.ts`.
To change PIN verification logic: modify `_login.ts` only.
