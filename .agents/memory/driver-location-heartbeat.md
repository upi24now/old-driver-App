---
name: Driver App location heartbeat
description: Why the Driver App must POST GPS coords (not just PATCH status) on a short interval to stay online on the VPS.
---

# Driver App online/location heartbeat

The live VPS backend (`api.bikecourierservice.com`) runs a stale-cleanup job every ~60s that marks a driver **offline AND clears lat/lng** when `driver_locations.last_seen_at` is older than **90s**. The dispatcher only counts drivers with non-NULL coords + `is_online=true` as candidates.

**Rule:** While Duty is ON the app must `POST /api/drivers/:uid/location` with numeric `{latitude, longitude, accuracy?, isOnline?}` on an interval comfortably under 90s. Heartbeat interval is **30s** (was 15s).

**Why:** `PATCH /api/drivers/:uid/status` flips `is_online` but does **NOT** write coordinates. Relying on status alone leaves lat/lng NULL → driver is un-dispatchable and gets reaped by stale-cleanup after 90s. So online state must be coupled to a *successful* location heartbeat.

**How to apply (in `contexts/DriverContext.tsx` `setOnline` / `pollLocationAndUpload`):**
- Duty ON → immediately get GPS + POST, then 30s interval.
- Revert UI to Offline (no "fake online") on: permission≠granted, GPS throw, non-numeric/NaN coords, POST ok:false (incl. missing token), or POST throw. Shared `revertToOffline(reason)` clears the interval + `incomingRide`.
- Reverting on a single periodic heartbeat failure is intentional (strict no-fake-online), accepted flapping tradeoff on transient network loss.
- Forensic log tags: `[LOCATION_HEARTBEAT_START|PAYLOAD|RESPONSE|STOP]`, `[ONLINE_REVERT_REASON]` (these are debug-only; gate/remove after forensics).
