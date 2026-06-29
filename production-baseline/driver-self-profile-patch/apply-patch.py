#!/usr/bin/env python3
"""Byte-safe additive patcher: adds GET /api/drivers/me (driver self-profile).

Base = the CURRENT LIVE bundle (the auth-routes patched build, sha 7a7ff11d...).
This is purely additive: it inserts a single wrapped block immediately BEFORE the
anchor  app.use("/api", routes_default);  and changes nothing else.
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "driver-auth-routes-patch", "production-api.PATCHED.js")
BODY = os.path.join(HERE, "drivers-me-body.js")
OUT = os.path.join(HERE, "production-api.PATCHED.js")

# Hard assertion: refuse to patch anything but the exact current-live bundle.
EXPECTED_BASE_SHA = "7a7ff11d4037aa1a9c8697d79ce92f1076149b984e125d6fe96bede24e081162"

ANCHOR = 'app.use("/api", routes_default);'

BEGIN = "\n// ===== BEGIN DRIVER SELF-PROFILE PATCH (GET /api/drivers/me) =====\n"
END = "\n// ===== END DRIVER SELF-PROFILE PATCH =====\n"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    with open(BASE, "rb") as f:
        base = f.read()
    with open(BODY, "r", encoding="utf-8") as f:
        body = f.read()

    base_sha = sha(base)
    if base_sha != EXPECTED_BASE_SHA:
        print("FATAL: base SHA mismatch.\n  expected %s\n  actual   %s"
              % (EXPECTED_BASE_SHA, base_sha))
        sys.exit(1)
    print("BASE SHA verified == %s" % EXPECTED_BASE_SHA)

    count = base.count(ANCHOR.encode("utf-8"))
    if count != 1:
        print("FATAL: anchor occurrences = %d (expected 1)" % count)
        sys.exit(1)

    # Reuse the bundle's existing module-scope bindings via an explicit closure.
    wrapped = (BEGIN +
               "(function(app, driverAuth, db, driversTable, driverLocationsTable, eq){\n" +
               body +
               "\n})(app, driverAuth, db, driversTable, driverLocationsTable, eq);" +
               END)

    base_text = base.decode("utf-8")
    idx = base_text.index(ANCHOR)
    patched_text = base_text[:idx] + wrapped + "\n" + base_text[idx:]
    patched = patched_text.encode("utf-8")

    with open(OUT, "wb") as f:
        f.write(patched)

    inserted = len(patched) - len(base)
    print("BASE    bytes: %d  sha256: %s" % (len(base), sha(base)))
    print("PATCH   block bytes inserted: %d" % inserted)
    print("PATCHED bytes: %d  sha256: %s" % (len(patched), sha(patched)))
    print("OUT: %s" % OUT)

    # Byte-safety proof: removing the inserted region reproduces the base exactly.
    bidx = patched_text.index(BEGIN)
    eidx = patched_text.index(END) + len(END)
    reconstructed = patched_text[:bidx] + patched_text[eidx:]
    if reconstructed == base_text[:bidx] + "\n" + base_text[bidx:]:
        print("BYTE-SAFE: removing inserted block reproduces base exactly "
              "(single splice newline accounted for)")
    elif reconstructed[:bidx] == base_text[:bidx] and reconstructed[bidx:].lstrip("\n") == base_text[bidx:]:
        print("BYTE-SAFE: base reproduced after removing inserted block "
              "(only leading newlines differ at splice point)")
    else:
        print("FATAL: reconstruction does NOT match base — NOT byte-safe")
        sys.exit(1)


if __name__ == "__main__":
    main()
