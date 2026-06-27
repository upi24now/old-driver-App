#!/usr/bin/env python3
"""
Targeted, byte-safe patch for the LIVE bike-courier production-api.js.

Two surgical edits inside src/routes/driverPlans.ts (compiled into the bundle):
  FIX 1 (create-order): add an active-plan guard -> HTTP 409 {active,error,plan}
         BEFORE any Razorpay order is created, using the existing pgGetActivePlan().
  FIX 2 (pgActivatePlanByOrderId): activate ONLY the row matching razorpay_order_id
         (already the case) AND, in ONE transaction, cancel every OTHER active row for
         the driver so exactly one active plan remains.

Reuses ONLY bindings already present in the bundle: db, driverPlansTable, eq, and, ne,
db.transaction, pgGetActivePlan. Touches nothing else (OTP/MPIN/login/session/payments
untouched). Each anchor must appear EXACTLY ONCE or the script aborts without writing.

Usage:
    python3 apply-patch.py /path/to/dist/production-api.js
"""
import sys, os, time, hashlib

MARKER = "existingActivePlan"  # idempotency sentinel introduced by FIX 1

# ---- FIX 1: create-order active-plan guard -------------------------------------
F1_OLD = '''  const plan = resolvePlan(body?.["planId"]);
  if (!plan) {
    res.status(400).json({ error: "Unknown planId" });
    return;
  }
  const keys = getRazorpayKeys();'''

F1_NEW = '''  const plan = resolvePlan(body?.["planId"]);
  if (!plan) {
    res.status(400).json({ error: "Unknown planId" });
    return;
  }
  const existingActivePlan = await pgGetActivePlan(uid);
  if (existingActivePlan) {
    res.status(409).json({ active: true, error: "Driver already has an active plan.", plan: { planId: existingActivePlan.planId, status: existingActivePlan.status, expiresAt: existingActivePlan.expiresAt } });
    return;
  }
  const keys = getRazorpayKeys();'''

# ---- FIX 2: cancel other active rows + atomic activation ------------------------
F2_OLD = '''  if (row.driverUid !== opts.driverUid) return { kind: "mismatch" };
  const startedAt = /* @__PURE__ */ new Date();
  const expiresAt = new Date(startedAt.getTime() + row.durationDays * DAY_MS);
  const updated = await db.update(driverPlansTable).set({
    status: "active",
    razorpayPaymentId: opts.razorpayPaymentId,
    startedAt,
    expiresAt,
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq(driverPlansTable.razorpayOrderId, opts.razorpayOrderId)).returning();
  return { kind: "ok", plan: updated[0] };'''

F2_NEW = '''  if (row.driverUid !== opts.driverUid) return { kind: "mismatch" };
  const startedAt = /* @__PURE__ */ new Date();
  const expiresAt = new Date(startedAt.getTime() + row.durationDays * DAY_MS);
  const updated = await db.transaction(async (tx) => {
    await tx.update(driverPlansTable).set({
      status: "cancelled",
      updatedAt: /* @__PURE__ */ new Date()
    }).where(and(eq(driverPlansTable.driverUid, opts.driverUid), eq(driverPlansTable.status, "active"), ne(driverPlansTable.razorpayOrderId, opts.razorpayOrderId)));
    return await tx.update(driverPlansTable).set({
      status: "active",
      razorpayPaymentId: opts.razorpayPaymentId,
      startedAt,
      expiresAt,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(driverPlansTable.razorpayOrderId, opts.razorpayOrderId)).returning();
  });
  return { kind: "ok", plan: updated[0] };'''


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def fail(msg):
    print("ABORT: " + msg)
    sys.exit(1)


def must_replace_once(text, old, new, label):
    n = text.count(old)
    if n == 0:
        fail("anchor for %s not found (0 matches). Bundle differs from the analyzed build." % label)
    if n > 1:
        fail("anchor for %s is not unique (%d matches). Refusing to patch." % (label, n))
    return text.replace(old, new, 1)


def main():
    if len(sys.argv) != 2:
        fail("usage: python3 apply-patch.py /path/to/dist/production-api.js")
    path = sys.argv[1]
    if not os.path.isfile(path):
        fail("file not found: " + path)

    with open(path, "rb") as f:
        orig_bytes = f.read()
    base_sha = sha256(orig_bytes)
    print("BASE   SHA256: " + base_sha)

    text = orig_bytes.decode("utf-8")

    if MARKER in text:
        fail("bundle already contains '%s' (already patched). Restore the .bak first." % MARKER)

    # Required bindings sanity (all must already exist in this bundle).
    for needed in ["pgGetActivePlan", "pgActivatePlanByOrderId", "driverPlansTable",
                   "db.transaction(", "driverAuth"]:
        if needed not in text:
            fail("expected binding '%s' missing from bundle. Send me this exact file." % needed)

    text = must_replace_once(text, F1_OLD, F1_NEW, "FIX1 create-order guard")
    text = must_replace_once(text, F2_OLD, F2_NEW, "FIX2 cancel-others + activate")

    patched_bytes = text.encode("utf-8")

    bak = path + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    with open(bak, "wb") as f:
        f.write(orig_bytes)
    with open(path, "wb") as f:
        f.write(patched_bytes)

    print("BACKUP written: " + bak)
    print("PATCHED SHA256: " + sha256(patched_bytes))
    print("OK: 2 edits applied. Run `node --check %s` then reload PM2." % path)


if __name__ == "__main__":
    main()
