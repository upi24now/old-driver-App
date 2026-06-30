// harness.mjs — functional proof that the PG-only driver-plans restore block registers
// and serves all 4 routes WITHOUT any Firestore (db2 / FieldValue) binding present.
//
// It loads INSERTED-BLOCK.js into a scope that provides ONLY: app, pool (mock), auth (mock),
// import_razorpay (mock), logger, process, and globalThis.require. Firestore identifiers
// (db2 / FieldValue) are intentionally NEVER provided — if the block referenced them it would
// throw ReferenceError and fail this harness.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";

globalThis.require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const block = readFileSync(join(HERE, "INSERTED-BLOCK.js"), "utf8");

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log("PASS  " + name); } else { failed++; console.log("FAIL  " + name); } };

// ---- Mock Express app that captures handlers --------------------------------
function makeApp() {
  const routes = {};
  return {
    routes,
    use() {},
    post(p, h) { routes["POST " + p] = h; },
    get(p, h) { routes["GET " + p] = h; },
  };
}

// ---- Mock res ---------------------------------------------------------------
function makeRes() {
  return {
    statusCode: 200, body: undefined, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.headersSent = true; return this; },
  };
}

// ---- Mock pg pool (scriptable) ---------------------------------------------
function makePool(scenario) {
  const calls = [];
  const client = {
    query: async (sql, params) => { calls.push(["client", sql, params]); return scenario.client(sql, params); },
    release() {},
  };
  return {
    calls,
    query: async (sql, params) => { calls.push(["pool", sql, params]); return scenario.pool(sql, params); },
    connect: async () => client,
  };
}

const auth = { verifyIdToken: async (t) => { if (t === "BAD") throw new Error("bad"); return { uid: "driver_1" }; } };
const import_razorpay = { default: class { constructor(){ this.orders = {
  create: async () => ({ id: "order_abc", amount: 300, currency: "INR" }),
  fetch: async () => ({ notes: { driver_uid: "driver_1", plan_id: "daily" }, amount: 300 }),
}; } } };
const logger = { info() {}, warn() {}, error() {} };

function runBlock(app, pool) {
  // typeof-guarded free identifiers (db2, FieldValue, getAuth, import_auth, admin, import_app,
  // _app, __dsRequireDriver) are intentionally NOT provided -> typeof returns "undefined".
  const fn = new Function("app", "pool", "auth", "import_razorpay", "logger", "process", block);
  fn(app, pool, auth, import_razorpay, logger, process);
}

// ============================================================================
// 1. Block must NOT reference db2 / FieldValue / Firestore .doc() in CODE.
// ============================================================================
const codeNoComments = block.replace(/^\s*\/\/.*$/gm, "");
ok("no db2 reference in code",        !/\bdb2\b/.test(codeNoComments));
ok("no FieldValue reference in code", !/\bFieldValue\b/.test(codeNoComments));
ok("no Firestore .doc() in code",     !/\.doc\(/.test(codeNoComments));
ok("no .set( merge mirror in code",   !/\.set\(/.test(codeNoComments));

// ============================================================================
// 2. Registration: all 4 routes register without throwing (no Firestore binding).
// ============================================================================
let app = makeApp();
let regThrew = false;
try { runBlock(app, makePool({ pool: async () => ({ rows: [], rowCount: 0 }), client: async () => ({ rows: [], rowCount: 0 }) })); }
catch (e) { regThrew = true; console.log("  registration threw:", e && e.message); }
ok("registration did not throw", !regThrew);
ok("POST create-order registered",   typeof app.routes["POST /api/driver-plans/create-order"] === "function");
ok("POST verify-payment registered", typeof app.routes["POST /api/driver-plans/verify-payment"] === "function");
ok("GET status registered",          typeof app.routes["GET /api/driver-plans/status"] === "function");
ok("GET current registered",         typeof app.routes["GET /api/driver-plans/current"] === "function");

// ============================================================================
// 3. GET /status — no active row -> { active:false, plan:null }
// ============================================================================
{
  app = makeApp();
  runBlock(app, makePool({ pool: async () => ({ rows: [], rowCount: 0 }), client: async () => ({ rows: [], rowCount: 0 }) }));
  const res = makeRes();
  await app.routes["GET /api/driver-plans/status"]({ headers: { authorization: "Bearer GOOD" }, log: logger }, res);
  ok("status inactive shape", res.statusCode === 200 && res.body && res.body.active === false && res.body.plan === null);
}

// ============================================================================
// 4. GET /status — active row -> { active:true, plan:{...} }
// ============================================================================
{
  app = makeApp();
  const exp = new Date(Date.now() + 36e5);
  runBlock(app, makePool({ pool: async () => ({ rows: [{ plan_id: "daily", status: "active", expires_at: exp }], rowCount: 1 }), client: async () => ({ rows: [], rowCount: 0 }) }));
  const res = makeRes();
  await app.routes["GET /api/driver-plans/status"]({ headers: { authorization: "Bearer GOOD" }, log: logger }, res);
  ok("status active shape", res.statusCode === 200 && res.body.active === true && res.body.plan.planId === "daily");
}

// ============================================================================
// 5. Auth: missing bearer -> 401 ; bad token -> 401
// ============================================================================
{
  app = makeApp();
  runBlock(app, makePool({ pool: async () => ({ rows: [], rowCount: 0 }), client: async () => ({ rows: [], rowCount: 0 }) }));
  let res = makeRes();
  await app.routes["GET /api/driver-plans/status"]({ headers: {}, log: logger }, res);
  ok("missing bearer -> 401", res.statusCode === 401);
  res = makeRes();
  await app.routes["POST /api/driver-plans/create-order"]({ headers: { authorization: "Bearer BAD" }, body: {}, log: logger }, res);
  ok("bad token -> 401", res.statusCode === 401);
}

// ============================================================================
// 6. create-order — active plan exists -> 409, NO razorpay order minted
// ============================================================================
{
  app = makeApp();
  const exp = new Date(Date.now() + 36e5);
  // Advisory lock is taken on the connect() client; the active-plan guard SELECT runs on pool.query.
  const pool = makePool({
    pool: async (sql) => {
      if (/SELECT plan_id, status, expires_at FROM driver_plans/.test(sql)) return { rows: [{ plan_id: "weekly", status: "active", expires_at: exp }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    client: async (sql) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ ok: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  });
  runBlock(app, pool);
  const res = makeRes();
  await app.routes["POST /api/driver-plans/create-order"]({ headers: { authorization: "Bearer GOOD" }, body: { planType: "daily" }, log: logger }, res);
  ok("create-order active -> 409", res.statusCode === 409 && res.body.active === true);
}

// ============================================================================
// 7. create-order — invalid plan -> 400
// ============================================================================
{
  app = makeApp();
  runBlock(app, makePool({ pool: async () => ({ rows: [], rowCount: 0 }), client: async () => ({ rows: [{ ok: true }], rowCount: 1 }) }));
  const res = makeRes();
  await app.routes["POST /api/driver-plans/create-order"]({ headers: { authorization: "Bearer GOOD" }, body: { planType: "yearly" }, log: logger }, res);
  ok("create-order bad plan -> 400", res.statusCode === 400);
}

// ============================================================================
// 8. create-order — happy path mints razorpay order + returns shape (env keys set)
// ============================================================================
{
  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_dummy";
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dummysecret";
  app = makeApp();
  const pool = makePool({
    pool: async () => ({ rows: [], rowCount: 0 }),
    client: async (sql) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ ok: true }], rowCount: 1 };
      if (/SELECT plan_id, status, expires_at FROM driver_plans/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  });
  runBlock(app, pool);
  const res = makeRes();
  await app.routes["POST /api/driver-plans/create-order"]({ headers: { authorization: "Bearer GOOD" }, body: { planType: "daily" }, log: logger }, res);
  ok("create-order happy -> razorpayOrderId", res.statusCode === 200 && res.body.razorpayOrderId === "order_abc" && res.body.planId === "daily");
}

// ============================================================================
// 9. verify-payment — bad signature -> 400
// ============================================================================
{
  process.env.RAZORPAY_KEY_SECRET = "dummysecret";
  app = makeApp();
  runBlock(app, makePool({ pool: async () => ({ rows: [], rowCount: 0 }), client: async () => ({ rows: [], rowCount: 0 }) }));
  const res = makeRes();
  await app.routes["POST /api/driver-plans/verify-payment"]({ headers: { authorization: "Bearer GOOD" }, body: { razorpayOrderId: "order_abc", razorpayPaymentId: "pay_1", razorpaySignature: "deadbeef" }, log: logger }, res);
  ok("verify bad signature -> 400", res.statusCode === 400);
}

// ============================================================================
// 10. verify-payment — valid signature activates the paid row (PG-only, no Firestore)
// ============================================================================
{
  process.env.RAZORPAY_KEY_SECRET = "dummysecret";
  const orderId = "order_abc", payId = "pay_1";
  const sig = crypto.createHmac("sha256", "dummysecret").update(orderId + "|" + payId).digest("hex");
  app = makeApp();
  const exp = new Date(Date.now() + 12 * 36e5);
  const pool = makePool({
    pool: async (sql) => {
      if (/SELECT \* FROM driver_plans WHERE razorpay_order_id/.test(sql)) return { rows: [{ driver_uid: "driver_1", plan_id: "daily", status: "created", expires_at: null, duration_days: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    client: async (sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [{ status: "created", expires_at: null }], rowCount: 1 };
      if (/UPDATE driver_plans SET status = 'active'/.test(sql)) return { rows: [{ expires_at: exp }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  });
  runBlock(app, pool);
  const res = makeRes();
  await app.routes["POST /api/driver-plans/verify-payment"]({ headers: { authorization: "Bearer GOOD" }, body: { razorpayOrderId: orderId, razorpayPaymentId: payId, razorpaySignature: sig }, log: logger }, res);
  ok("verify valid -> active", res.statusCode === 200 && res.body.ok === true && res.body.active === true && res.body.plan.planId === "daily");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
