---
name: Auth OTP PG store
description: PG-backed login OTP store replacing in-memory Map; atomic verify pattern; devOtp rules.
---

## Rule
Replace any in-memory OTP store with PG `auth_otps` table (phone PK, upsert on resend).
Use `SELECT ... FOR UPDATE` inside a transaction for verify — never SELECT then UPDATE outside a transaction.

## Why
In-memory Map is lost on restart and doesn't survive autoscale cross-instance routing.
TOCTOU between SELECT check and UPDATE consume allows two concurrent requests to both mint tokens.
Fail-open on consume error (log + continue) lets the OTP be replayed until expiry.

## How to apply
- Schema: `lib/db/src/schema/auth-otps.ts` — phone TEXT PK, otp TEXT, expires_at TIMESTAMPTZ, attempts INT DEFAULT 0, created_at, consumed_at.
- send-otp: `INSERT ... ON CONFLICT (phone) DO UPDATE SET otp, expires_at, attempts=0, consumed_at=NULL, created_at=NOW()`.
- verify-otp: wrap in `db.transaction(async tx => { tx.execute(sql\`SELECT ... FOR UPDATE\`) → check conditions → tx.execute(sql\`UPDATE SET consumed_at=NOW()\`) → return outcome })`. Fail-closed: if transaction throws, return 500 and do NOT mint token.
- Attempt increment: use `UPDATE SET attempts = attempts + 1` (SQL expression), never JS stale-read value.
- TEST_OTP_PHONES bypass: always return `devOtp: configuredPin` in response regardless of NODE_ENV (intentional; do not include real-user numbers).
- Real phones in production: devOtp only when `NODE_ENV !== "production"`.
- pruneStaleOtps: exported but not yet wired to startup timer — acceptable; table bloat bounded by real login traffic.
