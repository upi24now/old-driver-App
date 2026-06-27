-- Driver Plan cleanup for the LIVE driver_plans table.
-- Run ONCE on the prod Postgres. Review sections 0-2 (SELECT only) before running 3-4.
-- Non-destructive: only flips 'status' (active -> expired/cancelled). No deletes.

-- ============================================================
-- 0) Drivers that currently have MORE THAN ONE active+non-expired plan (the bug)
-- ============================================================
SELECT driver_uid, COUNT(*) AS active_plans
FROM driver_plans
WHERE status = 'active' AND expires_at > NOW()
GROUP BY driver_uid
HAVING COUNT(*) > 1
ORDER BY active_plans DESC;

-- 1) Inspect one driver in detail (replace the uid)
SELECT id, plan_id, status, amount, duration_days, started_at, expires_at, razorpay_order_id
FROM driver_plans
WHERE driver_uid = '918299013350'
ORDER BY created_at;

-- 2) Active rows that are actually past expiry (should be 'expired', not 'active')
SELECT id, driver_uid, plan_id, expires_at
FROM driver_plans
WHERE status = 'active' AND expires_at <= NOW();

-- ============================================================
-- 3) CLEANUP (run after reviewing the above)
-- ============================================================
BEGIN;

-- 3a) Any 'active' row already past expiry -> 'expired'
UPDATE driver_plans
SET status = 'expired', updated_at = NOW()
WHERE status = 'active' AND expires_at <= NOW();

-- 3b) For drivers with multiple still-active plans, keep only the latest
--     (latest expires_at, tie-break newest created_at); cancel the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY driver_uid
           ORDER BY expires_at DESC, created_at DESC
         ) AS rn
  FROM driver_plans
  WHERE status = 'active' AND expires_at > NOW()
)
UPDATE driver_plans dp
SET status = 'cancelled', updated_at = NOW()
FROM ranked r
WHERE dp.id = r.id AND r.rn > 1;

COMMIT;

-- ============================================================
-- 4) VERIFY — every driver now has at most ONE active plan
-- ============================================================
SELECT driver_uid, COUNT(*) AS active_plans
FROM driver_plans
WHERE status = 'active' AND expires_at > NOW()
GROUP BY driver_uid
HAVING COUNT(*) > 1;
-- ^ expect ZERO rows.
