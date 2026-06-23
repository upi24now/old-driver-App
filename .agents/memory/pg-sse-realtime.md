---
name: PG SSE realtime (Tier-6)
description: Architecture decisions for replacing Firestore L1/L2 onSnapshot listeners with PG-backed SSE streams.
---

## Rule
L1 (listenToAllDispatchedOrders) and L2 (listenToActiveOrder) are served by PG SSE streams, NOT Firestore. DriverContext imports both from `utils/order-stream.ts`.

**Why:** Firestore listener retirement path; SSE is snapshot-driven so reconnect always converges to truth without needing a complete event replay.

## Key architecture decisions

### Snapshot-driven, not replay-driven
Every SSE push re-queries current PG state. The `sse_events` tail is only a wakeup + reconnect cursor mechanism — it can be pruned without breaking correctness. Missed NOTIFYs are caught up by the 20s heartbeat polling `nextMatchingCursor(cursor, filter)`.

### Trigger safety gate
The PL/pgSQL trigger (`sse_orders_emit_trg`) wraps the entire body in `BEGIN/EXCEPTION WHEN OTHERS → RETURN NEW`. A fault in SSE bookkeeping can never abort the underlying order write (which would kill the dispatcher).

### Pool-leak fix (startSseHub)
The LISTEN client is stored in a local `client` variable first; `listenClient` (module-level) is only assigned AFTER `LISTEN sse_event` succeeds. The catch block releases `client` via `client.release(true)` if setup fails. This prevents pool exhaustion on repeated failed restarts.

### Order-stream ownership enforcement
`GET /api/orders/:orderId/stream` emits `{ status: null }` for any request where `order.driverUid !== uid`. Notify-driven refreshes for non-owned orders are suppressed entirely (cadence side channel mitigation). A null is emitted exactly once on owner→non-owner transition so the client converges correctly. `wasOwner` is connection-local; correct on reconnect because initial emit re-derives from DB.

### Mobile reconnect
`react-native-sse` with `pollingInterval: 0` (manual reconnect disabled built-in). Fresh `firebaseAuth.currentUser.getIdToken()` on every (re)connect. `Last-Event-ID` header carries the last seen event id as the resume cursor.

## How to apply
- Any new realtime feature for the driver app should use this SSE pattern, not new Firestore listeners.
- Before pruning `sse_events`, confirm the oldest active client cursor is within the retention window.
- The heartbeat interval (20s) is the worst-case stale window for missed-NOTIFY scenarios.
