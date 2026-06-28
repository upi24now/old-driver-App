#!/usr/bin/env python3
"""
Byte-safe in-place patch: Daily Driver Plan expiry = exactly 12 hours from activation.

ONLY changes the expiry computation inside pgActivatePlanByOrderId. Daily plans
(planId === "daily") expire at startedAt + 12h. Weekly/Monthly are unchanged
(they keep durationDays * DAY_MS = 7d / 30d). No price, schema, or other change.

Base input is the CURRENTLY-DEPLOYED bundle (delivery-patched) so the output
retains the already-live driver-delivery routes AND adds the 12h daily fix.
"""
import hashlib
import sys

# Base = currently deployed (delivery-patched) bundle.
SRC = "../driver-delivery-live-fix/live-production-api.PATCHED.js"
OUT = "live-production-api.PATCHED.js"

ANCHOR = b"const expiresAt = new Date(startedAt.getTime() + row.durationDays * DAY_MS);"
REPLACEMENT = b'const expiresAt = new Date(startedAt.getTime() + (row.planId === "daily" ? 12 * 60 * 60 * 1e3 : row.durationDays * DAY_MS));'


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    with open(SRC, "rb") as f:
        data = f.read()

    print(f"BASE  bytes={len(data)} sha256={sha(data)}")

    n = data.count(ANCHOR)
    if n != 1:
        print(f"ABORT: expected exactly 1 anchor, found {n}")
        return 1

    if data.count(REPLACEMENT) != 0:
        print("ABORT: replacement already present (already patched?)")
        return 1

    patched = data.replace(ANCHOR, REPLACEMENT)

    # Sanity: only the intended bytes changed (one occurrence, known delta).
    expected_delta = len(REPLACEMENT) - len(ANCHOR)
    actual_delta = len(patched) - len(data)
    if actual_delta != expected_delta:
        print(f"ABORT: byte-delta mismatch expected={expected_delta} actual={actual_delta}")
        return 1
    if patched.count(REPLACEMENT) != 1 or patched.count(ANCHOR) != 0:
        print("ABORT: post-replace counts wrong")
        return 1

    with open(OUT, "wb") as f:
        f.write(patched)

    print(f"PATCHED bytes={len(patched)} sha256={sha(patched)}")
    print(f"delta_bytes={actual_delta}")
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
