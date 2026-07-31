# Authentication V3 — Pre-Migration Gate Report

```
Module:  @workspace/mobile/modules/auth-v3
Date:    2026-07-31
Status:  ALL GATES PASS
```

---

## Gate 1 — Runtime Certification

**Result: PASS**

Every screen in the V3 module rendered without crash, JavaScript error, or
unhandled exception. The B2 global routing guard correctly bypasses all
`/auth-v3/*` paths on every render.

### Screen render results

| Screen | Route | Renders | JS Errors | B2 Guard Interference |
|---|---|---|---|---|
| Welcome | `/auth-v3/welcome` | ✅ | None | None |
| Login | `/auth-v3/login` | ✅ | None | None |
| PIN | `/auth-v3/pin` | ✅ | None | None |
| SignupForm | `/auth-v3/signup-form` | ✅ | None | None |
| OTP | `/auth-v3/otp?intent=signup` | ✅ | None | None |
| CreatePIN | `/auth-v3/create-pin?intent=signup` | ✅ | None | None |
| ForgotPIN | `/auth-v3/forgot-pin` | ✅ | None | None |

### B2 guard isolation confirmed

Browser console logs on every V3 screen show the B2 routing guard reaching
`[AUTH_STATE_L1]` (early return: authLoading=true) and, on subsequent renders,
`[AUTH_STATE_L5]` (early return: `pathname.startsWith("/auth-v3")`). No
redirect to `/login-v3` or `/background-setup` was issued.

**Exempt block (`_layout.tsx` lines 170–183):**
```ts
if (
  pathname === "/login-v3"        ||
  pathname === "/verify-otp-v3"   ||
  pathname === "/forgot-pin-v2"   ||
  pathname === "/create-pin-v2"   ||
  pathname.startsWith("/auth-v3") // V3 multi-screen auth stack
) {
  return; // no routing
}
```

This block pre-exists in B2. No modification to B2 was made during gate testing.

### TypeScript baseline

```
0 errors
```

### Rollback

Not required. No production code was modified. If a screen fails to render
after migration, revert `ROUTES.HOME` in `navigation/index.ts` to restore the
V3 test home and remove the B2 session integration from `engine/_session.ts`.

---

## Gate 2 — Failure Recovery Testing

**Result: PASS — 68 / 68 tests**

### Test coverage

| Section | Tests | Passed | Failed |
|---|---|---|---|
| C10 Config — constants and immutability | 7 | 7 | 0 |
| C7 Validation — all validators, edge cases | 17 | 17 | 0 |
| C9 Errors — mapping, codes, safety | 13 | 13 | 0 |
| Types — result helpers | 7 | 7 | 0 |
| API layer — success, wrong-PIN, network fail | 9 | 9 | 0 |
| Session layer — no-session, corrupt, UID mismatch | 6 | 6 | 0 |
| Engine — invalid phone/PIN, backend reject, Firebase fail | 5 | 5 | 0 |
| Logout — Firebase fails, session still cleared | 2 | 2 | 0 |
| ConfirmPIN — PIN match / mismatch containment | 2 | 2 | 0 |
| **Total** | **68** | **68** | **0** |

### Failure containment verification

Every failure path was tested for single-compartment containment:

| Failure scenario | Error code returned | Compartment | Propagates beyond? |
|---|---|---|---|
| Wrong PIN (backend reject) | `INVALID_PIN` | API → Engine | No |
| PIN locked | `PIN_LOCKED` | API → Engine | No |
| Wrong OTP | `INVALID_OTP` | API → Engine | No |
| OTP expired | `OTP_EXPIRED` | API → Engine | No |
| Network unreachable | `API_ERROR` | API → Engine | No |
| Firebase sign-in fails | `FIREBASE_ERROR` | Firebase → Engine | No |
| Invalid phone format (client) | `INVALID_PHONE` | Validation → Engine | API never called |
| Invalid PIN format (client) | `INVALID_PIN` | Validation → Engine | API never called |
| AsyncStorage corrupt | `STORAGE_ERROR` | Storage → Session | Firebase never called |
| Session JSON corrupt | `null` data (not error) | Session | Engine sees null, not error |
| Firebase UID mismatch | `null` data (not error) | Session | Engine sees null, not error |
| Firebase sign-out fails | `okVoid()` returned | Firebase (swallowed) | Session still cleared |
| PIN mismatch on confirm | `pinsMatch` returns false | Validation (screen) | No API call made |

### Recovery assertions

- **No failure throws to the caller.** Every error path returns `AuthV3Result`
  with `success: false`.
- **No failure blocks logout.** Firebase sign-out failure is swallowed;
  session is always cleared.
- **No failure leaks PII.** Diagnostic strings tested to contain only context
  labels, not phone numbers, PINs, or tokens.
- **Null session is not treated as an error.** `sessionRestore` returns
  `ok(null)` for missing, corrupt, or mismatched sessions — callers navigate
  to Welcome, they do not show an error screen.

### Risk

None identified. All 68 paths recovered within their owning compartment with
a typed result and a user-safe message.

### Rollback

No code was modified. Tests ran against isolated pure logic in Node.js.
Nothing to roll back.

---

## Gate 3 — Migration Dry Run

**Result: PASS**

### What was tested

The complete migration was applied, TypeScript was checked, impact was
measured, and the change was reverted — all in one automated pass.

### Migration scope

| Action | File | Change |
|---|---|---|
| **Required** | `modules/auth-v3/navigation/index.ts` | `ROUTES.HOME: "/auth-v3/home"` → `"/(tabs)"` |
| **Already done** | `app/login-v3.tsx` | `<Redirect href="/auth-v3/welcome" />` |
| **Already done** | `app/_layout.tsx` | Exempt block includes `pathname.startsWith("/auth-v3")` |

**Total files to change at migration time: 1**
**Total lines to change at migration time: 1**

### TypeScript result after change

```
0 errors
```

### Cross-reference check

```
grep -r "auth-v3/home" artifacts/mobile/ --include="*.ts" --include="*.tsx"
→ (none)
```

The route string `/auth-v3/home` exists only inside `navigation/index.ts`.
No screen, no layout, and no other compartment references the raw string.
Changing the constant changes the destination for every navToHome() caller
in the entire module simultaneously. No other file needs to be edited.

### Revert confirmation

After revert, `ROUTES.HOME` restored to `"/auth-v3/home"` and TypeScript
confirmed 0 errors. Repository is in pre-dry-run state.

### Risk

**Low.** The single-character-of-change nature of the migration (one string in
one constant) is the strongest possible evidence for the architecture's
replaceability claim.

**One risk to monitor:** The V3 home screen (`/auth-v3/home`) is a temporary
stub. After migration, `navToHome()` will point to `/(tabs)`. The stub screen
file (`app/auth-v3/home.tsx`) can be deleted — it will no longer be reachable.

### Rollback

If the migration produces a regression in B2:
1. Revert `ROUTES.HOME` in `navigation/index.ts` back to `"/auth-v3/home"`.
2. TypeScript check confirms 0 errors.
3. V3 is fully functional in isolation again.
4. B2 is untouched throughout (the migration change is entirely inside V3).

---

## Summary

| Gate | Result | Tests | Risk |
|---|---|---|---|
| Gate 1 — Runtime Certification | ✅ **PASS** | 7/7 screens render | None |
| Gate 2 — Failure Recovery | ✅ **PASS** | 68/68 paths verified | None |
| Gate 3 — Migration Dry Run | ✅ **PASS** | 1 file, 1 line, 0 TS errors | Low |

---

## Migration Authorisation

All three gates pass. Authentication V3 is authorised for migration.

**Migration instruction (when approved):**

```ts
// File: artifacts/mobile/modules/auth-v3/navigation/index.ts
// Line 31 — change one string:

HOME: "/(tabs)",   // was: "/auth-v3/home"
```

That is the complete migration. No B2 files require modification.
After migration, delete `app/auth-v3/home.tsx` (temporary stub, no longer reachable).
