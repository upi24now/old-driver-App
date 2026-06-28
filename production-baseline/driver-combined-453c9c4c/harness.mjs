// Deterministic, side-effect-free harness for the [BCD] combined additive block.
// Runs INSERTED-BLOCK.js with MOCK bindings (no live Firebase / no live PG) and
// asserts route registration + the critical behaviors. Exit code 0 = all pass.
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

// ---- in-memory Firestore mock -------------------------------------------------
const ST = Symbol("serverTimestamp");
const FieldValue = { serverTimestamp: () => ST };
const store = new Map(); // key: docId (orders/drivers) or "coll/auto" ; value: data obj
function resolveSentinels(obj) {
  const o = { ...obj };
  for (const k in o) if (o[k] === ST) o[k] = new Date();
  return o;
}
function applyMerge(id, upd) { store.set(id, { ...(store.get(id) || {}), ...resolveSentinels(upd) }); }
function snap(id) { const d = store.get(id); return { exists: d !== undefined, id, data: () => d }; }
function matchWhere(d, field, op, val) {
  const v = d ? d[field] : undefined;
  if (op === "array-contains") return Array.isArray(v) && v.includes(val);
  if (op === "==") return v === val;
  return false;
}
function collRef(name) {
  return {
    doc: (id) => docRef(id),
    where: (field, op, val) => ({
      get: async () => {
        const docs = [];
        for (const [id, d] of store) if (!id.includes("/") && matchWhere(d, field, op, val)) docs.push({ id, data: () => d });
        return { forEach: (cb) => docs.forEach(cb), size: docs.length };
      },
    }),
    add: async (obj) => { const id = name + "/auto_" + Math.random().toString(36).slice(2); store.set(id, resolveSentinels(obj)); return { id }; },
  };
}
function docRef(id) {
  return { id, get: async () => snap(id), set: async (upd) => { applyMerge(id, upd); return {}; } };
}
const db2 = {
  collection: (name) => collRef(name),
  doc: (path) => { const parts = path.split("/"); return docRef(parts[parts.length - 1] === undefined ? path : (parts.length === 2 ? parts[1] : path)); },
  runTransaction: async (fn) => {
    const tx = { get: async (ref) => snap(ref.id), update: (ref, upd) => applyMerge(ref.id, upd) };
    return await fn(tx);
  },
};

// ---- in-memory PG mock --------------------------------------------------------
const wallets = new Map(); // driver_uid -> {balance, total_earnings, completed_deliveries}
const txns = [];           // {driver_uid,type,amount,order_id}
const driversPg = new Map(); // uid -> {push_token,...}
function pgQuery(text, params = []) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK")) return { rowCount: 0, rows: [] };
  if (t.startsWith("UPDATE drivers SET push_token")) {
    const [token, type, plat, uid] = params; driversPg.set(uid, { push_token: token, push_token_type: type, push_token_platform: plat });
    return { rowCount: 1, rows: [] };
  }
  if (t.startsWith("SELECT 1 FROM wallet_transactions WHERE order_id")) {
    const [orderId] = params; const hit = txns.some((x) => x.order_id === orderId && (x.type === "credit" || x.type === "cash_collected"));
    return { rowCount: hit ? 1 : 0, rows: hit ? [{ "?column?": 1 }] : [] };
  }
  if (t.startsWith("INSERT INTO driver_wallets")) {
    const [uid] = params; if (!wallets.has(uid)) wallets.set(uid, { balance: 0, total_earnings: 0, completed_deliveries: 0 });
    return { rowCount: 1, rows: [] };
  }
  if (t.startsWith("SELECT balance FROM driver_wallets")) {
    const [uid] = params; const w = wallets.get(uid); return { rowCount: w ? 1 : 0, rows: w ? [{ balance: String(w.balance) }] : [] };
  }
  if (t.startsWith("UPDATE driver_wallets SET balance")) {
    const [bal, addEarn, uid] = params; const w = wallets.get(uid) || { balance: 0, total_earnings: 0, completed_deliveries: 0 };
    w.balance = Number(bal); w.total_earnings = Number(w.total_earnings) + Number(addEarn); w.completed_deliveries += 1; wallets.set(uid, w);
    return { rowCount: 1, rows: [] };
  }
  if (t.startsWith("INSERT INTO wallet_transactions")) {
    const isCash = t.includes("'cash_collected'");
    if (isCash) { const [uid, , orderId, before] = params; txns.push({ driver_uid: uid, type: "cash_collected", amount: "0", order_id: orderId, balance_before: before }); }
    else { const [uid, amount, , orderId, before, after] = params; txns.push({ driver_uid: uid, type: "credit", amount, order_id: orderId, balance_before: before, balance_after: after }); }
    return { rowCount: 1, rows: [] };
  }
  throw new Error("UNHANDLED SQL in harness: " + t);
}
const pool = { query: async (t, p) => pgQuery(t, p), connect: async () => ({ query: async (t, p) => pgQuery(t, p), release() {} }) };

// ---- auth + driverAuth + razorpay mocks --------------------------------------
const auth = { verifyIdToken: async (tok) => { if (typeof tok === "string" && tok.startsWith("VALID:")) return { uid: tok.slice(6) }; throw new Error("bad token"); } };
async function driverAuth(req, res, next) {
  const h = req.headers["authorization"] || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized — missing token" });
  try { const d = await auth.verifyIdToken(h.slice(7).trim()); req.driverUid = d.uid; next(); }
  catch { res.status(401).json({ error: "Unauthorized — invalid or expired token" }); }
}
const import_razorpay = { default: class { constructor() { this.orders = { create: async (o) => ({ id: "order_test_" + o.amount, amount: o.amount, currency: o.currency }) }; } } };

// ---- express app + inject block ----------------------------------------------
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = logger; next(); });

const blockText = readFileSync(new URL("./INSERTED-BLOCK.js", import.meta.url), "utf8");
// direct eval: the IIFE resolves app/auth/db2/pool/FieldValue/import_razorpay/driverAuth/logger from this scope
eval(blockText);

// ---- test driver --------------------------------------------------------------
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

try {
  console.log("\n== PART A: driver-plans ==");
  ok((await call("POST", "/api/driver-plans/create-order")).status === 401, "create-order no auth -> 401 (registered, not 404)");
  let r = await call("POST", "/api/driver-plans/create-order", { uid: "driverA", body: { driverUid: "driverA", planType: "weekly" } });
  ok(r.status === 200 && r.json.amount === 1900 && r.json.razorpayOrderId && r.json.keyId === "rzp_test_dummy", "create-order weekly -> 200 amount=1900 + razorpayOrderId + keyId");
  r = await call("POST", "/api/driver-plans/create-order", { uid: "driverA", body: { driverUid: "driverA", planType: "yearly" } });
  ok(r.status === 400, "create-order invalid planType -> 400");
  r = await call("POST", "/api/driver-plans/create-order", { uid: "driverA", body: { driverUid: "driverB", planType: "weekly" } });
  ok(r.status === 403, "create-order token/driver mismatch -> 403");

  const oId = "order_test_1900", pId = "pay_abc";
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "driverA", body: { driverUid: "driverA", planType: "weekly", razorpayOrderId: oId, razorpayPaymentId: pId, razorpaySignature: hmac(oId, pId) } });
  const drv = store.get("driverA") || {};
  ok(r.status === 200 && r.json.ok === true && drv.subscriptionPlan === "weekly" && Math.abs((drv.planExpiryAt - drv.planStartAt) - 7 * 864e5) < 1000, "verify-payment valid HMAC -> 200 + Firestore weekly 7d window");
  r = await call("POST", "/api/driver-plans/verify-payment", { uid: "driverA", body: { driverUid: "driverA", planType: "weekly", razorpayOrderId: oId, razorpayPaymentId: pId, razorpaySignature: "deadbeef" } });
  ok(r.status === 400, "verify-payment bad signature -> 400");

  store.set("driverF", { onboardingFeeApplies: true });
  r = await call("POST", "/api/driver-plans/onboarding-fee/create-order", { uid: "driverF", body: { driverUid: "driverF" } });
  ok(r.status === 200 && r.json.amount === 1000 && r.json.currency === "INR", "onboarding create-order -> 200 amount=1000 paise (floor ₹10)");
  const fO = "order_test_1000", fP = "pay_fee";
  r = await call("POST", "/api/driver-plans/onboarding-fee/verify-payment", { uid: "driverF", body: { driverUid: "driverF", razorpayOrderId: fO, razorpayPaymentId: fP, razorpaySignature: hmac(fO, fP) } });
  const drvF = store.get("driverF") || {};
  ok(r.status === 200 && r.json.ok === true && drvF.onboardingFeeStatus === "paid" && drvF.registrationFeePaid === true, "onboarding verify -> 200 + onboardingFeeStatus=paid + registrationFeePaid");

  console.log("\n== PART B: delivery ==");
  ok((await call("PATCH", "/api/drivers/me/fcm-token")).status === 401, "fcm-token no auth -> 401");
  ok((await call("GET", "/api/drivers/me/fcm-token", { uid: "driverA" })).status === 404, "GET on PATCH-only fcm-token -> 404 (method control)");
  r = await call("PATCH", "/api/drivers/me/fcm-token", { uid: "driverA", body: { fcmToken: "ExponentPushToken[xyz]" } });
  ok(r.status === 200 && r.json.ok === true && r.json.saved === true && driversPg.get("driverA").push_token_type === "expo", "fcm-token PATCH -> saved + type=expo");

  store.set("ord_active", { driverUid: "driverA", status: "to_drop", fareEstimate: 50, createdAt: new Date(), paymentMode: "UPI" });
  store.set("ord_done", { driverUid: "driverA", status: "delivered", fareEstimate: 50, createdAt: new Date() });
  r = await call("GET", "/api/drivers/driverA/active-orders", { uid: "driverA" });
  ok(r.status === 200 && r.json.ok === true && r.json.orders.length === 1 && r.json.orders[0].id === "ord_active", "active-orders -> only non-terminal owned order");
  ok((await call("GET", "/api/drivers/driverA/active-orders", { uid: "driverB" })).status === 403, "active-orders cross-uid -> 403");

  store.set("ord_offer", { status: "searching", activeOfferDriverUids: ["driverA", "driverB"], fareEstimate: 120, createdAt: new Date(), paymentMode: "UPI" });
  r = await call("POST", "/api/orders/ord_offer/accept", { uid: "driverA", body: {} });
  const od = store.get("ord_offer");
  ok(r.status === 200 && r.json.ok === true && od.driverUid === "driverA" && od.status === "driver_assigned" && Array.isArray(od.activeOfferDriverUids) && od.activeOfferDriverUids.length === 0, "accept first-wins -> driver_assigned + offers cleared");
  r = await call("POST", "/api/orders/ord_offer/accept", { uid: "driverB", body: {} });
  ok(r.json.ok === false && r.json.reason === "already_claimed", "second accept (other driver) -> already_claimed");
  r = await call("POST", "/api/orders/ord_offer/accept", { uid: "driverA", body: {} });
  ok(r.json.ok === true, "re-accept same owner -> idempotent ok");
  store.set("ord_other", { status: "searching", activeOfferDriverUids: ["driverZ"], createdAt: new Date() });
  r = await call("POST", "/api/orders/ord_other/accept", { uid: "driverA", body: {} });
  ok(r.json.ok === false && r.json.reason === "not_in_offer", "accept not in offer -> not_in_offer");
  r = await call("POST", "/api/orders/nope/accept", { uid: "driverA", body: {} });
  ok(r.json.ok === false && r.json.reason === "order_missing", "accept missing order -> order_missing");
  store.set("ord_exp", { status: "searching", activeOfferDriverUids: ["driverA"], offerStartedAt: { driverA: new Date(Date.now() - 5 * 60000) }, createdAt: new Date() });
  r = await call("POST", "/api/orders/ord_exp/accept", { uid: "driverA", body: {} });
  ok(r.json.ok === false && r.json.reason === "expired", "accept past TTL -> expired");

  r = await call("PATCH", "/api/orders/ord_offer/stage", { uid: "driverA", body: { stage: "to_pickup" } });
  ok(r.json.ok === true && store.get("ord_offer").status === "to_pickup", "stage to_pickup (owner) -> status=to_pickup (identity)");
  r = await call("PATCH", "/api/orders/ord_offer/stage", { uid: "driverB", body: { stage: "at_pickup" } });
  ok(r.json.ok === false, "stage by non-owner -> ok:false");
  r = await call("PATCH", "/api/orders/ord_offer/stage", { uid: "driverA", body: { stage: "bogus" } });
  ok(r.json.ok === true && r.json.ignored === true, "stage invalid -> ignored");

  r = await call("PATCH", "/api/orders/ord_offer/location", { uid: "driverA", body: { latitude: 12.9, longitude: 77.6, accuracy: 5 } });
  ok(r.json.ok === true && store.get("ord_offer").driverLat === 12.9, "location (owner) -> merged driverLat");
  r = await call("PATCH", "/api/orders/ord_offer/location", { uid: "driverB", body: { latitude: 1, longitude: 1 } });
  ok(r.json.ignored === true, "location non-owner -> ignored");

  // complete CASH: NEVER credit balance
  store.set("ord_cash", { driverUid: "driverA", status: "at_drop", deliveryOtp: "1234", paymentMode: "Cash", fareEstimate: 80, createdAt: new Date() });
  r = await call("POST", "/api/orders/ord_cash/complete", { uid: "driverA", body: { otpEntered: "1234" } });
  const walletA1 = wallets.get("driverA");
  const cashTxn = txns.find((x) => x.order_id === "ord_cash");
  ok(r.status === 200 && r.json.ok === true && store.get("ord_cash").status === "delivered", "complete CASH otp ok -> delivered");
  ok((!walletA1 || Number(walletA1.balance) === 0) && cashTxn && cashTxn.type === "cash_collected" && cashTxn.amount === "0", "CASH -> balance UNCHANGED + cash_collected audit row amount 0");

  // complete ONLINE: credit fare
  store.set("ord_online", { driverUid: "driverA", status: "at_drop", deliveryOtp: "9999", paymentMode: "UPI", fareEstimate: 100, createdAt: new Date() });
  r = await call("POST", "/api/orders/ord_online/complete", { uid: "driverA", body: { otpEntered: "9999" } });
  const walletA2 = wallets.get("driverA");
  const credTxn = txns.find((x) => x.order_id === "ord_online");
  ok(r.status === 200 && r.json.ok === true && Number(walletA2.balance) === 100 && credTxn.type === "credit" && credTxn.amount === "100", "complete ONLINE -> balance=100 + credit txn=100");
  ok(r.json.newBalance === 100 && typeof r.json.todayDate === "string" && r.json.tripsToday >= 2, "complete response -> newBalance + todayDate + tripsToday counts both modes");
  r = await call("POST", "/api/orders/ord_online/complete", { uid: "driverA", body: { otpEntered: "0000" } });
  ok(r.status === 200 && r.json.ok === true, "complete already-delivered (idempotent) -> ok even with wrong otp");
  ok(Number(wallets.get("driverA").balance) === 100, "idempotent complete -> NO double credit");
  store.set("ord_otp", { driverUid: "driverA", status: "at_drop", deliveryOtp: "1111", paymentMode: "UPI", fareEstimate: 60, createdAt: new Date() });
  r = await call("POST", "/api/orders/ord_otp/complete", { uid: "driverA", body: { otpEntered: "2222" } });
  ok(r.status === 422 && r.json.error === "otp_mismatch", "complete wrong OTP -> 422 otp_mismatch");
  r = await call("POST", "/api/orders/ghost/complete", { uid: "driverA", body: { otpEntered: "1" } });
  ok(r.status === 404 && r.json.error === "order_missing", "complete missing order -> 404");
} catch (e) {
  fail++; console.error("HARNESS EXCEPTION", e);
} finally {
  server.close();
  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}
