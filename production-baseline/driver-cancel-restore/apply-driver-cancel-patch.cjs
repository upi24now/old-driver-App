#!/usr/bin/env node
"use strict";
/*
 * Surgical ADD of the missing driver-cancel route into the live VPS bundle.
 *
 * Why this exists:
 *   The live api-pkg/dist/production-api.js has POST /api/orders/:orderId/accept
 *   and PATCH /api/orders/:orderId/stage as top-level routes, but is MISSING
 *   POST /api/orders/:orderId/driver-cancel entirely -> every call 404s.
 *   This adds ONLY that one route, additively, immediately before the
 *   bundle's `app.use("/api", routes_default)` (i.e. before the catch-all 404),
 *   matching where the existing accept/stage routes are registered.
 *
 * Drift-tolerant by design (the live bundle drifts ahead of every local copy):
 *   - NO base-SHA hard assertion. Locates the splice point by a unique anchor.
 *   - Idempotent: re-running is a safe no-op once applied.
 *   - Reuses the bundle's own module-scope `app`, `pool` (pg Pool) and
 *     `driverAuth` middleware (already used by other driver routes) — aborts
 *     loudly if any of these are not found, rather than shipping a bundle
 *     that would crash at boot.
 *
 * Purely additive: 0 deletions, 0 modifications to any existing route.
 * Removing the inserted block reproduces the base byte-for-byte (self-proven
 * below before anything is written to disk).
 *
 * Usage:
 *   node apply-driver-cancel-patch.cjs [path/to/production-api.js]
 * If no path is given it auto-locates dist/production-api.js next to this
 * script, one level up, or under the current working directory.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const BODY_PATH = path.join(HERE, "driver-cancel-route-body.js");

const ANCHOR = 'app.use("/api", routes_default);';
const BEGIN = "\n// ===== BEGIN DRIVER-CANCEL ROUTE ADD PATCH =====\n";
const END = "\n// ===== END DRIVER-CANCEL ROUTE ADD PATCH =====\n";
const MARKER = "BEGIN DRIVER-CANCEL ROUTE ADD PATCH";
const SENTINEL_ROUTE = '"/api/orders/:orderId/driver-cancel"';

function sha(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function resolveTarget() {
  const candidates = [
    process.argv[2],
    path.join(HERE, "dist", "production-api.js"),
    path.join(HERE, "..", "dist", "production-api.js"),
    path.join(process.cwd(), "dist", "production-api.js"),
    path.join(process.cwd(), "production-api.js"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  throw new Error(
    "Could not locate production-api.js. Pass it explicitly:\n" +
      "  node apply-driver-cancel-patch.cjs /path/to/api-pkg/dist/production-api.js"
  );
}

function main() {
  const target = resolveTarget();
  if (!fs.existsSync(BODY_PATH)) {
    throw new Error("Missing driver-cancel-route-body.js next to this script: " + BODY_PATH);
  }
  const body = fs.readFileSync(BODY_PATH, "utf8");
  const orig = fs.readFileSync(target);
  const text = orig.toString("utf8");

  // 1) Idempotency — never double-apply.
  if (text.indexOf(MARKER) !== -1 || text.indexOf(SENTINEL_ROUTE) !== -1) {
    console.log("[SKIP] driver-cancel route already present in:\n  " + target);
    console.log("       No changes made (idempotent).");
    return;
  }

  // 2) Anchor must exist exactly once (as a real statement, not inside a
  //    comment — the live bundle has ONE comment that mentions this same
  //    text without the trailing semicolon, so matching WITH the semicolon
  //    disambiguates it).
  const anchorCount = text.split(ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error(
      "ABORT: anchor occurrences = " +
        anchorCount +
        " (expected exactly 1). Anchor: " +
        JSON.stringify(ANCHOR)
    );
  }

  // 3) Pre-write binding/runtime safety checks. All HARD-fail before any
  //    write so we never leave a crashing bundle on disk.
  if (text.indexOf("pool.query(") === -1) {
    throw new Error(
      "ABORT: bundle has no `pool.query(` usage — module-scope `pool` binding " +
        "not found. Refusing to patch (would crash at boot)."
    );
  }
  if (!/async function driverAuth\s*\(/.test(text)) {
    throw new Error(
      "ABORT: could not find `async function driverAuth(` in the bundle. " +
        "Refusing to patch (would crash at boot referencing an undefined middleware)."
    );
  }
  if (!/(?:^|[^.\w])app\b/.test(text)) {
    throw new Error("ABORT: module-scope `app` binding not found.");
  }
  // The route body relies on `orders` having a `driver_uid` and
  // `active_offer_driver_uids` column (raw SQL, not ORM) — confirmed present
  // via the bundle's own accept/offer-matching queries.
  if (text.indexOf("active_offer_driver_uids") === -1) {
    throw new Error(
      "ABORT: bundle has no `active_offer_driver_uids` column reference — " +
        "cannot confirm the orders table schema this route assumes. Refusing to patch."
    );
  }

  // 4) Wrap the route body in an IIFE closing over the bundle's own
  //    module-scope `app`, `pool`, and `driverAuth` bindings (all confirmed
  //    present above), so no new global names are introduced.
  const wrapped =
    BEGIN +
    "(function(app, pool, driverAuth){\n" +
    body +
    "\n})(app, pool, driverAuth);" +
    END;

  const idx = text.indexOf(ANCHOR);
  const patchedText = text.slice(0, idx) + wrapped + "\n" + text.slice(idx);
  const patched = Buffer.from(patchedText, "utf8");

  // 5) Byte-safety self-proof: removing the inserted region MUST reproduce
  //    the base. Abort BEFORE writing anything if this does not hold.
  const bidx = patchedText.indexOf(BEGIN);
  const eidx = patchedText.indexOf(END) + END.length;
  const reconstructed =
    patchedText.slice(0, bidx) + patchedText.slice(eidx).replace(/^\n/, "");
  const byteSafe = reconstructed === text;
  if (!byteSafe) {
    throw new Error(
      "ABORT: byte-safety reconstruction failed (removing the inserted block " +
        "did not reproduce the base). Nothing was written."
    );
  }

  // 6) Backup current, then write patched in place.
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const bak = target + ".bak.driver-cancel." + stamp;
  fs.writeFileSync(bak, orig);
  fs.writeFileSync(target, patched);

  console.log("TARGET          : " + target);
  console.log("BACKUP          : " + bak);
  console.log("BASE  sha256    : " + sha(orig));
  console.log("PATCHED sha256  : " + sha(patched));
  console.log("Inserted bytes  : " + (patched.length - orig.length));
  console.log(
    "BYTE-SAFE       : " +
      (byteSafe
        ? "yes (removing the inserted block reproduces the base byte-for-byte)"
        : "NO — inspect before deploy!")
  );
  if (!byteSafe) process.exit(2);
  console.log("\nDONE. Now run:  node --check " + JSON.stringify(target));
}

main();
