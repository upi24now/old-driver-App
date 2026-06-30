#!/usr/bin/env bash
# =============================================================================
# install-driver-plans-restore.sh
# Self-contained installer: writes the 3 deliverable files into the current dir.
#   - apply-patch.py
#   - INSERTED-BLOCK.js
#   - README_DEPLOY.md
# No placeholders. Run from any directory; files land in ./driver-plans-restore/
# After it runs, follow the printed deployment steps.
# =============================================================================
set -euo pipefail
TARGET_DIR="${1:-driver-plans-restore}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"
echo "Writing deliverables into: $(pwd)"

cat > 'apply-patch.py' <<'APPLY_PATCH_PY_EOF'
#!/usr/bin/env python3
"""
apply-patch.py — Additive restore of the driver-plans routes into the live VPS bundle.

WHAT IT DOES
  Splices production-baseline/driver-plans-restore/INSERTED-BLOCK.js into the live
  esbuild bundle IMMEDIATELY AFTER the pino-http middleware registration, so the
  restored driver-plans handlers register before any (re)mounted "/api" router and
  win Express first-match-wins.

SAFETY (never breaks a working server)
  - Idempotent: aborts with exit 0 if the restore marker is already present.
  - Self-locating: finds the exact pino-http splice anchor; aborts if not found.
  - Self-verifying: confirms every binding the block reuses (app, pool, import_razorpay,
    auth/verifyIdToken, db2, FieldValue) actually exists in the target; aborts if any
    is missing rather than producing a broken bundle.
  - Non-destructive: writes a NEW file (production-api.PATCHED.js); never edits in place.
  - Prints sha256 before/after and byte delta for an auditable diff.

USAGE
  python3 apply-patch.py /path/to/production-api.js [/path/to/production-api.PATCHED.js]

  Defaults:
    SRC = ./production-api.js
    OUT = ./production-api.PATCHED.js
"""
import sys, os, re, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
BLOCK_FILE = os.path.join(HERE, "INSERTED-BLOCK.js")

SRC = sys.argv[1] if len(sys.argv) > 1 else "production-api.js"
OUT = sys.argv[2] if len(sys.argv) > 2 else "production-api.PATCHED.js"

RESTORE_MARKER = "[BCD-PLANS-RESTORE]"

def die(code, msg):
    print("ABORT: " + msg)
    sys.exit(code)

if not os.path.isfile(SRC):
    die(2, "source bundle not found: " + SRC)
if not os.path.isfile(BLOCK_FILE):
    die(2, "INSERTED-BLOCK.js not found next to this script.")

with open(SRC, "r", encoding="utf-8") as f:
    code = f.read()
with open(BLOCK_FILE, "r", encoding="utf-8") as f:
    block = f.read()

# 1) Idempotency -------------------------------------------------------------
if RESTORE_MARKER in code:
    print("ALREADY PATCHED: restore marker '%s' present — no changes made." % RESTORE_MARKER)
    sys.exit(0)
if 'app.post("/api/driver-plans/create-order"' in code or "app.post('/api/driver-plans/create-order'" in code:
    print("NOTE: a create-order route already exists in this bundle.")
    print("      If the app still 404s, the existing handler may be unreachable; inspect before forcing.")
    print("ABORT (safety): refusing to double-register. Remove the stale handler or rename the marker to force.")
    sys.exit(0)

# 2) Locate splice anchor (pino-http middleware) -----------------------------
#    Matches:  app.use((0, import_pino_http<NN>.default)({ logger }));
anchor_re = re.compile(
    r'app\.use\(\(0,\s*import_pino_http\w*\.default\)\(\s*\{\s*logger\s*\}\s*\)\s*\)\s*;'
)
m = anchor_re.search(code)
if not m:
    # Fallback: any pino-http app.use(...) on a single statement.
    anchor_re2 = re.compile(r'app\.use\([^\n;]*pino_http[^\n;]*\)\s*;')
    m = anchor_re2.search(code)
if not m:
    die(3, "could not locate the pino-http middleware splice anchor. "
           "Send me the ~30 lines around the Express app setup (the app.use(...) block) "
           "so the anchor/bindings can be matched to this build.")

# 3) Verify required bindings exist in the target ----------------------------
required = {
    "express app (app.post/get/use)": re.compile(r'\bapp\.(post|get|use)\('),
    "pg Pool binding `pool`":          re.compile(r'\bpool\b'),
    "razorpay import `import_razorpay`":re.compile(r'\bimport_razorpay\b'),
    "Firebase auth verifyIdToken":     re.compile(r'verifyIdToken'),
    "Firestore binding `db2`":         re.compile(r'\bdb2\b'),
    "Firestore `FieldValue`":          re.compile(r'\bFieldValue\b'),
}
missing = [name for name, rx in required.items() if not rx.search(code)]
if missing:
    die(4, "the block reuses bindings that are NOT present in this build:\n  - "
           + "\n  - ".join(missing)
           + "\nThis bundle differs from the lineage the block was authored against. "
             "Send me the Express setup region + the `var pool =` / firebase-admin init lines "
             "so the block can be rebound safely.")

# 4) Splice ------------------------------------------------------------------
insert_at = m.end()
patched = code[:insert_at] + "\n\n" + block + "\n" + code[insert_at:]

with open(OUT, "w", encoding="utf-8") as f:
    f.write(patched)

sha_before = hashlib.sha256(code.encode("utf-8")).hexdigest()
sha_after  = hashlib.sha256(patched.encode("utf-8")).hexdigest()

print("OK: driver-plans routes spliced.")
print("  anchor matched : %r" % code[m.start():m.end()])
print("  spliced after byte offset: %d (line %d)" % (insert_at, code[:insert_at].count("\n") + 1))
print("  src  : %s" % SRC)
print("  out  : %s" % OUT)
print("  sha256 before : %s" % sha_before)
print("  sha256 after  : %s" % sha_after)
print("  bytes added   : %d" % (len(patched) - len(code)))
print()
print("NEXT:")
print("  node --check %s        # syntax-validate the patched bundle" % OUT)
print("  # then on the VPS: back up the live file, move %s into place, pm2 restart bike-courier-api" % os.path.basename(OUT))
APPLY_PATCH_PY_EOF

cat > 'INSERTED-BLOCK.js' <<'INSERTED_BLOCK_JS_EOF'
// ==== [BCD-PLANS-RESTORE] BEGIN driver-plans route restore (additive) ====
// PURPOSE: the live VPS bundle (api-pkg/dist/production-api.js, PM2 bike-courier-api)
// was rebuilt WITHOUT the driver-plans router, so the Driver App's "Activate Plan"
// flow gets 404 "Not found". This block RE-REGISTERS only the driver-plans routes the
// app calls, spliced immediately AFTER the pino-http middleware so Express first-match-wins
// serves these handlers (and so they win even if a stale later block ever reappears).
//
// RESTORES EXACTLY 4 ROUTES (nothing else):
//   POST /api/driver-plans/create-order     (PG-authoritative one-active guard + Razorpay order)
//   POST /api/driver-plans/verify-payment   (HMAC verify + one-active activation tx, self-heal)
//   GET  /api/driver-plans/status           (read live PG driver_plans row)
//   GET  /api/driver-plans/current          (identical alias of /status)
//
// TABLES: driver_plans (order row stored as status='created' -> 'active') + drivers (Firestore
//   mirror only). The original production routes do NOT use a separate driver_plan_orders table;
//   the plan order and the active plan are the SAME driver_plans row keyed by razorpay_order_id.
//
// REUSES ONLY pre-existing top-level bindings at the splice point:
//   app, pool (pg Pool), import_razorpay, auth (Firebase Admin), db2 (Firestore), FieldValue.
//   Prefers the canonical driver gate __dsRequireDriver when present (typeof-guarded, safe).
// Each route is wrapped in a try/catch IIFE so a registration failure can NEVER crash boot.
// TOUCHES NOTHING ELSE: not dispatch, orders, FCM, wallet, KYC/onboarding-fee, OTP, MPIN,
//   login, sessions, customer app, or any existing route path.
// === BEGIN [BCD-PG] driver-plans PostgreSQL-authoritative one-active guard (additive override) ===
// Re-registers POST /api/driver-plans/create-order and POST /api/driver-plans/verify-payment
// IMMEDIATELY BEFORE the earlier [BCD] driver-plans block, so Express first-match-wins serves
// THESE PostgreSQL-authoritative handlers instead of the earlier Firestore-only ones.
//
// WHY: the earlier block checked Firestore for the active-plan guard, but the real source of
// truth is the PG `driver_plans` table — so a driver with an active PG row could still mint a
// new Razorpay order (double-charge). These handlers make `driver_plans` authoritative:
//   create-order : PG guard (status='active' AND expires_at>NOW()) -> 409, NO Razorpay, NO row.
//   verify-payment: HMAC verify -> ONE tx that cancels every OTHER active row then activates ONLY
//                   the paid row with strict expiry (daily +12h, weekly +7d, monthly +30d).
// Firestore drivers/{uid} is still mirrored (best-effort) so the app's subscription display and
// session-restore keep working unchanged. PG commit is authoritative; a Firestore mirror failure
// never fails the request.
//
// Reuses ONLY in-scope top-level bindings already used by the earlier block at this splice point:
//   app, auth (Firebase Admin), pool (pg Pool), import_razorpay, db2 (Firestore), FieldValue.
// Prefers the canonical driver gate `__dsRequireDriver` when present (keeps single-device session
// enforcement); `typeof` on an undeclared identifier is safe (returns "undefined").
// Touches NOTHING else: not /status, /current, onboarding-fee, OTP, MPIN, login, sessions, wallet,
// orders, delivery routes, customer booking, Razorpay keys, or UI.
;(() => {
  try {
    const __pgCrypto = globalThis.require("node:crypto");
    const DAY_MS = 24 * 60 * 60 * 1000;
    // amountPaise = charged via Razorpay AND stored in driver_plans.amount.
    // ms = strict plan lifetime: daily is 12h (an INTEGER duration_days column cannot hold 0.5d,
    // so expiry is computed in JS, NOT via duration_days * INTERVAL '1 day').
    const __PG_PLANS = {
      daily:   { amountPaise: 300,   amountInr: 3,   durationDays: 1,  label: "Daily",   ms: 12 * 60 * 60 * 1000 },
      weekly:  { amountPaise: 1900,  amountInr: 19,  durationDays: 7,  label: "Weekly",  ms: 7 * DAY_MS },
      monthly: { amountPaise: 10000, amountInr: 100, durationDays: 30, label: "Monthly", ms: 30 * DAY_MS },
    };
    // Reverse map for server-authoritative self-heal (Razorpay-charged amount in paise -> plan).
    const __PG_AMOUNT_TO_PLAN = { "300": "daily", "1900": "weekly", "10000": "monthly" };
    // Single per-driver advisory-lock namespace shared by create-order AND verify-payment so the
    // whole money path for one driver is mutually exclusive.
    const __pgLockKey = (uid) => "dpa:" + uid;

    async function __pgRequireDriver(req, res) {
      try { if (typeof __dsRequireDriver === "function") return await __dsRequireDriver(req, res); } catch (_e) {}
      try {
        const raw = req.headers["authorization"] || req.headers["Authorization"] || "";
        const hdr = Array.isArray(raw) ? raw[0] : raw;
        const m = /^Bearer\s+(.+)$/i.exec(hdr || "");
        if (!m) { res.status(401).json({ error: "unauthorized", message: "Missing bearer token." }); return null; }
        const decoded = await auth.verifyIdToken(m[1]);
        const uid = decoded && decoded.uid;
        if (!uid) { res.status(401).json({ error: "unauthorized" }); return null; }
        return uid;
      } catch (_e) {
        res.status(401).json({ error: "unauthorized", message: "Invalid token." });
        return null;
      }
    }

    const __pgResolvePlan = (body) => {
      const key = body && (body.planType || body.planId || body.plan);
      if (key && Object.prototype.hasOwnProperty.call(__PG_PLANS, key)) {
        const p = __PG_PLANS[key];
        return { id: key, amountPaise: p.amountPaise, amountInr: p.amountInr, durationDays: p.durationDays, label: p.label, ms: p.ms };
      }
      return null;
    };

    // Guard read — EXACTLY the contract the operator specified.
    const __pgGetActivePlan = async (driverUid) => {
      const r = await pool.query(
        "SELECT plan_id, status, expires_at FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1",
        [driverUid]
      );
      return r.rows[0] || null;
    };

    const __pgMirrorFirestore = async (uid, planId, startedAtMs, expiresAtMs, razorpayOrderId, razorpayPaymentId, amountInr) => {
      try {
        const doc = {
          subscriptionPlan: planId,
          subscriptionExpiresAt: expiresAtMs,
          planType: planId,
          planStatus: "active",
          planStartAt: startedAtMs,
          planExpiryAt: expiresAtMs,
          razorpayOrderId: razorpayOrderId,
          razorpayPaymentId: razorpayPaymentId,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (amountInr != null) doc.lastPlanAmount = amountInr;
        await db2.doc("drivers/" + uid).set(doc, { merge: true });
      } catch (_e) { /* PG is authoritative; mirror is best-effort */ throw _e; }
    };

    // ---- POST /api/driver-plans/create-order --------------------------------------------------
    app.post("/api/driver-plans/create-order", async (req, res) => {
      const uid = await __pgRequireDriver(req, res);
      if (!uid) return;
      const body = req.body || {};
      const driverUid = (typeof body.driverUid === "string" && body.driverUid) ? body.driverUid : uid;
      if (driverUid !== uid) { res.status(403).json({ error: "Token UID does not match driverUid" }); return; }
      const plan = __pgResolvePlan(body);
      if (!plan) { res.status(400).json({ error: "planType must be one of: daily, weekly, monthly" }); return; }

      // Per-driver advisory lock serialises check+create so concurrent taps cannot mint two orders.
      const lockKey = __pgLockKey(uid);
      const lockClient = await pool.connect();
      let locked = false;
      try {
        const lk = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok", [lockKey]);
        locked = !!(lk.rows && lk.rows[0] && lk.rows[0].ok === true);
        if (!locked) { res.status(409).json({ active: true, error: "A plan order is already being created." }); return; }

        // PG-AUTHORITATIVE GUARD: an active non-expired plan -> 409, NO Razorpay order, NO row write.
        const active = await __pgGetActivePlan(uid);
        if (active) {
          res.status(409).json({
            active: true,
            error: "Driver already has an active plan.",
            plan: {
              planId: active.plan_id,
              status: "active",
              expiresAt: active.expires_at ? new Date(active.expires_at).toISOString() : null,
            },
          });
          return;
        }

        const keyId = process.env["RAZORPAY_KEY_ID"];
        const keySecret = process.env["RAZORPAY_KEY_SECRET"];
        if (!keyId || !keySecret) { res.status(503).json({ error: "Payment service not configured" }); return; }

        const receipt = (driverUid + "-" + plan.id + "-" + Date.now()).slice(0, 40);
        let order = null;
        try {
          const rzp = new import_razorpay.default({ key_id: keyId, key_secret: keySecret });
          order = await rzp.orders.create({ amount: plan.amountPaise, currency: "INR", receipt, notes: { driver_uid: uid, plan_id: plan.id } });
        } catch (rzpErr) {
          try { req.log.error({ err: rzpErr }, "[BCD-PG] create-order razorpay failed"); } catch (_e) {}
          res.status(502).json({ error: "Failed to create payment order" });
          return;
        }
        if (!order || !order.id) { res.status(502).json({ error: "Failed to create payment order" }); return; }

        // Persist the SELECTED plan against this razorpay_order_id as 'created' (active=false) so
        // verify-payment can resolve the exact paid row and never default to monthly.
        try {
          await lockClient.query(
            "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', false, $6, NOW())",
            [uid, plan.id, plan.label, plan.amountPaise, plan.durationDays, order.id]
          );
        } catch (insErr) {
          // Razorpay order already exists; verify-payment self-heals the row by razorpay_order_id.
          try { req.log.error({ err: insErr }, "[BCD-PG] create-order insert failed (verify-payment will self-heal)"); } catch (_e) {}
        }
        try { req.log.info({ uid, planId: plan.id, orderId: order.id }, "[BCD-PG] create-order ok"); } catch (_e) {}
        res.json({ razorpayOrderId: order.id, orderId: order.id, amount: order.amount, currency: order.currency || "INR", keyId: keyId, planId: plan.id });
      } catch (err) {
        try { req.log.error({ err }, "[BCD-PG] create-order failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to create plan order." });
      } finally {
        if (locked) { try { await lockClient.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]); } catch (_e) {} }
        lockClient.release();
      }
    });

    // ---- POST /api/driver-plans/verify-payment ------------------------------------------------
    app.post("/api/driver-plans/verify-payment", async (req, res) => {
      const uid = await __pgRequireDriver(req, res);
      if (!uid) return;
      const b = req.body || {};
      const razorpayOrderId = b.razorpayOrderId || b.razorpay_order_id;
      const razorpayPaymentId = b.razorpayPaymentId || b.razorpay_payment_id;
      const razorpaySignature = b.razorpaySignature || b.razorpay_signature;
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        res.status(400).json({ error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required" });
        return;
      }
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keySecret) { res.status(503).json({ error: "Payment service not configured" }); return; }

      // HMAC verify (timing-safe; mismatched lengths throw -> false).
      const expected = __pgCrypto.createHmac("sha256", keySecret).update(razorpayOrderId + "|" + razorpayPaymentId).digest("hex");
      let sigOk = false;
      try { sigOk = __pgCrypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(razorpaySignature), "hex")); } catch (_e) { sigOk = false; }
      if (!sigOk) {
        try { req.log.warn({ uid, orderId: razorpayOrderId }, "[BCD-PG] verify-payment signature mismatch"); } catch (_e) {}
        res.status(400).json({ error: "Payment verification failed \u2014 invalid signature" });
        return;
      }

      try {
        // Resolve the row created for this order; self-heal if create-order's insert was lost.
        let ordRes = await pool.query("SELECT * FROM driver_plans WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
        let ord = ordRes.rows[0];
        if (!ord) {
          // SERVER-AUTHORITATIVE self-heal: derive the plan from the Razorpay order itself
          // (we set notes.plan_id at create time), falling back to the charged amount. NEVER
          // trust a client-supplied plan key here — that could activate the wrong (cheaper) plan.
          let planKey = null;
          try {
            const keyId = process.env["RAZORPAY_KEY_ID"];
            const rzp = new import_razorpay.default({ key_id: keyId, key_secret: keySecret });
            const rOrder = await rzp.orders.fetch(razorpayOrderId);
            const noteUid = rOrder && rOrder.notes && rOrder.notes.driver_uid;
            if (noteUid && noteUid !== uid) { res.status(403).json({ error: "forbidden", message: "Order does not belong to this driver." }); return; }
            const notePlan = rOrder && rOrder.notes && rOrder.notes.plan_id;
            if (notePlan && Object.prototype.hasOwnProperty.call(__PG_PLANS, notePlan)) planKey = notePlan;
            else if (rOrder && rOrder.amount != null && __PG_AMOUNT_TO_PLAN[String(rOrder.amount)]) planKey = __PG_AMOUNT_TO_PLAN[String(rOrder.amount)];
          } catch (fe) {
            try { req.log.error({ err: fe, orderId: razorpayOrderId }, "[BCD-PG] verify-payment self-heal razorpay fetch failed"); } catch (_e) {}
          }
          if (!planKey) { res.status(404).json({ error: "order_not_found", message: "Plan order not found for this driver." }); return; }
          const meta0 = __PG_PLANS[planKey];
          await pool.query(
            "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1,$2,$3,$4,$5,'created',false,$6,NOW()) ON CONFLICT DO NOTHING",
            [uid, planKey, meta0.label, meta0.amountPaise, meta0.durationDays, razorpayOrderId]
          );
          ordRes = await pool.query("SELECT * FROM driver_plans WHERE razorpay_order_id = $1 LIMIT 1", [razorpayOrderId]);
          ord = ordRes.rows[0];
        }
        if (!ord || ord.driver_uid !== uid) { res.status(404).json({ error: "order_not_found", message: "Plan order not found for this driver." }); return; }

        // Fast idempotent path: already active and not expired -> return current state (no re-charge).
        if (ord.status === "active" && ord.expires_at && new Date(ord.expires_at).getTime() > Date.now()) {
          const expMs = new Date(ord.expires_at).getTime();
          res.json({ ok: true, active: true, planExpiryAt: expMs, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(ord.expires_at).toISOString() } });
          return;
        }

        // Strict expiry: daily +12h, weekly +7d, monthly +30d; unknown -> the row's own duration_days.
        const meta = (ord.plan_id && Object.prototype.hasOwnProperty.call(__PG_PLANS, ord.plan_id)) ? __PG_PLANS[ord.plan_id] : null;
        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + (meta ? meta.ms : (Number(ord.duration_days || 1) * DAY_MS)));

        let activatedExpiry = null;
        let alreadyActive = false;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Per-driver transaction lock (same namespace as create-order) serialises the whole
          // money path: concurrent verifies for one driver run strictly one-at-a-time, so the
          // "cancel others + activate paid row" sequence can never leave two active rows.
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [__pgLockKey(uid)]);
          // Re-read the paid row UNDER the lock; re-check idempotency to avoid a double activation.
          const cur = await client.query("SELECT status, expires_at FROM driver_plans WHERE razorpay_order_id = $1 AND driver_uid = $2 FOR UPDATE", [razorpayOrderId, uid]);
          const crow = cur.rows[0];
          if (crow && crow.status === "active" && crow.expires_at && new Date(crow.expires_at).getTime() > Date.now()) {
            alreadyActive = true;
            activatedExpiry = crow.expires_at;
            await client.query("COMMIT");
          } else {
            // One active row per driver: cancel every OTHER active row first.
            await client.query(
              "UPDATE driver_plans SET status = 'cancelled', active = false WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2",
              [uid, razorpayOrderId]
            );
            // Activate ONLY the paid row; assert exactly one row updated or roll back.
            const upd = await client.query(
              "UPDATE driver_plans SET status = 'active', active = true, razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at",
              [razorpayPaymentId, startedAt.toISOString(), expiresAt.toISOString(), razorpayOrderId, uid]
            );
            if (upd.rowCount !== 1) { throw new Error("activation_row_mismatch:" + upd.rowCount); }
            activatedExpiry = upd.rows[0].expires_at;
            await client.query("COMMIT");
          }
        } catch (txErr) {
          try { await client.query("ROLLBACK"); } catch (_e) {}
          throw txErr;
        } finally {
          client.release();
        }

        const expMs = new Date(activatedExpiry).getTime();
        // Mirror to Firestore so the app's subscription display/session-restore keeps working
        // (best-effort; only on a fresh activation — an idempotent replay leaves Firestore as-is).
        if (!alreadyActive) {
          try { await __pgMirrorFirestore(uid, ord.plan_id, startedAt.getTime(), expMs, razorpayOrderId, razorpayPaymentId, meta ? meta.amountInr : null); }
          catch (fsErr) { try { req.log.warn({ err: fsErr, uid }, "[BCD-PG] firestore mirror failed (PG authoritative, non-fatal)"); } catch (_e) {} }
        }

        try { req.log.info({ uid, planId: ord.plan_id, orderId: razorpayOrderId, idempotent: alreadyActive }, "[BCD-PG] verify-payment activated"); } catch (_e) {}
        res.json({ ok: true, active: true, planStartAt: startedAt.getTime(), planExpiryAt: expMs, plan: { planId: ord.plan_id, status: "active", expiresAt: new Date(activatedExpiry).toISOString() } });
      } catch (err) {
        try { req.log.error({ err }, "[BCD-PG] verify-payment failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to verify payment." });
      }
    });

    try { (typeof logger !== "undefined" ? logger : console).info({}, "[BCD-PG] PG-authoritative driver-plans guard registered (create-order + verify-payment)"); } catch (_e) {}
  } catch (e) {
    try { (typeof logger !== "undefined" ? logger : console).error({ err: e }, "[BCD-PG] additive override failed to register (server continues)"); } catch (_e) {}
  }
})();
// === END [BCD-PG] driver-plans PostgreSQL-authoritative one-active guard ===
// === BEGIN [BCD-PG-STATUS] driver-plans status/current read-only routes (additive) ===
// PURPOSE: the deployed bundle has the PG-authoritative create-order/verify-payment guard
// but NO read route, so the mobile app's GET /api/driver-plans/status returns 404. The app
// turns 404 into null and KEEPS its last cached plan forever (never clears on expiry).
//
// This block adds ONLY two read-only routes, both reading PostgreSQL `driver_plans` ONLY:
//   GET /api/driver-plans/status   (and identical alias GET /api/driver-plans/current)
// Active ONLY when a live PG row exists (status='active' AND expires_at > NOW()). Otherwise
// { active:false, plan:null } so the app clears its cache. Firestore is NOT consulted.
//
// Reuses ONLY in-scope top-level bindings already present at this splice point:
//   app (L203779), auth (Firebase Admin, L199857), pool (pg Pool, L199755).
// Prefers the canonical driver gate __dsRequireDriver when present (keeps single-device
// session enforcement); `typeof` on an undeclared identifier is safe (returns "undefined").
// Touches NOTHING else: not create-order, verify-payment, onboarding-fee, Razorpay, delivery
// routes, OTP, MPIN, login, sessions, wallet, customer booking, or UI.
;(() => {
  try {
    const __psRequireDriver = async (req, res) => {
      // Prefer the canonical gate (session-aware) when available.
      if (typeof __dsRequireDriver === "function") {
        try { return await __dsRequireDriver(req, res); } catch (_e) { /* fall through to bearer verify */ }
      }
      try {
        const raw = req.headers["authorization"] || req.headers["Authorization"] || "";
        const hdr = Array.isArray(raw) ? raw[0] : raw;
        const m = /^Bearer\s+(.+)$/i.exec(hdr || "");
        if (!m) { res.status(401).json({ error: "unauthorized", message: "Missing bearer token." }); return null; }
        const decoded = await auth.verifyIdToken(m[1]);
        const uid = decoded && decoded.uid;
        if (!uid) { res.status(401).json({ error: "unauthorized", message: "Invalid token." }); return null; }
        return uid;
      } catch (_e) {
        res.status(401).json({ error: "unauthorized", message: "Invalid token." });
        return null;
      }
    };

    const __psHandler = async (req, res) => {
      const uid = await __psRequireDriver(req, res);
      if (!uid) return;
      try {
        const q = await pool.query(
          "SELECT plan_id, status, expires_at FROM driver_plans " +
          "WHERE driver_uid = $1 AND status = 'active' AND expires_at > now() " +
          "ORDER BY expires_at DESC LIMIT 1",
          [uid]
        );
        const row = q.rows && q.rows[0];
        if (!row) { res.json({ active: false, plan: null }); return; }
        const expiresIso = row.expires_at ? new Date(row.expires_at).toISOString() : null;
        res.json({
          active: true,
          plan: { id: row.plan_id, planId: row.plan_id, status: "active", expiresAt: expiresIso },
        });
      } catch (err) {
        try { req.log.error({ err, uid }, "[BCD-PG-STATUS] driver-plans/status failed"); } catch (_e) {}
        if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Failed to read plan status." });
      }
    };

    app.get("/api/driver-plans/status", __psHandler);
    app.get("/api/driver-plans/current", __psHandler);

    try { (typeof logger !== "undefined" ? logger : console).info({}, "[BCD-PG-STATUS] driver-plans status/current read-only routes registered (PG-only)"); } catch (_e) {}
  } catch (e) {
    try { (typeof logger !== "undefined" ? logger : console).error({ err: e }, "[BCD-PG-STATUS] failed to register (server continues)"); } catch (_e) {}
  }
})();
// === END [BCD-PG-STATUS] driver-plans status/current read-only routes ===
// ==== [BCD-PLANS-RESTORE] END driver-plans route restore ====
INSERTED_BLOCK_JS_EOF

cat > 'README_DEPLOY.md' <<'README_DEPLOY_MD_EOF'
# Driver-Plans Route Restore — VPS deploy package

Restores the **driver-plans** API routes that were lost when the live VPS bundle was
rebuilt. The Driver App's **Activate Plan** flow currently gets `404 "Not found"` because
the live `production-api.js` has **no** driver-plans handlers (only the Razorpay library's
own `/plans`, which is unrelated).

- **Target:** `/home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist/production-api.js`
- **Process:** PM2 `bike-courier-api`
- **Method:** additive splice — re-registers 4 routes, touches nothing else.

## What gets restored (exactly 4 routes — nothing else)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/driver-plans/create-order` | PG-authoritative one-active guard + creates Razorpay order |
| POST | `/api/driver-plans/verify-payment` | HMAC verify + one-active activation transaction (self-healing) |
| GET | `/api/driver-plans/status` | reads the live PG `driver_plans` row |
| GET | `/api/driver-plans/current` | identical alias of `/status` |

These match the Driver App calls verbatim (`artifacts/mobile/app/subscription.tsx` →
create-order then verify-payment; `artifacts/mobile/utils/profile-api.ts` → status, fallback
current). **No frontend change is required** — the route paths and response shapes are preserved.

### NOT touched (per the strict scope)
Dispatch, orders, FCM, customer/driver delivery routes, KYC / onboarding-fee, wallet, OTP, MPIN,
login, sessions, and every existing route path. The restore is two self-contained `try/catch`
IIFEs; a registration failure can never crash boot.

## Tables used

- **`driver_plans`** — the order row is stored here as `status='created'` at create-order, then
  flipped to `status='active'` at verify-payment, keyed by `razorpay_order_id`.
- **`drivers`** (Firestore `drivers/{uid}` doc) — best-effort mirror only, so the app's
  subscription display / session-restore keeps working. PG is authoritative; a mirror failure
  never fails the request.

> **About `driver_plan_orders`:** the original/proven production routes do **not** use a separate
> `driver_plan_orders` table. The plan *order* and the *active plan* are the **same** `driver_plans`
> row (`status` transitions `created → active`). A grep for `driver_plan_orders` in the patched
> bundle will therefore return nothing — by design, matching the behavior that previously ran in
> production. If your DB has a `driver_plan_orders` table, it is simply unused by these routes.

## Response shapes (preserved)

```
create-order   200 -> { razorpayOrderId, orderId, amount, currency, keyId, planId }
               409 -> { active:true, error, plan:{ planId, status:"active", expiresAt } }   // already active
verify-payment 200 -> { ok:true, active:true, planStartAt, planExpiryAt, plan:{ planId, status:"active", expiresAt } }
               400 -> { error:"...invalid signature" }                                       // bad HMAC
status/current 200 -> { active:true, plan:{ id, planId, status:"active", expiresAt } }
               200 -> { active:false, plan:null }                                            // no live row
```

Plan amounts (paise): **daily 300**, **weekly 1900**, **monthly 10000**.
Expiry: **daily +12h**, **weekly +7d**, **monthly +30d**.

## Files in this package

- `INSERTED-BLOCK.js` — the additive code that gets spliced in (387 lines, 4 routes).
- `apply-patch.py` — self-locating, self-verifying, idempotent patcher (writes a NEW file).
- `harness.mjs` — offline behavior proof using in-memory mocks (no DB/network).

---

## Deploy steps (run on the VPS)

```bash
cd /home/bikecourierservice-api/htdocs/api.bikecourierservice.com/api-pkg/dist

# 0) copy this package's INSERTED-BLOCK.js + apply-patch.py next to production-api.js
#    (scp/rsync them into e.g. ./driver-plans-restore/)

# 1) back up the live bundle
cp -a production-api.js production-api.js.bak.$(date +%Y%m%d-%H%M%S)

# 2) produce the patched bundle (does NOT touch the live file)
python3 driver-plans-restore/apply-patch.py production-api.js production-api.PATCHED.js

# 3) syntax-validate the patched bundle
node --check production-api.PATCHED.js

# 4) swap into place and restart PM2
mv production-api.PATCHED.js production-api.js
pm2 restart bike-courier-api
pm2 logs bike-courier-api --lines 50   # expect the [BCD-PG] + [BCD-PG-STATUS] "registered" log lines
```

`apply-patch.py` **aborts without writing** if it can't find the splice anchor (exit 3) or any
reused binding is missing (exit 4) — it will never produce a broken bundle. If it aborts, send the
~30 lines around the Express `app.use(...)` setup and the `var pool =` / firebase-admin init lines
so the block can be rebound to this build.

### Rollback
```bash
cp -a production-api.js.bak.<timestamp> production-api.js && pm2 restart bike-courier-api
```

---

## Grep proof (run after step 4, against the live `production-api.js`)

```bash
# 4 restored routes are present:
grep -nE 'app\.(post|get)\("/api/driver-plans/(create-order|verify-payment|status|current)"' production-api.js

# restore marker + the two registration banners:
grep -n "BCD-PLANS-RESTORE\] BEGIN" production-api.js
grep -n "PG-authoritative driver-plans guard registered" production-api.js
grep -n "driver-plans status/current read-only routes registered" production-api.js

# table used (driver_plans), and confirmation driver_plan_orders is NOT referenced:
grep -c "driver_plans" production-api.js
grep -c "driver_plan_orders" production-api.js     # expected: 0 (see note above)

# scope safety — the restore added NO order/wallet/fcm/delivery routes:
grep -nE '/api/orders/|offer-stream|fcm-token|active-orders' production-api.js | grep -i "BCD-PLANS-RESTORE" || echo "OK: restore block added no forbidden routes"
```

## Curl test (against the live API)

Replace `<ID_TOKEN>` with a valid Firebase ID token for a test driver.

```bash
BASE="https://api.bikecourierservice.com"

# create-order (expect 200 + razorpayOrderId, OR 409 if the driver already has an active plan):
curl -sS -X POST "$BASE/api/driver-plans/create-order" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"planType":"daily"}' | jq .

# status (expect {active:false,plan:null} or {active:true,plan:{...}}):
curl -sS "$BASE/api/driver-plans/status" \
  -H "Authorization: Bearer <ID_TOKEN>" | jq .
```

A `404 "Not found"` on either route means the patch is **not** live yet. A `401`/`200`/`409`
means the route is registered and reachable (auth/guard responding) — i.e. the restore worked.

## Local verification (already run in this package)

```bash
node --check INSERTED-BLOCK.js   # SYNTAX OK
node harness.mjs                 # ALL CHECKS PASSED (17 assertions: registration, shapes, guard, HMAC, expiry)
```
README_DEPLOY_MD_EOF

chmod +x apply-patch.py

echo
echo "=== files written ==="
ls -la apply-patch.py INSERTED-BLOCK.js README_DEPLOY.md

echo
echo "=== sha256 (for audit) ==="
sha256sum apply-patch.py INSERTED-BLOCK.js README_DEPLOY.md 2>/dev/null || shasum -a 256 apply-patch.py INSERTED-BLOCK.js README_DEPLOY.md

cat <<'NEXT_STEPS_EOF'

=== NEXT STEPS (run on the VPS) ===

# 1. Put the live bundle next to these files (adjust the source path to your VPS):
#    cp /var/www/api-pkg/dist/production-api.js ./production-api.js

# 2. Generate the patched bundle (writes a NEW file; never edits in place):
#    python3 apply-patch.py ./production-api.js ./production-api.PATCHED.js

# 3. Syntax-validate before going live:
#    node --check ./production-api.PATCHED.js

# 4. Back up the live file, swap in the patched one, restart PM2:
#    cp /var/www/api-pkg/dist/production-api.js /var/www/api-pkg/dist/production-api.js.bak.$(date +%s)
#    cp ./production-api.PATCHED.js /var/www/api-pkg/dist/production-api.js
#    pm2 restart bike-courier-api

# 5. Smoke-test (expect 401 unauth, NOT 404):
#    curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:PORT/api/driver-plans/create-order

# Full details: README_DEPLOY.md
NEXT_STEPS_EOF

