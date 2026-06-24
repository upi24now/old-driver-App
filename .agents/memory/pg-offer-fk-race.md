---
name: PG offer-row FK race (dispatch ordering)
description: Why order_offers creation must follow the parent orders row, and how the FCM dispatch path enforces it.
---

# PG offer-row FK race

`order_offers.order_id` has a FK to `orders.id` (`order_offers_order_id_orders_id_fk`).
Two **independent Firestore-event-driven** paths touch PG for the same order with NO
ordering guarantee between them:

- `pg-shadow-writer.ts` mirrors the parent `orders` row via `pgUpsertOrder`.
- `fcm-dispatcher.ts` `sendOrderFcm` creates the offer via `pgCreateOffer`.

The offer insert could win the race by a few ms, hit a FK violation, get **swallowed**
(`pgCreateOffer` catches and returns `{ok:false}`, never throws), so no offer row was
ever created. The driver's Accept (`pgAcceptOffer`) then found no offer → `not_in_offer`
("Order Unavailable") **regardless of accept timing** — the offer timer was never the cause.

**The rule:** any path that creates an `order_offers` row must guarantee the parent
`orders` row exists first. Do NOT rely on the shadow-writer winning the race.

**How it's enforced (in `sendOrderFcm`):**
1. `pgUpsertOrder(orderId, data, {guardRegression:true})` FIRST — ensures the parent row.
   `guardRegression` keeps the conflict-UPDATE constrained to `POOL_MIRRORABLE_STATUSES`
   (`searching|pending|dispatched`) so a concurrently-claimed/terminal row is never regressed.
2. `createOfferWithRetry` (bounded: 5 × 250ms) inspects `pgCreateOffer`'s `{ok}` **return**
   (it never throws) — a backstop for any residual visibility lag.
3. **FCM is gated on offer success**: only UIDs whose offer row is confirmed (`offerReadyUids`)
   are notified. If none succeed, the FCM claim is cleared and NO push is sent — never notify a
   driver who would get `not_in_offer`.

**Why:** an FCM push without a committed offer row is worthless under the API-accept
architecture (accept is PG-authoritative via `pgAcceptOffer`).

**Gotcha:** `[ORDER PG COMMITTED]` logs after `pgUpsertOrder`, which is non-throwing, so it is
slightly optimistic; the real commit proof is the subsequent `[PG OFFER CREATE SUCCESS]`
(FK satisfied). The same FK-race class also produces pre-existing non-blocking
`[pgUpsertOrderOtp] ... order_otps_order_id_orders_id_fk` noise on the startup snapshot.

Log markers in this path: `[ORDER PG CREATED]`, `[ORDER PG COMMITTED]`,
`[PG OFFER CREATE START|SUCCESS|RETRY|FAIL]`, `[FCM SEND START|SUCCESS]`.
