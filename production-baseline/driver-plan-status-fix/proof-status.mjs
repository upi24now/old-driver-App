// Deterministic proof for the [BCD-PG-STATUS] read routes, exercised through the EXACT bytes
// shipped in production-api.PATCHED.js. Extracts BOTH the [BCD-PG] guard block and the new
// [BCD-PG-STATUS] block from the patched bundle and runs them against ONE shared in-memory
// driver_plans, so the status route is proven to read the same PG truth the guard writes.
// Exit 0 = all pass.
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

// ---- in-memory pg: driver_plans (same dialect the real handlers emit) -------
let rows = [];
let seq = 1;
let rzpCreateCalls = 0;
let insertCalls = 0;
const nowMs = () => Date.now();
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
  throw new Error("UNHANDLED SQL in proof: " + t);
}
const pool = { query: async (t, p) => pgQuery(t, p), connect: async () => ({ query: async (t, p) => pgQuery(t, p), release() {} }) };

// ---- mocks (auth / razorpay / firestore) ------------------------------------
const auth = { verifyIdToken: async (tok) => { if (typeof tok === "string" && tok.startsWith("VALID:")) return { uid: tok.slice(6) }; throw new Error("bad token"); } };
const rzpOrders = new Map();
const import_razorpay = { default: class { constructor() { this.orders = {
  create: async (o) => { rzpCreateCalls++; const id = "order_test_" + o.amount + "_" + rzpCreateCalls; rzpOrders.set(id, { id, amount: o.amount, currency: o.currency, notes: o.notes }); return { id, amount: o.amount, currency: o.currency }; },
  fetch: async (id) => { const r = rzpOrders.get(id); if (!r) throw new Error("rzp order not found: " + id); return r; },
}; } } };
const ST = Symbol("serverTimestamp");
const FieldValue = { serverTimestamp: () => ST };
const fsStore = new Map();
const db2 = { doc: (path) => { const id = path.split("/").pop(); return { set: async (upd) => { const cur = fsStore.get(id) || {}; const merged = { ...cur }; for (const k in upd) merged[k] = upd[k] === ST ? Date.now() : upd[k]; fsStore.set(id, merged); return {}; } }; } };

// ---- extract BOTH blocks from the SHIPPED patched bundle ---------------------
const bundle = readFileSync(new URL("./production-api.PATCHED.js", import.meta.url), "utf8");
function slice(beginNeedle, endNeedle) {
  const a = bundle.indexOf(beginNeedle);
  const b = bundle.indexOf(endNeedle);
  if (a < 0 || b < 0) throw new Error("block not found: " + beginNeedle);
  return bundle.slice(a, b + endNeedle.length);
}
const guardBlock = slice("// === BEGIN [BCD-PG] driver-plans", "// === END [BCD-PG] driver-plans PostgreSQL-authoritative one-active guard ===");
const statusBlock = slice("// === BEGIN [BCD-PG-STATUS]", "// === END [BCD-PG-STATUS] driver-plans status/current read-only routes ===");
console.log("extracted guard block bytes:", guardBlock.length, "| status block bytes:", statusBlock.length);

// ---- express app + inject both blocks (from bundle bytes) --------------------
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = logger; next(); });
eval(guardBlock);
eval(statusBlock);

const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const baseUrl = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.error("  FAIL", m); } };
async function call(method, path, { uid, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = "Bearer VALID:" + uid;
  const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const hmac = (o, p) => crypto.createHmac("sha256", RZP_SECRET).update(`${o}|${p}`).digest("hex");
const DAY = 864e5;

try {
  console.log("\n== PROOF 1: routes are REGISTERED (not 404) ==");
  ok((await call("GET", "/api/driver-plans/status")).status === 401, "GET /status with no auth -> 401 (registered, NOT 404)");
  ok((await call("GET", "/api/driver-plans/current")).status === 401, "GET /current with no auth -> 401 (registered, NOT 404)");

  console.log("\n== PROOF 2: PG has NO active row -> /status active:false (app clears cache) ==");
  rows = [];
  let r = await call("GET", "/api/driver-plans/status", { uid: "918299013350" });
  ok(r.status === 200 && r.json.active === false && r.json.plan === null, "no PG row -> {active:false, plan:null}");
  r = await call("GET", "/api/driver-plans/current", { uid: "918299013350" });
  ok(r.status === 200 && r.json.active === false && r.json.plan === null, "/current alias identical -> {active:false, plan:null}");

  console.log("\n== PROOF 3: new DAILY purchase -> expiry EXACTLY +12h -> /status reflects it ==");
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "918299013350", body: { driverUid: "918299013350", planType: "daily" } });
  let oid = rows.find((x) => x.driver_uid === "918299013350").razorpay_order_id;
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "918299013350", body: { driverUid: "918299013350", planType: "daily", razorpayOrderId: oid, razorpayPaymentId: "payD", razorpaySignature: hmac(oid, "payD") } });
  let row = rows.find((x) => x.razorpay_order_id === oid);
  let windowMs = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(r.status === 200 && Math.abs(windowMs - 12 * 3600e3) < 2000, "daily verify-payment -> expires_at = started_at + 12h");
  r = await call("GET", "/api/driver-plans/status", { uid: "918299013350" });
  ok(r.status === 200 && r.json.active === true && r.json.plan.id === "daily" && r.json.plan.status === "active" && new Date(r.json.plan.expiresAt).getTime() === new Date(row.expires_at).getTime(), "/status now -> {active:true, plan:{id:daily, expiresAt=+12h}}");

  console.log("\n== PROOF 4: active plan present -> create-order 409 (no double charge) ==");
  const rzpBefore = rzpCreateCalls, insBefore = insertCalls;
  r = await call("POST", "/api/driver-plans/create-order", { uid: "918299013350", body: { driverUid: "918299013350", planType: "weekly" } });
  ok(r.status === 409 && r.json.active === true && r.json.plan && r.json.plan.planId === "daily", "active plan -> 409 {active:true, plan.planId:daily}");
  ok(rzpCreateCalls === rzpBefore && insertCalls === insBefore, "409 -> NO Razorpay order, NO new row");

  console.log("\n== PROOF 5: WEEKLY +7d and MONTHLY +30d ==");
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvW", body: { driverUid: "drvW", planType: "weekly" } });
  oid = rows.find((x) => x.driver_uid === "drvW").razorpay_order_id;
  await call("POST", "/api/driver-plans/verify-payment", { uid: "drvW", body: { driverUid: "drvW", planType: "weekly", razorpayOrderId: oid, razorpayPaymentId: "pW", razorpaySignature: hmac(oid, "pW") } });
  row = rows.find((x) => x.razorpay_order_id === oid);
  ok(Math.abs((new Date(row.expires_at) - new Date(row.started_at)) - 7 * DAY) < 2000, "weekly -> +7d");
  rows = [];
  await call("POST", "/api/driver-plans/create-order", { uid: "drvM", body: { driverUid: "drvM", planType: "monthly" } });
  oid = rows.find((x) => x.driver_uid === "drvM").razorpay_order_id;
  await call("POST", "/api/driver-plans/verify-payment", { uid: "drvM", body: { driverUid: "drvM", planType: "monthly", razorpayOrderId: oid, razorpayPaymentId: "pM", razorpaySignature: hmac(oid, "pM") } });
  row = rows.find((x) => x.razorpay_order_id === oid);
  ok(Math.abs((new Date(row.expires_at) - new Date(row.started_at)) - 30 * DAY) < 2000, "monthly -> +30d");

  console.log("\n== PROOF 6: after expiry the SAME row -> /status active:false (app clears) ==");
  rows = [{ id: 1, driver_uid: "918299013350", plan_id: "daily", plan_label: "Daily", amount: "300", duration_days: 1, status: "active", active: true, started_at: new Date(nowMs() - 13 * 3600e3).toISOString(), expires_at: new Date(nowMs() - 3600e3).toISOString(), created_at: new Date().toISOString(), razorpay_order_id: "order_expired", razorpay_payment_id: "payX" }];
  r = await call("GET", "/api/driver-plans/status", { uid: "918299013350" });
  ok(r.status === 200 && r.json.active === false && r.json.plan === null, "expired PG row -> {active:false, plan:null} (status='active' but expires_at<now filtered out)");
  // and create-order is allowed again after expiry (guard lifted)
  r = await call("POST", "/api/driver-plans/create-order", { uid: "918299013350", body: { driverUid: "918299013350", planType: "daily" } });
  ok(r.status === 200, "after expiry -> create-order allowed again (re-purchase works)");
} catch (e) {
  fail++; console.error("PROOF EXCEPTION", e);
} finally {
  server.close();
  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}
