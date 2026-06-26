---
name: Driver App read-path: two different "empty" contracts
description: active-orders is now PG-authoritative (NO Firestore fallback); offer-stream/order-stream SSE emitting [] is the designed "none" contract.
---

The Driver App has TWO distinct active-order read-path contracts. Conflating them produces a
false "you broke the zero-change invariant" finding (an architect review once did exactly this).

1. **Polled REST read — `GET /drivers/:uid/active-orders` (now PG-AUTHORITATIVE, no fallback).**
   `firestore.ts` `getActiveOrdersForDriver` treats **any HTTP 200 as authoritative** and returns the
   `orders` array verbatim — it **ignores the `ok` flag**, so `200 {ok:false,orders:[]}` (the backend's
   genuine PG miss) is an authoritative "no active order". On a non-200 / no-auth-user it **throws** so the
   single caller (`DriverContext` cold-start restore) leaves existing state untouched. The Firestore
   fallback (`getDocs`/`query`/`ACTIVE_STATUSES`) was **removed**. The restore block now CLEARS
   `activeOrders=[]` + `currentActiveOrderId=null` on an empty authoritative result (was: only set on
   non-empty, never cleared → that was the phantom-stale-order bug).
   **Why:** Firebase is Auth/OTP+FCM only; no Firestore for business data. A stale Firestore order kept
   resurrecting a phantom active ride after the order was gone from PG.
   **Historical note:** earlier ("API-primary WITH fallback") the rule was the opposite — backend reads
   had to return `ok:false` on a PG miss so the client would fall back to Firestore, and must never send
   `ok:true` with empty data. That rule is now obsolete on the client; the backend still returns
   `{ok:false,orders:[]}` on miss but the app treats it as authoritative-empty, not a fallback trigger.

2. **SSE listeners that REPLACE Firestore** — `GET /drivers/me/offer-stream` and `GET /orders/:id/stream`,
   consumed by `utils/order-stream.ts` (`listenToAllDispatchedOrders`, `listenToActiveOrder`). Drop-in
   replacement for the old Firestore `onSnapshot` listeners. **No Firestore fallback is wired to these** —
   the SSE stream IS the source, so emitting `[]` / `{status:null}` is the *designed* "no offers / no order"
   contract, not a broken fallback. Offers also arrive via FCM.

**How to apply:** before "fixing" a read route, check the client. `order-stream.ts` SSE = replacement
(empty is valid). `firestore.ts` `getActiveOrdersForDriver` = PG-authoritative (HTTP 200 incl. empty wins;
non-200 throws; never reads Firestore). `/orders/:id/stream` still uses `next()` fall-through, but only
because it OVERLAPS an existing route and must defer non-participants/non-PG orders — NOT to trigger a
client Firestore fallback.
