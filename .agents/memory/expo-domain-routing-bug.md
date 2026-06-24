---
name: EXPO_PUBLIC_DOMAIN dev vs prod routing bug
description: Mobile package.json was hardcoding the production domain; physical device called old deployed server missing newer API routes, causing null profile and /registration routing.
---

## The rule

`EXPO_PUBLIC_DOMAIN` in `artifacts/mobile/package.json` `dev` script must be `$REPLIT_DEV_DOMAIN`, never the hardcoded `.replit.app` production domain.

**Why:** The `.replit.app` domain is a SEPARATELY DEPLOYED production server running a snapshot of old code. Newer API routes (e.g. `/api/drivers/me`) only exist on the dev server. Physical devices using Expo Go load the dev bundle but call the production API → `Cannot GET /api/drivers/me` → null profile → `ensureDriverSignup` path → `/registration` for existing drivers.

**How to apply:** The `.replit` `[userenv.shared]` already sets `EXPO_PUBLIC_DOMAIN` to the dev domain. The package.json dev script was overriding it with the hardcoded prod domain. After the fix, the dev script uses `EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN` and the physical device correctly reaches the dev API server which has the current code.

## Related hardening added at the same time

- `getDriverProfile` now populates a module-level `_lastProfileFetch` debug accumulator on every code path (success, 404, error, no_token). `getLastProfileFetchDebug()` exports it.
- `confirmOtp` in DriverContext: if pgProfile is null after retry AND `_lastProfileFetch.source !== "404"` → return error to user instead of calling `ensureDriverSignup` (which would create a spurious PG row for an existing driver with a network/server error).
- Debug overlay in login.tsx: after OTP success, if `result.debugLog` is populated, show a full-screen dark overlay with 11 runtime items (DOMAIN, BASE_URL, UID, token, /drivers/me URL/status/body, /verification-status ping, nextRoute, AsyncStorage keys) before calling `router.replace`. User taps PROCEED to continue.
