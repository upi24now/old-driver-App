-- ============================================================================
-- PIN login columns — idempotent migration (004)
-- Run ONCE on the VPS PostgreSQL before restarting the api-server.
-- Safe to re-run; every statement uses IF NOT EXISTS / DEFAULT.
--
-- Adds:
--   drivers.pin_hash            — scrypt hash of the driver's 6-digit PIN
--   drivers.pin_set_at          — when the PIN was last set
--   drivers.pin_failed_attempts — consecutive wrong-PIN counter (resets on success)
--   drivers.pin_locked_until    — NULL = not locked; non-NULL = lockout expiry
-- ============================================================================

BEGIN;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_hash            text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_set_at          timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_locked_until    timestamptz;

COMMIT;

-- Verify (should print 4 rows):
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'drivers'
  AND column_name IN ('pin_hash', 'pin_set_at', 'pin_failed_attempts', 'pin_locked_until')
ORDER BY column_name;
