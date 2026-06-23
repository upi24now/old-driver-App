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

## SUPERSEDED for status by Phase 5J-Tier-5 (online/offline now PG-PRIMARY)

The 4C description above (Firestore source-of-truth + PG shadow on `PATCH /drivers/:uid/status`) was INVERTED in Tier-5: PG is now authoritative (write first, 404/500 on PG failure) and Firestore is a best-effort projection. All mobile auto-offline edge paths now call `patchDriverStatus` (no more direct `updateDriverOnlineStatus`), so the "accepted shadow-lag" below NO LONGER applies to status. See pg-dispatch-bridge.md → Phase 5J-Tier-5.

**Still accurate (location, Phase 4D, UNCHANGED):** `POST /api/drivers/:uid/location` — the ~15s while-online driver-doc GPS ping — remains Firestore-primary + fire-and-forget PG shadow. (The separate per-order customer-live-map location write WAS migrated to PG-authoritative `PATCH /orders/:orderId/location` in Tier-5 — that's a different code path.)
