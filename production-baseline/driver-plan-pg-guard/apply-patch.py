#!/usr/bin/env python3
# Byte-safe ADDITIVE patcher for the live VPS bundle.
#
# Splices the [BCD-PG] PostgreSQL-authoritative driver-plans override block IMMEDIATELY
# BEFORE the existing [BCD] combined block's banner, so Express first-match-wins serves the
# new PG-authoritative create-order / verify-payment handlers.
#
# The patch is purely additive: every original byte is preserved verbatim and a single
# contiguous block is inserted. Re-stripping the inserted block reproduces the base byte-for-byte.

import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "driver-combined-453c9c4c", "production-api.patched.js")
BLOCK = os.path.join(HERE, "INSERTED-BLOCK.js")
OUT = os.path.join(HERE, "production-api.PATCHED.js")

# The currently-deployed bundle this patch is built against.
EXPECTED_BASE_SHA = "a67b1ac1d6ada6b72e574b94a38f77fbd0afe3372370c84ec83ea16032197fae"

# Unique anchor = the existing combined block's banner. The new block is inserted right before it.
ANCHOR = (
    "// ============================================================================\n"
    "// [BCD] COMBINED ADDITIVE PATCH for live VPS bundle 453c9c4c (ESM, PM2 bike-courier-api)"
)


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def main() -> int:
    with open(BASE, "r", encoding="utf-8", newline="") as f:
        base = f.read()
    with open(BLOCK, "r", encoding="utf-8", newline="") as f:
        block = f.read()

    base_sha = sha256_text(base)
    print("base   sha256:", base_sha)
    if base_sha != EXPECTED_BASE_SHA:
        print("ABORT: base SHA mismatch (expected %s)" % EXPECTED_BASE_SHA)
        return 1

    n = base.count(ANCHOR)
    print("anchor occurrences:", n)
    if n != 1:
        print("ABORT: anchor must occur exactly once (got %d)" % n)
        return 1

    if ANCHOR in block:
        print("ABORT: inserted block must not contain the anchor literal")
        return 1

    # Ensure the new override's route registrations precede the existing block's registrations.
    insertion = block.rstrip("\n") + "\n\n" + ANCHOR
    patched = base.replace(ANCHOR, insertion, 1)

    if patched == base:
        print("ABORT: no change produced")
        return 1

    # Additive guarantee: removing the inserted block reproduces the base exactly.
    stripped = patched.replace(block.rstrip("\n") + "\n\n", "", 1)
    if stripped != base:
        print("ABORT: patch is not byte-safe additive (strip != base)")
        return 1

    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(patched)

    patched_sha = sha256_text(patched)
    print("patched sha256:", patched_sha)
    print("byte delta    : +%d" % (len(patched.encode("utf-8")) - len(base.encode("utf-8"))))
    print("written       :", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
