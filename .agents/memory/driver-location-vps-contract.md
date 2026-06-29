---
name: Driver online/location VPS contract
description: How the prod VPS handles PATCH /status and POST /location, and why the client must send both coordinate field-name conventions.
---

# Driver online/location → VPS persistence

The live VPS (`api.bikecourierservice.com`) is a DIFFERENT, more permissive bundle than `artifacts/api-server` source.

**Permissive 200, untrustworthy success:** authenticated `POST /api/drivers/:uid/location` and `PATCH /api/drivers/:uid/status` return `200 {ok:true}` even for an EMPTY body. So a client `ok:true` does NOT prove anything persisted. The api-server SOURCE, by contrast, 400-validates and reads `{latitude, longitude, isOnline}`.

**No readable verification channel:** `GET /drivers/me` returns 200 but exposes NO location fields; `GET /drivers/online` is admin-gated (403 for a normal driver); the Firestore `drivers/{uid}` doc had NO location fields. There is no HTTP/Firestore way to read back which body field-name the VPS actually persists to `driver_locations`. To probe as a driver: mint a Firebase custom token via Admin SDK (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) → exchange at identitytoolkit `signInWithCustomToken` (FIREBASE_API_KEY) → Bearer it. Run from bash/node (sandbox has no process.env).

**Fix applied (client-only):** `utils/driver-api.ts` `postDriverLocation` now sends BOTH `{latitude, longitude}` AND `{lat, lng}` (+accuracy, isOnline). 

**Why:** could not read-back which convention the VPS reads; the source contract is `latitude/longitude` but a prior client comment claimed `lat/lng`. Sending both is additive and harmless to either bundle, and covers the proven gap (client previously sent only `lat/lng`, leaving `driver_locations` lat/lng NULL → dispatcher `totalOnline:0`).

**Also hardened:** `DriverContext.setOnline` now reverts local `online` state (and stops the GPS interval) if `patchDriverStatus` fails or returns `ok:false` (e.g. missing ID token). Prevents the "UI shows online but backend never recorded it" fake/local-only state. `patchDriverStatus` body `{isOnline}` matches both source and VPS — left unchanged.
