---
name: Drizzle tx.rollback() masks business reasons
description: Why guarded 0-row transaction branches must return directly instead of calling tx.rollback() in this codebase's PG dispatch/order services.
---

# Drizzle tx.rollback() throws — don't use it to signal a business abort

In Drizzle (`db.transaction(async (tx) => …)`), `tx.rollback()` works by
**throwing** a `TransactionRollbackError`. So this common-looking pattern is a bug:

```ts
if (guardedUpdate.length === 0) {
  tx.rollback();
  return { ok: false, reason: "not_assignable" }; // DEAD CODE — never runs
}
```

The throw aborts the callback, `db.transaction` re-throws, and the outer
`catch` returns the generic `{ ok: false, reason: "unknown" }`. The intended
specific reason is silently lost.

**Why:** When a guarded `UPDATE … WHERE <guard>` matches 0 rows, **nothing was
written**. There is no dirty state to roll back. Returning normally commits an
empty (no-op) transaction and preserves the correct typed reason.

**How to apply:** In guarded write services, on a 0-row guard miss just
`return { ok: false, reason }` directly from inside the transaction callback —
do NOT call `tx.rollback()`. Reserve `tx.rollback()` for cases where earlier
writes in the same transaction must be undone (and even then, expect it to throw
and structure code accordingly).

**Known latent instance:** `order-pg-service.ts` (`pgAcceptOffer`) still uses
`tx.rollback(); return { reason }`, so its `not_in_offer` / `already_claimed` /
`expired` reasons currently surface as `unknown` to callers. It is working code
(do-not-touch), tracked as tech debt. The dispatch write services
(`pg-dispatch-service.ts`) use the correct no-rollback pattern — use that as the
template going forward.
