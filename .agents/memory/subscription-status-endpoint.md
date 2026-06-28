---
name: Subscription status source-of-truth
description: Which prod endpoint carries the driver's active plan, and why /drivers/me must never be used for it.
---

# Subscription status source-of-truth

The driver's active subscription plan is served ONLY by `GET /api/driver-plans/status`
(identical fallback: `GET /api/driver-plans/current`). Shape:
`{ active: boolean, plan: { id, label, amount, durationDays, status, startedAt, expiresAt(ISO) } | null }`.

`GET /api/drivers/me` (PgDriverProfile) does NOT carry any subscription fields in
production. Reading the plan from the profile leaves it permanently inactive.

**Why:** the prod VPS API bundle (separate, source not in repo) keys subscription
on the plan endpoints, not the profile. Reading `pgProfile.subscriptionExpiresAt`
returns null → `subscriptionActive` false → Duty ON shows the renew/purchase modal
even right after a successful purchase, and on every cold-start / OTP login.

**How to apply:** in the mobile app, `getDriverPlanStatus()` (utils/profile-api.ts)
is the only correct reader; `syncSubscriptionFromServer()` in DriverContext.tsx
routes ALL subscription state through it (post-purchase refresh, cold-start boot,
both OTP login paths). Never reintroduce a `pgProfile.subscription*` read — three
separate boot/login paths previously clobbered the plan to null that way. parse
`plan.expiresAt` ISO → epoch ms; `subscriptionActive = !!(expiresAt && expiresAt > now)`.

**404 trap (must hold):** if the deployed bundle is missing `/status` (404),
`getDriverPlanStatus()` returns null and `syncSubscriptionFromServer()` EARLY-RETURNS,
so the AsyncStorage plan cache is NEVER cleared and a stale plan survives every
boot/login forever. The read route therefore MUST exist and return `{active:false,
plan:null}` (PG-only: `status='active' AND expires_at>now()`) so an expired/absent
plan clears the cache. Only `active:false` clears it; 404/null preserves it.

**No client-side activation:** `activatePlan()` in DriverContext is the legacy
wallet-local path that wrote `Date.now()+PLAN_DAYS*24h` client-side — it is
neutralized (no plan/expiry/wallet writes) so the server status read is the SOLE
authority. The cache is only ever written by `persistSubscriptionCache()` fed from
server status, so boot-restore can never resurrect a client-fabricated plan.
