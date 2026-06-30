---
name: Driver-plans VPS route restore
description: How to additively restore the driver-plans API routes into the live VPS bundle without touching forbidden subsystems.
---

# Driver-plans route restore (VPS production-api.js)

When the live VPS bundle is rebuilt and drops the driver-plans router, the Driver App
"Activate Plan" flow 404s. The proven restore source lives in a previously-deployed
patched bundle as THREE additive blocks:

1. `[BCD-PG]` IIFE — PG-authoritative `POST /api/driver-plans/create-order` + `verify-payment`.
2. `[BCD]` combined IIFE — Part A onboarding-fee **fused with Part B = 7 forbidden
   delivery/order/FCM/wallet routes** (accept/stage/location/complete/offer-stream/active-orders/fcm-token).
3. `[BCD-PG-STATUS]` IIFE — `GET /api/driver-plans/status` + `/current`.

**Rule:** restore ONLY blocks 1 and 3 (both self-contained). NEVER include block 2 —
Part A and Part B share one IIFE, so you cannot keep onboarding-fee without dragging in
the forbidden order/FCM/wallet routes. Onboarding-fee is also KYC-adjacent, so excluding
it keeps the restore strictly within "Activate Plan + status" scope.

**Why:** the explicit task scope forbids touching dispatch/orders/FCM/wallet/KYC. The
4 driver-plans routes (create-order, verify-payment, status, current) are everything the
app calls for plan activation + display.

**How to apply:** splice the two IIFEs immediately AFTER the pino-http middleware
(`app.use((0, import_pino_http*.default)({ logger }))`) so they win Express first-match.
The block calls `globalThis.require("node:crypto")` at registration — fine on the VPS runtime
but undefined in Node ESM, so any local harness must shim `globalThis.require = createRequire(...)`.

**Bindings are NOT all stable across VPS rebuilds.** A later live rebuild dropped the Firestore
binding entirely (no `db2` / `FieldValue` at module scope). The restore is now **PG-only**: the
old best-effort `drivers/{uid}` Firestore mirror was REMOVED. Only HARD deps are `app` + `pool`
(the apply-patch verify-or-abort checks just these two). Auth and Razorpay are resolved
**defensively at runtime**: a typeof-guarded chain (`__dsRequireDriver` → `auth.verifyIdToken`
→ `getAuth()` → `import_auth.getAuth(_app)` → `admin.auth()` → `require("firebase-admin")`) and
`import_razorpay.default` → `require("razorpay")`. typeof on an undeclared identifier is safe
("undefined"), so a missing binding never throws at boot — it just 401s/503s at request time.
Lesson: never hard-require Firestore (or any specific auth/razorpay symbol) in a VPS bundle patch;
resolve defensively, because a rebuild can silently remove a binding the previous build had.

**Tables:** uses `driver_plans` ONLY — the order row is stored there as `status='created'`
then flipped to `'active'`, keyed by `razorpay_order_id`. There is NO `driver_plan_orders`
table usage; order and active plan are the SAME row. A grep for `driver_plan_orders` will
return 0 by design — do not force-fit an unused table just because the DB has it.

Package pattern: production-baseline/driver-plans-restore/ = INSERTED-BLOCK.js +
self-locating/self-verifying/idempotent apply-patch.py (verify-bindings-or-abort, writes a
new file) + mock harness.mjs + README_DEPLOY.md (grep proof + curl).
