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
