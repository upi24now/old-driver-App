---
name: Firebase-to-PG migration patterns
description: Patterns and gotchas for Step 1 of the Firestore→PostgreSQL migration in Bike Courier.
---

## RoutingDoc structural type

`deriveNextRoute` accepts a `RoutingDoc` structural type (not `DriverDoc` or `PgDriverProfile` directly).
Both Firestore and PG shapes satisfy `RoutingDoc` — only the fields used by the routing logic are listed.
The type is declared as a local type inside the `onAuthStateChanged` scope.

**Why:** Avoids coupling routing logic to either concrete type; allows PG-first + Firestore-fallback without a union cast.

**How to apply:** When adding new routing criteria, add the field to `RoutingDoc` first, then read from both sources.

## setKycDocuments cast

`setKycDocuments` expects `NonNullable<DriverDoc["documents"]>` (not `| undefined`).
`DriverDoc["documents"]` is itself an optional interface, so a plain `as DriverDoc["documents"]` cast produces a type that includes `undefined` and fails `setKycDocuments`.

Correct cast: `doc.documents as unknown as NonNullable<DriverDoc["documents"]>`

## Subscription + daily stats: remaining Firestore dep in Step 1

`subscriptionPlan`, `subscriptionExpiresAt`, `todayEarnings`, `tripsToday`, `todayDate`, `rating` are NOT in the PG schema after Step 1.
Pattern used: background `void getDriverDoc(uid).then(fsDoc => { ... }).catch(...)` immediately after the PG profile hydration block.
Also restore subscription from AsyncStorage cache as an immediate fallback before the background fetch resolves.

## Account-status polling vs Firestore onSnapshot

`subscribeDriverDoc` real-time listener replaced with a `setInterval`/`setTimeout` polling effect (5 s initial, 30 s interval) on `getDriverProfile()`.
The loop-guard boolean `hasEnforcedBlock` is preserved — works the same way.
No subscription sync in the poll; subscription fields are only fetched via the background Firestore getDriverDoc call.

## confirmOtp: PG-first + Firestore fallback

```
const pgProfile = await getDriverProfile();
if (!pgProfile) {
  // Firestore fallback: new driver or unmigrated uid
  driverDoc = await getDriverDoc(uid) ?? await createDriverDoc(...);
  routingDoc = driverDoc;
} else {
  // PG path: existing migrated driver
  routingDoc = pgProfile;
}
```
`driverDoc` is only declared (not always assigned) in the new flow. Always use `routingDoc` for `deriveNextRoute` and OTP_ROUTE logs.

## Files changed in Step 1

- `artifacts/mobile/utils/profile-api.ts` — new file, 5 PG helpers
- `artifacts/mobile/contexts/DriverContext.tsx` — imports, hydration, polling, confirmOtp, setProfile/Vehicle/Background, refreshKycStatus
- `artifacts/mobile/app/document-upload.tsx` — imports, on-mount load, Phase 3b removed
