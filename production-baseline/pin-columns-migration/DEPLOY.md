# PIN Columns Migration — VPS Deploy

## Problem
POST /api/v2/auth/verify-pin returns HTTP 500 (INTERNAL_ERROR) for drivers that
exist in the database. The VPS api-server's pin.service.ts attempts to SELECT
pin_hash / pin_failed_attempts / pin_locked_until from the drivers table, but
these columns were never added to the VPS PostgreSQL instance.

Drivers that do NOT exist return 401 (INVALID_CREDENTIALS) as expected — the
error only occurs on the second query, after existence is confirmed.

## Fix — one SQL file, no bundle change

```bash
# On the VPS (or from any host with $DATABASE_URL set):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 004_pin_columns.sql
```

Expected output (last 4 rows):
```
    column_name     |       data_type       | is_nullable
--------------------+-----------------------+-------------
 pin_failed_attempts| integer               | NO
 pin_hash           | text                  | YES
 pin_locked_until   | timestamp with time zone | YES
 pin_set_at         | timestamp with time zone | YES
```

Then restart the api-server:
```bash
pm2 restart bike-courier-api
# or: systemctl restart bike-courier-api
```

## Verification
```bash
# Should now return 404 (no PIN set) instead of 500:
curl -s -X POST https://api.bikecourierservice.com/api/v2/auth/verify-pin \
  -H 'Content-Type: application/json' \
  -d '{"phone":"8299013350","user_type":"driver","pin":"123456"}'
# Expected: {"error":{"code":"...","message":"..."}} with HTTP 404 or 401
# NOT: {"error":{"code":"INTERNAL_ERROR",...}} with HTTP 500
```
