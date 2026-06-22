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

## 3. Dual-read comparator is FS→PG only
The transaction comparator looks up FS rows in a PG-by-orderId map and compares counts; it does not detect unmatched PG rows or reconcile payout rows individually. Offsetting anomalies (e.g. a duplicate credit row plus a missing payout row yielding equal counts) can pass as a match.

**How to apply:** strengthen the comparator (bidirectional matching + payout reconciliation) before relying on `[PG_TX_MATCH]` as a cutover gate.
