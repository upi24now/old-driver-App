#!/usr/bin/env python3
"""
FINAL COMBINED byte-safe patcher for the CURRENT LIVE VPS API bundle.

Base (current live): attached_assets/live-production-api_1782580938044.js
  sha256 = b2f1643f4c62bf9f069c6175f44187a98319dfdf1cdecd056aac2c4e1b394e1c

Applies TWO things in ONE pass:

  PART 1 - Driver Plan strict fixes (surgical string replaces on the bundle's
           own driverPlans handlers; no route override):
    CHANGE1+4  pgActivatePlanByOrderId (verify-payment activation path):
       * strict per-plan_id expiry driven by the ACTUAL paid row's plan_id:
           daily=12h, weekly=7d, monthly=30d; final fallback = that row's own
           durationDays (NEVER defaults to monthly).
       * one-active invariant + concurrency safety: a per-driver advisory xact
           lock serializes activation; inside ONE tx, every other status='active'
           row for the driver is expired BEFORE the matched (paid) row is
           activated -> exactly one active row even under concurrent callbacks.
    CHANGE2    POST /api/driver-plans/create-order active-plan guard:
       if pgGetActivePlan(uid) (status='active' AND expires_at > now()) -> 409
       {active:true, expiresAt}; NO Razorpay order, NO driver_plans row inserted.
    CHANGE3    resolvePlan no longer defaults to monthly: missing/blank/unknown
       planId -> null -> create-order returns 400 (no accidental monthly).

  PART 2 - Driver-delivery additive block (INSERTED-BLOCK.js, unchanged):
    Splices the self-contained __BCD_DRIVER_DELIVERY IIFE (8 driver routes +
    dispatch poller + [BCD] marker) IMMEDIATELY BEFORE the single anchor
    `app2.use("/api", routes_default);` so the driver routes register before the
    base /api router (first-match wins).

Byte-safe: every other byte of the bundle is preserved verbatim. Aborts unless
each anchor occurs EXACTLY once and no replacement/marker is already present.
Writes a .bak of the input and prints SHA256 of input and output.

Usage:
    python3 apply-patch.py <input-bundle.js> [output-bundle.js]
If output is omitted, writes "<input>.patched.js".

NOT touched: OTP, MPIN, login, sessions, customer booking, wallet (beyond the
already-reviewed delivery completion in the block), Razorpay keys/config, UI,
DB schema. Plan prices unchanged.
"""
import hashlib
import os
import sys

# ---------------------------------------------------------------- PART 1 anchors
# CHANGE1+4: strict expiry + one-active tx (clean-base anchor: plain durationDays)
C14_OLD = (
    b'  const startedAt = /* @__PURE__ */ new Date();\n'
    b'  const expiresAt = new Date(startedAt.getTime() + row.durationDays * DAY_MS);\n'
    b'  const updated = await db.update(driverPlansTable).set({\n'
    b'    status: "active",\n'
    b'    razorpayPaymentId: opts.razorpayPaymentId,\n'
    b'    startedAt,\n'
    b'    expiresAt,\n'
    b'    updatedAt: /* @__PURE__ */ new Date()\n'
    b'  }).where(eq(driverPlansTable.razorpayOrderId, opts.razorpayOrderId)).returning();\n'
    b'  return { kind: "ok", plan: updated[0] };'
)
C14_NEW = (
    b'  const startedAt = /* @__PURE__ */ new Date();\n'
    b'  const expiresAt = new Date(startedAt.getTime() + '
    b'(row.planId === "daily" ? 12 * 60 * 60 * 1e3 '
    b': row.planId === "weekly" ? 7 * DAY_MS '
    b': row.planId === "monthly" ? 30 * DAY_MS '
    b': row.durationDays * DAY_MS));\n'
    b'  const updated = await db.transaction(async (tx) => {\n'
    b'    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${opts.driverUid}))`);\n'
    b'    await tx.update(driverPlansTable).set({ status: "expired", updatedAt: /* @__PURE__ */ new Date() })'
    b'.where(and(eq(driverPlansTable.driverUid, opts.driverUid), eq(driverPlansTable.status, "active")));\n'
    b'    return await tx.update(driverPlansTable).set({\n'
    b'      status: "active",\n'
    b'      razorpayPaymentId: opts.razorpayPaymentId,\n'
    b'      startedAt,\n'
    b'      expiresAt,\n'
    b'      updatedAt: /* @__PURE__ */ new Date()\n'
    b'    }).where(eq(driverPlansTable.razorpayOrderId, opts.razorpayOrderId)).returning();\n'
    b'  });\n'
    b'  return { kind: "ok", plan: updated[0] };'
)

# CHANGE2: active-plan guard in create-order (clean-base anchor)
C2_OLD = (
    b'  const plan = resolvePlan(body?.["planId"]);\n'
    b'  if (!plan) {\n'
    b'    res.status(400).json({ error: "Unknown planId" });\n'
    b'    return;\n'
    b'  }\n'
    b'  const keys = getRazorpayKeys();'
)
C2_NEW = (
    b'  const plan = resolvePlan(body?.["planId"]);\n'
    b'  if (!plan) {\n'
    b'    res.status(400).json({ error: "Unknown planId" });\n'
    b'    return;\n'
    b'  }\n'
    b'  try {\n'
    b'    const __activePlan = await pgGetActivePlan(uid);\n'
    b'    if (__activePlan) {\n'
    b'      res.status(409).json({ active: true, error: "Driver already has an active plan.", '
    b'plan: { planId: __activePlan.planId, status: __activePlan.status, expiresAt: __activePlan.expiresAt }, '
    b'expiresAt: __activePlan.expiresAt });\n'
    b'      return;\n'
    b'    }\n'
    b'  } catch (err) {\n'
    b'    req.log.error({ err, uid }, "driver-plans/create-order: active-plan guard check failed");\n'
    b'    res.status(500).json({ error: "Failed to check existing plan status" });\n'
    b'    return;\n'
    b'  }\n'
    b'  const keys = getRazorpayKeys();'
)

# CHANGE3: resolvePlan must not default to monthly (clean-base anchor)
C3_OLD = (
    b'function resolvePlan(raw) {\n'
    b'  const id = typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_PLAN_ID;\n'
    b'  return DRIVER_PLANS[id] ?? null;\n'
    b'}'
)
C3_NEW = (
    b'function resolvePlan(raw) {\n'
    b'  const id = typeof raw === "string" ? raw.trim() : "";\n'
    b'  return DRIVER_PLANS[id] ?? null;\n'
    b'}'
)

PLAN_CHANGES = [
    ("CHANGE1+4 expiry-map+one-active", C14_OLD, C14_NEW),
    ("CHANGE2 active-guard", C2_OLD, C2_NEW),
    ("CHANGE3 no-monthly-default", C3_OLD, C3_NEW),
]

# ---------------------------------------------------------------- PART 2 anchors
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
        data = f.read()
    with open(BLOCK_FILE, "rb") as f:
        block = f.read()

    original = data
    print(f"[patch] input        : {in_path}")
    print(f"[patch] input bytes  : {len(data)}")
    print(f"[patch] input sha256 : {sha256(data)}")

    # --- global preconditions -------------------------------------------------
    if MARKER in data:
        print("[patch] ABORT: delivery marker already present (already patched).", file=sys.stderr)
        return 1
    if MARKER not in block:
        print("[patch] ABORT: INSERTED-BLOCK.js missing its marker.", file=sys.stderr)
        return 1

    # --- PART 1: plan string replacements -------------------------------------
    for name, old, new in PLAN_CHANGES:
        if data.count(old) != 1:
            print(f"[patch] ABORT {name}: expected exactly 1 anchor, found {data.count(old)}", file=sys.stderr)
            return 1
        if data.count(new) != 0:
            print(f"[patch] ABORT {name}: replacement already present", file=sys.stderr)
            return 1
        before = len(data)
        data = data.replace(old, new, 1)
        print(f"[patch] applied {name}: +{len(data) - before} bytes")

    for _, old, new in PLAN_CHANGES:
        if data.count(new) != 1 or old in data:
            print("[patch] ABORT: post-replace verification failed for a plan change", file=sys.stderr)
            return 1

    # --- PART 2: splice delivery block before the /api mount -------------------
    if data.count(ANCHOR) != 1:
        print(f"[patch] ABORT: anchor found {data.count(ANCHOR)} times (expected 1).", file=sys.stderr)
        return 1
    idx = data.index(ANCHOR)
    injected = block if block.endswith(b"\n") else block + b"\n"
    data = data[:idx] + injected + data[idx:]

    # --- post-conditions ------------------------------------------------------
    if data.count(ANCHOR) != 1 or MARKER not in data:
        print("[patch] ABORT: post-splice verification failed", file=sys.stderr)
        return 1

    bak_path = in_path + ".bak"
    if not os.path.exists(bak_path):
        with open(bak_path, "wb") as f:
            f.write(original)
        print(f"[patch] backup       : {bak_path}")

    with open(out_path, "wb") as f:
        f.write(data)

    print(f"[patch] output       : {out_path}")
    print(f"[patch] output bytes : {len(data)} (+{len(data) - len(original)})")
    print(f"[patch] output sha256: {sha256(data)}")
    print(f"[patch] block bytes  : {len(injected)}")
    print(f"[patch] block sha256 : {sha256(injected)}")
    print("[patch] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
