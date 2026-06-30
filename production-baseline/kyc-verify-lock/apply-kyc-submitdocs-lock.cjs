#!/usr/bin/env node
/**
 * apply-kyc-submitdocs-lock.cjs
 *
 * SURGICAL, ADDITIVE, IDEMPOTENT production-bundle patch.
 *
 * Purpose: once a driver is approved/verified, their KYC documents become
 * read-only. This locks the ONLY driver-facing document-mutation route in the
 * CURRENT LIVE VPS bundle:
 *
 *     POST /api/kyc/driver/:uid/submit-documents   (driverAuth)
 *
 * (The legacy /api/kyc/upload-open route does NOT exist on the live server —
 * it returns 404 — so this is the route that must be locked. The actual KYC
 * image bytes are uploaded client-side; this endpoint is the only API path
 * that records a document state change, so locking it blocks server-side
 * re-submit/replace after verification.)
 *
 * After approval the route returns:
 *     403 { error: "Documents are locked after verification." }
 *
 * It touches NOTHING else:
 *   - NOT login / PIN / OTP / auth
 *   - NOT the admin approve / reject routes (those MUST keep working)
 *   - NOT dispatch, orders, plans, Razorpay, wallet, online/offline,
 *     active ride, maps, notifications, customer app, or any other route.
 *
 * verificationStatus and kycStatus are evaluated INDEPENDENTLY (lock if EITHER
 * is "approved" or "verified"). It FAILS CLOSED (503) when the lock status
 * cannot be read, so a DB fault can never let an approved driver re-submit.
 *
 * Self-locating: anchors on the route literal "/driver/:uid/submit-documents"
 * and then on the handler's first statement
 *   const uid = String(req.params["uid"]);
 * so it survives esbuild variable-name drift (router8 / db / eq may be renamed
 * between builds) as long as the route shape exists.
 *
 * Usage:
 *   node apply-kyc-submitdocs-lock.cjs <path-to-bundle.js>
 *   node apply-kyc-submitdocs-lock.cjs            # auto-scan known locations
 *
 * Idempotent: re-running is a no-op once the SENTINEL is present.
 * Backup: writes <file>.submitdocslock.bak once (never overwrites a backup).
 * Rollback: cp <file>.submitdocslock.bak <file>
 */

const fs = require("fs");
const path = require("path");

const SENTINEL = "KYC_SUBMITDOCS_LOCK_V1";
const ROUTE_MARKER = '"/driver/:uid/submit-documents"';
const UID_ANCHOR = 'const uid = String(req.params["uid"]);';
const LOCKED_MESSAGE = "Documents are locked after verification.";

// The additive block. Reuses db / driversTable / eq already in scope in the
// submit-documents handler (verified present: the sibling approve handler uses
// exactly db.update(driversTable)...where(eq(driversTable.uid, ...))).
const BLOCK = [
  "",
  "    // " + SENTINEL + " \u2014 documents are read-only once the driver is approved/verified",
  "    {",
  "      let __kvlRows = null, __kvlErr = false;",
  "      try {",
  "        __kvlRows = await db.select({ vs: driversTable.verificationStatus, ks: driversTable.kycStatus }).from(driversTable).where(eq(driversTable.uid, uid)).limit(1);",
  "      } catch (__e) { __kvlErr = true; }",
  "      if (__kvlErr) {",
  '        res.status(503).json({ error: "Could not verify document lock status. Please try again." });',
  "        return;",
  "      }",
  '      const __vs = String(__kvlRows?.[0]?.vs ?? "").toLowerCase();',
  '      const __ks = String(__kvlRows?.[0]?.ks ?? "").toLowerCase();',
  '      if (__vs === "approved" || __vs === "verified" || __ks === "approved" || __ks === "verified") {',
  '        res.status(403).json({ error: "' + LOCKED_MESSAGE + '" });',
  "        return;",
  "      }",
  "    }",
  "",
].join("\n");

function resolveTargets(argv) {
  if (argv[2]) return [path.resolve(argv[2])];
  const candidates = [
    path.resolve(__dirname, "..", "dist", "production-api.js"),
  ];
  return candidates.filter((p) => {
    if (!fs.existsSync(p)) return false;
    const s = fs.readFileSync(p, "utf8");
    return s.includes(ROUTE_MARKER);
  });
}

function patchOne(file) {
  const src = fs.readFileSync(file, "utf8");

  if (src.includes(SENTINEL)) {
    return { file, status: "skipped (already patched)" };
  }
  const routeIdx = src.indexOf(ROUTE_MARKER);
  if (routeIdx === -1) {
    return { file, status: "FAILED (no submit-documents route)" };
  }

  // Locate the handler's first statement AFTER the route literal, so we never
  // touch an identically-named statement in some other route.
  const anchorIdx = src.indexOf(UID_ANCHOR, routeIdx);
  if (anchorIdx === -1) {
    return { file, status: "FAILED (uid anchor not found after route)" };
  }

  // Guard against drift placing the route literal far from its handler: the
  // anchor must be within a small window of the route registration.
  if (anchorIdx - routeIdx > 400) {
    return { file, status: "FAILED (uid anchor too far from route: " + (anchorIdx - routeIdx) + ")" };
  }

  const insertAt = anchorIdx + UID_ANCHOR.length;

  const backup = file + ".submitdocslock.bak";
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, src);

  const patched = src.slice(0, insertAt) + BLOCK + src.slice(insertAt);
  fs.writeFileSync(file, patched);

  return { file, status: "PATCHED", backup };
}

const targets = resolveTargets(process.argv);
if (targets.length === 0) {
  console.error(
    "No target bundle found (need a file containing the submit-documents route)."
  );
  process.exit(2);
}
for (const t of targets) {
  const r = patchOne(t);
  console.log(
    `${r.status.padEnd(28)} ${path.basename(r.file)}${
      r.backup ? "  (backup: " + path.basename(r.backup) + ")" : ""
    }`
  );
}
