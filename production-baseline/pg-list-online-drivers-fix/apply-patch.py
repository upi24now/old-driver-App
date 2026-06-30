#!/usr/bin/env python3
"""
Fix pgListOnlineDrivers() in the live VPS bundle.

ROOT CAUSE
----------
pgListOnlineDrivers() reads the `driver_presence` table, which does NOT exist in
the live PostgreSQL schema. The query returns 0 rows, so the dispatch driver
filter logs `[DISPATCH DRIVER FILTER] totalOnline: 0` and no driver is ever
considered online.

FIX
---
Replace ONLY the body of pgListOnlineDrivers() with a read from the tables that
DO exist on the live DB:

    SELECT dl.driver_uid, dl.lat, dl.lng, dl.accuracy, dl.is_online,
           d.vehicle_id, d.vehicle_name, d.verification_status, d.account_status
    FROM driver_locations dl
    JOIN drivers d ON d.uid = dl.driver_uid
    WHERE dl.is_online = true

and map each row to the exact shape the dispatch code expects (see NEW_BODY).
The function's NAME and SIGNATURE (parameter list) are preserved byte-for-byte;
only the body between its outer braces is swapped. Nothing else in the bundle is
touched (route, matching, FCM, offers, timers, accept/reject, response JSON are
all in other functions and are left byte-identical).

SAFETY
------
* Self-locating: keys on the `pgListOnlineDrivers` DECLARATION, not a whole-file
  hash, so it runs against the REAL live bundle regardless of unrelated drift.
* Pre-flight: the declaration must occur exactly once AND its original body must
  reference `driver_presence` (proof it is the broken function). Otherwise ABORT
  and change nothing.
* Post-flight: new body must reference `driver_locations` and must NOT reference
  `driver_presence`.
* Writes a .bak and a separate PATCHED file; prints a unified diff for review.
* Run `node --check` on the output before restarting PM2 (see README_DEPLOY.md).

Usage:
    python3 apply-patch.py [INPUT_BUNDLE] [OUTPUT_BUNDLE]
    # defaults: INPUT  = ./production-api.BASE.js
    #           OUTPUT = ./production-api.PATCHED.js
"""
import sys, re, hashlib, pathlib, difflib

HERE = pathlib.Path(__file__).resolve().parent
inp  = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "production-api.BASE.js"
outp = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "production-api.PATCHED.js"

# The raw node-postgres Pool binding present at top-level scope in the bundle
# (var pool = new Pool({...})). Used by 20+ existing pool.query(...) call sites.
POOL = "pool"

SQL = ("SELECT dl.driver_uid, dl.lat, dl.lng, dl.accuracy, dl.is_online, "
       "d.vehicle_id, d.vehicle_name, d.verification_status, d.account_status "
       "FROM driver_locations dl JOIN drivers d ON d.uid = dl.driver_uid "
       "WHERE dl.is_online = true")

# New function body (everything BETWEEN the outer { } of the function).
# TEMPORARY debug logging is intentional (goes to PM2 stdout) so totalOnline can
# be verified after deploy; it does not alter the returned objects.
NEW_BODY = (
    '\n'
    '  console.log("[pgListOnlineDrivers] entered");\n'
    '  const __sql = ' + repr(SQL).replace("'", '"') + ';\n'
    '  console.log("[pgListOnlineDrivers] querying driver_locations JOIN drivers:", __sql);\n'
    '  const __res = await ' + POOL + '.query(__sql);\n'
    '  const __rows = (__res && __res.rows) ? __res.rows : [];\n'
    '  console.log("[pgListOnlineDrivers] row count:", __rows.length);\n'
    '  const __out = __rows.map(function(r) {\n'
    '    var __isBike = r.vehicle_id === "bike";\n'
    '    var __o = {\n'
    '      id: r.driver_uid,\n'
    '      driverUid: r.driver_uid,\n'
    '      lat: r.lat,\n'
    '      lng: r.lng,\n'
    '      accuracy: r.accuracy,\n'
    '      isOnline: r.is_online,\n'
    '      vehicleId: r.vehicle_id,\n'
    '      vehicleName: r.vehicle_name,\n'
    '      verificationStatus: r.verification_status,\n'
    '      accountStatus: r.account_status,\n'
    '      vehicleProductId: __isBike ? "2w" : r.vehicle_id,\n'
    '      vehicleSlug: __isBike ? "2w" : r.vehicle_id,\n'
    '      vehicleType: __isBike ? "2w" : r.vehicle_name\n'
    '    };\n'
    '    console.log("[pgListOnlineDrivers] row:", JSON.stringify({ driverUid: __o.driverUid, isOnline: __o.isOnline, vehicleProductId: __o.vehicleProductId, vehicleSlug: __o.vehicleSlug, vehicleType: __o.vehicleType, verificationStatus: __o.verificationStatus }));\n'
    '    return __o;\n'
    '  });\n'
    '  console.log("Returning " + __out.length + " online drivers");\n'
    '  return __out;\n'
)


# ---------- JS-aware scanners (skip strings / templates / comments) ----------
def skip_string(s, i, q):
    i += 1
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2; continue
        if c == q:
            return i + 1
        i += 1
    raise ValueError("unterminated string")


def skip_template(s, i):
    i += 1
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2; continue
        if c == "`":
            return i + 1
        if c == "$" and i + 1 < n and s[i + 1] == "{":
            i += 2
            depth = 1
            while i < n and depth > 0:
                d = s[i]
                if d == "\\":
                    i += 2; continue
                if d == "{":
                    depth += 1; i += 1; continue
                if d == "}":
                    depth -= 1; i += 1; continue
                if d in "\"'":
                    i = skip_string(s, i, d); continue
                if d == "`":
                    i = skip_template(s, i); continue
                i += 1
            continue
        i += 1
    raise ValueError("unterminated template")


def match_pair(s, open_idx, opench, closech):
    """Return index just past the matching close of the bracket at open_idx."""
    assert s[open_idx] == opench
    depth = 0
    i = open_idx
    n = len(s)
    while i < n:
        c = s[i]
        if c == opench:
            depth += 1; i += 1; continue
        if c == closech:
            depth -= 1; i += 1
            if depth == 0:
                return i
            continue
        if c in "\"'":
            i = skip_string(s, i, c); continue
        if c == "`":
            i = skip_template(s, i); continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i); i = n if j == -1 else j; continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2); i = n if j == -1 else j + 2; continue
        i += 1
    raise ValueError("no matching %r" % closech)


def find_decl(s):
    """Locate the pgListOnlineDrivers function declaration.
    Returns (start, body_open, body_close, sig_text) where sig_text is the
    verbatim text from declaration start up to and INCLUDING the body-opening
    '{'. body_close is the index just past the function's closing '}'.
    """
    patterns = [
        r"\basync\s+function\s+pgListOnlineDrivers\s*\(",
        r"\bfunction\s+pgListOnlineDrivers\s*\(",
        r"\b(?:var|let|const)\s+pgListOnlineDrivers\s*=\s*async\s+function\b",
        r"\b(?:var|let|const)\s+pgListOnlineDrivers\s*=\s*async\b",
        r"\b(?:var|let|const)\s+pgListOnlineDrivers\s*=\s*function\b",
    ]
    chosen = None
    for pat in patterns:
        ms = list(re.finditer(pat, s))
        if len(ms) == 1:
            chosen = (pat, ms[0]); break
        if len(ms) > 1:
            sys.exit("ABORT: declaration pattern %r matched %d times; refusing to guess." % (pat, len(ms)))
    if not chosen:
        sys.exit("ABORT: could not locate a unique pgListOnlineDrivers declaration. "
                 "Paste the function so it can be patched surgically.")
    pat, m = chosen
    start = m.start()
    # Find the parameter list '(' then skip past it, then find the body '{'.
    paren = s.index("(", m.end() - 1 if s[m.end()-1] == "(" else m.end())
    paren_close = match_pair(s, paren, "(", ")")
    # arrow form may have '=>' before '{'
    body_open = s.index("{", paren_close)
    # guard: nothing but whitespace / '=>' between ')' and '{'
    between = s[paren_close:body_open]
    if not re.fullmatch(r"\s*(=>)?\s*", between):
        sys.exit("ABORT: unexpected tokens between params and body: %r" % between)
    body_close = match_pair(s, body_open, "{", "}")
    sig_text = s[start:body_open + 1]
    return start, body_open, body_close, sig_text


def sha(b):
    return hashlib.sha256(b).hexdigest()


# ------------------------------- main -------------------------------
src = src0 = inp.read_text("utf-8")
base_bytes = src.encode("utf-8")

start, body_open, body_close, sig_text = find_decl(src)
orig_full = src[start:body_close]
orig_body = src[body_open + 1:body_close - 1]

# Pre-flight: confirm this is the BROKEN function (reads driver_presence).
if "driver_presence" not in orig_body and "driverPresenceTable" not in orig_body:
    sys.exit("ABORT: located pgListOnlineDrivers but its body does NOT reference "
             "driver_presence. The live function differs from the expected broken "
             "version; refusing to overwrite. Paste the function for a surgical patch.")

new_full = sig_text + NEW_BODY + "}"
patched = src[:start] + new_full + src[body_close:]

# Post-flight assertions.
if "driver_presence" in (patched[start:start + len(new_full)]):
    sys.exit("ABORT: new function body still references driver_presence.")
if "driver_locations dl JOIN drivers d" not in patched:
    sys.exit("ABORT: new function body missing the expected JOIN; aborting.")
# Exactly one declaration must remain and the rest of the file must be untouched.
if patched[:start] != src[:start] or patched[start + len(new_full):] != src[body_close:]:
    sys.exit("ABORT: bytes outside the function changed; aborting.")

patched_bytes = patched.encode("utf-8")
outp.write_text(patched, "utf-8")

# Unified diff (function region only, for readable review).
diff = difflib.unified_diff(
    orig_full.splitlines(keepends=True),
    new_full.splitlines(keepends=True),
    fromfile="pgListOnlineDrivers (ORIGINAL)",
    tofile="pgListOnlineDrivers (PATCHED)",
)
print("".join(diff))
print("=" * 70)
print(f"INPUT   bytes: {len(base_bytes):>9}  sha256: {sha(base_bytes)}")
print(f"PATCHED bytes: {len(patched_bytes):>9}  sha256: {sha(patched_bytes)}")
print(f"DELTA   bytes: {len(patched_bytes) - len(base_bytes):>+9}")
print(f"FUNCTION span: bytes [{start}, {body_close}) ({body_close - start} bytes replaced)")
print(f"OUT: {outp}")
print("Only the pgListOnlineDrivers body changed; all other bytes are identical.")
