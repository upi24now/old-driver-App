---
name: PG SSE offer-stream popup gap
description: Why drivers get FCM but no in-app ride popup after Tier-6 — the dispatched "added" path never writes the PG columns the SSE offer query requires.
---

# In-app ride popup channel ≠ FCM (post Tier-6)

Since Phase 5J-Tier-6 the driver's in-app ride popup is **not** a Firestore
listener and **not** FCM. `listenToAllDispatchedOrders` (mobile
`utils/order-stream.ts`) is an SSE stream `GET /api/drivers/me/offer-stream`,
whose snapshot comes from PG `pgGetOffersForDriver(uid)`.

`pgGetOffersForDriver` matches rows only when **all three** hold:
`uid = ANY(active_offer_driver_uids)` AND `status='dispatched'` AND
`dispatch_timeout_at > now()`.

## The gap
On a fresh dispatch (a Firestore `"added"` status→dispatched event), nobody
writes `active_offer_driver_uids` / `dispatch_timeout_at` into PG:
- The FCM dispatcher creates the PG row with `pgUpsertOrder(..., {guardRegression:true})`
  — **no `mirrorOfferSet`**, so `active_offer_driver_uids` stays `{}` and
  `dispatch_timeout_at` only set if the Firestore doc already carried it.
- The shadow-writer's offer-set mirror (Listener 6, `pg-shadow-writer.ts`) is the
  ONLY writer of `active_offer_driver_uids` (via `mirrorOfferSet:true`) but it
  handles **only `change.type==="modified"`** and explicitly delegates `"added"`
  to the dispatcher's upsert — which doesn't mirror the offer set.

Result: a normal single-driver dispatch (added, no later modified) leaves PG
`active_offer_driver_uids={}` + `dispatch_timeout_at=NULL` → SSE offer query
returns nothing → device `[DriverOfferListener] snapshot size= 0` → no popup.
FCM still arrives (separate channel), so the symptom is "push received, no sheet."

**Why:** the FCM-path FK-race fix and the popup are different channels; a green
FCM SEND SUCCESS proves nothing about the popup. `PG_INGRESS_CYCLE offerSize:N`
counts the **Firestore** doc, not PG — it can read 1 while PG is empty.

**How to apply:** when debugging "no popup", check PG `active_offer_driver_uids`
+ `dispatch_timeout_at` for the dispatched order, not FCM logs. Fix direction:
dispatcher's dispatch-time `pgUpsertOrder` should pass `mirrorOfferSet:true` and
mirror `dispatchedAt`/`dispatchTimeoutAt`, or Listener 6 should also handle `"added"`.
