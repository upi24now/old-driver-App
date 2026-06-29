---
name: driver_plans has no `active` boolean column (live VPS)
description: verify-payment 500 (42703) — activation is the text `status` column, not a boolean
---

The live VPS PostgreSQL `driver_plans` table has **no `active` boolean column**.
Activation state is carried entirely by the text column `status`
(`'created' | 'active' | 'cancelled'`). Every read filters on `status = 'active'`.

**Why:** the PG-authoritative driver-plans bundle block once wrote an `active`
boolean (INSERT `... status, active ...` and UPDATE `... SET status=..., active=...`)
that the live schema never had, so `verify-payment` failed at runtime with:
`DatabaseError: column "active" of relation "driver_plans" does not exist` (PG 42703)
— create-order returned 200 and Razorpay charged, but the plan never activated.

**How to apply:** any driver_plans write in the prod bundle must use ONLY `status`
to express activation; never add an `active` column. The boolean was redundant
(no reader used it), so the fix is to drop it from the writes — match the existing
schema, do NOT add a migration. Bind params are unaffected because `active` used
SQL literals (`false`/`true`), not positional params, so removing it keeps `$1..$N`
aligned. Patch the live bundle base-agnostically (key on the exact SQL literals,
not a whole-file hash) so other already-deployed patches are preserved.
