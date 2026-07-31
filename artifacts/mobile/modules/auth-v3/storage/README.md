# Compartment 4 — Secure Storage

## Purpose
Own the local persistence abstraction. All reads and writes to device storage
pass through this compartment and nowhere else.

## Public Interface
```ts
storageWrite(key: string, value: string): Promise<AuthV3VoidResult>
storageRead(key: string):                 Promise<AuthV3Result<string | null>>
storageRemove(key: string):               Promise<AuthV3VoidResult>
```
`storageRead` returns `data: null` (success) when the key does not exist —
that is a cache miss, not an error. A storage error is returned only when the
underlying I/O operation fails.

## Inputs
Plain string keys and values. Serialisation (JSON etc.) is the caller's
responsibility — this compartment handles raw strings only.

## Outputs
`AuthV3Result<string | null>` or `AuthV3VoidResult`. Never throws.

## Dependencies
- AsyncStorage (`@react-native-async-storage/async-storage`)
- Errors (C9) — for mapError, logOp
- Types — for AuthV3Result, AuthV3VoidResult, ok, okVoid, fail

## MUST NOT
- Contain authentication logic.
- Import from Firebase, Session, Engine, API, or Navigation.
- Serialise or deserialise domain objects — that belongs in Session (C3).
- Throw exceptions to callers.

## Replaceability
To replace AsyncStorage with `expo-secure-store` or any encrypted store:
change only this file. Zero changes required in any other compartment.

## Known assumptions
- AsyncStorage is available in the React Native / Expo environment.
- Keys are owned and managed by Session (C3) via Config (C10) constants.
  No compartment other than Session should write to session-related keys.
