---
name: Dispatch delay is engagement gap, not pipeline
description: Why "orders reach driver very late" is NOT a dispatch-pipeline lag but an FCM-off + no-TTL engagement problem.
---

# Perceived "dispatch delay" = driver-engagement gap, not pipeline lag

When orders "reach the driver very late" (minutes to hours), do NOT hunt for pipeline lag first. The PG dispatch pipeline is effectively instant and continuous:
- Firestore→PG mirror is event-driven `onSnapshot` (no polling) — order row + first SSE offer stamped at `created_at` (sub-second).
- PG dispatcher (`pg-dispatcher.ts`, `POLL_INTERVAL_MS=30000`, timeout 60s) re-offers an unaccepted order every ~90s, non-stop, verifiable in `sse_events` (one `offer` row per cycle).
- `pgGetOffersForDriver` filters `status='dispatched' AND dispatch_timeout_at > now()`, so stale offers are never replayed; projector (`pg-firestore-projector.ts`, 15s) is normally backlog-free (`dispatch_projections` rows all `projected`).

**The real causes of the delay:**
1. **FCM disabled** — `PG_FCM_SEND_ENABLED` ≠ `"true"` → `[PG_DISPATCH_WRITE_GUARD] FCM send blocked` every cycle. With no push, the driver app is never woken, so the driver only sees the (continuously-waiting) offer when they manually open/refresh. That manual-open gap IS the 15-min/2-hr delay. The co-hosted Firestore FCM dispatcher also skips ("already claimed") because the PG dispatcher wins the claim race → net zero FCM.
2. **No order TTL / max-search reaper** — orders left `searching` are redispatched forever (timeout sweep returns to pool but never cancels). Customer app shows "driver not found" on its own short timeout, but backend keeps cycling the abandoned order, so it can resurface on the driver hours later.

**How to confirm fast:** compare `orders.created_at` vs first `sse_events.offer.created_at` (≈ equal ⇒ pipeline fine), then check `sse_events` cadence (≈90s ⇒ continuously offered), then grep logs for `PG_DISPATCH_WRITE_GUARD ... FCM send blocked`.

**Fixes:** primary = set `PG_FCM_SEND_ENABLED=true` (config, reversible). Secondary = add max-search TTL that cancels (not redispatches) orders past the customer search window. Abandoned "driver not found" orders SHOULD be cancelled, never redispatched.

## Foreground refinement (FCM-off is NOT the only cause)
A foreground, online, eligible driver also got NO popup within the customer 60s window. Server proof: order created + offer + `active_offer_driver_uids` + `dispatch_timeout_at` + sse_events offer row ALL stamped same millisecond as creation; offers stayed available the whole window — but the request logs show the app hitting the server for `POST /location` (isOnline=true), `PATCH /drivers/me/fcm-token`, `GET /drivers/me`, `GET /orders/hotzone`, and ZERO `GET /api/drivers/me/offer-stream` (none open or closed for ~13+ min around the test; last two SSE conns ended ~16:45 & ~16:53). So the in-app popup channel (SSE `/offer-stream` → `pgGetOffersForDriver`) had no live consumer = break point **H** (SSE event generated, driver not connected).

**Why the app holds no SSE connection (client, `DriverContext.tsx` + `utils/order-stream.ts`):**
- Offer listener is gated `isOnline && driverUid && !isAtCapacity && subscriptionActive` AND `isOnline` is FORCED false on every app start/cold-start/reconnect ("always start offline"); only a manual online-toggle re-subscribes. Server `is_online=t` is stale and does NOT drive the client.
- `subscribe()` connect loop fails SILENTLY: `freshIdToken()` null → infinite 2s reconnect that never creates an EventSource (no server request ever); the `error` handler just closes + reschedules with no surfaced state. So a dead stream is invisible and the app can look "online" while never connected.

**How to verify break H vs I fast:** grep deployment request logs for `GET /api/drivers/me/offer-stream` during the window. Present (open/close) ⇒ investigate client render (break I). Absent while other driver REST calls land ⇒ break H (no SSE consumer). To distinguish an open-but-unlogged SSE conn: pino logs SSE only on close, so re-check after >300s (max conn lifetime) — a real conn will have closed and logged by then.

**Fix direction (client):** re-derive online state from server on launch instead of forcing offline; (re)subscribe to `/offer-stream` whenever authenticated+online; add visible open/error logging so a dead stream is detectable. Keep FCM enabled as the wake path for background/killed AND foreground-with-dead-SSE.
