---
name: FCM token PG migration (Phase 4A + 4B)
description: How driver push-token storage (write) and the dispatcher lookup (read) were moved from Firestore to Postgres, and what is intentionally still shadowed.
---

# FCM push-token storage — Firestore → Postgres (Phase 4A write, 4B read)

Driver Expo/FCM push tokens are written to **both** Postgres and Firestore. Postgres is the primary store for both write (4A) and the dispatcher's read (4B); Firestore is kept as a shadow/fallback on both sides.

## Phase 4B — dispatcher reads PG-first (read side)

The FCM dispatcher (`fcm-dispatcher.ts`) resolves each driver's token PG-first, Firestore-fallback via `resolveDriverFcmToken()`: PG `drivers.fcm_token` → `[PG_FCM_TOKEN_HIT]`; on PG empty/no-row/throw → Firestore `drivers/{uid}.fcmToken` → `[PG_FCM_TOKEN_FALLBACK]`; neither → `[PG_FCM_TOKEN_MISS]`.
- **A PG read error must never block push** — it is caught/logged and falls through to Firestore, identical to a PG miss.
- The PG `db` is imported **aliased as `pgDb`** because the dispatcher's local Firestore handle is already named `db`.
- Send payload, claim transaction, order targeting, and Firestore writeback are untouched.
- **Expected during rollout:** until drivers re-login through the 4A mobile build, `drivers.fcm_token` is null for everyone, so 100% of dispatches take the FALLBACK (Firestore) path. HIT share grows as drivers re-register. This is correct, not a bug.

## Decisions

- **Columns live on the `drivers` table**, not a separate `fcm_tokens` table. The schema file originally carried an "OUT OF SCOPE → fcm_tokens table" comment, but the Phase 4A task explicitly overrode that: add `fcm_token` + `fcm_token_updated_at` directly to `drivers`. The comment was removed.
  **Why:** task instruction was explicit and one-row-per-driver keeps it simple; no multi-device token list was required.

- **Write path is dual-write, mobile-orchestrated.** Mobile `registerDriverPushToken` calls `PATCH /api/drivers/me/fcm-token` (uid derived server-side from the Firebase ID token — never path/body) FIRST, then ALWAYS performs the existing Firestore write. Firestore write was NOT removed.
  **Why:** the FCM dispatcher still reads the token from **Firestore**. Removing the Firestore write here would silently break dispatch. Dispatcher migration is a later phase.

- **`saved` vs `ok` log semantics.** Server returns `{ok:true, saved:true}` only when the UPDATE actually hit a row; `{ok:true, saved:false}` when no `drivers` row exists yet (UPDATE-only, no upsert, because `drivers` requires `phone` NOT NULL on insert). Mobile logs `[PG_FCM_TOKEN_SAVE]` only on `saved===true`, else `[PG_FCM_TOKEN_FALLBACK]`. Do not collapse `saved` back into `ok` — that makes the rollout-verification logs lie (a code review caught exactly this).

## How to apply
- When promoting dispatch to read tokens from PG, only then is it safe to drop the Firestore token write. Until then keep both.
- `drivers/{uid}.fcmToken` (Firestore) and `drivers.fcm_token` (PG) must stay in sync during this phase; the mobile dual-write is the only writer.

## UPDATE 2026-06-27 — mobile Firestore shadow write REMOVED
Per the permanent rule "Firebase in the driver app = Phone OTP/Auth + FCM only", the mobile shadow token write was deleted: `registerDriverPushToken` (notifications.ts) now calls **only** PG `saveDriverFcmToken`; `updateDriverPushToken` was removed from firestore.ts. Mobile is now PG-only for token storage.
- **Consequence:** the SERVER still reads PG-first / Firestore-fallback (`resolveDriverFcmToken`), but for any driver who registers a token AFTER this change, `drivers/{uid}.fcmToken` in Firestore is no longer refreshed — so the Firestore fallback only holds stale tokens from before the change. PG must be authoritative for new tokens.
- **Residual risk (out of mobile scope):** if the PG save returns `saved:false` (no driver row) the token is only reattempted on next login/foreground — no durable client retry, and no Firestore shadow to catch it. Backend fix (upsert the row / require retry-until-saved) was recommended but NOT done (server is a separate artifact; this task was mobile-only, no deploy).
