#!/usr/bin/env python3
"""
Byte-safe ADDITIVE patcher for the LIVE VPS API bundle.

Inserts the __BCD_DRIVER_DELIVERY block (INSERTED-BLOCK.js) IMMEDIATELY BEFORE
the single anchor line:

    app2.use("/api", routes_default);

so the driver-facing routes register BEFORE the /api router mount (first-match
wins) and the dispatch poller starts on boot.

Guarantees:
  * Reads/writes bytes only (no re-encoding, no reformatting).
  * Aborts unless the anchor occurs EXACTLY once.
  * Aborts if the marker is already present (idempotent — never double-patches).
  * Writes a .bak of the original and prints SHA256 of input and output.
  * Does NOT modify any other byte of the bundle.

Usage:
    python3 apply-patch.py <input-bundle.js> [output-bundle.js]

If output is omitted, writes "<input>.patched.js".
"""

import hashlib
import os
import sys

ANCHOR = b'app2.use("/api", routes_default);'
MARKER = b"__BCD_DRIVER_DELIVERY"
BLOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "INSERTED-BLOCK.js")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: apply-patch.py <input-bundle.js> [output-bundle.js]", file=sys.stderr)
        return 2

    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else in_path + ".patched.js"

    with open(in_path, "rb") as f:
        original = f.read()
    with open(BLOCK_FILE, "rb") as f:
        block = f.read()

    print(f"[patch] input         : {in_path}")
    print(f"[patch] input bytes   : {len(original)}")
    print(f"[patch] input sha256  : {sha256(original)}")

    # --- preconditions ---------------------------------------------------
    if MARKER in original:
        print("[patch] ABORT: marker already present — bundle is already patched.", file=sys.stderr)
        return 1

    count = original.count(ANCHOR)
    if count != 1:
        print(f"[patch] ABORT: anchor found {count} times (expected exactly 1).", file=sys.stderr)
        return 1

    if MARKER not in block:
        print("[patch] ABORT: INSERTED-BLOCK.js is missing its marker.", file=sys.stderr)
        return 1

    # --- splice ----------------------------------------------------------
    idx = original.index(ANCHOR)
    # Insert the block (followed by a newline) immediately before the anchor.
    injected = block if block.endswith(b"\n") else block + b"\n"
    patched = original[:idx] + injected + original[idx:]

    # --- post-conditions: every original byte preserved, in order --------
    assert patched[:idx] == original[:idx], "prefix changed"
    assert patched[idx + len(injected):] == original[idx:], "suffix changed"
    assert patched.count(ANCHOR) == 1, "anchor count changed"
    assert MARKER in patched, "marker missing after patch"

    bak_path = in_path + ".bak"
    if not os.path.exists(bak_path):
        with open(bak_path, "wb") as f:
            f.write(original)
        print(f"[patch] backup        : {bak_path}")

    with open(out_path, "wb") as f:
        f.write(patched)

    print(f"[patch] output        : {out_path}")
    print(f"[patch] output bytes  : {len(patched)} (+{len(patched) - len(original)})")
    print(f"[patch] output sha256 : {sha256(patched)}")
    print(f"[patch] block bytes   : {len(injected)}")
    print(f"[patch] block sha256  : {sha256(injected)}")
    print("[patch] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
