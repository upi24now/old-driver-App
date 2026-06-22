---
name: Wallet PG migration constraints
description: Durable data-consistency constraints for the Firestore→Postgres wallet migration that must be resolved before any PG-primary cutover.
---

# Wallet PG migration — constraints before PG-primary cutover

The wallet migration is incremental: Firestore stays source of truth; PG is shadow-written and dual-read-compared. All PG writes/reads in the wallet/order/payout routes are fire-and-forget (`void promise.catch(log)`) so PG failures never affect the Firestore response. These items are safe to leave during shadow/dual-read phases but MUST be addressed before reads switch to PG.

## 1. Payout amount sign divergence
Firestore payout ledger rows store `amount` **negative** (`-amount`); the PG `wallet_transactions` payout shadow row stores `amount` **positive** (matching `pgMarkPayoutProcessed`'s convention).

**Why:** the dual-read transaction comparator skips per-row amount checks for payout rows (they have no `order_id`), so the sign mismatch is invisible today and does not raise `[PG_TX_DIFF]`. On PG-primary cutover the mobile app would render flipped payout signs.

**How to apply:** before promoting transaction reads to PG, canonicalize the payout sign (either store negative in PG to mirror FS, or normalize at the read/serialization boundary) and document the chosen convention.

## 2. Credit shadow writes are not DB-level idempotent
`pgCreditOrderEarning` increments `driver_wallets` totals and inserts a credit `wallet_transactions` row with no unique constraint / `ON CONFLICT` guard.

**Why:** a replayed/duplicated shadow call would over-credit PG balances and create duplicate ledger rows. Firestore completion is guarded by the `transactions/{orderId}_earn` idempotency doc, but PG has no equivalent.

**How to apply:** add a unique index on `(driver_uid, order_id, type)` for credits + conflict handling in `pgCreditOrderEarning` before PG becomes authoritative.

## 3. Historical wallet/transaction data needs an explicit backfill
Shadow writes only mirror *new* activity from the moment they were deployed. The existing `wallets/{uid}` docs and historical `transactions` rows in Firestore are NOT in PG until a one-time backfill runs — same pattern as the Phase 2C delivered-trips backfill.

**Why:** an audit found Firestore had real driver wallet+transaction data while `driver_wallets`/`wallet_transactions` were empty, so any PG-primary cutover would serve blank wallets. Shadow-only ≠ migrated.

**How to apply:** write and run an idempotent backfill (wallets + transactions) before promotion, then re-run the readiness audit (`scripts/audit-wallet-pg-readiness.mjs`) until it returns READY_FOR_PG_PRIMARY.

## 4. Firestore payout sign is itself inconsistent
The live `transactions` collection contains both negative AND positive payout `amount` values (legacy/manual rows), not a uniform sign. Any sign canonicalization (see #1) must handle mixed-sign source data, not assume all FS payouts are negative.

## 5. Dual-read comparator is FS→PG only
The transaction comparator looks up FS rows in a PG-by-orderId map and compares counts; it does not detect unmatched PG rows or reconcile payout rows individually. Offsetting anomalies (e.g. a duplicate credit row plus a missing payout row yielding equal counts) can pass as a match.

**How to apply:** strengthen the comparator (bidirectional matching + payout reconciliation) before relying on `[PG_TX_MATCH]` as a cutover gate.
