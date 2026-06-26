#!/usr/bin/env python3
"""
Byte-safe additive patch: insert the single-device login route block into the
production bundle immediately AFTER the last global middleware
`app.use((0, import_pino_http.default)({ logger }));`.

This anchor matters: the base bundle already ships its OWN additive
`/api/auth/send-otp` + `/api/auth/verify-otp` override. To make our handlers win
Express first-match routing they must register FIRST, so we splice right after the
final middleware (after `express.json()`, so `req.body` is parsed) and BEFORE both
that pre-existing override AND `app.use("/api", routes_default)`.

This NEVER edits existing bytes. It performs a pure splice:
    out = base[:idx] + block + base[idx:]   # idx = end of the anchor
and proves byte-safety by asserting prefix/suffix are bit-identical to the base, the
block is placed verbatim, the length is exactly base+block, and the first differing
byte between base and out falls within the inserted region (>= splice point and
< splice+len(block)). The first diff may land a few bytes after the splice point
when the block's leading bytes coincide with the bytes that follow the anchor.
Emits sha256 of the input and output.

The single-device session enforcement is layered on by WRAPPING the existing
`__dsRequireDriver` function binding from inside the inserted block (no compiled
bytes are edited), so this remains a pure additive splice.

Usage:
    python3 patch.py            # uses default paths below
    python3 patch.py BASE OUT BLOCK
"""
import hashlib
import sys

DEFAULT_BASE = "../driver-orders-patch/production-api.js"
DEFAULT_OUT = "production-api.js"
DEFAULT_BLOCK = "INSERTED-BLOCK-session-login.js"

EXPECTED_BASE_SHA = "395ffcb2265179178487878f853b2a86b8eac8a53a77928737c20a28c633b719"
# Insert immediately AFTER the last global middleware (pino-http). This places the
# block after express.json()/urlencoded() (so req.body is parsed) yet BEFORE the
# base bundle's own pre-existing `/api/auth/send-otp` + `/api/auth/verify-otp`
# additive override (and before `app.use("/api", routes_default)`), so Express
# first-match-wins makes OUR send-otp/verify-otp handlers authoritative.
ANCHOR = b'app.use((0, import_pino_http.default)({ logger }));'


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
    anchor_at = base.index(ANCHOR)
    idx = anchor_at + len(ANCHOR)  # splice point is immediately AFTER the anchor
    print(f"ANCHOR byte offset: {anchor_at}")
    print(f"SPLICE byte offset: {idx} (after anchor)")

    # The block is wrapped with surrounding newlines so it forms its own
    # statements on their own lines, separated from the anchor and what follows.
    block = b"\n" + block_src.rstrip(b"\n") + b"\n\n"

    out = base[:idx] + block + base[idx:]

    # ---- Byte-safety proofs -------------------------------------------------
    assert out[:idx] == base[:idx], "prefix changed"
    assert out[idx:idx + len(block)] == block, "block not placed verbatim"
    assert out[idx + len(block):] == base[idx:], "suffix changed"
    assert len(out) == len(base) + len(block), "length mismatch"

    # First differing byte between base and out must fall AT or AFTER the splice
    # point and strictly WITHIN the inserted block. It may legitimately be a few
    # bytes after `idx` when the block's leading bytes coincide with the bytes
    # that follow the anchor (here both begin "\n// "). The hard invariant is that
    # nothing BEFORE the splice point changed, which is already proven by
    # out[:idx] == base[:idx] above; this check additionally bounds the drift.
    first_diff = -1
    minlen = min(len(base), len(out))
    for i in range(minlen):
        if base[i] != out[i]:
            first_diff = i
            break
    print(f"FIRST DIFF offset : {first_diff} (>= splice {idx}, < {idx + len(block)})")
    assert first_diff >= idx, "a byte BEFORE the splice point changed — not additive"
    assert first_diff < idx + len(block), "divergence outside the inserted block"

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
