-- ============================================================================
-- Single-device login — idempotent migration (003)
-- Run ONCE on the target PostgreSQL BEFORE deploying the patched bundle.
-- Safe to re-run. No existing data is modified or deleted.
--
-- Adds:
--   1. drivers.active_session_id / active_session_at  — the single active
--      device's server session id (+ when it was minted). Nullable so every
--      existing driver row and every legacy app version is unaffected until
--      the next successful login.
--   2. otp_send_events                                — append-only OTP-send
--      log used to rate-limit OTP requests to 3 per rolling 24h per phone.
--   3. drivers.pin_*                                  — defensive ADD COLUMN IF
--      NOT EXISTS for the PIN-login columns (already present on prod from the
--      driver-session patch); included so this migration also bootstraps a
--      fresh DEV database for boot-smoke verification.
-- ============================================================================

BEGIN;

-- ── Single-device session columns ──────────────────────────────────────────
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_session_id text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_session_at timestamptz;

-- ── PIN-login columns (no-op on prod; bootstraps fresh dev) ─────────────────
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- ── OTP-send rate-limit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_send_events (
  id      serial PRIMARY KEY,
  phone   text        NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_send_events_phone_sent_at_idx
  ON otp_send_events (phone, sent_at);

COMMIT;
