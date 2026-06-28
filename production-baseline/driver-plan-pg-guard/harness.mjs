// Deterministic harness for the [BCD-PG] PG-authoritative driver-plans override block.
// Runs INSERTED-BLOCK.js with MOCK bindings (in-memory pg "driver_plans" + mock Firestore +
// mock Razorpay + mock auth) and asserts the money-path behaviour end-to-end through the REAL
// handler code. Exit code 0 = all pass.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
import crypto from "node:crypto";

globalThis.require = createRequire(import.meta.url);
process.env.RAZORPAY_KEY_ID = "rzp_test_dummy";
process.env.RAZORPAY_KEY_SECRET = "dummysecret_for_harness_only";
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET;
const logger = { info() {}, warn() {}, error(...a) { console.error("[blocklog]", ...a); } };

// ---- in-memory pg: driver_plans ----------------------------------------------
let rows = [];
let seq = 1;
let rzpCreateCalls = 0;       // every Razorpay order creation
let insertCalls = 0;          // every INSERT into driver_plans
function nowMs() { return Date.now(); }
function pgQuery(text, params = []) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.startsWith("SELECT pg_try_advisory_lock")) return { rows: [{ ok: true }] };
  if (t.startsWith("SELECT pg_advisory_unlock")) return { rows: [{ ok: true }] };
  if (t.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [{}] };
  if (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK") return { rowCount: 0, rows: [] };
  if (t.startsWith("SELECT status, expires_at FROM driver_plans WHERE razorpay_order_id")) {
    const [oid, uid] = params; const r = rows.find((x) => x.razorpay_order_id === oid && x.driver_uid === uid);
    return { rowCount: r ? 1 : 0, rows: r ? [{ status: r.status, expires_at: r.expires_at }] : [] };
  }
  // guard read
  if (t.startsWith("SELECT plan_id, status, expires_at FROM driver_plans WHERE driver_uid")) {
    const [uid] = params;
    const m = rows
      .filter((r) => r.driver_uid === uid && r.status === "active" && r.expires_at && new Date(r.expires_at).getTime() > nowMs())
      .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at));
    return { rowCount: m.length ? 1 : 0, rows: m.length ? [{ plan_id: m[0].plan_id, status: m[0].status, expires_at: m[0].expires_at }] : [] };
  }
  if (t.startsWith("SELECT * FROM driver_plans WHERE razorpay_order_id")) {
    const [oid] = params; const r = rows.find((x) => x.razorpay_order_id === oid);
    return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
  }
  if (t.startsWith("INSERT INTO driver_plans")) {
    const [uid, planId, label, amount, dur, oid] = params;
    const conflict = t.includes("ON CONFLICT DO NOTHING");
    if (conflict && rows.some((x) => x.razorpay_order_id === oid)) return { rowCount: 0, rows: [] };
    insertCalls++;
    rows.push({ id: seq++, driver_uid: uid, plan_id: planId, plan_label: label, amount: String(amount), duration_days: dur, status: "created", active: false, started_at: null, expires_at: null, created_at: new Date().toISOString(), razorpay_order_id: oid, razorpay_payment_id: null });
    return { rowCount: 1, rows: [] };
  }
  if (t.startsWith("UPDATE driver_plans SET status = 'cancelled'")) {
    const [uid, oid] = params; let n = 0;
    for (const r of rows) if (r.driver_uid === uid && r.status === "active" && r.razorpay_order_id !== oid) { r.status = "cancelled"; r.active = false; n++; }
    return { rowCount: n, rows: [] };
  }
  if (t.startsWith("UPDATE driver_plans SET status = 'active'")) {
    const [payId, startedAt, expiresAt, oid, uid] = params;
    const r = rows.find((x) => x.razorpay_order_id === oid && x.driver_uid === uid);
    if (!r) return { rowCount: 0, rows: [] };
    r.status = "active"; r.active = true; r.razorpay_payment_id = payId; r.started_at = startedAt; r.expires_at = expiresAt;
    return { rowCount: 1, rows: [{ expires_at: r.expires_at }] };
  }
  throw new Error("UNHANDLED SQL in harness: " + t);
}
const pool = { query: async (t, p) => pgQuery(t, p), connect: async () => ({ query: async (t, p) => pgQuery(t, p), release() {} }) };

// ---- auth / razorpay / firestore mocks ---------------------------------------
const auth = { verifyIdToken: async (tok) => { if (typeof tok === "string" && tok.startsWith("VALID:")) return { uid: tok.slice(6) }; throw new Error("bad token"); } };
const rzpOrders = new Map();   // orderId -> { id, amount, currency, notes } (server-set notes for self-heal)
const import_razorpay = { default: class { constructor() { this.orders = {
  create: async (o) => { rzpCreateCalls++; const id = "order_test_" + o.amount + "_" + rzpCreateCalls; rzpOrders.set(id, { id, amount: o.amount, currency: o.currency, notes: o.notes }); return { id, amount: o.amount, currency: o.currency }; },
  fetch: async (id) => { const r = rzpOrders.get(id); if (!r) throw new Error("rzp order not found: " + id); return r; },
}; } } };
const ST = Symbol("serverTimestamp");
const FieldValue = { serverTimestamp: () => ST };
const fsStore = new Map();
const db2 = { doc: (path) => { const id = path.split("/").pop(); return { set: async (upd, _opt) => { const cur = fsStore.get(id) || {}; const merged = { ...cur }; for (const k in upd) merged[k] = upd[k] === ST ? Date.now() : upd[k]; fsStore.set(id, merged); return {}; } }; } };

// ---- express app + inject block ----------------------------------------------
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = logger; next(); });
const blockText = readFileSync(new URL("./INSERTED-BLOCK.js", import.meta.url), "utf8");
eval(blockText);

const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.error("  FAIL", msg); } }
async function call(method, path, { uid, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = "Bearer VALID:" + uid;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
function hmac(orderId, payId) { return crypto.createHmac("sha256", RZP_SECRET).update(`${orderId}|${payId}`).digest("hex"); }
const DAY = 864e5;

try {
  console.log("\n== create-order: PG-authoritative guard ==");
  ok((await call("POST", "/api/driver-plans/create-order")).status === 401, "create-order no auth -> 401 (registered, not 404)");
  ok((await call("POST", "/api/driver-plans/create-order", { uid: "drv1", body: { driverUid: "drv1", planType: "yearly" } })).status === 400, "invalid planType -> 400");
  ok((await call("POST", "/api/driver-plans/create-order", { uid: "drv1", body: { driverUid: "drvX", planType: "weekly" } })).status === 403, "token/driver mismatch -> 403");

  // no active plan -> creates order + inserts 'created' row
  let r = await call("POST", "/api/driver-plans/create-order", { uid: "drv1", body: { driverUid: "drv1", planType: "weekly" } });
  ok(r.status === 200 && r.json.razorpayOrderId && r.json.keyId === "rzp_test_dummy" && r.json.amount === 1900 && r.json.planId === "weekly", "no active plan -> 200 + razorpayOrderId + keyId + amount=1900");
  ok(rows.length === 1 && rows[0].status === "created" && rows[0].active === false, "create-order wrote ONE 'created' (active=false) row");

  // ACTIVE plan present -> 409, NO razorpay order, NO row
  rows = [{ id: 99, driver_uid: "drv2", plan_id: "monthly", plan_label: "Monthly", amount: "10000", duration_days: 30, status: "active", active: true, started_at: new Date().toISOString(), expires_at: new Date(nowMs() + 10 * DAY).toISOString(), created_at: new Date().toISOString(), razorpay_order_id: "order_existing", razorpay_payment_id: "pay_existing" }];
  const rzpBefore = rzpCreateCalls, insBefore = insertCalls, lenBefore = rows.length;
  r = await call("POST", "/api/driver-plans/create-order", { uid: "drv2", body: { driverUid: "drv2", planType: "weekly" } });
  ok(r.status === 409 && r.json.active === true && r.json.error === "Driver already has an active plan." && r.json.plan && r.json.plan.planId === "monthly" && r.json.plan.status === "active" && typeof r.json.plan.expiresAt === "string", "active plan -> 409 {active,error,plan{planId,status,expiresAt}}");
  ok(rzpCreateCalls === rzpBefore, "409 guard -> NO Razorpay order created");
  ok(insertCalls === insBefore && rows.length === lenBefore, "409 guard -> NO driver_plans row written");

  console.log("\n== verify-payment: PG strict expiry + one-active ==");
  ok((await call("POST", "/api/driver-plans/verify-payment")).status === 401, "verify-payment no auth -> 401");

  // daily = +12h
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvD", body: { driverUid: "drvD", planType: "daily" } });
  let oid = rows.find((x) => x.driver_uid === "drvD").razorpay_order_id;
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvD", body: { driverUid: "drvD", planType: "daily", razorpayOrderId: oid, razorpayPaymentId: "payD", razorpaySignature: hmac(oid, "payD") } });
  let row = rows.find((x) => x.razorpay_order_id === oid);
  let windowMs = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(r.status === 200 && r.json.plan && r.json.plan.status === "active" && Math.abs(windowMs - 12 * 3600e3) < 2000, "daily verify -> active + expiry = started + 12h");
  ok(r.json.plan.planId === "daily" && typeof r.json.planExpiryAt === "number", "daily verify response -> plan.planId + planExpiryAt(ms) superset");
  const fsD = fsStore.get("drvD");
  ok(fsD && fsD.subscriptionPlan === "daily" && typeof fsD.subscriptionExpiresAt === "number" && fsD.planStatus === "active", "daily verify -> Firestore mirror written (subscriptionPlan/ExpiresAt/planStatus)");

  // weekly = +7d
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvW", body: { driverUid: "drvW", planType: "weekly" } });
  oid = rows.find((x) => x.driver_uid === "drvW").razorpay_order_id;
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvW", body: { driverUid: "drvW", planType: "weekly", razorpayOrderId: oid, razorpayPaymentId: "payW", razorpaySignature: hmac(oid, "payW") } });
  row = rows.find((x) => x.razorpay_order_id === oid);
  windowMs = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(r.status === 200 && Math.abs(windowMs - 7 * DAY) < 2000, "weekly verify -> expiry = started + 7d");

  // monthly = +30d, AND one-active invariant: drvW already has weekly active; activate monthly -> weekly cancelled
  await call("POST", "/api/driver-plans/create-order", { uid: "drvW", body: { driverUid: "drvW", planType: "monthly" } }).then(() => {});
  // create-order would 409 because weekly active; insert a fresh 'created' monthly row directly to test verify one-active
  rows.push({ id: seq++, driver_uid: "drvW", plan_id: "monthly", plan_label: "Monthly", amount: "10000", duration_days: 30, status: "created", active: false, started_at: null, expires_at: null, created_at: new Date().toISOString(), razorpay_order_id: "order_m_drvW", razorpay_payment_id: null });
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvW", body: { driverUid: "drvW", planType: "monthly", razorpayOrderId: "order_m_drvW", razorpayPaymentId: "payM", razorpaySignature: hmac("order_m_drvW", "payM") } });
  const mRow = rows.find((x) => x.razorpay_order_id === "order_m_drvW");
  windowMs = new Date(mRow.expires_at).getTime() - new Date(mRow.started_at).getTime();
  ok(r.status === 200 && Math.abs(windowMs - 30 * DAY) < 2000, "monthly verify -> expiry = started + 30d");
  const activeForW = rows.filter((x) => x.driver_uid === "drvW" && x.status === "active");
  ok(activeForW.length === 1 && activeForW[0].plan_id === "monthly", "one-active invariant -> exactly ONE active row, prior weekly cancelled");

  // idempotent verify (already active) -> ok, no change, no re-charge
  const beforeRzp = rzpCreateCalls;
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvW", body: { driverUid: "drvW", planType: "monthly", razorpayOrderId: "order_m_drvW", razorpayPaymentId: "payM", razorpaySignature: hmac("order_m_drvW", "payM") } });
  ok(r.status === 200 && r.json.active === true && rzpCreateCalls === beforeRzp, "idempotent verify (already active) -> 200 active, no re-charge");

  console.log("\n== verify-payment: self-heal is SERVER-authoritative (Razorpay notes/amount, NOT client) ==");
  // create-order records the Razorpay order's server-set notes; simulate the 'created' row being lost.
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvH", body: { driverUid: "drvH", planType: "weekly" } });
  const healOid = rows.find((x) => x.driver_uid === "drvH").razorpay_order_id;
  rows = [];   // wipe the row -> verify-payment must self-heal from the Razorpay order
  // CLIENT LIES: claims the cheaper "daily" plan. Server must IGNORE it and use notes.plan_id = weekly.
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvH", body: { driverUid: "drvH", planType: "daily", razorpayOrderId: healOid, razorpayPaymentId: "payH", razorpaySignature: hmac(healOid, "payH") } });
  const healRow = rows.find((x) => x.razorpay_order_id === healOid);
  const healWin = healRow ? new Date(healRow.expires_at).getTime() - new Date(healRow.started_at).getTime() : -1;
  ok(r.status === 200 && r.json.plan && r.json.plan.planId === "weekly", "self-heal -> activates WEEKLY (from Razorpay notes), IGNORES client's 'daily' lie");
  ok(Math.abs(healWin - 7 * DAY) < 2000, "self-heal -> expiry = started + 7d (weekly), NOT 12h");

  // self-heal cross-driver guard: order notes.driver_uid != token uid -> 403
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvO", body: { driverUid: "drvO", planType: "monthly" } });
  const otherOid = rows.find((x) => x.driver_uid === "drvO").razorpay_order_id;
  rows = [];
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "attacker", body: { driverUid: "attacker", planType: "monthly", razorpayOrderId: otherOid, razorpayPaymentId: "payZ", razorpaySignature: hmac(otherOid, "payZ") } });
  ok(r.status === 403 && rows.length === 0, "self-heal -> order belonging to another driver -> 403, NO row written");

  // bad signature -> 400
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "drvW", body: { driverUid: "drvW", planType: "monthly", razorpayOrderId: "order_m_drvW", razorpayPaymentId: "payM", razorpaySignature: "deadbeef" } });
  ok(r.status === 400, "verify-payment bad signature -> 400");
} catch (e) {
  fail++; console.error("HARNESS EXCEPTION", e);
} finally {
  server.close();
  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}
