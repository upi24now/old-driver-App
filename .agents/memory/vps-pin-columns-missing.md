---
name: VPS pin columns missing
description: VPS DB missing pin_hash/pin_failed_attempts/pin_locked_until → verify-pin 500 for existing drivers; migration SQL in production-baseline/pin-columns-migration/
---

# VPS pin columns missing → verify-pin HTTP 500

## The rule
VPS PostgreSQL database does not have `pin_hash`, `pin_set_at`, `pin_failed_attempts`,
`pin_locked_until` on the `drivers` table. The VPS `pin.service.ts` does a two-step query:
1. Check driver existence (no pin columns) → non-existent driver gets 401 correctly
2. SELECT pin columns → throws PG "column does not exist" → global handler → INTERNAL_ERROR 500

**Why:** The VPS is running `/opt/bike-courier-platform-v2/` (a modular V2 codebase, not the
Replit flat-routes codebase). The pin columns migration was never run on the VPS DB.

**Distinguishing test:** a known-existing driver + ANY pin → 500; unknown phone → 401.
If wrong-pin returned 401, the columns would exist (error would be post-column-read).

## Fix
```sql
-- production-baseline/pin-columns-migration/004_pin_columns.sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_hash            text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_set_at          timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_locked_until    timestamptz;
```
Run on VPS: `psql "$DATABASE_URL" -f 004_pin_columns.sql`

After migration, verify-pin returns 404 (no PIN set) not 500, for the same driver.

## VPS architecture note
- VPS: `/opt/bike-courier-platform-v2/artifacts/api-server/src/modules/auth/pin.service.ts`
- VPS uses pnpm monorepo, Express 5 (router@2.2.0), rate-limit 7.5.1
- Mobile calls: `POST /api/v2/auth/verify-pin` with `{phone, user_type:"driver", pin}`
- VPS v2 verify-otp needs `otp_id` field (separate from Replit dev server which uses `otp`)
- TEST_OTP_PHONES bypass does NOT work on VPS (real OTP only)
