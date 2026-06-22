---
name: Driver online-status & location PG migration (Phase 4C/4D)
description: How driver online/offline state and latest GPS location are mirrored into Postgres while Firestore stays source of truth.
---

# Driver online/offline + location — Firestore → Postgres shadow (Phase 4C/4D)

Driver online/offline state (4C) and latest GPS location (4D) are mirrored onto the `drivers` table. **Firestore `drivers/{uid}` remains the source of truth** (for online state and for customer live tracking). Nothing reads the PG columns yet — no dispatcher switch, no customer-map switch.

PG columns on `drivers`: `is_online` bool default false, `online_status` text ("online"/"offline"), `last_seen_at` timestamptz (4C); `latitude`, `longitude`, `accuracy` doublePrecision (4D). `uid` PK serves as driver_uid; latest-location only, no history table.

## Where the mirrors happen (server-side, zero mobile change)

Both mirrors are added on the existing server routes the mobile app already calls:
- **Online status** → `PATCH /api/drivers/:uid/status` (mobile `setOnline` toggle already calls `patchDriverStatus` for both online and offline).
- **Location** → `POST /api/drivers/:uid/location` (mobile `postDriverLocation` already fires every ~15s while online). The separate Firestore client write `updateDriverLocation` (driverLat/driverLng for customer live tracking) is NOT touched.

Pattern in both routes: Firestore write runs FIRST and unchanged (still 500 + early `return` on Firestore failure). After success, a **fire-and-forget** `void (async()=>{...})()` runs a Drizzle UPDATE on `driversTable`; `res.json({ok:true})` is sent immediately and does NOT await the PG write — a PG failure can never block Firestore or the response.

Logs: `[PG_ONLINE_STATUS_SAVE]`/`[PG_ONLINE_STATUS_FALLBACK]` (4C), `[PG_DRIVER_LOCATION_SAVE]`/`[PG_DRIVER_LOCATION_FALLBACK]` (4D). FALLBACK = no matching drivers row OR PG threw.

## Known shadow-lag (accepted)

Auto-offline edge paths in DriverContext (subscription-expiry, block-enforcement, some cleanup) call only `updateDriverOnlineStatus` (Firestore), **not** `patchDriverStatus`, so they do NOT mirror to PG. PG `is_online` can briefly lag after those — acceptable because PG is a non-consumed shadow and the next toggle/location update corrects it. Do not add `patchDriverStatus` calls there without a reason (would be a mobile change).
