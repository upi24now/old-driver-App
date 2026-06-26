-- ============================================================================
-- Phase 0 — Driver Order Lifecycle (PG) idempotent migration
-- Run ONCE on the target PostgreSQL BEFORE deploying the patched bundle.
-- Safe to re-run. No data is modified or deleted.
--
-- On PRODUCTION these tables already exist (Firestore-mirror schema), so every
-- CREATE TABLE IF NOT EXISTS is a no-op there; the only real prod change is the
-- single additive `orders.delivered_at` column plus one composite index.
-- The full CREATE TABLE IF NOT EXISTS statements exist so the SAME migration
-- bootstraps a fresh DEV database for boot-smoke verification (parity).
-- ============================================================================

BEGIN;

-- ── drivers (subset — full prod table is a superset; no-op on prod) ──────────
CREATE TABLE IF NOT EXISTS drivers (
  uid                     text PRIMARY KEY,
  phone                   text,
  mobile_number           text,
  name                    text,
  city                    text,
  vehicle_id              text,
  account_status          text,
  documents_submitted     boolean,
  verification_status     text,
  push_token              text,
  push_token_type         text,
  push_token_updated_at   timestamptz,
  subscription_plan       text,
  subscription_expires_at timestamptz,
  created_at              timestamptz DEFAULT NOW(),
  updated_at              timestamptz DEFAULT NOW()
);

-- ── orders (Firestore-mirror shape) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                       text PRIMARY KEY,
  user_id                  text,
  type                     text,
  status                   text,
  distance_km              numeric,
  total_amount             numeric,
  fare_estimate            numeric,
  driver_uid               text,
  driver_name              text,
  driver_phone             text,
  active_offer_driver_uids jsonb,
  rejected_driver_uids     jsonb,
  offer_started_at         jsonb,
  cancel_reason            text,
  cancelled_by             text,
  cancelled_at             timestamptz,
  location                 jsonb,
  location_updated_at      timestamptz,
  dispatched_at            timestamptz,
  accepted_at              timestamptz,
  created_at               timestamptz,
  updated_at               timestamptz,
  raw                      jsonb,
  mirror_synced_at         timestamptz NOT NULL DEFAULT NOW()
);

-- Column parity for every field the new routes touch. On PRODUCTION all of these
-- already exist EXCEPT `delivered_at`, so each is a no-op there (the only real prod
-- change is delivered_at). On other databases (e.g. dev) they bring the orders
-- table up to the shape the routes require. All are nullable/additive — no data
-- is altered and no existing column type is touched.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status                   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_uid               text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_name              text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fare_estimate            numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount             numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_km              numeric;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS active_offer_driver_uids jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_driver_uids     jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location                 jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_updated_at      timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at              timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at               timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason            text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by             text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at             timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw                      jsonb;
-- The one genuinely new production column: completion timestamp.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at             timestamptz;

-- ── order_otps (server-only drop OTP) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_otps (
  order_id         text PRIMARY KEY,
  value            text,
  user_id          text,
  raw              jsonb,
  mirror_synced_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE order_otps ADD COLUMN IF NOT EXISTS value text;

-- ── driver_wallets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_wallets (
  driver_uid           text PRIMARY KEY,
  balance              numeric(12,2) NOT NULL DEFAULT '0',
  total_earnings       numeric(12,2) NOT NULL DEFAULT '0',
  total_paid           numeric(12,2) NOT NULL DEFAULT '0',
  completed_deliveries integer       NOT NULL DEFAULT 0,
  last_updated_at      timestamptz   NOT NULL DEFAULT NOW()
);

-- ── wallet_transactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_uid     text NOT NULL REFERENCES driver_wallets(driver_uid),
  type           text NOT NULL,
  amount         numeric(12,2) NOT NULL,
  description    text NOT NULL DEFAULT '',
  order_id       text,
  balance_before numeric(12,2) NOT NULL,
  balance_after  numeric(12,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

-- Composite index to serve GET /drivers/:uid/active-orders and /me/trips quickly.
CREATE INDEX IF NOT EXISTS idx_orders_driver_status ON orders (driver_uid, status);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_order      ON wallet_transactions (order_id);

COMMIT;

-- ----------------------------------------------------------------------------
-- Supporting index for GET /api/drivers/me/offer-stream, whose hot-path query
-- is `active_offer_driver_uids @> '["<uid>"]'::jsonb` (a specific driver is
-- offered very few orders, so this jsonb containment is the selective predicate
-- and is polled every few seconds per online driver). A GIN index serves it.
--
-- Built CONCURRENTLY and OUTSIDE the transaction above so it never takes a
-- write-blocking lock on the live prod `orders` table while the old bundle is
-- still serving customer order writes. On a fresh/empty DB it is instant.
-- IF NOT EXISTS makes the migration safely re-runnable.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_offer_gin
  ON orders USING gin (active_offer_driver_uids);
