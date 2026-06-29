---
name: Location heartbeat & Expo Go background timer pause
description: Why the driver 30s location heartbeat dies and the foreground-resume watchdog pattern that recovers it; Expo Go's hard background limit.
---

# Driver location heartbeat (DriverContext.tsx)

The driver app posts location every 10s while Duty is ON (was 30s) so the backend's
90s stale-cleanup keeps the driver online (lat/lng non-NULL). The heartbeat is a
plain JS `setInterval`. The ONLY live mobile app is `artifacts/mobile` (manifest:
name "Driver App", slug/scheme "mobile", EAS projectId 3222bc75-...); there is no
`artifacts/driver-app` directory — don't be misled into hunting for another tree.

`lastLocationSyncAt` (epoch ms) is set ONLY on a successful `/location` POST
(`result.ok`), surfaced as "Last sync <time>" in the home header, and RESET to null
on duty-off / revertToOffline / fresh go-online so it only ever reflects the current
online session. Payload sends BOTH `latitude/longitude` AND `lat/lng` (different
bundles read different keys).

## The trap
Android/Expo Go **pauses the JS thread (and all `setInterval` timers) when the app
is backgrounded** (screen off / app switched). So the heartbeat fires its first
POST while foreground, then silently stops on background → backend 90s cleanup
flips the driver offline with NULL coords by ~2 min. Symptom: exactly ONE
successful `/location` POST, then nothing, and `[LOCATION_HEARTBEAT_TICK]` never
logs again. This is NOT a clear-on-failure bug and NOT a stale-uid closure.

**Why:** confirmed by symptom (one POST then silence) + the fact that the once-
registered `AppState` "active" listener historically only re-registered the FCM
push token and never restarted/kicked the heartbeat.

## The fix (foreground-resume watchdog)
- Extract a single resilient `startLocationHeartbeat({immediate?})`: clears any
  existing interval, optionally fires one immediate poll, then starts the 30s
  interval. Tick failures are LOGGED but the interval is RETAINED (self-heals).
- `setOnline(true)` keeps its guarded initial poll (reverts to offline on first
  failure to prevent fake-online), then calls `startLocationHeartbeat()`.
- Augment the `AppState` "active" listener: when online, log
  `[LOCATION_HEARTBEAT_RESUME]` and call the starter with `{immediate:true}` so a
  fresh coordinate hits the backend the instant the app is foregrounded and the
  timer is guaranteed alive again.
- Use a "latest" ref (`startLocationHeartbeatRef`) so the once-registered listener
  never holds a stale closure; `heartbeatTickRef` so the counter survives restarts.

## Offline-resume race (caught in review)
`isOnlineRef` mirrored via `useEffect` lags one tick behind `isOnline`. A resume
firing right after duty-off could post one heartbeat while offline. **Fix:** set
`isOnlineRef.current = v` SYNCHRONOUSLY at every duty-off site (setOnline,
revertToOffline, subscription-expiry effect, account-block enforce, sign-out) +
a defense-in-depth `if (!isOnlineRef.current) return;` guard at the top of
`startLocationHeartbeat`. setOnline(true) sets the ref true BEFORE calling the
starter, so legit go-online is never blocked.

## Hard limitation (tell the user honestly)
**Continuous BACKGROUND heartbeat is impossible in Expo Go.** True background
location needs a native dev build with expo-location background task / foreground
service. This watchdog only guarantees heartbeat while the app is FOREGROUND and
re-syncs immediately on every foreground resume. Acceptance ("online after 2 min")
holds when the app stays foreground; a phone left backgrounded for 2 min will still
go offline until a native build is shipped.
