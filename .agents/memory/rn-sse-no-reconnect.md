---
name: react-native-sse silent death on proxy 300s close
description: Why the Driver App's /offer-stream SSE dies after ~5 min and never reconnects, so foreground drivers get no in-app order popup.
---

# react-native-sse@1.2.1 + pollingInterval:0 silently dies on a clean server/proxy close

**Symptom:** foreground, online, eligible driver gets NO in-app order popup; server shows the offer + sse_events generated instantly but ZERO `GET /api/drivers/me/offer-stream` reaching the server during the window. Earlier in the same session offer-stream connections DID exist (so library/Expo/Android all work), each ending at exactly `responseTime≈300000ms`, then NONE reappear for 40+ min even though the GPS location interval keeps posting `isOnline=true` (JS session alive + online the whole time).

**Root cause (deterministic from library source):**
- The Replit infra proxy caps long-lived SSE connections at ~300s and ends them as a normal HTTP completion → on the client XHR this is `readyState=DONE` + `status=200`.
- In `react-native-sse@1.2.1` `EventSource.js`: the 200/DONE branch dispatches NO `error` event; it only calls `_pollAgain(this.interval, false)`. Reconnect is gated `if (time > 0 || allowZero)`. The app passes `pollingInterval: 0` (to manage reconnect itself) → `this.interval = 0` → `_pollAgain(0, false)` is a NO-OP.
- `error` is dispatched ONLY for `status>=400`/`status!=0` or `onerror` (true network reset). The `close` event fires ONLY from the explicit `.close()` method, never on a server/proxy-initiated close.
- The app (`utils/order-stream.ts subscribe()`) puts its manual reconnect ONLY in the `"error"` listener → on a clean proxy close, no `error` fires → reconnect never runs → EventSource silently dead.

**Why it stays dead:** the DriverContext offer-listener effect (`DriverContext.tsx`, deps `[isOnline, driverUid, isAtCapacity, subscriptionActive]`) only re-subscribes when a dep CHANGES. A continuously-online session has no dep change, so the dead stream is never revived until a manual offline→online toggle. (Compounding: `setOnlineState(false)` is forced on every launch/auth-refresh — "always start offline" — so cold-starts also need a manual toggle to subscribe.)

**A–F classification:** C — EventSource never (re)created during the offer window. NOT A (gate was open: uid set, isOnline true, subscriptionActive true to 2026-07-24, 0 active orders), NOT B (token works — REST calls authed fine same window), NOT D/E (no request reaches server), F is only the downstream symptom of C.

**Fix (APPLIED in `utils/order-stream.ts subscribe()`):** a connection-AGE watchdog, NOT a message/ping-silence watchdog. **Why not message-silence:** the server heartbeat is a COMMENT frame `: ping\n\n`, which react-native-sse's parser ignores → it fires NO `message` event → a "no message for 45–60s" watchdog cannot see heartbeats and would false-fire every ~50s in quiet periods. So liveness must key off connection age, not frames. Watchdog (15s tick) proactively recycles at `CONNECTION_MAX_MS=270s` (before the ~300s proxy cap, so the silent clean-close is preempted, never reached) and also recycles if `"open"` never arrives within 30s. Kept `pollingInterval:0` + manual fresh-token reconnect + error-path reconnect with backoff. **Async zombie guard (REQUIRED):** `connect()` is async (awaits `freshIdToken()`); without a guard an unsubscribe/recycle during that await still constructs an orphan EventSource → duplicate streams/popups. Fixed via a `generation` counter bumped in `teardownEs()`; `connect()` captures it before the await and bails if it changed (plus a post-await `closed` recheck). Keep FCM enabled as the wake path.

**`"close"` listener is useless for reconnect** here — the lib dispatches `close` ONLY from our own `.close()`, never on a server/proxy close, so it can only react to closes we initiated. Don't wire reconnect to it.

**How to confirm fast:** server request logs — offer-stream conns ending at exactly ~300000ms then never reappearing while other driver REST calls (location/fcm-token) keep landing = this bug. If `error`-path were happening you'd see periodic reconnect GETs.
