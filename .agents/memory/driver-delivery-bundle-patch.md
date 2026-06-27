---
name: Driver delivery additive patch for the prod VPS bundle
description: Durable gotchas from adding the driver-facing delivery API + broadcast dispatch to the live esbuild bundle without source.
---

# Driver delivery API patch — non-obvious constraints

Adds the driver-facing delivery API the mobile app expects (offer-stream, accept,
stage, complete, location, order stream) + a broadcast dispatch poller to the LIVE
prod bundle as ONE additive IIFE spliced immediately BEFORE `app2.use("/api", routes_default);`
(register-first beats the bundle's own parallel `/api/driver/*` routers). See
`prod-vps-bundle-patch.md` for the byte-safe splice mechanics; this file is the
delivery-specific knowledge.

## esbuild lazy module init — call the inits yourself
Top-level `var pool, db` (via `init_src()`) and `logger` (via `init_logger2()`) are
populated by lazy `__esm` initializers, NOT at file top. An injected block that runs at
mount-time must call `init_src()` / `init_logger2()` (idempotent) before touching
db/pool/logger, and lazy-init `notificationService` before use.
**Why:** module-init order isn't guaranteed relative to where your spliced block executes.

## notificationService: only the __export() names are reachable
The bundle's `notificationService` `__esm` module exports ONLY
`getNotificationHistory` / `saveFCMToken` / `sendNotification`. The low-level senders
`isExpoToken` / `sendViaFCM` / `sendViaExpoPush` are module-PRIVATE and unreachable from
the top-level scope. Send FCM by reusing `sendNotification({audience:"specific_driver",
driverUid, title, body, data})` — it resolves tokens itself. Don't try to reach the
private senders or re-implement token resolution.

## creditWallet is NOT order-idempotent — guard yourself
The bundle's `creditWallet(uid, amount, desc, {orderId})` inserts a fresh
`wallet_transactions` row every call; there is NO unique index on (driver_uid, order_id).
Any "credit exactly once per order" requirement must be enforced by the caller via an
existence check (`SELECT 1 ... WHERE driver_uid AND order_id AND type='credit'`) before
calling it. `wallet_transactions.balance_before`/`balance_after` are NOT NULL, so any
injected audit row (e.g. `cash_collected`, amount 0) must supply both (use the current
balance for both).

## Completion atomicity: fail loud, then self-heal on retry
OTP-verify (`pgVerifyDeliveryOtp`) marks the order `delivered` in a step SEPARATE from
the wallet credit. If the credit throws after delivery is committed, do NOT return
`ok:true` — return a non-2xx (`500 credit_failed`) so the client retries. The retry hits
`pgVerifyDeliveryOtp`'s `invalid_status` (already delivered) branch, which must re-run an
IDEMPOTENT settle that re-attempts the (guarded) credit. Otherwise the payout is lost
forever with no recovery path. (Caught in architect review.)
**How to apply:** one `settleDeliveredOrder(uid, orderId)` helper, called from BOTH the
fresh-delivered and the invalid_status-already-delivered branches.

## SSE order-stream needs an ownership guard (IDOR)
`GET /api/orders/:orderId/stream` must filter `WHERE id=$1 AND driver_uid=$2`; without the
driver_uid clause any authenticated driver can poll arbitrary order IDs and watch status
transitions. (Caught in architect review.)

## Prove prod SQL on a hand-built prod-faithful temp schema
The Replit dev PG schema DIVERGES from the prod bundle's schema, so deterministic SQL
proofs must run against a temporary schema built to match the bundle's compiled
`pgTable(...)` defs (NOT NULL balance cols, no order-dedup index, text `type`), then
dropped. Validating against dev's real tables gives false confidence.
