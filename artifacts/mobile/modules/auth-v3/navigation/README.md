# Compartment 1 — Navigation

## Purpose
Own every route constant and navigation action for the auth-v3 flow.
This is the only compartment permitted to import from `expo-router`.
All navigation in the auth-v3 module is expressed as a typed function call
to this compartment — never a raw `router.push("/some/path")` in a screen.

## Public Interface
```ts
const ROUTES = {
  WELCOME, LOGIN, PIN, SIGNUP_FORM, OTP,
  CREATE_PIN, CONFIRM_PIN, FORGOT_PIN, HOME
}
type OtpIntent  = "signup" | "forgot"
type PinIntent  = "signup" | "forgot"
type NavRouter  = Router   // expo-router Router

navToWelcome(router):                  void
navToLogin(router):                    void
navToPin(router):                      void
navToSignupForm(router):               void
navToOtp(router, intent: OtpIntent):   void
navToCreatePin(router, intent):        void
navToConfirmPin(router, intent):       void
navToForgotPin(router):                void
navToHome(router):                     void
navBack(router):                       void
```

## Inputs
- `router` — the expo-router `Router` instance obtained via `useRouter()`
  inside a screen. Never imported here; always passed in by the caller.
- `intent` — flow discriminant for OTP and PIN screens.

## Outputs
Side effect only: triggers navigation. No return value.

## Dependencies
- `expo-router` — `Router` type and `Href` type only.
- Config (C10) — could be used for feature-flag-gated routes if needed.

## MUST NOT
- Perform authentication logic.
- Call APIs, read storage, or use Firebase.
- Hold router state (never call `useRouter()` internally).
- Know about flow context, PINs, OTPs, or session data.

## Replaceability
To migrate from expo-router to React Navigation:
1. Replace the `Router` type import with React Navigation's.
2. Rewrite `navTo*` functions to call the React Navigation API.
3. Update `index.ts` imports.
Zero changes required in Engine, Session, API, or screen business logic.

## Known assumptions
- Route strings in `ROUTES` must match the file-based routes in `app/auth-v3/`.
- The internal `href()` cast is required because expo-router's typed `push`
  does not accept plain `string`. This is intentional and safe — all values
  in `ROUTES` are valid registered paths.
