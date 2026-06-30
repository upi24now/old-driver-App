# Fix `pgListOnlineDrivers()` — read `driver_locations JOIN drivers` (not `driver_presence`)

## What this fixes

`pgListOnlineDrivers()` in the live bundle queries the **`driver_presence`** table,
which does **not exist** in the live PostgreSQL DB. The query returns 0 rows, so the
dispatch driver filter logs:

```
[DISPATCH DRIVER FILTER] totalOnline: 0
```

and no driver is ever treated as online.

This patch replaces **only the body of `pgListOnlineDrivers()`** with a read from the
tables that DO exist:

```sql
SELECT dl.driver_uid, dl.lat, dl.lng, dl.accuracy, dl.is_online,
       d.vehicle_id, d.vehicle_name, d.verification_status, d.account_status
FROM driver_locations dl
JOIN drivers d ON d.uid = dl.driver_uid
WHERE dl.is_online = true
```

Each row is mapped to the exact shape the dispatch code expects:

| field | source |
|---|---|
| `id`, `driverUid` | `dl.driver_uid` |
| `lat`, `lng`, `accuracy` | `dl.lat`, `dl.lng`, `dl.accuracy` |
| `isOnline` | `dl.is_online` |
| `vehicleId` | `d.vehicle_id` |
| `vehicleName` | `d.vehicle_name` |
| `verificationStatus` | `d.verification_status` |
| `accountStatus` | `d.account_status` |
| `vehicleProductId` / `vehicleSlug` / `vehicleType` | if `vehicle_id === "bike"` → `"2w"`/`"2w"`/`"2w"`, else `vehicle_id`/`vehicle_id`/`vehicle_name` |

Temporary `console.log` debug lines are included (entered, SQL, row count, per-row
fields, `Returning X online drivers`) — they go to PM2 stdout and do **not** change
the returned objects.

## What is NOT touched

Only the `pgListOnlineDrivers` function body changes. The function NAME and SIGNATURE
are byte-preserved. The patcher asserts every other byte in the bundle is identical.
Route, product matching, FCM, offer generation, offer timers, accept/reject, and
response JSON live in other functions and are left untouched.

## Files in this folder

- `apply-patch.py` — self-locating patcher (finds `pgListOnlineDrivers`, verifies it
  is the broken `driver_presence` version, swaps only its body, prints a unified diff).
- `harness.mjs` — standalone logic test for the row→object mapping (incl. bike→`2w`).
- `README_DEPLOY.md` — this file.

## Deploy steps (run on the VPS)

```bash
cd /home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist

# 0. Copy apply-patch.py into this folder (scp/paste), then:

# 1. Timestamped backup of the live bundle (instant rollback if needed)
cp production-api.js production-api.js.bak.$(date +%Y%m%d-%H%M%S)

# 2. Produce the patched bundle FROM the live file. Review the printed diff.
python3 apply-patch.py production-api.js production-api.PATCHED.js
#    -> if it prints "ABORT: ..." STOP and send me the output; nothing is deployed.
#    -> the diff shown must contain ONLY the pgListOnlineDrivers change.

# 3. Syntax-check the patched bundle (MUST print nothing / exit 0)
node --check production-api.PATCHED.js && echo "SYNTAX OK"

# 4. Swap in the patched bundle
mv production-api.js production-api.PRE_PATCH.js
mv production-api.PATCHED.js production-api.js

# 5. Restart PM2
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50
```

### Rollback (if anything looks wrong)

```bash
cd /home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist
cp production-api.js.bak.<timestamp> production-api.js
pm2 restart bike-courier-api
```

## Post-deploy verification

**1. Online drivers exist in the source tables (sanity, before trusting the app):**
```bash
psql "$DATABASE_URL" -c "SELECT count(*) AS online_now FROM driver_locations WHERE is_online = true;"
psql "$DATABASE_URL" -c "SELECT count(*) AS online_join FROM driver_locations dl JOIN drivers d ON d.uid = dl.driver_uid WHERE dl.is_online = true;"
```
If `online_now` > 0 but `online_join` is smaller, some online drivers have no matching
`drivers` row (uid mismatch) — note it, but that is data, not this patch.

**2. PM2 logs now show the function running and a non-zero count:**
```bash
pm2 logs bike-courier-api --lines 200 | grep -E "pgListOnlineDrivers|Returning .* online drivers|DISPATCH DRIVER FILTER"
```
Expect to see:
```
[pgListOnlineDrivers] entered
[pgListOnlineDrivers] querying driver_locations JOIN drivers: SELECT ...
[pgListOnlineDrivers] row count: <N>
Returning <N> online drivers
[DISPATCH DRIVER FILTER] totalOnline: <N>      # no longer 0 when drivers are online
```

**3. Place a test order** (or wait for a real one) with at least one online driver and
confirm `totalOnline` is non-zero and dispatch proceeds as before.

## Removing the debug logs later

The `console.log("[pgListOnlineDrivers] ...")` lines are temporary. When you no longer
need them, re-run the patch flow from a clean base, or delete those `console.log`
lines from the function and `node --check` + `pm2 restart` again.
