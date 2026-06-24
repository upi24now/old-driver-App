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
