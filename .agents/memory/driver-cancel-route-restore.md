---
name: Driver-cancel route restore
description: How the missing POST /api/orders/:orderId/driver-cancel 404 in production was diagnosed and patched, and the splice-path gotcha it revealed.
---

The live VPS bundle registers some routes (e.g. `accept`, `stage`) directly on
the bare `app`, spliced in BEFORE `app.use("/api", routes_default)`. Those
routes must include the `/api` prefix literally in their own path string —
there is no surrounding `/api` sub-router at that splice point. A patch that
copies the router-mounted convention (path without `/api`) registers at the
wrong URL and silently keeps 404ing even though the patch "applied
successfully" with no errors.

**Why:** `routes_default` is a sub-router only mounted at `/api` further down
in the bundle; anything spliced before that anchor sits at the `app` top
level with no prefix of its own.

**How to apply:** before adding any new additively-spliced route near the
`app.use("/api", routes_default)` anchor, confirm whether sibling routes
already spliced there include `/api` in their own path, and grep-confirm this
rather than assuming — it's easy to get right for a router-based restore
(like `driver-auth-routes-restore`, which wraps its own `authRouter` mounted
at `/api/auth`) and wrong for a bare-`app` splice.

Also: when the user cannot reliably paste raw terminal output back through
chat (answers come back paraphrased/summarized instead of verbatim), stop
asking for more raw pastes and instead ship a single self-contained,
self-verifying Node script that does its own discovery + precondition
checks + abort-if-ambiguous + patch + byte-safety proof in one run, so the
user only has to run one command instead of relay many.
