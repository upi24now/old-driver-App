#!/usr/bin/env python3
"""
Combined byte-safe patch on the CURRENT LIVE bundle (sha 297c2543...).

Keeps everything already live (driver-delivery routes + [BCD] poller), and makes the
driver-plans handlers correct & strict:

  CHANGE 1+4 — pgActivatePlanByOrderId (verify-payment activation path):
    * strict per-plan_id expiry: daily=12h, weekly=7d, monthly=30d, driven by the
      actual paid row's plan_id (never defaults to monthly; final fallback = that
      row's own durationDays).
    * one-active invariant: expire any other currently-active rows for the same
      driver before activating the matched (paid) row -> exactly one active row.

  CHANGE 2 — POST /create-order active-plan guard:
    if pgGetActivePlan(uid) (status='active' AND expires_at > now()) returns a row,
    respond 409 with the active-plan JSON and do NOT create a Razorpay order or
    insert a driver_plans row.

  CHANGE 3 — resolvePlan no longer defaults to monthly:
    missing/blank/unknown planId -> null -> create-order returns 400 (no defaulting).
    DEFAULT_PLAN_ID is still used by GET "/" as the suggested UI default only.

Nothing else touched (OTP/MPIN/login/sessions/customer/wallet/Razorpay keys/UI/schema).
"""
import hashlib
import sys

SRC = "../driver-daily-plan-12h-fix/live-production-api.PATCHED.js"   # current live (297c2543)
OUT = "live-production-api.PATCHED.js"

# ---- CHANGE 1+4: strict expiry map + atomic one-active invariant (per-driver lock) ----
# Replace the whole pgActivatePlanByOrderId body so deactivate+activate run inside one
# transaction serialized by a per-driver advisory lock -> strictly one active row even
# under concurrent verify-payment calls for the same driver.
C14_OLD = (
    b'  const startedAt = /* @__PURE__ */ new Date();\n'
    b'  const expiresAt = new Date(startedAt.getTime() + '
    b'(row.planId === "daily" ? 12 * 60 * 60 * 1e3 : row.durationDays * DAY_MS));\n'
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

# ---- CHANGE 2: active-plan guard in create-order ----
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
    b'plan: { planId: __activePlan.planId, status: __activePlan.status, expiresAt: __activePlan.expiresAt } });\n'
    b'      return;\n'
    b'    }\n'
    b'  } catch (err) {\n'
    b'    req.log.error({ err, uid }, "driver-plans/create-order: active-plan guard check failed");\n'
    b'    res.status(500).json({ error: "Failed to check existing plan status" });\n'
    b'    return;\n'
    b'  }\n'
    b'  const keys = getRazorpayKeys();'
)

# ---- CHANGE 3: resolvePlan must not default to monthly ----
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

CHANGES = [
    ("CHANGE1+4 expiry-map+one-active", C14_OLD, C14_NEW),
    ("CHANGE2 active-guard", C2_OLD, C2_NEW),
    ("CHANGE3 no-monthly-default", C3_OLD, C3_NEW),
]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    with open(SRC, "rb") as f:
        data = f.read()
    print(f"BASE  bytes={len(data)} sha256={sha(data)}")

    for name, old, new in CHANGES:
        if data.count(old) != 1:
            print(f"ABORT {name}: expected exactly 1 anchor, found {data.count(old)}")
            return 1
        if data.count(new) != 0:
            print(f"ABORT {name}: replacement already present")
            return 1
        before = len(data)
        data = data.replace(old, new, 1)
        print(f"applied {name}: +{len(data) - before} bytes")

    for _, old, new in CHANGES:
        if data.count(new) != 1:
            print("ABORT: post-replace new-count != 1")
            return 1
        if old in data:
            print("ABORT: an old anchor still present")
            return 1

    with open(OUT, "wb") as f:
        f.write(data)
    print(f"PATCHED bytes={len(data)} sha256={sha(data)}")
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
