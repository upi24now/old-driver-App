# Compartment 6 — Firebase Layer

## Purpose
Own every Firebase Authentication operation. This is the only file in the
entire auth-v3 module that imports from `firebase/auth`.

## Public Interface
```ts
type FirebaseSignInData = { uid: string; idToken: string }

firebaseSignIn(customToken: string):  Promise<AuthV3Result<FirebaseSignInData>>
firebaseSignOut():                    Promise<AuthV3VoidResult>
firebaseGetCurrentUid():              string | null        // synchronous
firebaseWaitReady():                  Promise<void>
```

`firebaseSignOut` always returns `{ success: true }` — sign-out is best-effort.
The local session is always cleared regardless of whether Firebase accepts
the sign-out call (e.g. offline scenario).

## Inputs
- `customToken` — issued by the backend after PIN or OTP verification.

## Outputs
- `FirebaseSignInData` containing the Firebase `uid` and a freshly-issued
  `idToken` that can be used immediately for authenticated API calls.
- Never throws.

## Dependencies
- `firebase/auth` — the only auth-v3 file that does so.
- `@/utils/firebase` — the shared `firebaseAuth` instance.
- Errors (C9)
- Types

## MUST NOT
- Perform storage reads or writes.
- Navigate.
- Know about sessions, PINs, OTPs, or the backend API.
- Import from any other auth-v3 compartment except Errors and Types.

## Replaceability
To replace Firebase with another identity provider (Auth0, Supabase, custom
JWT, etc.):
1. Implement the same four exported functions.
2. Replace this file only.
3. Zero changes required in Engine, Session, or any screen.

## Known assumptions
- `firebaseAuth.authStateReady()` is available (Firebase JS SDK ≥ 10).
- `getIdToken()` returns a fresh token — no caching. If caching is needed,
  add it here, not in callers.
- The `idToken` from `firebaseSignIn` is used immediately by the Engine for
  the set-PIN API call. It expires after 1 hour — not a concern here.
