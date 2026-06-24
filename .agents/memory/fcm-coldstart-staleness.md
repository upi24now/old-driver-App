---
name: FCM cold-start staleness guard
description: Android caches last FCM tap indefinitely; getLastNotificationResponseAsync replays it on every cold start without a staleness check, causing fake order popups after login.
---

## Rule
In `useNotifications.ts`, `getLastNotificationResponseAsync()` must check `response.notification.date` (Unix seconds) before calling `handleNotificationResponse`. Any notification older than 2 minutes is stale — ignore it and return early.

```ts
const ageMs = Date.now() - response.notification.date * 1000;
if (ageMs > 2 * 60 * 1000) {
  console.log("[FCM] ignoring stale cold-start notification age:", Math.round(ageMs / 1000), "s");
  return;
}
```

**Why:** Android's Expo Notifications persists the last notification tap response until the OS clears it (can be hours/days). Without this guard, every app launch after a tapped FCM replays `handleNotificationResponse` → `router.push("/ride-request")` with the old orderId and FCM payload fields, showing a popup for an order that no longer exists. Offer windows are ≤60s so 2 minutes is a safe staleness threshold.

**How to apply:** Applies any time `getLastNotificationResponseAsync()` is called for incoming-order FCM. The fix is in place in `artifacts/mobile/hooks/useNotifications.ts`.

## Related: PG projector Firestore restore
If a Firestore order is cancelled manually but the `dispatch_projections` queue has queued `return_to_pool` events for it, the projector will restore it to `searching` status in Firestore, allowing re-dispatch.

**Fix:** When manually cancelling test/stale orders:
1. Hard-delete from Firestore (DELETE the document, not just status=cancelled) — projector skips absent docs with `[PG_PROJECT_SKIPPED]`
2. Set PG status=`cancelled` (PG dispatcher guard excludes cancelled from eligible set)
3. Purge `dispatch_projections` rows for those order IDs where `projected_at IS NULL`

## Related: PG dispatcher cancelled-order guard
PG dispatcher skips orders with `status IN ('delivered','cancelled')` in both the eligible-for-dispatch query and the timeout-recovery scan. Confirmed by `[PG_DISPATCH_SERVICE_TIMEOUT] expired dispatches found count: 0` at startup even when cancelled orders have expired `dispatch_timeout_at`. Always clear `dispatch_timeout_at = NULL` on manual cancel to avoid confusion.
