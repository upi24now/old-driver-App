---
name: Driver App active-order poll must treat 403 as terminal
description: Why GET /api/orders/:id 403 responses need explicit terminal handling in the driver app's order poller, not generic error backoff.
---

`utils/order-stream.ts`'s active-order poller (`listenToActiveOrder`) originally reused the generic `authedGet` helper, which only special-cased HTTP 404 as a "gone" signal and threw on anything else non-2xx, including 403. When a customer cancels an order, the backend can revoke the driver's access to that order (403) before/instead of returning a cancelled status body — that 403 was swallowed by the poll's transient error-backoff and retried forever, so the driver app's terminal-cleanup path (which relies on `onChange(null)`) never fired. The active-delivery screen stayed stuck on the last known stage (e.g. "En Route to Pickup") even though the order was already cancelled server-side.

**Why:** any driver-app polling loop against an order/assignment endpoint must treat "no longer authorized" (403) the same as "no longer exists" (404) — both are equally valid "this driver has no claim to this order anymore" signals and must converge to the same terminal/cleanup code path. Only genuine transport/5xx failures should hit the transient error-backoff.

**How to apply:** when adding new polling endpoints for driver-owned resources (orders, offers, assignments), give 403 the same "authoritative gone" treatment as 404 in the fetch layer, not just 2xx/network-error. Don't rely solely on a status-code field inside the JSON body for terminal detection — the HTTP status itself can be the only terminal signal when the server has already revoked the resource.
