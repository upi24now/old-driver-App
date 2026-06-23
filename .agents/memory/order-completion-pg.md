---
name: Order completion PG migration
description: Architecture decisions for the POST /orders/:id/complete PG-authoritative migration.
---

## Rule
`POST /orders/:id/complete` is PG-authoritative. `pgCompleteDelivery()` commits the delivery atomically in PG. Firestore gets best-effort projections only. Legacy orders (no PG row) fall back to the original Firestore transaction.

**Why:** Order completion is a financial write (wallet credit + ledger entry) — PG must be the sole authority to prevent split-brain between PG and Firestore state.

## Critical safety constraint: no fallback on PG infra error
When `pgCompleteDelivery()` throws (infra error, not a business rejection), the route returns HTTP 500 immediately. It does NOT fall back to Firestore. Falling back would allow Firestore to mark an order as delivered while PG remains at `at_drop` — a correctness breach for the new authority.

Only when `pgResult.reason === 'no_pg_row'` does the Firestore fallback run. This handles legacy orders that predate PG dispatch.

**How to apply:** For any future PG-authoritative write route: catch { return 500 } — never silently fall through to the old FS path on infra error.

## Atomic driver daily stats (no read-modify-write)
`pgCompleteDelivery` uses a single `UPDATE drivers SET today_earnings = CASE WHEN today_date = $today THEN COALESCE(today_earnings, 0) + $fare ELSE $fare END, trips_today = CASE WHEN ... THEN ... + 1 ELSE 1 END` statement. This eliminates the read-modify-write lost-update race under READ COMMITTED where two concurrent completions for the same driver could overwrite each other.

**How to apply:** All PG daily-stats increments must use this CASE WHEN pattern, never an app-level read-modify-write.

## Wallet transactions idempotency
`wallet_transactions` has a unique index on `(order_id, type)` (`wallet_txn_order_id_type_idx`). Credit inserts use `ON CONFLICT DO NOTHING`. This makes the credit idempotent — duplicate completions (retry, at-most-once failure) can never produce double-credit.

## OTP still from Firestore
The delivery OTP is still read from Firestore (`orders/{id}/private/otp` subcollection). No OTP table in PG yet. This is intentional — the customer app writes it; migrating OTP requires a customer-app change.
