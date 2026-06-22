---
name: Wallet PG migration constraints
description: Durable data-consistency constraints for the Firestore→Postgres wallet migration that must be resolved before any PG-primary cutover.
---

# Wallet PG migration — constraints before PG-primary cutover

The wallet migration is incremental: Firestore stays source of truth; PG is shadow-written and dual-read-compared. All PG writes/reads in the wallet/order/payout routes are fire-and-forget (`void promise.catch(log)`) so PG failures never affect the Firestore response. These items are safe to leave during shadow/dual-read phases but MUST be addressed before reads switch to PG.

## 1. Payout amount sign divergence — RESOLVED (PG-primary cutover)
Firestore payout ledger rows store `amount` **negative** (`-amount`); the PG `wallet_transactions` payout shadow row stores `amount` **positive** (matching `pgMarkPayoutProcessed`), and backfilled historical payout rows mirror the verbatim (mixed) FS sign.

**Why:** the dual-read transaction comparator skips per-row amount checks for payout rows (they have no `order_id`), so the sign mismatch was invisible during shadow/dual-read and never raised `[PG_TX_DIFF]`. Without canonicalization a PG-primary read would emit inconsistent payout signs.

**Chosen convention (resolved at the PG-primary cutover):** the transactions endpoint normalizes every `type === "payout"` row to a **negative** amount at the serialization boundary (`-Math.abs(parseFloat(amount))`) — canonical "money out = debit". This is serialization-only: no stored value and no `driver_wallets` balance math change. Credits and adjustments pass through with their stored sign. Note the REST wallet GET endpoints currently have **zero consumers** (mobile reads Firestore directly via the client SDK and only uses `POST /api/payouts/request`), so this established the canonical contract with no live behavior change.

## 2. Credit shadow writes are not DB-level idempotent
`pgCreditOrderEarning` increments `driver_wallets` totals and inserts a credit `wallet_transactions` row with no unique constraint / `ON CONFLICT` guard.

**Why:** a replayed/duplicated shadow call would over-credit PG balances and create duplicate ledger rows. Firestore completion is guarded by the `transactions/{orderId}_earn` idempotency doc, but PG has no equivalent.

**How to apply:** add a unique index on `(driver_uid, order_id, type)` for credits + conflict handling in `pgCreditOrderEarning` before PG becomes authoritative.

## 3. Historical wallet/transaction data needs an explicit backfill
Shadow writes only mirror *new* activity from the moment they were deployed. The existing `wallets/{uid}` docs and historical `transactions` rows in Firestore are NOT in PG until a one-time backfill runs — same pattern as the Phase 2C delivered-trips backfill.

**Why:** an audit found Firestore had real driver wallet+transaction data while `driver_wallets`/`wallet_transactions` were empty, so any PG-primary cutover would serve blank wallets. Shadow-only ≠ migrated.

**How to apply:** `scripts/backfill-wallet-pg.mjs` does this idempotently (credits dedupe on driver_uid+order_id+type; payouts/adjustments on driver_uid+type+amount+created_at; skips rows with neither orderId nor timestamp; copies FS amounts/signs verbatim — no balance math). Re-run `scripts/audit-wallet-pg-readiness.mjs` after; it now returns READY_FOR_PG_PRIMARY for the current dataset. Backfill is read-from-FS / write-PG-only — re-run it before any cutover to capture rows created since.

## 4. Firestore payout sign is itself inconsistent
The live `transactions` collection contains both negative AND positive payout `amount` values (legacy/manual rows), not a uniform sign. Any sign canonicalization (see #1) must handle mixed-sign source data, not assume all FS payouts are negative.

## 5. Dual-read comparator is FS→PG only
The transaction comparator looks up FS rows in a PG-by-orderId map and compares counts; it does not detect unmatched PG rows or reconcile payout rows individually. Offsetting anomalies (e.g. a duplicate credit row plus a missing payout row yielding equal counts) can pass as a match.

**How to apply:** strengthen the comparator (bidirectional matching + payout reconciliation) before relying on `[PG_TX_MATCH]` as a cutover gate.
