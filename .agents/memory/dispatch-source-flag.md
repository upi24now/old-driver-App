---
name: DISPATCH_SOURCE feature flag (Phase 5E-B skeleton)
description: The dispatcher cutover feature flag — allowed values, default, and the rule that nothing routes on it yet.
---

# DISPATCH_SOURCE feature flag (Phase 5E-B skeleton)

`DISPATCH_SOURCE` env flag gates a FUTURE PostgreSQL dispatcher cutover. Resolver
lives in `dispatch-source.ts`. Allowed values: `firestore | pg_shadow | pg`.
Missing / empty / invalid → `firestore` (case-insensitive, whitespace-trimmed).

**Skeleton-phase rule: NOTHING routes on this flag.** It is logged once at
startup (`[DISPATCH_SOURCE] value=X effective=Y`) and consumed nowhere else. The
Firestore dispatcher (FCM + round-robin) and PG shadow writer always start
exactly as before regardless of the flag.

**`effective` always equals `value` in this phase** — do NOT downgrade `effective`
based on PG availability here.
**Why:** the phase spec verifies `pg→pg` and `pg_shadow→pg_shadow` in the log; a
DATABASE_URL-based downgrade would break that wherever DB env is absent, and a
logging-only skeleton must not encode routing/downgrade semantics. The future
cutover phase is where `effective` is allowed to diverge from `value`.

**PG-availability check is DATABASE_URL only.** The pg-dispatch-service functions
are statically compiled into the bundle (never actually "missing"), so the only
runtime PG prerequisite that can be absent is the connection string. When
`pg`/`pg_shadow` is requested but `DATABASE_URL` is unset, log a warning —
behavior still unchanged. Don't hard-import pg-dispatch-service into the flag
resolver just to typeof-check it; that adds no signal and couples a config-level
module to the service layer.
