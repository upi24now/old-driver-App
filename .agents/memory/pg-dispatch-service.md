---
name: PG dispatch write services (Phase 5E-A)
description: The PG-authoritative dispatcher write/read services that exist but are not yet wired live; their guard semantics and parity rules.
---

# PG dispatch write services (Phase 5E-A)

The foundation write/read services a future PostgreSQL-authoritative dispatcher
will call, mirroring the Firestore round-robin + FCM dispatcher onto PG. They
live in `pg-dispatch-service.ts` and are **NOT live-wired** — no route, listener,
or poller calls them; only the verification harness imports them. They perform
**no Firestore writes and no FCM sends** (claim ≠ send: claiming only sets the
guard fields; the actual push stays the caller's job, exactly like the Firestore
flow separates claim from send).

## Atomic guard semantics (double-action prevention)
- **Assign:** guard `id + status IN (searching,pending) + driver_uid IS NULL`;
  on success opens/refreshes a `pending` `order_offers` row in the SAME
  transaction so order/offer can't split-brain. Clears the FCM guard fields
  (`fcm_dispatch_claimed_at/_by`, `fcm_message_id`, `fcm_dispatched_at`) to open
  a fresh dispatch cycle — parity with the Firestore dispatcher.
- **Claim:** guard `fcm_dispatch_claimed_at IS NULL`; 0-row → distinguish
  `order_missing` vs `already_claimed` with a follow-up existence read.
- **Return-to-pool:** guard `status='dispatched'`; resets to searching, clears
  driver + claim fields, marks still-pending offers `timed_out` (NO `rejected_by`
  mutation — Firestore timeout semantics allow re-offer). Same transaction.

## Eligibility parity (pgFindEligibleDrivers)
`is_online = true` AND (`subscription_expires_at IS NULL` OR `> now()`) AND uid
NOT in the order's `rejected_by`, sorted by uid ascending. NULL subscription =
"allow through" (legacy/test drivers), matching Firestore's `expiry===0 || >now`.
It correctly returns ALL eligible PG drivers — harness assertions must scope to a
test-id prefix because the dev DB contains real online drivers.

## Critical implementation note
On a guarded 0-row miss, these return `{ ok:false, reason }` directly inside the
transaction (no-op empty commit). Do NOT use `tx.rollback()` — see
[Drizzle tx.rollback() pitfall](drizzle-tx-rollback.md).

**Why not live yet:** Phase 5D audit found PG dispatch NOT_READY (no write
services, zero live shadow observations, empty live offer model). 5E-A only
builds the write surface; cutover is a later, flag-gated phase.
