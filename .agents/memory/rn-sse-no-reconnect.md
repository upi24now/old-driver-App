---
name: react-native-sse silent death on Android — RESOLVED via polling
description: Why the Driver App's /offer-stream SSE opened but never delivered messages on Android, and why it was replaced with polling rather than patched further.
---

# RESOLVED: replaced SSE receive layer with polling (2026-07-05)

**Final symptom (superseded the earlier 300s-clean-close bug below):** even with
the connection-age watchdog in place, production logs showed `OFFER_STREAM_OPEN`
firing but `OFFER_STREAM_MESSAGE` **never** firing, while the server logged
`OFFER_STREAM_SEND` repeatedly on that same connection (dispatch fully correct:
`active_offer_driver_uids` populated, `DISPATCH OFFER ADDED` fired). This is a
different failure mode than the 300s clean-close: the socket never went through
a close/error at all — the client-side EventSource (built on RN's XHR) never
surfaced ANY incremental body chunk to JS on Android, not even the first one.

**Root cause:** react-native-sse is implemented entirely on top of
`XMLHttpRequest`, reading `xhr.responseText` growth on `readystatechange`
(readyState 3/LOADING) events. React Native's Android XHR (OkHttp-backed) does
not reliably deliver incremental `responseText` progress for a long-lived
chunked keep-alive stream — data only surfaces to JS when the response ends,
which never happens for an intentionally-never-closing SSE stream. iOS's XHR
does not have this limitation. No amount of client-side reconnect/watchdog
logic can fix this because the problem is chunk delivery, not connection
liveness.

**Fix:** replaced the receive layer only (`artifacts/mobile/utils/order-stream.ts`)
with a plain polling loop (~3s interval) against JSON REST endpoints instead of
EventSource:
- `GET /api/drivers/me/offers` (new, in `artifacts/api-server/src/routes/sse.ts`) —
  same `pgGetOffersForDriver` + `pgOrderToOrderDoc` data the SSE stream pushed.
- `GET /api/orders/:orderId` (already existed) — reused for single-order status.

**Durable rule:** on Android RN, never rely on EventSource/XHR streaming for a
connection meant to stay open indefinitely and deliver more than one chunk —
prefer short-interval polling against a plain JSON endpoint. The SSE
routes/hub (`sse.ts`, `sse-hub.ts`) were kept server-side (harmless, other
consumers may still work e.g. iOS/web), only the Driver App's Android
consumption path was swapped.

---

# (superseded) earlier bug: silent death on proxy 300s close

**Symptom:** foreground, online, eligible driver gets NO in-app order popup; server shows the offer + sse_events generated instantly but ZERO `GET /api/drivers/me/offer-stream` reaching the server during the window... (see git history for full original note — connection-age watchdog was applied but did not fix the deeper Android XHR chunk-delivery issue above, which is now the documented root cause and the reason polling replaced SSE entirely for this receive path).
