#!/usr/bin/env python3
"""
Byte-safe additive patch: insert the driver order-lifecycle route block into the
production bundle immediately BEFORE the single Express mount
`app.use("/api", routes_default)`.

This NEVER edits existing bytes. It performs a pure splice:
    out = base[:idx] + block + base[idx:]
and proves byte-safety by asserting both halves are bit-identical to the base and
that the first differing byte between base and out is EXACTLY at the insertion
offset. Emits sha256 of the input and output.

Usage:
    python3 patch.py            # uses default paths below
    python3 patch.py BASE OUT BLOCK
"""
import hashlib
import sys

DEFAULT_BASE = "../driver-plan-patch/production-api.js"
DEFAULT_OUT = "production-api.js"
DEFAULT_BLOCK = "INSERTED-BLOCK-driver-orders.js"

EXPECTED_BASE_SHA = "dedff18a3ddb71d5c1eed84614accef642163e11b77ec1f79e6e95a818d37503"
ANCHOR = b'app.use("/api", routes_default)'


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    base_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    block_path = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_BLOCK

    with open(base_path, "rb") as f:
        base = f.read()
    with open(block_path, "rb") as f:
        block_src = f.read()

    base_sha = sha256(base)
    print(f"BASE  path : {base_path}")
    print(f"BASE  sha  : {base_sha}")
    print(f"BASE  bytes: {len(base)}")
    if base_sha != EXPECTED_BASE_SHA:
        print(f"!! BASE sha mismatch (expected {EXPECTED_BASE_SHA}) — refusing to patch.")
        return 2

    # Anchor must occur exactly once.
    count = base.count(ANCHOR)
    print(f"ANCHOR occurrences: {count}")
    if count != 1:
        print("!! Anchor not unique — refusing to patch.")
        return 3
    idx = base.index(ANCHOR)
    print(f"ANCHOR byte offset: {idx}")

    # The block is wrapped with surrounding newlines so it forms its own
    # statements on their own lines, separated from the following mount.
    block = b"\n" + block_src.rstrip(b"\n") + b"\n\n"

    out = base[:idx] + block + base[idx:]

    # ---- Byte-safety proofs -------------------------------------------------
    assert out[:idx] == base[:idx], "prefix changed"
    assert out[idx:idx + len(block)] == block, "block not placed verbatim"
    assert out[idx + len(block):] == base[idx:], "suffix changed"
    assert len(out) == len(base) + len(block), "length mismatch"

    # First differing byte between base and out must be exactly `idx`.
    first_diff = -1
    minlen = min(len(base), len(out))
    for i in range(minlen):
        if base[i] != out[i]:
            first_diff = i
            break
    print(f"FIRST DIFF offset : {first_diff} (expected {idx})")
    assert first_diff == idx, "first diff not at insertion offset"

    with open(out_path, "wb") as f:
        f.write(out)

    out_sha = sha256(out)
    print(f"BLOCK bytes: {len(block)}")
    print(f"OUT   path : {out_path}")
    print(f"OUT   sha  : {out_sha}")
    print(f"OUT   bytes: {len(out)}")
    print("PATCH OK — pure additive splice verified byte-for-byte.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
