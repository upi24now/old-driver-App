---
name: Firestore business-data retirement audit
description: What still treats Firestore as source-of-truth vs projection/fallback/auth; what blocks full Firestore business-data retirement; what is safe to delete now.
---

# Firestore business-data retirement — readiness map

**Verdict (as of 2026-06): NOT_READY for full Firestore business-data retirement. Driver-app side IS retirement-ready.**

## KEEP FOREVER (never retire)
- Firebase Auth (driver login `auth.ts` createCustomToken, `require-auth.ts` verifyIdToken) and Admin Auth (`admin-auth.ts`, `admin-otp-store.ts`). Removing breaks all logins.
- FCM. The FCM dispatcher (`fcm-dispatcher.ts`) is *triggered by* a Firestore `orders` listener and reads `drivers/{uid}` as a token fallback — so the Firestore order projection is part of the live FCM path.

## KEEP TEMPORARILY (blocked by the EXTERNAL customer app, not in this repo)
The customer app reads/writes `orders/{orderId}` directly in Firestore for real-time state, so these must stay until the customer app migrates:
- `pg-firestore-projector.ts` — projects PG-authoritative order state → Firestore (customer app + FCM trigger see it).
- `pg-shadow-writer.ts` — ingress: mirrors customer-app Firestore order/OTP writes → PG.
- Driver-app Firestore *fallbacks*: `fetchOrderById` + `getActiveOrdersForDriver` (REST-primary, Firestore fallback for cold-start) and `updateDriverPushToken` (FCM-token Firestore shadow the dispatcher reads if the PG token lookup misses). Retire `updateDriverPushToken` in one explicit cutover once the server PG-token path drops its FS fallback.

## BLOCKERS to full business-data retirement (still Firestore-AUTHORITATIVE)
1. **Order completion** — `POST /orders/:orderId/complete` writes the final `delivered` status, wallet balance, and `transactions/{id}_earn` ledger to Firestore as source of truth. Primary blocker.
2. **Support tickets** — `support.ts` (`supportTickets` + messages) is 100% Firestore-authoritative.
3. **Payouts** — `payouts.ts` (`wallets`, `withdrawalRequests`, `transactions`) is 100% Firestore-authoritative.
- Admin-panel reads (`admin-data.ts`, `admin-users.ts`, `kyc-admin.ts` view-mirror) are Firestore-authoritative but only break the admin panel, not the driver/customer apps.

## SAFE TO DELETE
- **Done (mobile):** all dead `utils/firestore.ts` driver-doc/order-write/wallet helpers whose callers moved to PG REST (`profile-api`/`driver-api`/`wallet-api`/`config-api`/`delivery-api`). Kept only live REST wrappers + Firestore fallbacks + shared types. See `firestore.ts` header comments.
- **Backend, gated:** `round-robin-dispatcher.ts` is deletable ONLY once `DISPATCH_SOURCE=pg` is permanent — it is still the authoritative dispatcher in `firestore` rollback mode, so it is the documented kill-switch and must stay while rollback is retained.

**Why this matters:** the migration's authority already flipped to PG for dispatch, but "business-data retirement" means Firestore stops being source-of-truth for ALL business entities. Completion/support/payouts + the external customer app keep Firestore load-bearing. Audit is read-only except the safe mobile dead-code delete.
