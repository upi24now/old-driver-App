---
name: Firestore business-data retirement audit
description: What still treats Firestore as source-of-truth vs projection/fallback/auth; what blocks full Firestore business-data retirement; what is safe to delete now.
---

# Firestore business-data retirement — readiness map

**Verdict (as of 2026-06-23): NOT_READY for strict `FIRESTORE_BUSINESS_DATA_RETIRED`. One driver-app write route is still Firestore-authoritative.**

## KEEP FOREVER (never retire)
- Firebase Auth (`require-auth.ts` verifyIdToken, `firebase-admin.ts` adminAuth) — removing breaks all logins.
- FCM (`fcm-dispatcher.ts`, `adminMessaging`) — PERMANENT KEEP.
- Round-robin Firestore dispatcher (`round-robin-dispatcher.ts`) — kill switch for DISPATCH_SOURCE=firestore rollback; keep until rollback is permanently removed.

## RESOLVED — previously blockers, now PG-authoritative
- **Order completion** — `POST /orders/:orderId/complete` is PG-authoritative (`pgCompleteDelivery`); FS fallback only for `no_pg_row` legacy orders; OTP still read from FS private subcollection (intentional, no PG OTP store).
- **Support tickets/messages** — all 4 routes PG-authoritative; FS is `void (async ()` best-effort projection only.
- **Payouts** — `pgRequestPayout` is authority; FS is `void (async ()` projection only.
- **Reject/Timeout/Driver-cancel** — despite living in `utils/firestore.ts`, all three call PG REST endpoints. Server routes are PG-canonical with FS projection.
- **Order realtime streams (L1/L2)** — replaced by PG SSE (`sse_events` table + pg_notify trigger + SSE hub); Firestore `onSnapshot` listeners fully retired.
- **Dispatch** — DISPATCH_SOURCE=pg, writesAllowed=true, verifyOnly=false, FCM push confirmed live.

## SINGLE BLOCKER — one FS-authoritative driver-app write remains
`POST /api/drivers/:uid/location` (`drivers.ts:478`):
- `await fsDb.collection("drivers").doc(uid).update(update)` is the **blocking primary write** (lines 525-535).
- Firestore failure → 500 response abort; PG mirror is a `void` IIFE that runs AFTER (never blocks).
- Comment at line 543: "Firestore stays the source of truth for customer live tracking."
- Mobile actively calls this via `driver-api.ts:61` (`postDriverLocation`).

**Two resolution paths:**
1. **Strict retirement**: Flip to PG-authoritative (PG commit gates response; FS becomes best-effort projection). Requires PG `drivers` table to be the live location store for the customer app.
2. **Scope exception**: Formally declare this endpoint as "infrastructure/read-model" (customer live tracking), record an explicit exception, and issue the verdict as `FIRESTORE_BUSINESS_DATA_RETIRED` with the exclusion documented.

## KEEP TEMPORARILY (blocked by external customer app)
- `pg-firestore-projector.ts` — projects PG order state → Firestore for customer app + FCM trigger.
- `pg-shadow-writer.ts` — ingests customer-app Firestore writes → PG.
- FS fallbacks on GET routes (active-orders, completed-trips, GET /orders/:orderId, driver-plans) — PG-primary; FS fallback for legacy rows not yet in PG.

## PG-primary + FS fallback reads (NOT FS-authoritative; PG is the response)
- `GET /api/orders/:orderId` — PG-primary; FS fallback for legacy rows only.
- `GET /api/drivers/:uid/active-orders` — PG-primary; non-blocking FS compare + FS fallback for 0-PG-rows.
- `GET /api/drivers/:uid/completed-trips` — PG-primary; non-blocking FS compare + FS fallback.
- `GET /driver-plans/:uid/active-plan` — PG-primary; FS fallback for drivers not yet in PG.

## Admin routes — out of scope for driver-app retirement
- `admin-auth.ts`, `admin-data.ts`, `admin-users.ts`, `kyc-admin.ts` — admin panel only.

**Why:** "FIRESTORE_BUSINESS_DATA_RETIRED" requires zero driver-app write routes with Firestore as authoritative response source. `POST /drivers/:uid/location` is the last one.
