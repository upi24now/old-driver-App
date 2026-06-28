---
name: VPS bundle schema authority + additive-patch idempotency
description: Which DB schema is authoritative when patching the live VPS API bundle, and how to make reused-helper writes idempotent without a migration.
---

# Authoritative schema for the live VPS API bundle

The live production API runs as a standalone esbuild bundle on the VPS with its **own**
Postgres. When validating SQL for an additive bundle patch, the authoritative schema is the
**bundle's own Drizzle `pgTable` definitions** (grep the bundle source), NOT Replit's
managed Postgres.

**Why:** `executeSql({environment:"production"})` queries Replit's managed replica, which is
a *different database* from the VPS's own DB. Judging the VPS schema by that replica
produced a false "schema divergence" alarm (e.g. it suggested `orders` had `driver_lat`
columns the bundle schema does not, and made `driver_locations`/`driver_plans` look
missing when the bundle defines them).

**How to apply:** before writing/raw-SQL against the VPS DB, read the bundle's schema
sections (orders, order_offers, driver_locations, driver_plans, driver_wallets,
wallet_transactions, etc.) and reconcile column names against those. To prove logic when
the VPS DB is unreachable, build a faithful mirror of those exact `pgTable` columns in the
dev DB, seed isolated rows, and run the block's real SQL.

# Idempotency for reused non-idempotent wallet helpers

The bundle's `creditWallet(uid, amount, desc, {orderId})` has **no order-level dedup**. An
additive completion path that does `SELECT existing credit` then `creditWallet(...)` is a
check-then-write race: concurrent `/complete` retries can both pass the check and
double-credit.

**Fix used:** serialize the whole settle critical section per `(uid, orderId)` with a
Postgres **session advisory lock** on a dedicated pooled client —
`pg_advisory_lock($1::int4,$2::int4)` (two int4 keys from an md5 of the id), released in
`finally`. The competing helper commits its credit before the lock releases, so the next
contender's existence check sees it and skips. Proven with 10 parallel settles → exactly
one credit (ONLINE) / one `cash_collected` (CASH).

**Why advisory lock over a unique index:** keeps the fix code-only (no prod DB migration),
and advisory locks are cluster-wide per database so they also serialize across PM2 workers.
