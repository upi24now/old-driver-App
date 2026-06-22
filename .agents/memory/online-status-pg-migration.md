---
name: Driver online-status PG migration (Phase 4C)
description: How driver online/offline state is mirrored into Postgres while Firestore stays source of truth.
---

# Driver online/offline status — Firestore → Postgres shadow (Phase 4C)

Driver online/offline state is mirrored into Postgres on the `drivers` table (`is_online` bool default false, `online_status` text "online"/"offline", `last_seen_at` timestamptz). **Firestore `drivers/{uid}` (isOnline/onlineStatus/lastSeenAt) remains the source of truth.** Nothing reads the PG columns yet — no dispatcher switch.

## Where the mirror happens

The single chokepoint is the server route `PATCH /api/drivers/:uid/status`. The mobile `setOnline` toggle (DriverContext) already calls both `updateDriverOnlineStatus` (Firestore client write) **and** `patchDriverStatus` (this route) for both online and offline, so the PG mirror is added server-side with **zero mobile change**.

- Firestore write runs FIRST and unchanged (still 500 + early return on Firestore failure).
- After a successful Firestore write, a **fire-and-forget** `void (async()=>{...})()` runs a Drizzle UPDATE on `driversTable`. `res.json({ok:true})` is sent immediately and does NOT await the PG write — a PG failure can never block Firestore or the response.
- Logs: `[PG_ONLINE_STATUS_SAVE]` (rows matched), `[PG_ONLINE_STATUS_FALLBACK]` (no row matched OR PG threw).

## Known shadow-lag (accepted)

Auto-offline edge paths in DriverContext (subscription-expiry, block-enforcement, some cleanup) call only `updateDriverOnlineStatus` (Firestore), **not** `patchDriverStatus`, so they do NOT mirror to PG. PG `is_online` can stay briefly stale after these — acceptable because PG is a non-consumed shadow and the next toggle corrects it. Do not add `patchDriverStatus` calls there without a reason (would be a mobile change).
