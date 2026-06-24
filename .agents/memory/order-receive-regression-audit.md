---
name: Order-receive regression audit method
description: How to triage "driver app stopped receiving order popups" and avoid blaming undeployed code.
---

# Order-receive ("no popup") regression triage

**Rule 1 — check the DEPLOYED commit, not dev HEAD.** Production runs the last
`Published your App` commit, which often lags dev HEAD by several commits. A
production regression CANNOT be caused by code that only exists in dev (not yet
published). Before blaming a recent dev change (wallet, UI, etc.), confirm whether
that change is even in the deployed commit (`git log --oneline`, find the latest
`Published your App`). Then confirm the change's diff actually touches the
dispatch/offer/FCM/SSE/eligibility path — completion-only changes can't break
order receipt.

**Rule 2 — dispatch is a PRODUCTION concern; dev only ingests.** The dev
api-server log shows ONLY `PG_INGRESS_*`, `PG_DISPATCH_SERVICE_TIMEOUT`,
`PG_SHADOW_*` — it mirrors Firestore→PG and never offers real orders. The
authoritative offer path (`round-robin-dispatcher.ts` onSnapshot on
`status in ["searching","pending"]` → sets `status:"dispatched"` + driverUid +
offer window → `fcm-dispatcher.ts` sends FCM) runs in the PRODUCTION deployment.
To see why an order wasn't offered, use `fetch_deployment_logs`, not dev logs.

**Rule 3 — classify the break by what the order doc has.** Customer app creates
the order directly in Firestore (no POST /orders create route in api-server). An
un-offered order has: no `offerStartedAt`, empty `activeOfferDriverUids`, no
`fcmDispatchedAt/ClaimedAt`, no `status:"dispatched"`, and no PG `order_offers`
row / `dispatch_timeout_at`. That = **break point B (created, never dispatched)**,
upstream of SSE and wallet entirely.

**Rule 4 — RR pickup gates.** RR dispatcher only sees orders whose status is
`searching`/`pending`, and only assigns drivers with Firestore `isOnline==true`
(+ active subscription). If RR logs NOTHING for an order (not even
`[RR dispatcher] No eligible driver`), the order never entered those statuses or
the onSnapshot didn't fire — vs. an eligibility skip which DOES log "No eligible
driver poolSize/onlineCount". `PG_DISPATCHER poolSize=0` is the PG shadow, not
authoritative.

**Rule 5 — read the deployed env, not just the code.** Production boot logs
(`fetch_deployment_logs` for `[STARTUP_FIREBASE_CONFIG]`, `[DISPATCH_SOURCE]
value=`, `[PG_DISPATCH_WRITE_GUARD] writesAllowed=`) reveal the actual runtime
flags. A 2026-06-24 follow-up proved production runs **`DISPATCH_SOURCE=pg`**
(NOT the assumed `firestore` kill-switch position), with `writesAllowed=true` but
`pgFcmSendEnabled=false`. In `pg` mode the RR Firestore dispatcher attaches its
onSnapshot but `assignNextDriver` returns at the top ("pg mode — skipping
Firestore assignment (PG authority)"), so the proven-working Firestore RR+FCM
path is bypassed. The PG dispatcher becomes authority but (a) never saw the real
orders (FS→PG shadow-writer FK failures = order never mirrored), (b) logged
`poolSize=0` (no eligible PG drivers), and (c) `PG_FCM_SEND_ENABLED=false` means
it would send no FCM even on success → driver never notified. Documented kill
switch / minimal safe fix: set `DISPATCH_SOURCE=firestore` to restore the working
Firestore RR + FCM dispatcher path.

**Why:** a 2026-06-24 audit chased a wallet fix as the cause of dropped order
popups; the wallet fix touched only the completion path AND wasn't deployed. The
two failed orders were created in FS, never dispatched (point B), with no RR log
at all, while production had restarted (pid 21→22) between the last working
dispatch and the failures — and the deployment was running DISPATCH_SOURCE=pg the
whole time. Lesson: prove deployed-commit + deployed-env flags + break-point
before any fix.
