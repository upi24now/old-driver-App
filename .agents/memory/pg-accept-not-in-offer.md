---
name: PG accept not_in_offer in production
description: Why driver Accept fails with "Order Unavailable" in prod, and the self-heal contract that fixes it
---

# Driver Accept fails with not_in_offer in production

**Symptom:** Driver gets the FCM ride popup, but tapping Accept shows "Order Unavailable — already accepted or no longer available." `pgAcceptOffer` returns `reason="not_in_offer"` because `order_offers` has NO row for the dispatched order.

**Root cause (non-obvious):** In production the api-server runs `DISPATCH_SOURCE=pg` with `PG_FCM_SEND_ENABLED=false`, AND the actual driver dispatch + FCM delivery happen **entirely outside the api-server's offer-creating code paths** — the offer is written to the Firestore order doc (status=dispatched + activeOfferDriverUids) by the customer/dispatch side, and the popup is FCM-driven. None of the three server-side offer-creation paths run for real orders:
- round-robin shadow-write `[PG_SHADOW_OFFER]` — absent in prod logs
- fcm-dispatcher `sendOrderFcm` `[ORDER PG CREATED]`/`[PG OFFER CREATE START]` — absent
- PG dispatcher assign — logs `no eligible driver poolSize=0`, never assigns

So `order_offers` never gets a row → accept fails. Confirmed via prod replica: dispatched orders have `driver_uid` empty, `active_offer_driver_uids='{}'`, `dispatch_timeout_at=NULL`, and zero offer rows for any real order.

**Why earlier "fixes" (offer creation + FCM gating in fcm-dispatcher) didn't help:** they ARE deployed, but that code never executes in prod because the FCM/dispatch the driver actually receives does not flow through `sendOrderFcm`. Verify a path runs via deployment logs before assuming a deployed fix is live.

**The exact reason `[ORDER PG CREATED]`/`[PG OFFER CREATE START]` never log for real orders (confirmed forensically):** `sendOrderFcm` first calls `claimFcmDispatch(db, orderId)` (fcm-dispatcher.ts). That guard reads the **Firestore** order doc and returns false ("already claimed") when the doc already carries `fcmDispatchedAt` OR `fcmDispatchClaimedAt`. In prod the EXTERNAL Firestore-side dispatcher has already set one of those fields, so `sendOrderFcm` logs `[FCM dispatcher] Order already claimed or dispatched — skipping` and **returns before** the parent-row upsert + `pgCreateOffer`. Net: no durable PG offer row, `active_offer_driver_uids` stays `{}`, `dispatch_timeout_at` NULL → SSE in-app popup query returns []. A fresh post-deploy order observed end-to-end: created in FS → `[PG_INGRESS_CYCLE] offerSize=1` → claim-skip → offerSize drops to 0 → `[PG_INGRESS_CANCELLED]` ~18s later, never any FCM/offer write by this server. This pattern is pre-existing (identical on orders before any republish) — an accept-route self-heal cannot affect it because no popup/accept is ever reached.

**Fix — self-heal at accept (routes/orders.ts `selfHealOfferFromFirestore`):** when `pgAcceptOffer` returns `not_in_offer`, read the AUTHORITATIVE live Firestore order doc; only if it proves status==="dispatched" AND the driver is on the live offer (`activeOfferDriverUids` contains uid, or single `driverUid` matches) AND `dispatchTimeoutAt` not expired, mirror the parent order into PG (`pgUpsertOrder` mirrorOfferSet) + create the pending offer row (`pgCreateOffer`), then retry `pgAcceptOffer` once. Otherwise keep the rejection.

**Why:** Firestore is the live authority for the offer in production; PG-only accept assumed an api-server offer-creation path that does not run. Self-heal makes accept work for ANY dispatcher (external Cloud Function, round-robin, PG) without touching dispatch authority, the fcm-dispatcher ("do not touch"), or the UI.

**Proactive fix — mirror the external claim into PG (dispatch-owner sync):** `claimFcmDispatch` now returns `"won" | "already_claimed" | "error"`. When the external Firestore dispatcher already claimed the order (`already_claimed`), the fcm-dispatcher no longer just skips — it calls `mirrorClaimedOrderToPg` (idempotent `pgUpsertOrder` mirrorOfferSet+guardRegression + one pending `pgCreateOffer` per Firestore activeOfferDriverUid) and returns WITHOUT sending a duplicate FCM. Two entry points must BOTH mirror or the popup stays broken: (1) the `startFcmDispatcher` snapshot fast-path (order already claimed when the `added` event arrives — the COMMON prod case; resolve targetUids BEFORE the claimed-check so it can mirror), and (2) the `sendOrderFcm` claim-transaction race (claimed between snapshot read and tx). New logs: `[FCM CLAIM SKIP MIRROR START|OFFER|DONE]`. This proactively makes PG/SSE/accept consistent so the accept-time self-heal becomes a fallback, not the only path. **Why:** the driver in-app popup (SSE) + accept read PG only; the external dispatcher writes Firestore only — something must bridge FS→PG at dispatch time, and FCM-claim-skip was the missing bridge.

**How to apply:** Only authorize healing on status `dispatched` (a live offer is always dispatched; searching/pending have stale driver fields). A driver can never accept an order Firestore does not show offered to them — the security boundary is the Firestore offer doc, not the request body.
