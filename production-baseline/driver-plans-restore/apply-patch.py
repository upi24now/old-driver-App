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
  - Self-verifying: confirms every binding the block reuses (app, pool, import_razorpay,
    auth/verifyIdToken, db2, FieldValue) actually exists in the target; aborts if any
    is missing rather than producing a broken bundle.
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

# 3) Verify required bindings exist in the target ----------------------------
required = {
    "express app (app.post/get/use)": re.compile(r'\bapp\.(post|get|use)\('),
    "pg Pool binding `pool`":          re.compile(r'\bpool\b'),
    "razorpay import `import_razorpay`":re.compile(r'\bimport_razorpay\b'),
    "Firebase auth verifyIdToken":     re.compile(r'verifyIdToken'),
    "Firestore binding `db2`":         re.compile(r'\bdb2\b'),
    "Firestore `FieldValue`":          re.compile(r'\bFieldValue\b'),
}
missing = [name for name, rx in required.items() if not rx.search(code)]
if missing:
    die(4, "the block reuses bindings that are NOT present in this build:\n  - "
           + "\n  - ".join(missing)
           + "\nThis bundle differs from the lineage the block was authored against. "
             "Send me the Express setup region + the `var pool =` / firebase-admin init lines "
             "so the block can be rebound safely.")

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
