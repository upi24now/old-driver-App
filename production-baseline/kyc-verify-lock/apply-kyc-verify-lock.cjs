#!/usr/bin/env node
/**
 * apply-kyc-verify-lock.cjs
 *
 * SURGICAL, ADDITIVE, IDEMPOTENT production-bundle patch.
 *
 * Purpose: once a driver is approved/verified, their KYC documents become
 * read-only. This locks the ONLY driver-facing document file-write route in the
 * live VPS bundle — POST /api/kyc/upload-open — so an approved driver can no
 * longer replace/re-upload any document. The check is injected into the route's
 * existing pre-multer middleware, so the 403 fires BEFORE multer writes the new
 * file to disk (the verified file is never overwritten).
 *
 * It touches NOTHING else: not login/PIN/auth, dispatch, orders, plans,
 * Razorpay, wallet, online/offline, active ride, customer app, /profile, or any
 * other route. /api/kyc/resubmit already rejects non-rejected drivers, so an
 * approved driver cannot use it; it is intentionally left untouched.
 *
 * Self-locating: anchors on the unique `req.driverUid = rawUid;` assignment that
 * exists only inside the /upload-open pre-multer middleware, so it survives
 * bundle drift as long as that route shape exists.
 *
 * Usage:
 *   node apply-kyc-verify-lock.cjs <path-to-bundle.js>
 *   node apply-kyc-verify-lock.cjs            # auto-scan known attached_assets
 *
 * Idempotent: re-running is a no-op once the SENTINEL is present.
 * Backup: writes <file>.kyclock.bak once (never overwrites an existing backup).
 * Rollback: cp <file>.kyclock.bak <file>
 */

const fs = require("fs");
const path = require("path");

const SENTINEL = "KYC_VERIFY_LOCK_V1";
const ANCHOR = "req.driverUid = rawUid;";
const ROUTE_MARKER = '"/upload-open"';
const LOCKED_MESSAGE = "Documents are locked after verification.";

// The additive block. Reuses db / driversTable / eq already in scope in the
// /upload-open pre-multer middleware. verificationStatus and kycStatus are
// evaluated INDEPENDENTLY (lock if EITHER is approved/verified). It FAILS CLOSED
// (503) when the lock status cannot be read, so a DB fault can never let an
// approved driver replace a document.
const BLOCK = [
  "",
  "    // " + SENTINEL + " \u2014 documents are read-only once the driver is approved/verified",
  "    {",
  "      let __kvlRows = null, __kvlErr = false;",
  "      try {",
  "        __kvlRows = await db.select({ vs: driversTable.verificationStatus, ks: driversTable.kycStatus }).from(driversTable).where(eq(driversTable.uid, rawUid)).limit(1);",
  '      } catch (__e) { __kvlErr = true; req.log.error({ err: __e, uid: rawUid }, "kyc/upload-open: lock-check failed"); }',
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
  const dir = path.resolve(__dirname, "..", "..", "attached_assets");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".bak"))
    .map((f) => path.join(dir, f))
    .filter((p) => {
      const s = fs.readFileSync(p, "utf8");
      return s.includes(ROUTE_MARKER) && s.includes(ANCHOR);
    });
}

function patchOne(file) {
  const src = fs.readFileSync(file, "utf8");

  if (src.includes(SENTINEL)) {
    return { file, status: "skipped (already patched)" };
  }
  if (!src.includes(ROUTE_MARKER)) {
    return { file, status: "skipped (no /upload-open route)" };
  }

  // Scope the anchor to AFTER the /upload-open route literal so we never touch
  // an identically-named assignment in some other route.
  const routeIdx = src.indexOf(ROUTE_MARKER);
  const anchorIdx = src.indexOf(ANCHOR, routeIdx);
  if (anchorIdx === -1) {
    return { file, status: "FAILED (anchor not found after route)" };
  }
  // Sanity: the anchor must be unique in the whole file (guards against drift
  // putting the same assignment in a sibling route).
  const occurrences = src.split(ANCHOR).length - 1;
  if (occurrences !== 1) {
    return { file, status: `FAILED (anchor not unique: ${occurrences} occurrences)` };
  }

  const backup = file + ".kyclock.bak";
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, src);

  const patched = src.slice(0, anchorIdx) + BLOCK.trimStart() + "    " + src.slice(anchorIdx);
  fs.writeFileSync(file, patched);

  return { file, status: "PATCHED", backup };
}

const targets = resolveTargets(process.argv);
if (targets.length === 0) {
  console.error("No target bundle found (need a file containing /upload-open).");
  process.exit(2);
}
for (const t of targets) {
  const r = patchOne(t);
  console.log(`${r.status.padEnd(28)} ${path.basename(r.file)}${r.backup ? "  (backup: " + path.basename(r.backup) + ")" : ""}`);
}
