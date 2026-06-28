---
name: VPS bundle patch verification methodology
description: How to verify a byte-safe additive splice into the live VPS production-api ESM bundle without a full boot.
---

# Verifying a byte-safe additive VPS bundle patch

The live API is a standalone esbuild ESM bundle run by PM2 (`bike-courier-api`); patches are
ONE additive block spliced verbatim immediately before `app.use("/api", routes_default);`
(the single `/api` mount anchor) so new routes register ahead of the catch-all 404.

**A full boot of the 8.9MB bundle is NOT required to prove correctness.** Use this layered proof:

1. **Reproduction / byte-safety** — `apply-patch.py <base> <block> out.js` asserts prefix==base[:idx],
   suffix==base[idx:], anchor count==1, len==base+injected; then `sha256sum out.js` must equal the
   delivered patched SHA. This proves the splice changed nothing except the inserted block.
2. **Parse check** — copy patched bundle to `*.mjs` and `node --check` it. Parses ESM without executing
   → proves the splice introduced no syntax error (no boot crash at parse). No live side effects.
3. **Mock harness** — `harness.mjs` loads the REAL `INSERTED-BLOCK.js` text via `new Function` with mock
   bindings (in-memory Firestore/PG mocks) and drives every route through a real express app, asserting
   route registration (401-not-404), money rules, first-wins accept, idempotency, OTP verify.

**Why:** booting the full bundle pulls in firebase-admin + a live pg pool + schedulers and risks side
effects against prod Firebase; the three layers above give deterministic, side-effect-free proof.

**How to apply:**
- **ESM gotcha:** `harness.mjs` does `import express`. ESM resolves bare specifiers by walking up from the
  file's own directory looking for `node_modules` — it does NOT honor `NODE_PATH`. Run the harness from a
  copy placed inside a package that already has `express` (e.g. a temp dir under `artifacts/api-server`,
  whose parent `node_modules` has express); then delete the temp dir. Setting `NODE_PATH` does nothing.
- The combined `453c9c4c` deliverable lives in `production-baseline/driver-combined-453c9c4c/` (+ tarball
  `bike-courier-combined-453c9c4c.tar.gz`): 4 Firestore driver-plans routes (no 409 guard) + 7 delivery
  routes; cash/COD never credit wallet (audit-only `cash_collected` amount 0); settle is idempotent.
