---
name: Authentication V3 architecture
description: PIN-first auth module; 10-compartment design; location of all files; key patterns.
---

# Authentication V3 Architecture

## Flow summary
- **Daily login:** Welcome → Login (phone) → PIN → Home
- **Signup:** Welcome → SignupForm → OTP → CreatePIN → ConfirmPIN → Home
- **Forgot PIN:** PIN → ForgotPIN (phone) → OTP → CreatePIN → ConfirmPIN → Home

## Compartment map (`artifacts/mobile/modules/auth-v3/`)

| # | Name | Path | Rule |
|---|------|------|------|
| C10 | Config | `config/index.ts` | No deps; constants/colours/vehicles/keys |
| C7 | Validation | `validation/index.ts` | ← Config; pure fns only |
| C9 | Errors | `errors/index.ts` | ← Config; mapError, makeError, logDiagnostic |
| C4 | Storage | `storage/index.ts` | ← Config, Errors; wraps AsyncStorage |
| C6 | Firebase | `firebase/index.ts` | ← Config, Errors; only file that imports firebase/auth |
| C5 | API | `api/index.ts` | ← Config, Errors; wraps auth-api/profile-api |
| C3 | Session | `session/index.ts` | ← Config, Errors, Storage, Firebase |
| C2 | Engine | `engine/index.ts` | ← Config, Validation, Errors, API, Firebase, Session |
| C1 | Navigation | `navigation/index.ts` | ← expo-router Router type; only file with expo-router import |
| C8 | UI | `ui/context/FlowContext.tsx`, `ui/components/NumPad.tsx`, `ui/components/PinDots.tsx` | ← Config only for components |

## Screens (`artifacts/mobile/app/auth-v3/`)
All screens are UI-only thin shells. They import from:
- `@/modules/auth-v3/engine` — auth operations
- `@/modules/auth-v3/navigation` — navTo* functions
- `@/modules/auth-v3/ui/context/FlowContext` — inter-screen transient state
- `@/modules/auth-v3/ui/components/NumPad|PinDots` — widgets
- `@/modules/auth-v3/validation` — ConfirmPIN uses pinsMatch()
- `@/modules/auth-v3/config` — COLORS, PIN_LENGTH, OTP_LENGTH, PHONE_DIGITS, PHONE_PREFIX
- `@/modules/auth-v3/session` — Home screen uses sessionLoad() for display only

**Zero direct imports** from firebase/auth, auth-api, profile-api, AsyncStorage in any screen.

## Key patterns
- **Engine returns typed unions** (`{ ok: true, ... } | { ok: false, error: AuthV3Error }`), never throws.
- **Screens display `error.userMessage`**, never raw error strings.
- **Navigation compartment** is the only module with `expo-router` imports; uses internal `href()` cast for typed routes.
- **FlowContext** scoped to `_layout.tsx` → auto-clears on stack exit; no singleton state.
- **Firebase cold-start race** fixed in Session: `firebaseWaitReady()` before UID check.
- **Auto-submit** pattern: pass computed `next` directly to handler (no setTimeout, no stale closure).
- **mountedRef** pattern in every screen with async operations.

## Routing integration (unchanged from V3 build)
- `app/login-v3.tsx` → `<Redirect href="/auth-v3/welcome" />`
- `app/_layout.tsx` → one-line exemption: `pathname.startsWith("/auth-v3")`

## Deleted (replaced by compartments)
- `utils/auth-v3-session.ts` → C3 Session + C4 Storage + C6 Firebase
- `utils/auth-v3-api.ts` → C5 API
- `contexts/auth-v3/FlowContext.tsx` → `modules/auth-v3/ui/context/FlowContext.tsx`
- `components/auth-v3/NumPad.tsx` → `modules/auth-v3/ui/components/NumPad.tsx`
- `components/auth-v3/PinDots.tsx` → `modules/auth-v3/ui/components/PinDots.tsx`

## TypeScript status
0 errors after full refactor.
