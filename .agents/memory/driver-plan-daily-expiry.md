---
name: Driver Daily plan expiry (12h, not 24h)
description: Where/how the Daily driver plan expiry is computed and why it branches on planId rather than durationDays.
---

# Daily plan expiry = 12 hours

The Daily driver plan must expire **exactly 12h** after activation; Weekly stays 7d, Monthly stays 30d.

## Where expiry is computed
- **Live prod bundle**: `pgActivatePlanByOrderId` (called by `POST /api/driver-plans/verify-payment`) is the ONLY place `expires_at` is computed: `startedAt + durationDays * DAY_MS`. There is **no Firestore mirror of expiry in the bundle** — single source.
- Active/expired status reads the stored column (`pgGetActivePlan`: `expires_at > now()`), so writing the right `expires_at` is sufficient; do not add a parallel rule.
- **In-repo** `artifacts/api-server/src/routes/driver-plans.ts` computes `planExpiryAt = planStartAt + PLAN_DAYS[plan] * MS_PER_DAY` with `PLAN_DAYS.daily = 0.5` (epoch-ms, no integer column there).

## Why branch on planId, not durationDays
`driver_plans.duration_days` is an **INTEGER** column — `0.5` would truncate to 0 and expire instantly. So the bundle fix branches: `row.planId === "daily" ? 12h : row.durationDays * DAY_MS`. `DRIVER_PLANS.daily.durationDays` stays `1` (display/insert unaffected); prices/schema untouched.

**Why:** keeps schema integer, keeps one expiry rule, leaves existing rows' stored `expires_at` untouched (only NEW daily activations get +12h).

**How to apply:** any change to plan duration must edit the activation expiry calc (and the in-repo `PLAN_DAYS`), never the integer `duration_days` column for sub-day durations.
