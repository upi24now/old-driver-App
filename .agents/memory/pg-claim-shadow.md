---
name: PG FCM claim shadow (Phase 5C-C)
description: Read-only validator reproducing future PG FCM-claim logic vs authoritative Firestore claim/send; design constraints and the unmirrored-claim normalization rule.
---

# PG FCM claim shadow (Phase 5C-C)

Read-only validator that reproduces the future PostgreSQL FCM-claim decision and
compares it to the authoritative Firestore claim/send, logging
`[PG_CLAIM_MATCH]` / `[PG_CLAIM_DIFF]` / `[PG_CLAIM_ERROR]`. Firestore stays
authoritative: it owns the claim transaction, sends push, and writes
`fcmDispatchClaimedAt/_By/fcmMessageId`. The shadow never writes, claims, sends,
or throws into the dispatcher (fire-and-forget `void` + internal try/catch).

## Key constraint: claim-result fields are NOT live-mirrored to PG
**Why:** Firestore's claim/send writes (`fcm_dispatch_claimed_at/_by`,
`fcm_message_id`) reach PG only via the one-time backfill script — there is no
live shadow write of the claim. The live-authoritative PG target set is the
`order_offers` table (Phase-2 model), NOT `orders.active_offer_driver_uids`
(a legacy/backfill column). So for a FRESH live claim, PG's claim-result columns
are null — the expected unmirrored state, not a disagreement.

**How to apply:** Reproduce the claim DECISION from stable inputs (order status =
"dispatched", live `order_offers` pending set, prior-claim guard, target's
`drivers.fcm_token`). In the live path, `normalizeForLive` fills null
claim-result fields from the Firestore values ONLY when `priorClaimPresent` is
false, so they don't false-diff. Keep `priorClaimPresent` separate from the
result-compare fields so the "already claimed" guard is never corrupted; keep the
pure comparator strict so the harness can drive every diff reason.

## Token dimension = the readiness signal
PG-first token resolution: `pg_hit` (drivers.fcm_token present → PG ready),
`fs_fallback` (token only in Firestore → DIFF "firestore token fallback"),
`missing` (neither → DIFF "pg token missing"). Phase 5D readiness is gauged by
the `pg_hit` vs `fs_fallback`/`missing` distribution over live traffic.

## Open fidelity note for 5D (non-blocking)
The PG target-set reproduction uses `order_offers` then legacy
`active_offer_driver_uids`; it does NOT fall back to `orders.driver_uid` for
Phase-1 single-driver orders the way the Firestore dispatcher does. Confirm
intended behavior for any remaining Phase-1 `driverUid`-only orders during 5D.

## Pattern lineage
Mirrors `pg-timeout-shadow.ts` (5C-B): pure `evaluate*`/`compare*`, read-only
`readPg*Inputs`, `normalizeForLive`, fire-and-forget `*ShadowValidate`, plus an
esbuild harness (`verify-claim-shadow.ts` + `verify-claim.mjs`). Live hook lives
in `fcm-dispatcher.ts` as one additive `void` loop after the writeback.
