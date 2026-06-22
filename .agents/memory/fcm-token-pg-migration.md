---
name: FCM token PG migration (Phase 4A)
description: How driver push-token storage was moved from Firestore to Postgres, and what is intentionally still shadowed.
---

# FCM push-token storage — Firestore → Postgres (Phase 4A)

Driver Expo/FCM push tokens are now written to **both** Postgres and Firestore. Postgres is the new primary store; Firestore is kept as a shadow/fallback.

## Decisions

- **Columns live on the `drivers` table**, not a separate `fcm_tokens` table. The schema file originally carried an "OUT OF SCOPE → fcm_tokens table" comment, but the Phase 4A task explicitly overrode that: add `fcm_token` + `fcm_token_updated_at` directly to `drivers`. The comment was removed.
  **Why:** task instruction was explicit and one-row-per-driver keeps it simple; no multi-device token list was required.

- **Write path is dual-write, mobile-orchestrated.** Mobile `registerDriverPushToken` calls `PATCH /api/drivers/me/fcm-token` (uid derived server-side from the Firebase ID token — never path/body) FIRST, then ALWAYS performs the existing Firestore write. Firestore write was NOT removed.
  **Why:** the FCM dispatcher still reads the token from **Firestore**. Removing the Firestore write here would silently break dispatch. Dispatcher migration is a later phase.

- **`saved` vs `ok` log semantics.** Server returns `{ok:true, saved:true}` only when the UPDATE actually hit a row; `{ok:true, saved:false}` when no `drivers` row exists yet (UPDATE-only, no upsert, because `drivers` requires `phone` NOT NULL on insert). Mobile logs `[PG_FCM_TOKEN_SAVE]` only on `saved===true`, else `[PG_FCM_TOKEN_FALLBACK]`. Do not collapse `saved` back into `ok` — that makes the rollout-verification logs lie (a code review caught exactly this).

## How to apply
- When promoting dispatch to read tokens from PG, only then is it safe to drop the Firestore token write. Until then keep both.
- `drivers/{uid}.fcmToken` (Firestore) and `drivers.fcm_token` (PG) must stay in sync during this phase; the mobile dual-write is the only writer.
