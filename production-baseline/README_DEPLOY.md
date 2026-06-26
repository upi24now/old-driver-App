# Customer Order Auth 401 — Surgical Fix (backend only)

## Root cause
The production API (`api-server-baseline`) initialised Firebase Admin in
`src/lib/firebase.ts` using ONLY `FIREBASE_SERVICE_ACCOUNT_JSON`. The VPS/PM2
deployment supplies credentials via the **three discrete env vars**
(`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`), which
the code ignored. It therefore fell through to a credential-less
`initializeApp()`, leaving Admin with **no project id**. With no project
configured, `auth.verifyIdToken()` rejected every valid customer token
(`aud=bike-1-wap`) with:

    401 {"error":"Unauthorized — invalid or expired token"}

## Exact changes (2 files, additive)
1. `src/lib/firebase.ts` — added a 3-var credential branch BETWEEN the existing
   JSON branch and the ADC fallback:
   - if `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
     are all present, build `cert({ projectId, clientEmail, privateKey })` with
     `privateKey.replace(/\\n/g, "\n")` newline un-escaping.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (dev) and bare `initializeApp()` (ADC) paths
     are unchanged.
2. `src/middlewares/customerAuth.ts` — TEMPORARY safe diagnostic logging in the
   `verifyIdToken` catch block: logs error `code`, `message`, `adminProjectId`
   (from env), and the token's decoded `aud`/`iss` claims only. It NEVER prints
   the full token or signature. The 401 response body is unchanged.

Nothing else changed. No API contract change, no Firestore logic change, no
Razorpay change, no admin/driver/KYC/wallet change, no frontend change.

## Deploy (no auto-deploy performed)
1. Back up the current `dist/` on the VPS.
2. Replace `dist/production-api.js` (and `dist/mirror-parity.mjs`) with the files
   in this package.
3. Ensure PM2 env still has `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` (it does, per evidence).
4. `pm2 reload bike-courier-api --update-env`
5. `MIRROR_ENABLED` stays unset/false (mirror remains OFF — unchanged).

## Post-deploy verification
- Trigger a real customer order: `POST /api/customer/orders` should NO LONGER
  return 401 at the auth gate. (If a later save error occurs it will be a
  different explicit error, not auth 401.)
- Unauthenticated request still returns `401 {"error":"Unauthorized — missing token"}`.
- If any 401 persists, check the new `[customerAuth] verifyIdToken failed:` log
  line — it now prints the failing `code`, `adminProjectId`, and token `aud`/`iss`
  so the mismatch is visible.
- Razorpay endpoints unchanged and still functional.

## Removing the temporary diagnostic log later
The diagnostic logging in `customerAuth.ts` is intentionally verbose. Once the
fix is confirmed in production it can be trimmed back to the original bare catch.
