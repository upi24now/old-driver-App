---
name: Dispatch shadow data (PG reproduction of dispatcher)
description: Which driver/order fields the dispatcher reads, which have no writer, and how PG shadow columns must mirror them faithfully.
---

# Dispatcher field provenance (for PG reproduction)

The round-robin dispatcher reads these driver fields from Firestore:
`subscriptionExpiresAt` (epoch ms), `rating`, and `tripsTotal` OR `trips`.

**Writer reality (audited):**
- `subscriptionExpiresAt` — ONLY written by the server verify-payment route
  (driver-plans.ts). That route is the single shadow-mirror chokepoint.
- `rating` — **no writer anywhere**. Defaults to 5.0 when absent; dispatcher only
  reads it. PG `rating` stays null faithfully.
- `tripsTotal` — **no writer anywhere**. Delivery completion writes `tripsToday`
  (a DIFFERENT field). PG `trips_total` stays null faithfully.

**Rule:** Do NOT mirror `tripsToday` → `trips_total`. They are different concepts;
doing so would make PG diverge from what the dispatcher actually reads.
**Why:** faithful shadow parity for an eventual PG dispatcher cutover — PG must
reproduce the SAME decision, including "rating/trips absent → treated as null".

# Shadow-write pattern

PG mirrors run AFTER the authoritative Firestore write, as a fire-and-forget
`void (async () => { try { ...pg... } catch {} })()` so a PG failure can never
block the real path. Log `[PG_DRIVER_META_SAVE]` on success, `[PG_DRIVER_META_FALLBACK]`
on failure.

# Backfill mechanics

- `@workspace/db` exports its raw TS entry (`./src/index.ts`) AND a `pool` (node-postgres
  Pool). A `tsx` script in `scripts/` can `import { pool } from "@workspace/db"` and run
  parameterized SQL directly — no lib/db build needed, picks up live schema.
- `firebase-admin` only resolves from inside the `scripts/` package dir (its node_modules),
  not repo root.
- Driver upsert uses `ON CONFLICT (uid) DO UPDATE` and deliberately does NOT touch `phone`,
  so existing rows keep their canonical phone. Missing-phone drivers use a `missing:<uid>`
  sentinel (never a real-phone-looking value) only on brand-new inserts.
- Order FCM/offer backfill UPDATEs existing PG order rows only (`WHERE id=$1`); never inserts.

# Shadow comparator parity rules (Phase 5B)

- **Legacy subscription passthrough is mandatory.** The Firestore dispatcher allows a
  driver when `expiry === 0 || expiry > now`. Backfill coerces a Firestore
  `subscriptionExpiresAt` of `0` (and any non-numeric/missing value) via `toDateOrNull`,
  so PG stores it as `Date(0)` (0 ms) or NULL. The PG comparator MUST treat BOTH
  `null` and `0` as legacy-allowed (`expiryMs === null || expiryMs === 0 || expiryMs > now`),
  or it produces false subscription DIFFs. Keep the rule in ONE shared helper used by
  both `selectPgCandidate` and the eligibility set in `compareDispatchDecision`.
  **Why:** without the `=== 0` branch, every legacy/no-subscription driver shadows as a DIFF.
- **Round-robin cursor: use the PRE-dispatch value.** Pass the Firestore `lastDispatchedUid`
  captured BEFORE assignment into the comparator. Do not read PG `last_dispatched_uid`
  post-assignment — the assignment tx and the PG order mirror both advance it, so a
  post-read races and reports phantom cursor diffs.
- **Timeout shadow compare must be gated on an actual reset.** `returnToPool`'s tx can bail
  without resetting; in that case `timedOutDriverUid` is null and there is nothing to
  compare — return silently, never log a MATCH (it pollutes timeout telemetry).
