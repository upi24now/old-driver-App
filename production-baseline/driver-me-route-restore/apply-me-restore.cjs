#!/usr/bin/env node
/**
 * apply-me-restore.cjs
 *
 * Surgical, additive, drift-tolerant, idempotent RESTORE of ONLY the driver
 * self-profile route:
 *
 *     GET /api/drivers/me
 *
 * WHY: the live VPS bundle (api-pkg/dist/production-api.js) has no "/me" route on
 * its drivers router, so GET /api/drivers/me fell through to the admin-gated
 * router.get("/:uid", adminAuth, ...) (:uid = "me") and returned
 *   403 { error: "Forbidden — account does not have admin access" }
 * for a normal driver's Firebase token. The driver app treats any non-404
 * /drivers/me response as fatal and bounces back to login, so the home screen
 * never loads even though /api/auth/verify-pin returns 200.
 *
 * FIX: register a top-level  app.get("/api/drivers/me", ...)  IMMEDIATELY BEFORE
 * `app.use("/api", routes_default);`. Express matches in registration order, so
 * this handler wins for exactly GET /api/drivers/me and the admin-gated /:uid
 * route is never reached. Auth uses the SAME token issued by verify-pin
 * (auth.verifyIdToken -> decoded.uid); the profile is read PostgreSQL-first from
 * the drivers + driver_documents tables; the response shape matches the mobile
 * app's PgDriverProfile contract.
 *
 * DESIGN (identical guarantees to the auth-routes restore patcher):
 *   - ADDITIVE ONLY (0 deletions). Removing the inserted block reproduces the
 *     base byte-for-byte; the patcher PROVES this and ABORTS before any write if
 *     it does not hold.
 *   - DRIFT-TOLERANT. No base-SHA lock. Splice located by the unique anchor
 *     `app.use("/api", routes_default);`. Reuses only the stable module-scope
 *     bindings `app`, `pool`, `auth` (proven never renamed by additive patches).
 *   - IDEMPOTENT. Re-running is a no-op (marker + route sentinel check).
 *   - SAFE. Hard-fails (no write) if the anchor isn't unique, or if `pool`/`auth`
 *     bindings can't be confirmed.
 *   - Auto-creates a timestamped backup before writing.
 *
 * USAGE:
 *   node apply-me-restore.cjs [path/to/production-api.js]
 *   (defaults to ./dist/production-api.js relative to CWD)
 *
 * TOUCHES NOTHING ELSE: no driver plans, Razorpay, orders, dispatch, offers,
 * wallet, FCM, KYC upload, online/offline, active ride, demo mode, frontend,
 * and NOT /api/auth/* (verify-pin / OTP). Only adds GET /api/drivers/me.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ANCHOR = 'app.use("/api", routes_default);';
const MARKER = "[ME_PATCH]";
const BEGIN = "\n// === [ME_PATCH:BEGIN] GET /api/drivers/me restore (additive) ===\n";
const END = "\n// === [ME_PATCH:END] ===\n";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function main() {
  const target =
    process.argv[2] || path.join(process.cwd(), "dist", "production-api.js");
  const bodyPath = path.join(__dirname, "drivers-me-body.js");

  if (!fs.existsSync(target)) {
    throw new Error("ABORT: target bundle not found: " + target);
  }
  if (!fs.existsSync(bodyPath)) {
    throw new Error("ABORT: route body not found next to patcher: " + bodyPath);
  }

  const text = fs.readFileSync(target, "utf8");
  const body = fs.readFileSync(bodyPath, "utf8");

  // 1) Idempotency: already patched?
  if (text.indexOf(MARKER) !== -1 || text.indexOf('app.get("/api/drivers/me"') !== -1) {
    console.log("[SKIP] GET /api/drivers/me already present in:");
    console.log("  " + target);
    console.log("       No changes made (idempotent).");
    return;
  }

  // 2) Anchor must exist exactly once.
  const anchorCount = text.split(ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error(
      "ABORT: anchor occurrences = " +
        anchorCount +
        " (expected exactly 1). Anchor: " +
        JSON.stringify(ANCHOR)
    );
  }

  // 3) Pre-write binding safety. Hard-fail (no write) so a wrong/incompatible
  //    bundle is never modified.
  // 3a) module-scope `pool` (pg Pool) — the route reads via pool.query(...).
  if (text.indexOf("pool.query(") === -1) {
    throw new Error(
      "ABORT: bundle has no `pool.query(` usage — module-scope `pool` binding " +
        "not found. Refusing to patch (route would crash at boot)."
    );
  }
  // 3b) module-scope `auth` (Firebase Admin Auth) — route calls auth.verifyIdToken.
  const hasAuthBinding =
    /(?:^|[^.\w])auth\s*=\s*getAuth\(/.test(text) ||
    text.indexOf("auth.verifyIdToken") !== -1 ||
    text.indexOf("auth.createCustomToken") !== -1;
  if (!hasAuthBinding) {
    throw new Error(
      "ABORT: could not confirm a module-scope `auth` (Firebase Admin) binding. " +
        "Refusing to patch (route would crash at boot)."
    );
  }
  // 3c) module-scope `app` (express app) — proven by the anchor, asserted explicitly.
  if (!/(?:^|[^.\w])app\b/.test(text)) {
    throw new Error("ABORT: module-scope `app` binding not found.");
  }

  // 4) Wrap the body in an IIFE bound to the stable module bindings. The body
  //    references `app`, `pool`, `auth` — passed in by name here, so the
  //    minified internal var names are irrelevant.
  const wrapped =
    BEGIN +
    "(function(app, pool, auth){\n" +
    body +
    "\n})(app, pool, auth);" +
    END;

  const idx = text.indexOf(ANCHOR);
  const patchedText = text.slice(0, idx) + wrapped + "\n" + text.slice(idx);

  // 5) Byte-safety self-proof: removing the inserted region MUST reproduce the
  //    base. Abort BEFORE writing anything if it does not hold.
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
    .replace(/[:T]/g, "-")
    .replace(/\..+/, "");
  const backup = target + ".bak.me-restore." + stamp;
  fs.copyFileSync(target, backup);

  fs.writeFileSync(target, patchedText, "utf8");

  console.log("TARGET          : " + target);
  console.log("BACKUP          : " + backup);
  console.log("BASE  sha256    : " + sha256(Buffer.from(text, "utf8")));
  console.log("PATCHED sha256  : " + sha256(Buffer.from(patchedText, "utf8")));
  console.log("Inserted bytes  : " + (patchedText.length - text.length));
  console.log(
    "BYTE-SAFE       : yes (removing the inserted block reproduces the base byte-for-byte)"
  );
  console.log("");
  console.log('DONE. Now run:  node --check "' + target + '"');
}

try {
  main();
} catch (err) {
  console.error(String((err && err.message) || err));
  process.exit(1);
}
