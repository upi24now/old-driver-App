-- One-time idempotent migration for Driver Plan Activation
-- Run ONCE on the production PostgreSQL BEFORE deploying the patched bundle.
-- Safe to re-run (IF NOT EXISTS everywhere). No data is modified or deleted.

BEGIN;

-- 1. Subscription state on the existing drivers table (read by GET /api/drivers/me)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS subscription_plan       text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

-- 2. Razorpay order bridge for plan activation (create-order -> verify-payment)
CREATE TABLE IF NOT EXISTS driver_plan_orders (
  razorpay_order_id   text PRIMARY KEY,
  driver_uid          text        NOT NULL,
  plan_type           text        NOT NULL,
  amount_paise        integer     NOT NULL,
  currency            text        NOT NULL DEFAULT 'INR',
  status              text        NOT NULL DEFAULT 'created',
  razorpay_payment_id text,
  plan_expires_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  paid_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_driver_plan_orders_driver
  ON driver_plan_orders (driver_uid);

COMMIT;
