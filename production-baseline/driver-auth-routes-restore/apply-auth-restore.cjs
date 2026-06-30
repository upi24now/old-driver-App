#!/usr/bin/env node
"use strict";
/*
 * Surgical RESTORE of the driver `/api/auth/*` routes into the live VPS bundle.
 *
 * Why this exists:
 *   The live `api-pkg/dist/production-api.js` lost its entire `/api/auth/*`
 *   router (every login call -> 404). This re-splices ONLY those routes back in,
 *   additively, immediately BEFORE the bundle's `app.use("/api", routes_default)`
 *   (i.e. before the catch-all 404).
 *
 * Restored routes (and ONLY these):
 *   POST /api/auth/send-otp
 *   POST /api/auth/verify-otp
 *   POST /api/auth/set-pin
 *   GET  /api/auth/pin-status
 *   POST /api/auth/verify-pin
 *
 * Drift-tolerant by design (the live bundle drifts ahead of every local copy):
 *   - NO base-SHA hard assertion. Locates the splice point by a unique anchor.
 *   - Idempotent: re-running is a safe no-op once applied.
 *   - Does NOT depend on the bundle's minified express var name (e.g.
 *     import_express34 vs import_express33). express is resolved at runtime via
 *     globalThis.require("express") and shimmed to expose `.default`.
 *   - Still reuses the bundle's module-scope `app`, `pool` (pg Pool) and
 *     `auth` (Firebase Admin Auth) bindings (stable across additive patches);
 *     aborts loudly if `pool` is not found, rather than shipping a crashing boot.
 *
 * Purely additive: 0 deletions, 0 modifications to any existing route. Removing
 * the inserted block reproduces the base byte-for-byte (self-proven below).
 *
 * Usage:
 *   node apply-auth-restore.cjs [path/to/production-api.js]
 * If no path is given it auto-locates dist/production-api.js next to this script,
 * one level up, or under the current working directory.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const BODY_PATH = path.join(HERE, "auth-routes-body.js");

const ANCHOR = 'app.use("/api", routes_default);';
const BEGIN = "\n// ===== BEGIN PG-ONLY AUTH ROUTES RESTORE PATCH =====\n";
const END = "\n// ===== END PG-ONLY AUTH ROUTES RESTORE PATCH =====\n";
const MARKER = "BEGIN PG-ONLY AUTH ROUTES RESTORE PATCH";
const SENTINEL_ROUTE = 'authRouter.post("/auth/verify-pin"';

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
      "  node apply-auth-restore.cjs /path/to/api-pkg/dist/production-api.js"
  );
}

function main() {
  const target = resolveTarget();
  if (!fs.existsSync(BODY_PATH)) {
    throw new Error("Missing auth-routes-body.js next to this script: " + BODY_PATH);
  }
  const body = fs.readFileSync(BODY_PATH, "utf8");
  const orig = fs.readFileSync(target);
  const text = orig.toString("utf8");

  // 1) Idempotency — never double-apply.
  if (text.indexOf(MARKER) !== -1 || text.indexOf(SENTINEL_ROUTE) !== -1) {
    console.log("[SKIP] /api/auth/* routes already present in:\n  " + target);
    console.log("       No changes made (idempotent).");
    return;
  }

  // 2) Anchor must exist exactly once.
  const anchorCount = text.split(ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error(
      "ABORT: anchor occurrences = " +
        anchorCount +
        ' (expected exactly 1). Anchor: ' +
        JSON.stringify(ANCHOR)
    );
  }

  // 3) Pre-write binding/runtime safety. These all HARD-fail before any write so
  //    we never leave a crashing bundle on disk. The inserted IIFE is called with
  //    `(app, <express shim>, pool, auth)` and the body uses globalThis.require —
  //    every one of those must be satisfiable in the target's runtime.

  // 3a) module-scope `pool` (pg Pool) — used by many other routes too.
  if (text.indexOf("pool.query(") === -1) {
    throw new Error(
      "ABORT: bundle has no `pool.query(` usage — module-scope `pool` binding " +
        "not found. Refusing to patch (would crash at boot)."
    );
  }
  // 3b) module-scope `auth` (Firebase Admin Auth) — declared `auth = getAuth(...)`
  //     in base, or used as auth.createCustomToken / auth.verifyIdToken.
  const hasAuthBinding =
    /(?:^|[^.\w])auth\s*=\s*getAuth\(/.test(text) ||
    text.indexOf("auth.createCustomToken") !== -1 ||
    text.indexOf("auth.verifyIdToken") !== -1;
  if (!hasAuthBinding) {
    throw new Error(
      "ABORT: could not confirm a module-scope `auth` (Firebase Admin) binding. " +
        "Refusing to patch (would crash at boot)."
    );
  }
  // 3c) module-scope `app` (express app) — proven by the anchor itself, asserted
  //     explicitly for clarity.
  if (!/(?:^|[^.\w])app\b/.test(text)) {
    throw new Error("ABORT: module-scope `app` binding not found.");
  }
  // 3d) runtime must provide globalThis.require (the body and the express shim
  //     both rely on it). The esbuild banner sets it; if absent, the body throws
  //     at module eval. Refuse rather than risk a boot crash.
  if (text.indexOf("globalThis.require") === -1) {
    throw new Error(
      "ABORT: bundle does not reference `globalThis.require` — the auth body " +
        "(globalThis.require('node:crypto')) would throw at boot. Refusing to patch."
    );
  }

  // 4) Resolve express at runtime (drift-safe). The body uses
  //    `import_express34.default.Router()`; we pass a shim whose `.default` is the
  //    express callable, so the bundle's own express var name is irrelevant.
  //    Prefer globalThis.require, fall back to a local require if present.
  const expressArg =
    "(function(){" +
    "var __req=(typeof globalThis!=='undefined'&&globalThis.require)?globalThis.require:" +
    "(typeof require!=='undefined'?require:null);" +
    "if(!__req)throw new Error('[AUTH_PATCH] no require available to load express');" +
    'var __e=__req("express");' +
    "return (__e&&__e.default)?__e:{default:__e};})()";

  const wrapped =
    BEGIN +
    "(function(app, import_express34, pool, auth){\n" +
    body +
    "\n})(app, " +
    expressArg +
    ", pool, auth);" +
    END;

  const idx = text.indexOf(ANCHOR);
  const patchedText = text.slice(0, idx) + wrapped + "\n" + text.slice(idx);
  const patched = Buffer.from(patchedText, "utf8");

  // 5) Byte-safety self-proof: removing the inserted region MUST reproduce the
  //    base. Abort BEFORE writing anything if this does not hold.
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
  const bak = target + ".bak.auth-restore." + stamp;
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
