---
name: PG SSE realtime (Tier-6)
description: Architecture decisions for replacing Firestore L1/L2 onSnapshot listeners with PG-backed SSE streams. Verified working end-to-end 2026-06-24.
---

## Rule
L1 (listenToAllDispatchedOrders) and L2 (listenToActiveOrder) are served by PG SSE streams, NOT Firestore. DriverContext imports both from `utils/order-stream.ts`.

**Why:** Firestore listener retirement path; SSE is snapshot-driven so reconnect always converges to truth without needing a complete event replay.

## Verified results (T008, 2026-06-24)

- `sse_events` table: 7038+ rows, written by trigger on every order insert/update
- `[SSE_TRIGGER] orders → sse_events trigger installed` appears at startup
- `[SSE_HUB] listening on sse_event channel` appears at startup
- `GET /api/drivers/me/offer-stream`: returns 401 unauthenticated; full `OrderDoc[]` array with all fields on auth
- `GET /api/orders/:id/stream`: returns 401 unauthenticated; `{"status":"dispatched"}` for owned order; `{"status":null}` for nonexistent/unowned order
- Reconnect with `Last-Event-ID`: accepted, re-emits current snapshot at same cursor id
- FCM/Firestore dispatch unchanged — PG dispatcher + shadow writer run normally alongside SSE

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

### Check constraints (idempotent, in sse-trigger.ts INSTALL_SQL)
Three CHECK constraints are installed at server startup alongside the trigger (DROP IF EXISTS + ADD CONSTRAINT so they're always in sync):
- `sse_events_topic_chk` — topic IN ('offer', 'order')
- `sse_events_offer_uid_chk` — topic != 'offer' OR driver_uid IS NOT NULL
- `sse_events_order_oid_chk` — topic != 'order' OR order_id IS NOT NULL

### Retention cleanup
`startSseEventsCleanup()` in `sse-hub.ts` — called from `index.ts` after `startSseHub()`. Deletes rows older than 7 days, runs immediately on startup then every 6 hours. Errors are swallowed; log line `[SSE_CLEANUP]` only emits when `rowCount > 0` (silent when table is fresh).

## How to apply
- Any new realtime feature for the driver app should use this SSE pattern, not new Firestore listeners.
- The heartbeat interval (20s) is the worst-case stale window for missed-NOTIFY scenarios.
- `sse_events` rows older than 7 days are automatically pruned; no manual cleanup needed.
- SSE routes require Firebase Auth Bearer token — use `createCustomToken` + Firebase REST exchange to generate test tokens (see /tmp/gen-token.mjs pattern).
- Physical device SSE requires the API server to be deployed (`*.replit.app`) — dev domain is internal-only.
