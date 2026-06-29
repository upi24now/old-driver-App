#!/usr/bin/env python3
"""
Driver-Plans verify-payment fix: drop the non-existent `active` column from the
4 driver_plans WRITE statements in the live VPS bundle.

ROOT CAUSE
----------
verify-payment (and create-order self-heal) INSERT/UPDATE driver_plans with an
`active` boolean column that does NOT exist in the live PostgreSQL schema:
    DatabaseError: column "active" of relation "driver_plans" does not exist  (42703)
The activation state is already carried by the existing text column `status`
(values 'created' | 'active' | 'cancelled'); every READ filters on
`status = 'active'`, never on the boolean. So `active` is redundant — removing it
from the writes matches the existing production schema with ZERO behaviour change.

This patcher is BASE-AGNOSTIC: it keys on the 4 exact SQL literals, not on a
whole-file hash, so it can be run directly against the real live bundle on the VPS
and will only ever change those 4 statements (everything else is byte-identical).

Usage:
    python3 apply-patch.py [INPUT_BUNDLE] [OUTPUT_BUNDLE]
    # defaults: INPUT = ./production-api.BASE.js   OUTPUT = ./production-api.PATCHED.js
"""
import sys, hashlib, pathlib

HERE = pathlib.Path(__file__).resolve().parent
inp  = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "production-api.BASE.js"
outp = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "production-api.PATCHED.js"

# (old, new) — remove only the `active` column + its SQL literal value.
# Bind params $1..$N are UNCHANGED because `active` used literals (false/true), not params.
REPLACEMENTS = [
    # 1. create-order insert
    ("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', false, $6, NOW())",
     "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', $6, NOW())"),
    # 2. verify-payment self-heal insert
    ("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1,$2,$3,$4,$5,'created',false,$6,NOW()) ON CONFLICT DO NOTHING",
     "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, razorpay_order_id, created_at) VALUES ($1,$2,$3,$4,$5,'created',$6,NOW()) ON CONFLICT DO NOTHING"),
    # 3. cancel other active rows
    ("UPDATE driver_plans SET status = 'cancelled', active = false WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2",
     "UPDATE driver_plans SET status = 'cancelled' WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2"),
    # 4. activate the paid row
    ("UPDATE driver_plans SET status = 'active', active = true, razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at",
     "UPDATE driver_plans SET status = 'active', razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at"),
]

def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

src = inp.read_text("utf-8")
base_bytes = src.encode("utf-8")

# Pre-flight: each buggy literal must be present EXACTLY once.
for i, (old, new) in enumerate(REPLACEMENTS, 1):
    n = src.count(old)
    if n != 1:
        sys.exit(f"ABORT: replacement #{i} expected exactly 1 occurrence, found {n}. "
                 f"Bundle is not the expected driver-plans build; do NOT deploy.")

patched = src
for old, new in REPLACEMENTS:
    patched = patched.replace(old, new)

# Post-flight: no driver_plans write may still reference the `active` column.
LEFTOVERS = [
    "status, active, razorpay_order_id",
    "SET status = 'cancelled', active = false",
    "active = true, razorpay_payment_id",
]
for frag in LEFTOVERS:
    if frag in patched:
        sys.exit(f"ABORT: leftover active-column write still present: {frag!r}")

# Reverse-proof: re-inserting `active` reproduces the base EXACTLY (surgical-only change).
reverse = patched
for old, new in REPLACEMENTS:
    reverse = reverse.replace(new, old)
if reverse.encode("utf-8") != base_bytes:
    sys.exit("ABORT: reverse reconstruction != base — patch changed unexpected bytes.")

patched_bytes = patched.encode("utf-8")
outp.write_text(patched, "utf-8")

print(f"INPUT   bytes: {len(base_bytes):>9}  sha256: {sha(base_bytes)}")
print(f"PATCHED bytes: {len(patched_bytes):>9}  sha256: {sha(patched_bytes)}")
print(f"DELTA   bytes: {len(patched_bytes) - len(base_bytes):>9}  (4 statements, active column removed)")
print(f"OUT: {outp}")
print("SURGICAL-SAFE: re-inserting `active` reproduces the input bundle byte-for-byte.")
