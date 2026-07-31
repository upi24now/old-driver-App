# Compartment 5 — API Layer

## Purpose
Own all communication with the backend authentication and driver-profile
endpoints. Wraps the existing `auth-api` and `profile-api` utilities with
typed, consistent V3 results.

## Public Interface (index.ts only — never import internal _*.ts files)
```ts
apiSendOtp(phone: string):                        Promise<AuthV3Result<SendOtpData>>
apiVerifyOtp(phone: string, otp: string):         Promise<AuthV3Result<VerifyOtpData>>
apiVerifyPin(phone: string, pin: string):         Promise<AuthV3Result<VerifyPinData>>
apiSetPin(pin, idToken, sessionId):               Promise<AuthV3VoidResult>
apiCreateAccount(params: CreateAccountParams):    Promise<AuthV3VoidResult>

type SendOtpData    = { otpId: string }
type VerifyOtpData  = { token: string; sessionId: string | null }
type VerifyPinData  = { token: string; sessionId: string | null }
type CreateAccountParams = { phone, name, city, gender, vehicleId, vehicleName,
                             licenseNumber?, vehicleNumber? }

VEHICLES: readonly Vehicle[]
type VehicleId
```

## Internal structure
```
api/
  index.ts          ← Public contract (ONLY file to import)
  _sendOtp.ts       ← Internal: sendOtp implementation
  _verifyOtp.ts     ← Internal: verifyOtp implementation
  _verifyPin.ts     ← Internal: verifyPin implementation
  _setPin.ts        ← Internal: setPin implementation
  _createAccount.ts ← Internal: createAccount implementation
```

## Inputs
Phone numbers (E.164), raw PIN/OTP strings, idToken from Firebase, driver
profile fields.

## Outputs
`AuthV3Result<T>` or `AuthV3VoidResult`. Never throws.
Error codes set to `ERR.API_ERROR` (network/server) or `ERR.INVALID_PIN` /
`ERR.INVALID_OTP` (backend domain errors).

## Dependencies
- `@/utils/auth-api` — underlying OTP/PIN network calls
- `@/utils/profile-api` — driver signup
- Errors (C9), Types

## MUST NOT
- Display UI or navigate.
- Read or write storage.
- Call Firebase.
- Know about sessions or flow context.

## Replaceability
To change a backend endpoint or add retry logic, modify the relevant `_*.ts`
internal file only. The public contract in `index.ts` remains unchanged.
No other compartment requires modification.

## Known assumptions
- `auth-api` and `profile-api` handle the HTTP transport and base URL.
- The `token` returned by `apiVerifyPin` / `apiVerifyOtp` is a Firebase
  custom token — valid for one sign-in, not a persistent credential.
- `sessionId` may be null for older backend versions.
