# Authentication V3 — Architecture Report

> **Status:** Production-hardened. Ready for B2 migration phase.
> **TypeScript:** 0 errors.

---

## 1. Module overview

Authentication V3 is a self-contained authentication module under
`artifacts/mobile/modules/auth-v3/`. It is composed of 10 independent
compartments, each with a single responsibility and a declared public
contract. No B2 code is imported or modified.

```
modules/auth-v3/
├── config/         C10 — Constants, limits, colours, vehicles
├── types/              — Shared result types (AuthV3Result, AuthV3VoidResult)
├── errors/         C9  — Error mapping, codes, structured logging
├── validation/     C7  — Pure input validators
├── storage/        C4  — AsyncStorage abstraction
├── firebase/       C6  — Firebase Auth abstraction
├── api/            C5  — Backend API wrappers
│   ├── index.ts        ← Public contract only
│   ├── _sendOtp.ts
│   ├── _verifyOtp.ts
│   ├── _verifyPin.ts
│   ├── _setPin.ts
│   └── _createAccount.ts
├── session/        C3  — Session save/load/clear/restore
├── engine/         C2  — Auth orchestration
│   ├── index.ts        ← Public contract only
│   ├── _login.ts
│   ├── _otp.ts
│   ├── _signup.ts
│   └── _session.ts
├── navigation/     C1  — Route constants and navTo* functions
└── ui/             C8  — FlowContext, NumPad, PinDots
    ├── context/FlowContext.tsx
    └── components/NumPad.tsx, PinDots.tsx
```

Screens live in `app/auth-v3/` (Expo Router requirement) and import
only from `@/modules/auth-v3/`.

---

## 2. Dependency graph

```
C10 Config          (no deps)
       ↓
Types  ← C9 Errors ← C10
       ↓
C7  Validation      ← C10
C4  Storage         ← C9, Types
C6  Firebase        ← C9, Types
C5  API             ← C9, Types, external (auth-api, profile-api)
C1  Navigation      ← expo-router (type only)
       ↓
C3  Session         ← C10, C9, Types, C4, C6
       ↓
C2  Engine          ← C9, Types, C7, C5, C6, C3
       ↓
C8  UI Screens      ← C2, C1, C7, C9, C3 (read-only), C10, FlowContext
```

**No cycles.** Verified by inspection: each arrow points strictly
downward in the dependency order above.

---

## 3. Single responsibility audit

| Compartment | Responsibility | Violation? |
|---|---|---|
| C10 Config | Constants and palette | None |
| C9 Errors | Error mapping and diagnostics | None |
| C7 Validation | Input validation (pure) | None |
| C4 Storage | AsyncStorage read/write/remove | None |
| C6 Firebase | Firebase Auth sign-in/out | None |
| C5 API | Backend HTTP calls | None |
| C3 Session | Session persistence and restore | None |
| C2 Engine | Auth operation orchestration | None |
| C1 Navigation | Route constants and navTo* | None |
| C8 UI | Display and local interaction state | None |

---

## 4. Public contract enforcement

Every compartment exposes exactly one public file (`index.ts` or the
equivalent `.tsx` for React files). Internal implementation files in
API and Engine are prefixed with `_` to signal that they are private
to the compartment.

**Enforcement rule:** No file outside `modules/auth-v3/api/` may
import from `modules/auth-v3/api/_*.ts`. Same for engine internal
files. This is an architectural convention; a lint rule
(e.g. `import/no-internal-modules`) can be added to enforce it
automatically.

---

## 5. Standard result contract

Every public function returns one of:

```ts
AuthV3Result<T>     = { success: true; data: T }
                    | { success: false; error: AuthV3Error }

AuthV3VoidResult    = { success: true }
                    | { success: false; error: AuthV3Error }
```

**No function throws to its caller. No function returns null, undefined,
or a raw boolean.** Callers always check `result.success` first.

---

## 6. Stable error codes

```ts
ERR.VALIDATION_ERROR      // Input did not pass validation
ERR.INVALID_PIN           // Wrong PIN entered
ERR.INVALID_OTP           // Wrong OTP entered
ERR.INVALID_PHONE         // Phone number format invalid
ERR.PIN_LOCKED            // Too many incorrect attempts
ERR.OTP_EXPIRED           // OTP has timed out
ERR.FIREBASE_ERROR        // Firebase operation failed
ERR.API_ERROR             // Backend returned error or network failed
ERR.NETWORK_ERROR         // Connection problem
ERR.STORAGE_ERROR         // AsyncStorage I/O failed
ERR.SESSION_EXPIRED       // Session no longer valid
ERR.SESSION_CORRUPT       // Stored session data is unreadable
ERR.SIGNUP_DATA_MISSING   // Signup flow missing required form data
ERR.UNKNOWN               // Unrecognised error
```

UI reacts to `error.code`, not `error.userMessage`. This means UX copy
can change without touching screen logic.

---

## 7. Observability

Every compartment emits structured diagnostic events via `logOp`:

```
[auth-v3][compartment.operation] ✓
[auth-v3][compartment.operation] ✗ ERROR_CODE — sanitised diagnostic
```

**Rules enforced in Errors (C9):**
- Only emits in `__DEV__` builds.
- Never logs tokens, UIDs, phone numbers, PIN digits, or PII.
- `context` strings passed to `mapError` must be operation names only.

---

## 8. Testability

Each compartment is independently testable via Jest module mocking:

```ts
// Test engineLogin in isolation
jest.mock("../api");      // mock apiVerifyPin
jest.mock("../firebase"); // mock firebaseSignIn
jest.mock("../session");  // mock sessionSave

import { engineLogin } from "./_login";
// Test all success/failure branches without a real server or Firebase
```

No changes to Engine, UI, or any other compartment are needed for this
to work. The compartment boundaries ARE the test seams.

---

## 9. Replaceability matrix

| Replace... | Change only... | No changes in... |
|---|---|---|
| Firebase → Auth0 / Supabase | `firebase/index.ts` | Engine, Session, API, UI, Navigation |
| AsyncStorage → expo-secure-store | `storage/index.ts` | Session, Engine, API, UI |
| Backend API endpoints | `api/_*.ts` internal files | Engine, Session, Firebase, UI |
| expo-router → React Navigation | `navigation/index.ts` | Engine, Session, API, Firebase, Storage |
| Error messages / UX copy | `errors/index.ts` MAPPINGS table | All other compartments |
| PIN length / OTP length | `config/index.ts` | All other compartments |

---

## 10. No hidden coupling checklist

- [ ] **No screen imports `firebase/auth` directly.** ✅
- [ ] **No screen imports `@react-native-async-storage/async-storage` directly.** ✅
- [ ] **No screen imports `@/utils/auth-api` or `@/utils/profile-api` directly.** ✅
- [ ] **No screen calls `router.push("/literal/string")` directly.** ✅
- [ ] **No screen displays `error.message` — always `error.userMessage`.** ✅
- [ ] **Engine has no React imports.** ✅
- [ ] **Session has no navigation imports.** ✅
- [ ] **API has no Firebase imports.** ✅
- [ ] **Firebase has no storage imports.** ✅
- [ ] **Storage has no Firebase imports.** ✅
- [ ] **No circular imports between compartments.** ✅
- [ ] **No duplicated business logic across compartments.** ✅

---

## 11. Pre-migration checklist (before wiring to B2)

Before connecting V3 to the real driver home (`/(tabs)`):

1. **Test all three flows on a real device:**
   - Daily login: Welcome → Login → PIN → Home
   - New signup: Welcome → SignupForm → OTP → CreatePIN → ConfirmPIN → Home
   - Forgot PIN: PIN → ForgotPIN → OTP → CreatePIN → ConfirmPIN → Home

2. **Verify session restore:** kill the app after login, reopen — should skip
   to Home without entering credentials.

3. **Verify PIN mismatch:** enter different PINs on Create and Confirm — error
   shown, confirm field cleared, flow recoverable.

4. **Verify OTP resend:** request resend, verify new OTP works.

5. **Replace `navToHome` destination:** change `ROUTES.HOME` in Navigation
   (C1) to `"/(tabs)"` when migration is approved. Zero screen changes needed.

6. **Delete dead code:** `verify-otp-v3.tsx`, `forgot-pin-v2.tsx`,
   `create-pin-v2.tsx`, `auth-v2-api.ts`, `auth-v2-store.ts`.
