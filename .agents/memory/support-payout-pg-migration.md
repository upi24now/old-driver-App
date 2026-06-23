---
name: Support + Payout PG migration
description: Patterns and lessons from retiring support.ts + payouts.ts Firestore authority to PostgreSQL.
---

## Rule
For any route that takes a UUID from URL params (`:id`, `:ticketId`), validate the UUID format with a regex before querying PG — Drizzle re-throws a PostgreSQL cast error on non-UUID input, which escapes the catch if the guard is missing.

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(ticketId)) { res.status(404).json({ ok: false, error: "ticket_not_found" }); return; }
```

**Why:** Drizzle does not sanitize invalid UUID strings — they reach the PG wire and cause a `22P02 invalid_text_representation` exception that surfaces as an unhandled 500 without a try/catch.

## Rule
Driver-facing "send message" routes must enforce server-authoritative sender fields — never trust `from` or `senderUid` from the request body.

```typescript
const safeFrom      = "user";
const safeSenderUid = authedUid;   // from Firebase ID token, never from body
```

**Why:** Without enforcement a driver can set `from: "support"` to impersonate agents, corrupting conversation integrity in both PG and the FS projection.

## Rule
Every PG service call in a route handler must be wrapped in try/catch that returns `{ ok: false, error: "server_error" }` — the service re-throws infra errors (correct) so the route must catch them before Express's default handler leaks details.

**Why:** Express's default error middleware can surface stack traces in non-production environments; explicit 500 sanitization prevents this at each call site.

## Payout atomic pattern (pgRequestPayout)
`SELECT … FOR UPDATE` on `driver_wallets` inside a Drizzle `db.transaction()` provides row-level locking for concurrent payout prevention. Balance check uses `parseFloat()` on the NUMERIC string Drizzle returns. Wallet debit + payout_requests insert + wallet_transactions insert are atomic in one transaction.

## FS projection pattern
All Firestore writes are demoted to `void (async () => { try { … } catch (e) { req.log.warn(…) } })()` — a self-invoked async IIFE that can never block the response or surface to the caller. The PG UUID becomes the Firestore doc ID for tickets/requests so the two stores stay cross-referenceable.
