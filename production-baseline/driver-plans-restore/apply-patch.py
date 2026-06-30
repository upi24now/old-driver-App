#!/usr/bin/env python3
"""
apply-patch.py — Additive restore of the driver-plans routes into the live VPS bundle.

WHAT IT DOES
  Splices production-baseline/driver-plans-restore/INSERTED-BLOCK.js into the live
  esbuild bundle IMMEDIATELY AFTER the pino-http middleware registration, so the
  restored driver-plans handlers register before any (re)mounted "/api" router and
  win Express first-match-wins.

SAFETY (never breaks a working server)
  - Idempotent: aborts with exit 0 if the restore marker is already present.
  - Self-locating: finds the exact pino-http splice anchor; aborts if not found.
  - Self-verifying: confirms the two HARD-required bindings (Express `app`, pg `pool`)
    actually exist in the target; aborts if either is missing rather than producing a
    broken bundle. The block is PG-ONLY (no Firestore db2/FieldValue) and resolves auth +
    Razorpay defensively at runtime (typeof-guarded), so those are detected for INFO only,
    never hard-required.
  - Non-destructive: writes a NEW file (production-api.PATCHED.js); never edits in place.
  - Prints sha256 before/after and byte delta for an auditable diff.

USAGE
  python3 apply-patch.py /path/to/production-api.js [/path/to/production-api.PATCHED.js]

  Defaults:
    SRC = ./production-api.js
    OUT = ./production-api.PATCHED.js
"""
import sys, os, re, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
BLOCK_FILE = os.path.join(HERE, "INSERTED-BLOCK.js")

SRC = sys.argv[1] if len(sys.argv) > 1 else "production-api.js"
OUT = sys.argv[2] if len(sys.argv) > 2 else "production-api.PATCHED.js"

RESTORE_MARKER = "[BCD-PLANS-RESTORE]"

def die(code, msg):
    print("ABORT: " + msg)
    sys.exit(code)

if not os.path.isfile(SRC):
    die(2, "source bundle not found: " + SRC)
if not os.path.isfile(BLOCK_FILE):
    die(2, "INSERTED-BLOCK.js not found next to this script.")

with open(SRC, "r", encoding="utf-8") as f:
    code = f.read()
with open(BLOCK_FILE, "r", encoding="utf-8") as f:
    block = f.read()

# 1) Idempotency -------------------------------------------------------------
if RESTORE_MARKER in code:
    print("ALREADY PATCHED: restore marker '%s' present — no changes made." % RESTORE_MARKER)
    sys.exit(0)
if 'app.post("/api/driver-plans/create-order"' in code or "app.post('/api/driver-plans/create-order'" in code:
    print("NOTE: a create-order route already exists in this bundle.")
    print("      If the app still 404s, the existing handler may be unreachable; inspect before forcing.")
    print("ABORT (safety): refusing to double-register. Remove the stale handler or rename the marker to force.")
    sys.exit(0)

# 2) Locate splice anchor (pino-http middleware) -----------------------------
#    Matches:  app.use((0, import_pino_http<NN>.default)({ logger }));
anchor_re = re.compile(
    r'app\.use\(\(0,\s*import_pino_http\w*\.default\)\(\s*\{\s*logger\s*\}\s*\)\s*\)\s*;'
)
m = anchor_re.search(code)
if not m:
    # Fallback: any pino-http app.use(...) on a single statement.
    anchor_re2 = re.compile(r'app\.use\([^\n;]*pino_http[^\n;]*\)\s*;')
    m = anchor_re2.search(code)
if not m:
    die(3, "could not locate the pino-http middleware splice anchor. "
           "Send me the ~30 lines around the Express app setup (the app.use(...) block) "
           "so the anchor/bindings can be matched to this build.")

# 3) Verify HARD-required bindings exist in the target -----------------------
#    The block is PG-only and resolves auth + Razorpay defensively at runtime
#    (typeof-guarded, with require() fallbacks), so the ONLY bindings it truly
#    needs to exist at the splice scope are the Express `app` and the pg `pool`.
#    It does NOT use Firestore (db2 / FieldValue) at all.
required = {
    "express app (app.post/get/use)": re.compile(r'\bapp\.(post|get|use)\('),
    "pg Pool binding `pool`":          re.compile(r'\bpool\b'),
}
missing = [name for name, rx in required.items() if not rx.search(code)]
if missing:
    die(4, "the block reuses bindings that are NOT present in this build:\n  - "
           + "\n  - ".join(missing)
           + "\nThis bundle is missing the Express app/pg pool the block needs. "
             "Send me the Express setup region + the `var pool =` line so it can be rebound.")

# 3b) Informational only (NEVER fatal): report which auth / Razorpay patterns
#     the runtime resolver is expected to bind to in this build.
auth_signals = [
    ("__dsRequireDriver gate", r'__dsRequireDriver'),
    ("auth.verifyIdToken",     r'verifyIdToken'),
    ("firebase-admin present", r'firebase-admin'),
]
razorpay_signals = [
    ("import_razorpay binding", r'\bimport_razorpay\b'),
    ('require("razorpay")',     r'razorpay'),
]
auth_found = [name for name, rx in auth_signals if re.search(rx, code)]
rzp_found  = [name for name, rx in razorpay_signals if re.search(rx, code)]
print("INFO: auth verify patterns detected in target : "
      + (", ".join(auth_found) if auth_found else "NONE (runtime require(\"firebase-admin\") fallback will be used)"))
print("INFO: Razorpay patterns detected in target     : "
      + (", ".join(rzp_found) if rzp_found else "NONE (runtime require(\"razorpay\") fallback will be used)"))

# 4) Splice ------------------------------------------------------------------
insert_at = m.end()
patched = code[:insert_at] + "\n\n" + block + "\n" + code[insert_at:]

with open(OUT, "w", encoding="utf-8") as f:
    f.write(patched)

sha_before = hashlib.sha256(code.encode("utf-8")).hexdigest()
sha_after  = hashlib.sha256(patched.encode("utf-8")).hexdigest()

print("OK: driver-plans routes spliced.")
print("  anchor matched : %r" % code[m.start():m.end()])
print("  spliced after byte offset: %d (line %d)" % (insert_at, code[:insert_at].count("\n") + 1))
print("  src  : %s" % SRC)
print("  out  : %s" % OUT)
print("  sha256 before : %s" % sha_before)
print("  sha256 after  : %s" % sha_after)
print("  bytes added   : %d" % (len(patched) - len(code)))
print()
print("NEXT:")
print("  node --check %s        # syntax-validate the patched bundle" % OUT)
print("  # then on the VPS: back up the live file, move %s into place, pm2 restart bike-courier-api" % os.path.basename(OUT))
