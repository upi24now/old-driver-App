---
name: Driver Plan one-active-plan fix
description: Money-path rules for the live VPS driver_plans subscription override (create-order/verify-payment).
---

# Driver Plan one-active-plan invariant (live VPS bundle)

The LIVE api.bikecourierservice.com bundle uses a `driver_plans` table (status created/active/cancelled/expired;
cols incl. plan_id, plan_label, amount, duration_days, started_at, expires_at, razorpay_order_id, razorpay_payment_id)
and serves /status & /current. This schema/routes do NOT exist in any repo bundle (repo uses driver_plan_orders +
drivers.subscription_*). Source for the live bundle is not in the repo and the user has declined to share it; fixes
ship as an additive first-match-wins override spliced after the pino middleware.

**Rules the override must hold (money path — double-charge risk):**
- create-order: if a non-expired `status='active'` row exists → HTTP 409 `{active:true,error,plan}`, create NO Razorpay order.
- verify-payment: HMAC-verify, then in ONE tx cancel every OTHER active row, then activate ONLY the row matching
  `razorpay_order_id` (+ driver_uid). Never default to monthly. Assert `rowCount===1` or rollback.
- expires_at is computed FROM the paid row's own `duration_days` (`NOW() + duration_days * INTERVAL '1 day'`),
  not from a code catalog — keeps a single source of truth and matches whatever was priced at create-order.
- Leave /status & /current on the base bundle; the one-active invariant makes them correct automatically.

**Why these specific techniques:**
- **Prefer the canonical gate:** authenticate via `typeof __dsRequireDriver === "function" ? __dsRequireDriver : self-contained verifyIdToken`.
  Raw verifyIdToken alone bypasses single-device `x-session-id` session-replacement enforcement on a money route.
  `typeof` on an undeclared identifier is safe (returns "undefined", no ReferenceError), so the detection works even
  if the gate is absent. apply-patch.py reports which path will run; if the gate name differs, get the live bundle.
- **Per-driver advisory lock** (`pg_try_advisory_lock(hashtext('dpa:create:'+uid)::bigint)`) around check+Razorpay+insert
  in create-order: without it, concurrent taps when no active plan exists can mint multiple Razorpay orders/rows.
- `daily` 12h cannot be stored in an integer `duration_days` column → daily defaults to 1 day; needs numeric column for 0.5.

Validate logic on a real Postgres temp table via executeSql (dev DB), never assume.
