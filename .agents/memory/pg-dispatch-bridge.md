---
name: PG dispatch authority bridge (Phase 5H)
description: Why a naive PG-authoritative cutover breaks production, and the bridge architecture required before it can happen.
---

# PG dispatcher authority cutover — the bridge problem

A "make PG authoritative, step Firestore down" flip CANNOT be a simple env change. Two independent always-on subsystems and the apps all assume **Firestore is the live read/notify surface**:

- `round-robin-dispatcher.ts` decides assignment in Firestore; `fcm-dispatcher.ts` (the ONLY ride-request push path) listens on Firestore `status==dispatched` and dedupes via a Firestore claim (`fcmDispatchClaimedAt/By`).
- Driver app reads offers via Firestore `onSnapshot where("activeOfferDriverUids","array-contains",uid)` — **no API route**. Active order via `GET /api/drivers/:uid/active-orders` (Firestore-primary) + Firestore fallback.
- `GET /api/orders/:orderId` is already PG-primary; `active-orders` is NOT.
- **Customer app is external (not in this repo)** — reads/writes `orders/{orderId}` directly in Firestore. Hard blocker for any "apps read PG directly" design.

## Recommended bridge: "PG decides, projects to Firestore"
Keep Firestore as the read/notify surface; make PG the sole *decider*.
- In `DISPATCH_SOURCE=pg`: disable the Firestore RR **assignment/timeout writes** (no dual authority), keep `fcm-dispatcher.ts` UNTOUCHED.
- After a committed PG assign/timeout, **project** the result into the Firestore order doc (status, activeOfferDriverUids/driverUid, dispatchTimeoutAt, clear FCM guard fields on a fresh dispatch cycle). FCM + both apps keep working unchanged; no PG→FCM path needed.
- Rollback: `DISPATCH_SOURCE=firestore` re-enables RR, projection stops.

**Why preferred over PG-native FCM + apps-read-PG:** the external customer app can't be migrated from this repo, and a PG-native FCM sender needs a new cross-store dedupe claim to avoid double-send with the still-present Firestore FCM dispatcher.

## Blockers that MUST be built/validated before bridge implementation
1. **Firestore→PG ingress** for new pool orders (status searching/pending) — today PG is fed only by RR shadow paths; with RR authority off, PG has no live order source.
2. **Full dispatch-cycle feedback into PG** — accept/reject/timeout/cancel/stage mutate Firestore directly; `pg-shadow-writer.ts` mirrors only driver_assigned + stages + OTP, NOT reject/timeout/cancel semantics (`activeOfferDriverUids` array-remove, `status="pending"` cancel). PG authority will drift without these.
3. **Durable PG→Firestore projector** — PG-commit-then-Firestore-project is cross-store, non-atomic. Needs an outbox + idempotent retry + health/lag metric or projection failure causes split-brain (PG advances, app/FCM blind).
4. **Mode-switch invariant**: in pg mode, no RR assignment writes (no dual authority) + no duplicate FCM; cover with tests.

**Verdict at audit time:** NOT_READY_FOR_PHASE_5H_BRIDGE_IMPLEMENTATION until 1–4 exist and the projection-vs-PG-native-FCM design is ratified.
