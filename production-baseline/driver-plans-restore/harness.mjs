// harness.mjs — proves the restored driver-plans block PARSES and BEHAVES correctly,
// using in-memory mocks for every binding it reuses (app, pool, import_razorpay, auth,
// db2, FieldValue). No live server, no DB, no network. Run: node harness.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import crypto from "node:crypto";

// The live VPS runtime exposes a global require (the block uses globalThis.require(...)).
// Node ESM does not, so shim it for the harness only.
if (typeof globalThis.require !== "function") globalThis.require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const blockSrc = readFileSync(join(HERE, "INSERTED-BLOCK.js"), "utf8");

const KEY_SECRET = "test_secret_key";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;

let FAIL = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) FAIL++; };

// ---- mock Express app: capture route handlers --------------------------------
const handlers = {};
const app = {
  post: (p, ...h) => { handlers["POST " + p] = h[h.length - 1]; },
  get:  (p, ...h) => { handlers["GET " + p]  = h[h.length - 1]; },
  use:  () => {},
};

// ---- mock pg pool ------------------------------------------------------------
// state.activePlan controls the create-order guard + status route.
// state.orderRow is the driver_plans row resolved by verify-payment.
const state = { activePlan: null, orderRow: null, lastActivateExpiry: null };
function runQuery(sql, params) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (s.startsWith("SELECT pg_try_advisory_lock")) return { rows: [{ ok: true }] };
  if (s.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
  if (s.startsWith("SELECT pg_advisory_unlock")) return { rows: [] };
  if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [] };
  // create-order guard + status route read
  if (s.startsWith("SELECT plan_id, status, expires_at FROM driver_plans")) {
    return { rows: state.activePlan ? [state.activePlan] : [] };
  }
  // verify-payment: resolve order row by razorpay_order_id
  if (s.startsWith("SELECT * FROM driver_plans WHERE razorpay_order_id")) {
    return { rows: state.orderRow ? [state.orderRow] : [] };
  }
  // verify-payment tx: FOR UPDATE re-read
  if (s.startsWith("SELECT status, expires_at FROM driver_plans")) {
    return { rows: state.orderRow ? [{ status: state.orderRow.status, expires_at: state.orderRow.expires_at }] : [] };
  }
  if (s.startsWith("INSERT INTO driver_plans")) return { rowCount: 1, rows: [] };
  if (s.startsWith("UPDATE driver_plans SET status = 'cancelled'")) return { rowCount: 0, rows: [] };
  if (s.startsWith("UPDATE driver_plans SET status = 'active'")) {
    const exp = params[2]; // expires_at iso
    state.lastActivateExpiry = exp;
    return { rowCount: 1, rows: [{ expires_at: exp }] };
  }
  return { rows: [], rowCount: 0 };
}
const pool = {
  query: async (sql, params) => runQuery(sql, params),
  connect: async () => ({ query: async (sql, params) => runQuery(sql, params), release: () => {} }),
};

// ---- mock razorpay -----------------------------------------------------------
const import_razorpay = {
  default: class {
    constructor() {
      this.orders = {
        create: async (o) => ({ id: "order_TEST123", amount: o.amount, currency: o.currency || "INR", notes: o.notes }),
        fetch:  async (_id) => ({ id: _id, amount: 300, notes: { driver_uid: "uid_abc", plan_id: "daily" } }),
      };
    }
  },
};

// ---- mock Firebase auth + Firestore -----------------------------------------
const auth = { verifyIdToken: async (t) => (t === "good" ? { uid: "uid_abc" } : Promise.reject(new Error("bad token"))) };
const db2 = { doc: () => ({ set: async () => {} }) };
const FieldValue = { serverTimestamp: () => "SERVERTS" };
const logger = { info: () => {}, warn: () => {}, error: () => {} };

// ---- mock req/res ------------------------------------------------------------
function mkReq(body, token = "good") {
  return { body, headers: { authorization: "Bearer " + token }, log: { info(){}, warn(){}, error(){} } };
}
function mkRes() {
  const r = { statusCode: 200, body: null, headersSent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.headersSent = true; return r; };
  return r;
}
const call = async (key, body, token) => {
  const h = handlers[key];
  if (!h) throw new Error("route not registered: " + key);
  const res = mkRes();
  await h(mkReq(body, token), res);
  return res;
};

// ---- load the block: bind free identifiers as function params ----------------
const factory = new Function(
  "app", "pool", "import_razorpay", "auth", "db2", "FieldValue", "logger", "globalThis",
  blockSrc
);
factory(app, pool, import_razorpay, auth, db2, FieldValue, logger, globalThis);

console.log("\n[1] route registration");
ok(!!handlers["POST /api/driver-plans/create-order"], "create-order registered");
ok(!!handlers["POST /api/driver-plans/verify-payment"], "verify-payment registered");
ok(!!handlers["GET /api/driver-plans/status"], "status registered");
ok(!!handlers["GET /api/driver-plans/current"], "current registered");

(async () => {
  console.log("\n[2] create-order (no active plan) -> 200 + razorpayOrderId");
  state.activePlan = null;
  let r = await call("POST /api/driver-plans/create-order", { driverUid: "uid_abc", planType: "daily" });
  ok(r.statusCode === 200, "status 200 (got " + r.statusCode + ")");
  ok(r.body && r.body.razorpayOrderId === "order_TEST123", "razorpayOrderId present");
  ok(r.body && r.body.amount === 300 && r.body.currency === "INR", "amount=300 paise, currency INR");
  ok(r.body && r.body.keyId === "rzp_test_key", "keyId echoed");

  console.log("\n[3] create-order one-active guard -> 409, no order");
  state.activePlan = { plan_id: "weekly", status: "active", expires_at: new Date(Date.now() + 6 * 864e5).toISOString() };
  r = await call("POST /api/driver-plans/create-order", { driverUid: "uid_abc", planType: "daily" });
  ok(r.statusCode === 409, "status 409 (got " + r.statusCode + ")");
  ok(r.body && r.body.active === true, "active:true guard payload");

  console.log("\n[4] create-order token mismatch -> 403");
  state.activePlan = null;
  r = await call("POST /api/driver-plans/create-order", { driverUid: "someone_else", planType: "daily" });
  ok(r.statusCode === 403, "status 403 (got " + r.statusCode + ")");

  console.log("\n[5] verify-payment valid HMAC -> {ok:true, planExpiryAt}");
  const orderId = "order_TEST123", paymentId = "pay_TEST456";
  const sig = crypto.createHmac("sha256", KEY_SECRET).update(orderId + "|" + paymentId).digest("hex");
  state.orderRow = { driver_uid: "uid_abc", plan_id: "daily", status: "created", expires_at: null, duration_days: 1 };
  r = await call("POST /api/driver-plans/verify-payment", {
    driverUid: "uid_abc", planType: "daily",
    razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sig,
  });
  ok(r.statusCode === 200, "status 200 (got " + r.statusCode + ")");
  ok(r.body && r.body.ok === true, "ok:true");
  ok(r.body && typeof r.body.planExpiryAt === "number", "planExpiryAt is epoch ms");
  // daily = +12h; allow 60s skew
  const expectMs = 12 * 3600 * 1000;
  ok(r.body && Math.abs((r.body.planExpiryAt - r.body.planStartAt) - expectMs) < 60000, "daily expiry = +12h");

  console.log("\n[6] verify-payment bad signature -> 400");
  r = await call("POST /api/driver-plans/verify-payment", {
    driverUid: "uid_abc", razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: "deadbeef",
  });
  ok(r.statusCode === 400, "status 400 (got " + r.statusCode + ")");

  console.log("\n[7] status route reflects active plan");
  state.activePlan = { plan_id: "monthly", status: "active", expires_at: new Date(Date.now() + 30 * 864e5).toISOString() };
  r = await call("GET /api/driver-plans/status", {});
  ok(r.statusCode === 200 && r.body.active === true, "active:true when row live");
  ok(r.body.plan && r.body.plan.planId === "monthly", "plan.planId echoed");
  state.activePlan = null;
  r = await call("GET /api/driver-plans/current", {});
  ok(r.body.active === false && r.body.plan === null, "current -> {active:false, plan:null} when none");

  console.log("\n" + (FAIL === 0 ? "ALL CHECKS PASSED" : (FAIL + " CHECK(S) FAILED")));
  process.exit(FAIL === 0 ? 0 : 1);
})();
