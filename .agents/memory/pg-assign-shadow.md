---
name: PG assignment shadow (Phase 5C-A)
description: Why the PG assignment shadow validates LOGIC from stable inputs, not the racey order mirror.
---

# PG assignment shadow — validate the LOGIC, not the mirror row

The read-only PG assignment validator compares each authoritative Firestore
assignment against an independently reproduced + guarded PG assignment, and
must compare: order id, assigned driver uid, rejected drivers, round-robin
cursor, order status, timeout value. Guards reproduced: status eligible,
driver not already assigned, driver not rejected, timeout valid.

**Rule:** reproduce what a future PG-authoritative assignment WOULD decide from
*stable* PG inputs (online drivers, orders.rejected_by, order_offers rejected
history), NOT the persisted PG order/offer mirror row.

**Why:** the PG order mirror (`pgUpsertOrder`) runs fire-and-forget AFTER the
Firestore commit and is called with the PRE-assignment Firestore order data
plus a driver override. So the mirrored `last_dispatched_uid` is the *pre*
cursor (not the chosen driver) and `dispatch_timeout_at` is stale/null.
Depending on the mirror would produce false diffs and is racey (the mirror
write and the shadow compare are both kicked off as `void` at nearly the same
time).

**How to apply:**
- Round-robin cursor comparison = `pgChosen === fs.cursor` (a PG assignment sets
  its cursor to the driver it chose; Firestore likewise sets
  lastDispatchedDriverUid = chosen). Do NOT compare against the mirror's stored
  last_dispatched_uid.
- Order/offer rows are read ONLY for guards, and the guards tolerate the mirror
  race: an order status of poolable OR `dispatched` is eligible, and
  orders.driver_uid of null OR the same driver counts as "not already
  assigned".
- Timeout value: both sides compute `assignTime + 60s` in separate writes, so
  compare with a tolerance (5s) and report the delta; fall back to
  `now + 60s` when the offer row isn't mirrored yet.
- Reason priority (most fundamental first): order id mismatch → guard reason →
  assigned driver → rejected list → cursor → status → timeout → other.
