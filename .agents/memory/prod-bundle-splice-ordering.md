---
name: Prod-bundle additive patch splice ordering
description: Why an additive route override in the prod bundle can silently do nothing, and where to splice it.
---

# Prod-bundle additive patch — splice ordering vs. pre-existing overrides

When adding an additive route OVERRIDE to the production bundle
(`production-baseline/.../production-api.js`), splicing "before
`app.use("/api", routes_default)`" is NOT enough to win routing.

**Why:** the base bundle already ships its OWN additive overrides for some auth
routes (e.g. a prior driver-orders patch adds `/api/auth/send-otp` +
`/api/auth/verify-otp` right after the global middleware). Express is
first-match-wins by REGISTRATION ORDER. A block spliced before the `/api` mount
but AFTER those pre-existing overrides registers second → the OLD handler serves
the request and your override is dead code (symptoms: response missing your new
fields, no new DB writes, no rate-limit — but brand-new routes in the same block
work fine because they have no competitor).

**How to apply:** splice the block immediately AFTER the last global middleware
`app.use((0, import_pino_http.default)({ logger }));` (i.e. after `express.json()`
so `req.body` is parsed) and BEFORE any pre-existing override. Confirm ordering by
grepping the regenerated bundle: your `app.post("/api/auth/...")` line numbers must
be SMALLER than the base block's. Wrapping a hoisted `async function
__dsRequireDriver(...)` from the earlier point is safe (function declarations are
hoisted, so the binding exists at module-execution time regardless of splice line).

**Byte-safety proof gotcha:** asserting the first differing byte is EXACTLY at the
splice offset is too strict — if the block's leading bytes coincide with the bytes
following the anchor (both began `\n// `), the first diff legitimately lands a few
bytes later. Correct invariant: `first_diff >= splice && first_diff <
splice+len(block)`, plus prefix/suffix bit-identity and `len(out)==len(base)+len(block)`.

**Verification gotcha:** a `nohup` background server started in one bash tool call
is reaped when that call returns. Boot AND run the curl matrix in a SINGLE bash
call (or the server is dead → HTTP 000 on the next call).
