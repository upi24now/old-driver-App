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

## Phase 5H-BRIDGE-1 (blocker #1: ingress) — DONE, verdict READY_FOR_PHASE_5H_BRIDGE_2
Two additive Firestore listeners in `pg-shadow-writer.ts` feed PG the live pool BEFORE any dispatch, with dispatch authority untouched (`DISPATCH_SOURCE=firestore`, write/FCM gates closed):
- Pool ingress `[PG_INGRESS_POOL]`: `where status in (searching,pending)`, on `added` → `pgUpsertOrder` (mirrors order's own pool status, no override). Fires both on customer-create and on returnToPool reset.
- Cancellation ingress `[PG_INGRESS_CANCELLED]`: `where status=="cancelled"`, on `added` → `pgShadowSetStatus(id,"cancelled")` (UPDATE-only; sets cancelled_at).
E2E verified (sentinel `driverUid` makes RR skip → no assignment/FCM): searching mirrored, idempotent re-write stays 1 row, cancel→cancelled with cancelled_at, real-order count unchanged, full cleanup.

**GATING PREREQUISITE for Bridge-2 (must fix BEFORE the PG pool query becomes authoritative):**
- **Cancel-vs-pool ingress race** — the two listeners are independent snapshots; their async PG writes can interleave. If a cancel is processed before the initial pool insert, the UPDATE-only cancel is a no-op, then a delayed pool upsert INSERTs stale `searching` → a cancelled order leaks into the PG pool. Inert in Bridge-1 (nothing authoritative reads the PG pool yet) but a correctness bug the moment Bridge-2 reads it.
  - **Why not fixed in Bridge-1:** a complete fix changes the shared `pgUpsertOrder` conflict-update to refuse downgrading a terminal status (cancelled/delivered) AND makes the cancel path upsert-capable — that touches the dispatcher-critical shadow path, out of scope for a safety-frozen additive ingress phase.
  - **How to apply in Bridge-2:** (a) make cancel land a row even when missing (upsert-cancelled), and (b) give the pool-ingress upsert a guarded conflict-update (`setWhere status NOT IN ('cancelled','delivered')`, behind an opt-in param so existing `pgUpsertOrder` callers are unaffected). Add a race test: create `searching` then immediate `cancelled` under induced delay; final PG status must be `cancelled` regardless of callback order.
- **Minor data-quality (Bridge-2):** cancellation listener replays the full Firestore snapshot on every restart, re-stamping `cancelled_at` for already-cancelled orders. Guard against resetting an existing `cancelled_at`.

## Phase 5H-BRIDGE-2 (pool safety + complete mirroring) — DONE, verdict READY_FOR_PHASE_5H_BRIDGE_3
All Bridge-2 gating items resolved, still additive and Firestore-authoritative (safety gates closed). Pattern, not changelog:
- **Terminal cancel must UPSERT, not UPDATE.** A cancel that may arrive before the row exists has to INSERT a terminal row (`pgShadowCancelOrder`), else the no-op UPDATE leaves the door open for a later pool INSERT to resurrect it. **Why:** the two ingress listeners are independent snapshots whose async PG writes interleave arbitrarily.
- **Pool ingress must be regression-guarded.** Pool-status upserts from listeners use a guarded conflict-update (`setWhere status IN ('searching','pending','dispatched')`) so a stale/replayed pool event can never overwrite a claimed (driver_assigned…delivered) or cancelled row. The guard is opt-in (`guardRegression`) so the dispatcher's own authoritative upsert path is byte-unchanged.
- **`dispatched` is intentionally inside the poolable/guard set.** It must stay there so legitimate `returnToPool` (timeout) `dispatched→searching` still mirrors; the guard only blocks *terminal/claimed* regressions, not the legit backward pool move.
- **Offer-set drift needs its own listener.** Driver reject/timeout = mobile `arrayRemove` on `activeOfferDriverUids` with status unchanged (`status=='dispatched'` `modified` events) — no other listener saw it. A dedicated dispatch-cycle listener mirrors it with an opt-in `mirrorOfferSet` flag; the dispatcher's dispatch-time upsert deliberately leaves the offer column untouched. **Why it matters:** `pg-claim-shadow.ts` validates against PG's `active_offer_driver_uids`, so drift would corrupt claim validation once PG is authoritative.
- **Verification approach that worked:** drive the REAL service functions (not re-implemented SQL) against live PG from a temp tsx harness under `artifacts/api-server/src/scripts/`, run via `pnpm --filter @workspace/scripts exec tsx <ABSOLUTE path>` (relative paths resolve against the scripts package dir and fail). Use a `TEST_PG_DISPATCH_` id prefix + sentinel driverUid, assert real-row count unchanged, delete the harness after. 14/14 covering every cancel/pool interleaving, claimed/delivered precedence, and offer-set mirror.

## Phase 5H-CUTOVER-RETRY readiness audit — DONE, verdict READY_FOR_PHASE_5I
Full authority dependency audit (A-I), authority simulation (64 assertions vs REAL PG + REAL Firestore), rollback simulation, safety audit, and architect review — all passed. Key finding (fixed here):
- **RR dual-writer was a blocker:** `startRoundRobinDispatcher()` starts unconditionally in every mode. In `DISPATCH_SOURCE=pg`, both RR (Firestore authority) and PG dispatcher would race for assignment. **Fix:** added pg-mode guards at the start of `assignNextDriver` and `returnToPool` in `round-robin-dispatcher.ts` — both call `resolveDispatchSource().value === "pg"` and return early, logging `[RR dispatcher] pg mode — skipping Firestore assignment/timeout (PG authority)`. Guard is call-time so env flip takes effect immediately without restart. RR shadow writes (inside `if (assigned)`) never run because `assigned` stays `false` on early return.
- **FCM dispatcher stays unconditional:** correct — it needs Firestore claim+send, which the projector enables.
- **All other A-G checks passed first attempt.** Audit harness deleted after passing.
Operational runbook: see Phase E section in the session evidence (environment variables, restart sequence, health log markers, rollback steps).

## Phase 5H-BRIDGE-3 (durable PG→Firestore projector) — DONE, verdict READY_FOR_PHASE_5H_CUTOVER_RETRY
Transactional outbox (`dispatch_projections`, bigserial FIFO id) enqueued INSIDE the PG assign/timeout txns so a projection row exists iff a PG write committed. A poller drains it serially and applies to the Firestore order doc inside a Firestore txn with RR-equivalent guards (assignment only onto pool-status & !driverUid; timeout only onto `dispatched`). Still additive/Firestore-authoritative; default-closed. Durable patterns, not changelog:
- **Claim is deliberately NOT projected.** Projecting `pgClaimFcmDispatch` would pre-claim the Firestore doc and block the untouched Firestore FCM dispatcher (which does its OWN Firestore claim). The assignment projection instead CLEARS the 4 fcm guard fields so the FCM dispatcher fires normally.
- **Per-order causal sequencing is mandatory under retry/backoff.** A naive `status=pending AND availableAt<=now ORDER BY id` drain is WRONG: a failed earlier row (assignment) gets pushed forward by backoff while its later same-order row (timeout) becomes due first; since a guard-miss is terminally marked `projected`, the timeout is permanently consumed against a stale doc → Firestore stuck `dispatched` while PG is back in pool (split-brain). **Fix:** the drain excludes any row that has an EARLIER (lower id) same-`orderId` row still `pending`/`failed` (correlated `NOT EXISTS` over an aliased self-join). **Why:** guarantees assignment projects before its timeout. A permanently-`failed` predecessor INTENTIONALLY blocks its order's later rows (surfaced via `[PG_PROJECT_FAILED]` + lag metric) — blocking is safe; reordering corrupts.
- **Two-condition Firestore-write gate, re-resolved every pass:** writes happen only when `PG_PROJECTION_ENABLED==="true"` AND `DISPATCH_SOURCE=pg`; otherwise verify-only (health/lag metric, zero Firestore writes, rows left `pending`). Gate is read inside the pass, not captured by the caller, so it can't be bypassed.
- **Test-collection seam must be double-gated.** The projector can target an isolated Firestore collection for harness runs, but the override is honored ONLY when `PG_PROJECTION_COLLECTION` is set AND `PG_PROJECTION_ALLOW_COLLECTION_OVERRIDE==="true"`; an accidental production `PG_PROJECTION_COLLECTION` is ignored (forced `"orders"`) + logged `[PG_PROJECT_COLLECTION_GUARD]`, so projection can never silently misroute off the collection the apps read.
- **Mode-aware stale-pool guard:** `pgUpsertOrder` gained `guardStatuses`; in pg mode the pool-ingress listener passes `[searching,pending]` (so a stale Firestore pool event can't regress a PG-authoritative `dispatched`), vs `[searching,pending,dispatched]` in firestore mode (needs the returnToPool mirror). Resolve at call time so DISPATCH_SOURCE flips without restart-frozen capture.
- **ESM gotcha:** any env-derived constant the projector needs (e.g. the projection collection) must resolve at CALL time inside a function, not at module load — import hoisting evaluates module-level reads before the harness sets env.
- **Verification:** 34/34 assertions vs REAL PG + REAL Firestore (isolated collection), incl. a dedicated out-of-order retry test (delay assignment into the future, confirm the later timeout is causally held, then converges in order). Real-order count 74→74 unchanged; harness deleted; build/typecheck clean; restart logs confirm `DISPATCH_SOURCE=firestore`, `writesAllowed=false`, `[PG_PROJECTOR_START] inert`.
