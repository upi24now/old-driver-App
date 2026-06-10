---
name: Phase 2 dispatch model
description: How the driver app listens for and claims offered orders — changed from single-driver driverUid assignment to multi-driver activeOfferDriverUids array broadcast.
---

## The rule
Customer app no longer writes `driverUid` + `status="dispatched"` during offer phase.
Instead it writes `activeOfferDriverUids: string[]` + `offerStartedAt: Record<string,Timestamp>`.

## How to apply

**Offer listener** (`listenToAllDispatchedOrders` / `listenToDispatchedOrder`):
- OLD: `where("driverUid","==",uid) AND where("status","==","dispatched")`
- NEW: `where("activeOfferDriverUids","array-contains",uid)` — no status filter; no composite index needed.

**Accept transaction** (`acceptOrder`):
- Guard 1: `status === "driver_assigned"` → abort (another driver won)
- Guard 2: `!(activeOfferDriverUids ?? []).includes(driverUid)` → abort (offer withdrawn)
- Write: `status="driver_assigned"`, `driverUid`, `acceptedAt`, `activeOfferDriverUids=[]`

**Reject** (`rejectOrder`): `updateDoc` with `arrayRemove(driverUid)` — no transaction.
**Timeout** (`timeoutOrder`): same as reject — `arrayRemove(driverUid)`.

**OrderStatus type**: includes `"driver_assigned"` (Phase 2 win state).
**ACTIVE_STATUSES**: includes `"driver_assigned"` so auth-restore finds briefly-assigned orders.
**DriverContext acceptRide()**: sets local `orderStatus: "driver_assigned"` on accepted ride.
**Stale-snapshot guard**: checks `"driver_assigned" || "accepted" || "to_pickup"` (any early local status).

**FCM-tap recovery** (`ride-request.tsx`):
- OLD: `order.status !== "dispatched"` → dismiss
- NEW: `!(order.activeOfferDriverUids ?? []).includes(driverUid)` → dismiss
- Requires `driverUid` in `useDriver()` destructure.

**Why:** Customer app Phase 2 broadcasts to multiple drivers simultaneously; server no longer sets driverUid before acceptance.
