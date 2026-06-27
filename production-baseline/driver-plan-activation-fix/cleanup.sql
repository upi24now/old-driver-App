-- ============================================================================
-- Driver Plan one-active-plan cleanup  (RUN ON THE PRODUCTION VPS POSTGRES)
-- Run the SELECTs first, eyeball the rows, THEN run the UPDATEs in section 3.
-- No row is deleted. Only status is changed. Idempotent / safe to re-run.
--   driver under test: 918299013350
-- ----------------------------------------------------------------------------
-- If your column names differ from the proof you sent, adjust them here ONLY.
-- Assumed columns: id, driver_uid, plan_id, plan_label, amount, duration_days,
--                  status, started_at, expires_at, created_at,
--                  razorpay_order_id, razorpay_payment_id
-- ============================================================================

-- 0) Confirm the live schema (run once; abort the rest if columns differ).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'driver_plans'
ORDER BY ordinal_position;

-- 1) SHOW every row for the test driver (no mutation).
SELECT id, driver_uid, plan_id, plan_label, amount, duration_days,
       status, started_at, expires_at, created_at,
       razorpay_order_id, razorpay_payment_id
FROM driver_plans
WHERE driver_uid = '918299013350'
ORDER BY created_at DESC;

-- 2) SHOW which active rows would be cancelled (dry run).
--    rn = 1 is the row we KEEP (latest non-expired active); rn > 1 get cancelled.
SELECT id, plan_id, status, started_at, expires_at,
       ROW_NUMBER() OVER (ORDER BY started_at DESC NULLS LAST, created_at DESC) AS rn
FROM driver_plans
WHERE driver_uid = '918299013350'
  AND status = 'active'
  AND expires_at > NOW();

-- ============================================================================
-- 3) CLEANUP  (run only after reviewing #1 and #2)
-- ============================================================================

-- 3a) Active rows already past expiry -> 'expired'.
UPDATE driver_plans
SET status = 'expired'
WHERE driver_uid = '918299013350'
  AND status = 'active'
  AND expires_at <= NOW();

-- 3b) Keep ONLY the most-recent non-expired active row; cancel the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY started_at DESC NULLS LAST, created_at DESC) AS rn
  FROM driver_plans
  WHERE driver_uid = '918299013350'
    AND status = 'active'
    AND expires_at > NOW()
)
UPDATE driver_plans dp
SET status = 'cancelled'
FROM ranked r
WHERE dp.id = r.id
  AND r.rn > 1;

-- 3c) (optional) Stale never-paid orders -> 'cancelled' so they cannot be activated later.
UPDATE driver_plans
SET status = 'cancelled'
WHERE driver_uid = '918299013350'
  AND status = 'created'
  AND created_at < NOW() - INTERVAL '1 day';

-- 4) VERIFY: exactly one active row remains for the driver (expect 1, or 0 if all expired).
SELECT COUNT(*) AS active_rows
FROM driver_plans
WHERE driver_uid = '918299013350'
  AND status = 'active'
  AND expires_at > NOW();

-- 5) (TEST ONLY) Manually expire the active plan to re-test create-order 200 path.
-- UPDATE driver_plans SET expires_at = NOW() - INTERVAL '1 minute'
-- WHERE driver_uid = '918299013350' AND status = 'active';
