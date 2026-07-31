# Compartment 8 — UI Layer

## Purpose
Display screens and shared components. Contains zero business logic.
Every auth operation is delegated to the Engine; every navigation action
is delegated to Navigation. Screens are thin shells that:
  1. Manage local display state (loading spinner, error text, input values)
  2. Call Engine functions
  3. Inspect `result.success` and route via Navigation functions
  4. Display `result.error.userMessage` — never raw error strings

## Structure
```
ui/
  context/
    FlowContext.tsx     ← Transient inter-screen state (phone, token, PIN,
                          signup data). Scoped to the V3 stack — cleared on exit.
  components/
    NumPad.tsx          ← 3×4 digit keypad; pure presentation
    PinDots.tsx         ← PIN progress dots; pure presentation
```

Screens live in `app/auth-v3/` (Expo Router requirement) but import only
from `@/modules/auth-v3/`.

## Public Interface — FlowContext
```ts
type V3SignupData = { name, city, gender, vehicleId, vehicleName,
                      licenseNumber, vehicleNumber }

// Hook (used inside screens only):
useV3Flow(): {
  flow:            Readonly<V3FlowState>
  setPhone(phone): void
  setVerifyResult(token, sessionId): void
  setCreatedPin(pin): void
  setSignup(data): void
  clearFlow(): void
}

// Provider (used only by app/auth-v3/_layout.tsx):
V3FlowProvider
```

## Public Interface — Components
```ts
NumPad(props: { onDigit(d): void; onDelete(): void; disabled?: boolean })
PinDots(props: { length: number; filled: number; error?: boolean })
```

## Dependencies (screens)
- Engine (C2) — all auth operations
- Navigation (C1) — all routing actions
- FlowContext — inter-screen state
- Validation (C7) — ConfirmPIN screen uses `pinsMatch`
- Config (C10) — COLORS, PIN_LENGTH, OTP_LENGTH, PHONE_DIGITS, PHONE_PREFIX
- Session (C3) — Home screen reads `sessionLoad()` for display only

## MUST NOT
- Import from `firebase/auth` directly.
- Import from `@/utils/auth-api` or `@/utils/profile-api` directly.
- Import from `@react-native-async-storage/async-storage` directly.
- Call `router.push("/literal/path")` — always use Navigation functions.
- Display raw error strings from exceptions — always use `error.userMessage`.
- Contain authentication decisions (login success/fail logic lives in Engine).

## Known assumptions
- `useRouter()` is called inside screen components only.
- `mountedRef` pattern (useRef + cleanup) is required in every screen with
  async operations to prevent state updates after navigation.
- Auto-submit pattern: pass the locally-computed `next` value directly to
  the handler function — never use `setTimeout` or read stale state via closure.
- FlowContext clears automatically when the user exits the auth-v3 stack
  (V3FlowProvider unmounts with the stack layout). No manual clear is needed
  on stack entry — only on successful auth completion (`clearFlow()` in
  ConfirmPinScreen).
