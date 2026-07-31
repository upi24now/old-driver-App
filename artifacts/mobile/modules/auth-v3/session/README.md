# Compartment 3 — Session Manager

## Purpose
Own the complete lifecycle of the V3 auth session: save after login, load
for display, clear on logout, and restore on cold start (validating both the
stored record and the live Firebase auth state before trusting either).

## Public Interface
```ts
type V3Session = { uid: string; phone: string }

sessionSave(uid: string, phone: string):  Promise<AuthV3VoidResult>
sessionLoad():                            Promise<AuthV3Result<V3Session | null>>
sessionClear():                           Promise<AuthV3VoidResult>
sessionRestore():                         Promise<AuthV3Result<V3Session | null>>
```

`sessionLoad` returning `data: null` is a legitimate "no session" state, not
an error. An error means the storage I/O itself failed.

`sessionRestore` calls `firebaseWaitReady()` before checking `currentUser`.
This is required on cold start — without it, Firebase may still be restoring
its own cached state and `currentUser` would be null even with a valid session.

## Inputs
- `uid` and `phone` after successful authentication.

## Outputs
- `V3Session` or null. Never throws.

## Dependencies
- Config (C10) — SESSION_KEY
- Errors (C9)
- Types
- Storage (C4) — all persistence operations
- Firebase (C6) — firebaseGetCurrentUid, firebaseWaitReady

## MUST NOT
- Perform HTTP requests.
- Import from Engine, API, Navigation, or UI.
- Navigate.
- Display UI.
- Know about PINs or OTPs.

## Replaceability
To add a server-side session check (e.g. token rotation), modify only
`sessionRestore`. No other compartment changes.

To change the session record schema (add a field, change expiry logic),
modify only this file. Storage (C4) is unaffected because it handles
raw strings; schema changes live here.

## Known assumptions
- A session is valid if and only if AsyncStorage and Firebase agree on the UID.
- There is at most one active session at a time. Multi-account support would
  require extending the session key scheme here, not in Storage.
- `savedAt` timestamp is stored but not currently used for expiry. Add TTL
  logic in `sessionRestore` if session expiry is required.
