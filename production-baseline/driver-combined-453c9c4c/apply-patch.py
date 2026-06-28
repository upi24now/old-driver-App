#!/usr/bin/env python3
"""
Byte-safe ADDITIVE patcher for the live VPS bundle 453c9c4c.

Splices INSERTED-BLOCK.js verbatim immediately BEFORE the single anchor line
  app.use("/api", routes_default);
so the new driver-plans + delivery routes register on `app` ahead of the
catch-all 404. NO existing byte is modified — the output is byte-identical to
the base except for the inserted block (+ surrounding newlines).

Usage:
  python3 apply-patch.py <base.js> <inserted-block.js> <out.js>
"""
import sys, hashlib, pathlib

ANCHOR = b'app.use("/api", routes_default);'

def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def main():
    if len(sys.argv) != 4:
        print("usage: apply-patch.py <base.js> <inserted-block.js> <out.js>", file=sys.stderr)
        sys.exit(2)
    base_p, block_p, out_p = map(pathlib.Path, sys.argv[1:4])

    base = base_p.read_bytes()
    block = block_p.read_bytes()

    n = base.count(ANCHOR)
    if n != 1:
        print(f"ABORT: anchor found {n} times (expected exactly 1)", file=sys.stderr)
        sys.exit(1)

    idx = base.index(ANCHOR)
    # Splice: everything up to the anchor, then the block on its own lines, then
    # the anchor and the remainder — untouched.
    injected = b"\n// ==== [BCD] BEGIN combined additive patch ====\n" + block + \
               b"\n// ==== [BCD] END combined additive patch ====\n"
    patched = base[:idx] + injected + base[idx:]

    # Invariants: output = base with exactly `injected` inserted at idx.
    assert patched[:idx] == base[:idx], "prefix changed"
    assert patched[idx + len(injected):] == base[idx:], "suffix changed"
    assert patched.count(ANCHOR) == 1, "anchor count changed"
    assert len(patched) == len(base) + len(injected), "length mismatch"

    out_p.write_bytes(patched)

    print("base.js   bytes:", len(base))
    print("block.js  bytes:", len(block))
    print("patched   bytes:", len(patched))
    print("inserted  bytes:", len(injected))
    print("anchor at byte offset:", idx)
    print("BASE    SHA256:", sha(base))
    print("PATCHED SHA256:", sha(patched))

if __name__ == "__main__":
    main()
