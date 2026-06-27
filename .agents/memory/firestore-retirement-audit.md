---
name: Firestore business-data retirement audit
description: Final retirement status — what stays Firestore, what is PG-authoritative, and the one intentional design caveat.
---

# Firestore business-data retirement — RESOLVED

**Verdict: FIRESTORE_BUSINESS_DATA_RETIRED (as of 2026-06-23)**
No driver-app write route has Firestore as its authoritative response source.

## KEEP FOREVER (infrastructure — never retire)
- Firebase Auth (`require-auth.ts` verifyIdToken, `firebase-admin.ts` adminAuth) — all logins depend on it.
- FCM (`fcm-dispatcher.ts`, `adminMessaging`) — push notifications.
- Round-robin Firestore dispatcher (`round-robin-dispatcher.ts`) — DISPATCH_SOURCE=firestore kill switch; keep until rollback option is permanently dropped.
- `pg-firestore-projector.ts` / `pg-shadow-writer.ts` — customer app bridge; keep until customer app migrates away from Firestore.

## All driver-facing writes are now PG-authoritative
- Dispatch — DISPATCH_SOURCE=pg, writesAllowed=true, verifyOnly=false.
- Accept/Reject/Timeout/Driver-cancel — PG-canonical REST; FS projection only.
- Order stage / delivery location (PATCH /orders/:id/location) — PG-auth; FS projection.
- Order completion (POST /orders/:id/complete) — PG-auth; FS fallback only for no_pg_row legacy orders.
- Driver status (PATCH /drivers/:uid/status) — PG-auth; FS projection.
- Driver location (POST /drivers/:uid/location) — **FLIPPED** Phase 5J-Final: PG now gates response; FS is void IIFE projection for customer live tracking.
- Support tickets/messages — PG-auth; FS void IIFE projection.
- Payout requests — PG-auth; FS void IIFE projection.
- SSE realtime streams (L1/L2) — PG-backed; Firestore onSnapshot listeners fully retired.

## Intentional design caveat (non-blocking)
POST /drivers/:uid/location returns 200 even when PG updated.length === 0 (driver not yet in PG).
**Why:** avoids breaking location updates for drivers not yet migrated to PG.
**If stricter canonical guarantee is needed:** return 404 on 0-row update.

## PG-primary reads with FS fallback (not FS-authoritative)
GET active-orders, GET completed-trips, GET /orders/:id, GET driver-plans — PG primary; FS fallback for legacy-only rows not yet mirrored.

## Admin routes — out of scope for driver-app retirement
admin-auth.ts, admin-data.ts, admin-users.ts, kyc-admin.ts — admin panel only.

## MOBILE CLIENT (artifacts/mobile) — Firestore/Storage FULLY removed (2026-06-27)
The driver app no longer initializes or calls Firestore or Storage at all. `utils/firebase.ts` initializes Firebase **Auth only** (no `getFirestore`/`getStorage`). Removed: the `db`/`storage` exports, `updateDriverPushToken` (Firestore token shadow), and the Firestore fallback inside `fetchOrderById` (now PG-only REST). KYC uploads already went through VPS REST (`utils/storage.ts` → `/api/kyc/upload-open`), not Firebase Storage. Remaining `firebase/*` in mobile = `firebase/auth` (OTP) + FCM/expo-notifications only. The `firebase` npm package stays (Auth needs it). **Do not reintroduce `firebase/firestore` or `firebase/storage` imports into the mobile app** — it's a permanent rule.
