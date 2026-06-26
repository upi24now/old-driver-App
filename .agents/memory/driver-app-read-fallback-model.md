---
name: Driver App read-path: two different "empty" contracts
description: Why offer-stream/order-stream emitting [] is NOT a broken Firestore fallback, unlike active-orders.
---

The Driver App has TWO distinct read-path contracts. Conflating them produces a
false "you broke the zero-change invariant" finding (an architect review did exactly this).

1. **Polled REST reads with Firestore fallback** — e.g. `GET /drivers/:uid/active-orders`.
   The client (`firestore.ts` `getActiveOrdersForDriver`) treats the API as primary but
   **only** trusts it when the response is `{ok:true,...}`; ANY other shape (incl. `{ok:false}`)
   makes it fall back to the Firestore listener. So these routes MUST return a JSON *miss*
   (`ok:false`) on a PG miss, never `ok:true` with empty data.

2. **SSE listeners that REPLACE Firestore** — `GET /drivers/me/offer-stream` and
   `GET /orders/:id/stream`, consumed by `utils/order-stream.ts` (`listenToAllDispatchedOrders`,
   `listenToActiveOrder`). That file is a drop-in replacement for the old Firestore `onSnapshot`
   listeners ("DriverContext only swaps the import path"). There is **no Firestore fallback wired
   to these** — the SSE stream IS the source. Therefore emitting `[]` / `{status:null}` is the
   *designed* "no offers / no order" contract, not a broken fallback. `DriverContext.tsx` imports
   these from `order-stream` (SSE), so the deployed app uses the SSE path; offers also arrive via FCM.

**Why this matters:** when adding PG-only versions of these endpoints, don't force a `next()`/`ok:false`
"fallback" onto the SSE routes to satisfy the active-orders rule — they are different mechanisms.
`/orders/:id/stream` still uses `next()` fall-through, but for a different reason (it OVERLAPS an
existing route and must defer non-participants/non-PG orders), not to trigger a client fallback.

**How to apply:** before "fixing" an SSE read route to add fallback semantics, check which client
consumes it. `order-stream.ts` = replacement (empty is valid). `firestore.ts` active-orders = fallback-gated (must return ok:false on miss).
