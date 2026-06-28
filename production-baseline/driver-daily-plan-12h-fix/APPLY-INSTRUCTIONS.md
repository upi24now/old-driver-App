# Daily Driver Plan → 12-hour expiry (live VPS bundle patch)

## What this changes
Daily plan was activating for **24 hours** (`durationDays = 1` × `DAY_MS`). It now
expires **exactly 12 hours** after activation. Weekly (7 days) and Monthly (30 days)
are unchanged.

The change is a single, byte-safe, in-place edit to the expiry computation inside
`pgActivatePlanByOrderId` (the function the `POST /api/driver-plans/verify-payment`
route calls on successful payment):

```js
// before
const expiresAt = new Date(startedAt.getTime() + row.durationDays * DAY_MS);
// after
const expiresAt = new Date(startedAt.getTime() + (row.planId === "daily" ? 12 * 60 * 60 * 1e3 : row.durationDays * DAY_MS));
```

### Why this approach
- `duration_days` is an **INTEGER** column, so `0.5` cannot be stored. Branching on
  `row.planId === "daily"` keeps the schema and the stored `duration_days = 1`
  untouched while writing a 12-hour `expires_at`.
- The active-plan **status check** (`pgGetActivePlan`: `expires_at > now()`) reads the
  stored `expires_at`, so it automatically honours the new 12-hour value — there is
  exactly **one** expiry rule, computed in one place.
- **Existing active plans are untouched** — their `expires_at` was written at their own
  activation time and is never recomputed. Only **new** Daily activations get +12h.
- Prices, Razorpay, OTP/MPIN/login/sessions, dispatch, wallet, order flow, Firebase,
  and the DB schema are all unchanged.

## Base / output
- **Base** = the currently-deployed (driver-delivery-patched) bundle, so this output
  retains the live delivery routes AND adds the 12h fix.
  - BASE sha256: `8d15ec721e97b8e718f38f8a7c7cffff7df48cbf2405aef7de917acfe3a6e87a`
- **Output**: `live-production-api.PATCHED.js`
  - PATCHED sha256: `297c2543edbdefe54a38f6442cf755bf05bc9040fb0f43705f5f1cac0c038bd2`
  - byte delta: +48 bytes (single occurrence replaced)

## Deploy (VPS)
```bash
scp live-production-api.PATCHED.js <user>@<vps-host>:/tmp/
ssh <user>@<vps-host>

cd /tmp
sha256sum live-production-api.PATCHED.js
# must equal: 297c2543edbdefe54a38f6442cf755bf05bc9040fb0f43705f5f1cac0c038bd2

# verify as a module (NOT a bare `node --check *.js` — bundle is ESM)
cp live-production-api.PATCHED.js /tmp/check.mjs && node --check /tmp/check.mjs

# back up current, drop in, reload
cp /home/<user>/api-pkg/dist/production-api.js \
   /home/<user>/api-pkg/dist/production-api.js.bak-$(date +%Y%m%d-%H%M%S)
cp /tmp/live-production-api.PATCHED.js /home/<user>/api-pkg/dist/production-api.js
cd /home/<user>/api-pkg && node --check dist/production-api.js
pm2 reload bike-courier-api --update-env
pm2 logs bike-courier-api --lines 50
```

## Verify after deploy
Activate a new Daily plan, then check the DB row:
```sql
SELECT plan_id, started_at, expires_at,
       EXTRACT(EPOCH FROM (expires_at - started_at))/3600 AS hours
FROM driver_plans
WHERE status = 'active'
ORDER BY started_at DESC
LIMIT 5;
```
- Daily → `hours = 12`
- Weekly → `hours = 168` (7d)
- Monthly → `hours = 720` (30d)

## Rollback
Purely a one-line in-place edit; restore the backup to fully revert (no schema/data
migration to undo):
```bash
cp /home/<user>/api-pkg/dist/production-api.js.bak-<timestamp> \
   /home/<user>/api-pkg/dist/production-api.js
pm2 reload bike-courier-api --update-env
```
