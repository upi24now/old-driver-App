---
name: PG timeout shadow (Phase 5C-B)
description: Why the PG timeout shadow gates eligibility on dispatch_timeout_at and normalizes the returnToPool shadow-write race in the live path only.
---

# PG timeout shadow — reproduce the LOGIC, normalize the race in live only

Read-only validator: each authoritative Firestore timeout is compared against an
independently reproduced + guarded PG timeout. Compared dimensions: order id,
driver uid, dispatch_timeout_at, offer expiry, timeout eligibility,
return-to-pool eligibility. Reproduction inputs: order status, offer status,
offer expires_at, order dispatch_timeout_at. Logs `[PG_TIMEOUT_MATCH|DIFF|ERROR]`
(distinct from Phase-5B `[PG_DISPATCH_SHADOW_*]`).

**Rule:** the timeout DECISION must gate on `orders.dispatch_timeout_at`, not just
compare it. The future PG poller's actual trigger is `WHERE status dispatched AND
dispatch_timeout_at <= now` (index orders_dispatched_timeout_idx). So eligibility
requires dispatch_timeout_at non-null (`"dispatch timeout missing"` otherwise) AND
`<= now` (`"not yet expired"` if future), THEN offer expires_at `<= now` as a
corroborating check.

**Why:** an earlier version gated only on offer expires_at and merely compared
dispatch_timeout_at as a value — that mis-models the poller, which keys off the
order deadline. Both stores hold `assignTime + DISPATCH_TIMEOUT_SECONDS(60)`, so
the two deadlines are corroborating, not redundant.

**The returnToPool shadow-write race:** returnToPool fires two best-effort PG
writes — `pgTimeoutOffer` (offer pending→timed_out) and `pgShadowSetStatus`
(order dispatched→searching). NEITHER touches the timeout VALUES (expires_at /
dispatch_timeout_at stay put); only the two status fields flip. The pure
comparator stays STRICT (harness exercises `already timed out` etc.). The LIVE
path `normalizeForLive` maps offer `timed_out`→`pending` and tolerates order
`searching`, because in shadow mode only this same returnToPool could have set
them. Do NOT move this lenience into the pure comparator; remove it when a
PG-authoritative timeout poller goes live (else it masks real divergence).

**How to apply:**
- Driver uid is a first-class dimension: read `order_offers.driver_uid` from PG
  (`offerDriverUid`) and compare `offerDriverUid === fs.driverUid`. Split the
  diff reason: `"missing offer"` when offerDriverUid is null, `"driver uid
  mismatch"` when it's a different driver.
- Dispatcher hook: validate ONLY when the FS dispatchTimeoutAt captured inside
  the tx (`fsTimeoutAtMs`) is non-null. Never fall back to `Date.now()` — emit
  `[PG_TIMEOUT_ERROR]` and skip, so the compared deadline is always authoritative.
- Reason priority (most fundamental first): order id mismatch → guard reason
  (order missing / order not eligible / missing offer / already accepted /
  rejected / timed out / offer not active / dispatch timeout missing / not yet
  expired) → driver uid mismatch → dispatch timeout value mismatch → offer
  expiry value mismatch → timeout eligibility → return-to-pool → other.
- ELIGIBLE_ORDER_STATUSES = {dispatched, searching} (tolerates the post-reset
  race); TIMEOUT_TOLERANCE_MS = 5000.
