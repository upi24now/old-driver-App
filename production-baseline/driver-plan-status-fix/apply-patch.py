#!/usr/bin/env python3
"""Byte-safe ADDITIVE patcher: add GET /api/driver-plans/status + /current to the deployed bundle.

Base   = the currently-deployed PG-guard bundle (has create-order/verify-payment, no read route).
Splice = INSERTED-BLOCK-status.js, inserted IMMEDIATELY BEFORE the unique anchor
         `app.use("/api", routes_default);` so the two new GET routes register before the /api mount.
No existing byte is modified; only the block (plus one newline on each side) is inserted.
"""
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent / "driver-plan-pg-guard" / "production-api.PATCHED.js"
BLOCK = HERE / "INSERTED-BLOCK-status.js"
OUT = HERE / "production-api.PATCHED.js"
ANCHOR = 'app.use("/api", routes_default);'


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    base = BASE.read_text()
    block = BLOCK.read_text()

    # Guard 1: the read route must NOT already exist in the base.
    if "/api/driver-plans/status" in base:
        print("ABORT: base already contains /api/driver-plans/status", file=sys.stderr)
        return 1

    # Guard 2: the anchor must be unique.
    n = base.count(ANCHOR)
    if n != 1:
        print(f"ABORT: anchor found {n} times (expected exactly 1)", file=sys.stderr)
        return 1

    idx = base.index(ANCHOR)
    patched = base[:idx] + block + "\n" + base[idx:]

    # Byte-safety assertion: patched == base with exactly the block(+newline) inserted.
    assert patched.replace(block + "\n", "", 1) == base, "byte-safety check failed"

    OUT.write_text(patched)

    base_b = base.encode()
    out_b = patched.encode()
    print("BASE   :", BASE)
    print("  sha256:", sha(base_b), "bytes:", len(base_b))
    print("PATCHED:", OUT)
    print("  sha256:", sha(out_b), "bytes:", len(out_b))
    print("INSERTED block sha256:", sha(block.encode()), "bytes:", len(block.encode()))
    print("delta bytes:", len(out_b) - len(base_b), "(block + 1 newline =", len(block.encode()) + 1, ")")
    print("anchor still present:", patched.count(ANCHOR) == 1)
    print("status route present:", "/api/driver-plans/status" in patched)
    print("current route present:", "/api/driver-plans/current" in patched)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
