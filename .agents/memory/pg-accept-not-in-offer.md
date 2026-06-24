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

**Fix — self-heal at accept (routes/orders.ts `selfHealOfferFromFirestore`):** when `pgAcceptOffer` returns `not_in_offer`, read the AUTHORITATIVE live Firestore order doc; only if it proves status==="dispatched" AND the driver is on the live offer (`activeOfferDriverUids` contains uid, or single `driverUid` matches) AND `dispatchTimeoutAt` not expired, mirror the parent order into PG (`pgUpsertOrder` mirrorOfferSet) + create the pending offer row (`pgCreateOffer`), then retry `pgAcceptOffer` once. Otherwise keep the rejection.

**Why:** Firestore is the live authority for the offer in production; PG-only accept assumed an api-server offer-creation path that does not run. Self-heal makes accept work for ANY dispatcher (external Cloud Function, round-robin, PG) without touching dispatch authority, the fcm-dispatcher ("do not touch"), or the UI.

**How to apply:** Only authorize healing on status `dispatched` (a live offer is always dispatched; searching/pending have stale driver fields). A driver can never accept an order Firestore does not show offered to them — the security boundary is the Firestore offer doc, not the request body.
