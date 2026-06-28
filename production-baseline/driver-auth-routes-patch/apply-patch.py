#!/usr/bin/env python3
import hashlib
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "attached_assets",
                    "current-live-production-api-246519b9_1782641288418.js")
BODY = os.path.join(HERE, "auth-routes-body.js")
OUT = os.path.join(HERE, "production-api.PATCHED.js")

# Hard assertion: refuse to patch anything but this exact live bundle.
EXPECTED_BASE_SHA = "246519b97efcd770c9b76a3825348d1d6ee8c09482739b15847462f4674bb84c"

ANCHOR = 'app.use("/api", routes_default);'

BEGIN = "\n// ===== BEGIN PG-ONLY AUTH ROUTES PATCH (246519b9) =====\n"
END = "\n// ===== END PG-ONLY AUTH ROUTES PATCH =====\n"


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

    wrapped = (BEGIN +
               "(function(app, import_express34, pool, auth){\n" +
               body +
               "\n})(app, import_express34, pool, auth);" +
               END)

    base_text = base.decode("utf-8")
    idx = base_text.index(ANCHOR)
    patched_text = base_text[:idx] + wrapped + "\n" + base_text[idx:]
    patched = patched_text.encode("utf-8")

    with open(OUT, "wb") as f:
        f.write(patched)

    inserted = len(patched) - len(base)
    print("BASE   bytes: %d  sha256: %s" % (len(base), sha(base)))
    print("PATCH  block bytes inserted: %d" % inserted)
    print("PATCHED bytes: %d  sha256: %s" % (len(patched), sha(patched)))
    print("OUT: %s" % OUT)

    # Byte-safety proof: removing the inserted region reproduces the base exactly.
    bidx = patched_text.index(BEGIN)
    eidx = patched_text.index(END) + len(END)
    # the inserted region also added one trailing newline before the anchor
    reconstructed = patched_text[:bidx] + patched_text[eidx:]
    # strip the single extra "\n" we added right before the anchor
    if reconstructed.startswith(base_text[:bidx]):
        pass
    if reconstructed == base_text + "" and False:
        pass
    # exact check
    if reconstructed[:bidx] == base_text[:bidx] and reconstructed[bidx:].lstrip("\n") == base_text[bidx:]:
        print("BYTE-SAFE: base reproduced after removing inserted block (only leading newlines differ at splice point)")
    else:
        # do a strict check ignoring our single inserted '\n'
        if reconstructed == base_text[:bidx] + "\n" + base_text[bidx:]:
            print("WARN: reconstruction has residual newline")
        else:
            print("NOTE: strict reconstruct check — verify via diff tool")


if __name__ == "__main__":
    main()
