#!/usr/bin/env python3
"""
Byte-safe additive patcher for the LIVE production bundle.

Run this ON THE VPS, in the api-pkg dir, against the REAL dist/production-api.js.
It inserts INSERTED-BLOCK.js so the new driver-plans handlers register BEFORE the
base bundle's routes (Express first-match-wins). It NEVER edits the bundle as text:
it splices raw bytes and proves head/tail are bit-identical to the original.

Usage:
  python3 apply-patch.py /path/to/api-pkg/dist/production-api.js

Writes:
  <bundle>.bak.<timestamp>   (backup of the original)
  <bundle>                   (patched, in place)
Prints base + patched SHA256 and byte-safety invariants.

Aborts (touching nothing) if any precondition fails:
  - required bindings `pool` / `auth` not found
  - no usable splice anchor found
  - block already present (idempotency)
"""
import hashlib, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
BLOCK_PATH = os.path.join(HERE, "INSERTED-BLOCK.js")

# Anchors, tried in order. (label, bytes, where) where = "after" | "before".
ANCHORS = [
    ("pino middleware", b"app.use((0, import_pino_http.default)({ logger }));", "after"),
    ("api mount",       b'app.use("/api", routes_default);',                    "before"),
]

def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def fail(msg: str):
    print("ABORT: " + msg)
    sys.exit(1)

def main():
    if len(sys.argv) != 2:
        fail("usage: python3 apply-patch.py /path/to/dist/production-api.js")
    target = sys.argv[1]
    if not os.path.isfile(target):
        fail("bundle not found: " + target)
    if not os.path.isfile(BLOCK_PATH):
        fail("INSERTED-BLOCK.js not found next to this script")

    with open(target, "rb") as f:
        orig = f.read()
    with open(BLOCK_PATH, "rb") as f:
        block = f.read()

    base_sha = sha256(orig)
    print("BASE   bytes=%d sha256=%s" % (len(orig), base_sha))

    # Idempotency: refuse to double-patch.
    if b"__DPA_PLANS" in orig:
        fail("bundle already contains __DPA_PLANS (already patched). Restore the .bak first.")

    # Precondition: the bindings our block reuses must exist.
    if not re.search(rb"\bvar pool\b", orig) and b"pool.query" not in orig:
        fail("could not find `pool` binding in bundle - block needs the pg Pool. Send me the bundle.")
    if not re.search(rb"\bvar auth\b", orig) and b"auth.verifyIdToken" not in orig:
        fail("could not find `auth` binding in bundle - block needs Firebase Admin auth. Send me the bundle.")

    # Report which driver-auth gate the block will use at runtime.
    has_canonical_gate = b"__dsRequireDriver" in orig
    print("driver-auth gate: %s" % (
        "canonical __dsRequireDriver FOUND (single-device session enforcement preserved)"
        if has_canonical_gate else
        "WARNING: __dsRequireDriver NOT found -> block falls back to self-contained verifyIdToken "
        "(no session-replacement check). Confirm the live create-order's gate name before relying on this."
    ))

    # Pick the first anchor that occurs EXACTLY once.
    chosen = None
    for label, anchor, where in ANCHORS:
        n = orig.count(anchor)
        print("anchor [%s] occurrences=%d" % (label, n))
        if n == 1:
            chosen = (label, anchor, where)
            break
    if not chosen:
        fail("no unique splice anchor found; do not guess. Send me the bundle to splice manually.")

    label, anchor, where = chosen
    idx = orig.find(anchor)
    payload = b"\n" + block + b"\n"
    if where == "after":
        splice = idx + len(anchor)
    else:
        splice = idx
    out = orig[:splice] + payload + orig[splice:]

    # Byte-safety invariants.
    assert len(out) == len(orig) + len(payload), "length drift"
    assert out[:splice] == orig[:splice], "prefix changed"
    assert out[splice + len(payload):] == orig[splice:], "suffix changed"
    first_diff = next((i for i in range(min(len(orig), len(out))) if orig[i] != out[i]), min(len(orig), len(out)))
    assert splice <= first_diff < splice + len(payload), "first diff outside splice window"

    ts = time.strftime("%Y%m%d-%H%M%S")
    bak = target + ".bak." + ts
    with open(bak, "wb") as f:
        f.write(orig)
    with open(target, "wb") as f:
        f.write(out)

    patched_sha = sha256(out)
    print("OK splice via [%s] at byte offset %d (first_diff=%d)" % (label, splice, first_diff))
    print("backup written: " + bak)
    print("PATCH  bytes=%d sha256=%s" % (len(out), patched_sha))
    print("next: node --check %s  &&  pm2 reload bike-courier-api --update-env" % target)

if __name__ == "__main__":
    main()
