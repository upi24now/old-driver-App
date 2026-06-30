---
name: pgListOnlineDrivers prod fix & live-bundle drift
description: Why local production-baseline copies can't be shipped, and how online-driver vehicle fields are sourced.
---

# Live prod bundle drifts AHEAD of every local copy

The live VPS `production-api.js` can contain functions (e.g. `pgListOnlineDrivers`)
that exist in **none** of the `production-baseline/*` copies or tarballs, and that are
**not** in dev source (`artifacts/api-server`) either. Confirmed: every local copy had
`onlineDrivers` (dashboard count only) and `driver_presence` refs, but zero
`pgListOnlineDrivers`.

**Why it matters:** patching a stale local copy and shipping it would ROLL BACK live
changes that only exist on the VPS — a silent regression of working functionality.

**How to apply:** never hand over a pre-built local bundle as "the patch" when the live
file is known to be newer. Ship a **self-locating, base-agnostic patcher** (Python) that
the user runs against the real live file on the VPS: locate the function declaration,
brace-match its body (skipping strings/templates/comments), verify it's the expected
broken version via an anchor substring, replace only that body, print a unified diff,
back up, `node --check`, then `pm2 restart bike-courier-api`. See
`production-baseline/pg-list-online-drivers-fix/apply-patch.py` for the reusable pattern
(JS-aware scanner, pre/post-flight asserts, "every other byte identical" check).

# Online-driver vehicle product fields are NOT stored in PG

`vehicleProductId` / `vehicleSlug` / `vehicleType` lived ONLY in the `driver_presence`
table (a Firestore mirror that does NOT exist on the live DB). The tables that DO exist:
- `driver_locations`: driver_uid, lat, lng, accuracy, is_online, online_status, last_seen_at, updated_at
- `drivers`: uid, vehicle_id, vehicle_name, verification_status, account_status, ... (no vehicle_product_id/slug/type)

So `pgListOnlineDrivers` reading `driver_presence` returns 0 rows → `[DISPATCH DRIVER
FILTER] totalOnline: 0`. Fix = `driver_locations dl JOIN drivers d ON d.uid =
dl.driver_uid WHERE dl.is_online = true`, deriving the product fields:
`vehicle_id === "bike"` → product/slug/type = `"2w"`, else product=slug=`vehicle_id`,
type=`vehicle_name`. Product matching is downstream — keep returning ALL online drivers.

**Raw query binding:** the bundle has top-level `var pool = new Pool(...)` (node-postgres,
20+ `pool.query(...)` sites) — use `pool.query` for added reads; no drizzle table var
needed.
