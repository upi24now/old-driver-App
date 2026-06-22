/**
 * Phase 3D-B — Wallet PG-primary readiness audit (READ-ONLY)
 *
 * Compares Firestore (source of truth) against PostgreSQL (shadow) for every
 * driver that exists in either store, and emits a promotion-readiness verdict.
 *
 * NO writes of any kind. NO Firestore changes. NO read switching.
 *
 * Reports:
 *   PG_WALLET_MATCH / PG_WALLET_DIFF  counts
 *   PG_TX_MATCH    / PG_TX_DIFF       counts
 *   onlyInFirestore / onlyInPostgres  transactions (bidirectional)
 *   duplicate credit rows (driver_uid + order_id + type='credit')
 *   payout sign convention (FS vs PG)
 *   verdict: READY_FOR_PG_PRIMARY | NOT_READY
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_PROJECT_ID,
}, "audit-readiness");

const fsDb = getFirestore(app);

// ── helpers ─────────────────────────────────────────────────────────────────
function numClose(a, b) { return Math.abs(a - b) < 0.005; }
const N = (v) => (typeof v === "number" ? v : (typeof v === "string" && v !== "" && !isNaN(parseFloat(v)) ? parseFloat(v) : 0));
function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return null;
}
const CREATED_AT_TOLERANCE_MS = 5 * 60 * 1000; // 5 min: shadow write lags FS commit

// ── 1. Gather every driver uid present in either store ──────────────────────
console.log("Gathering driver UIDs from Firestore wallets + PG driver_wallets …");

const fsWalletSnap = await fsDb.collection("wallets").get();
const fsWalletByUid = new Map();
for (const d of fsWalletSnap.docs) fsWalletByUid.set(d.id, d.data());

const pgWalletRes = await pool.query("SELECT * FROM driver_wallets");
const pgWalletByUid = new Map();
for (const r of pgWalletRes.rows) pgWalletByUid.set(r.driver_uid, r);

const allUids = new Set([...fsWalletByUid.keys(), ...pgWalletByUid.keys()]);
console.log(`  Firestore wallets: ${fsWalletByUid.size}`);
console.log(`  PG driver_wallets: ${pgWalletByUid.size}`);
console.log(`  Union of drivers : ${allUids.size}\n`);

// ── 2. Per-driver wallet + transaction comparison ───────────────────────────
let walletMatch = 0, walletDiff = 0, txMatch = 0, txDiff = 0;
let totalOnlyInFs = 0, totalOnlyInPg = 0;
const driverReports = [];

// payout sign tracking
let fsPayoutNeg = 0, fsPayoutPos = 0, fsPayoutZero = 0;
let pgPayoutNeg = 0, pgPayoutPos = 0, pgPayoutZero = 0;

for (const uid of allUids) {
  const fsW = fsWalletByUid.get(uid) ?? null;
  const pgW = pgWalletByUid.get(uid) ?? null;

  // ---- wallet comparison ----
  const fsBalance   = fsW ? N(fsW.balance)             : 0;
  const fsEarnings  = fsW ? N(fsW.totalEarnings)       : 0;
  const fsPaid      = fsW ? N(fsW.totalPaid)           : 0;
  const fsCompleted = fsW ? N(fsW.completedDeliveries) : 0;

  const walletDiffs = [];
  if (!pgW) {
    const allZero = fsBalance === 0 && fsEarnings === 0 && fsPaid === 0 && fsCompleted === 0;
    if (!allZero) walletDiffs.push("PG row missing but FS has data");
  } else {
    if (!numClose(fsBalance,   N(pgW.balance)))            walletDiffs.push(`balance fs=${fsBalance} pg=${pgW.balance}`);
    if (!numClose(fsEarnings,  N(pgW.total_earnings)))     walletDiffs.push(`totalEarnings fs=${fsEarnings} pg=${pgW.total_earnings}`);
    if (!numClose(fsPaid,      N(pgW.total_paid)))         walletDiffs.push(`totalPaid fs=${fsPaid} pg=${pgW.total_paid}`);
    if (fsCompleted           !== pgW.completed_deliveries) walletDiffs.push(`completedDeliveries fs=${fsCompleted} pg=${pgW.completed_deliveries}`);
    if (!fsW) walletDiffs.push("FS row missing but PG has data");
  }
  walletDiffs.length === 0 ? walletMatch++ : walletDiff++;

  // ---- transactions ----
  const fsTxSnap = await fsDb.collection("transactions").where("driverUid", "==", uid).get();
  const fsTxns = fsTxSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const pgTxRes = await pool.query(
    "SELECT * FROM wallet_transactions WHERE driver_uid = $1", [uid]);
  const pgTxns = pgTxRes.rows;

  // sign convention tally (payouts)
  for (const t of fsTxns) if (t.type === "payout") { const a = N(t.amount); a < 0 ? fsPayoutNeg++ : a > 0 ? fsPayoutPos++ : fsPayoutZero++; }
  for (const t of pgTxns) if (t.type === "payout") { const a = N(t.amount); a < 0 ? pgPayoutNeg++ : a > 0 ? pgPayoutPos++ : pgPayoutZero++; }

  // ---- bidirectional credit matching (key = orderId) ----
  const fsCredits = fsTxns.filter((t) => t.type === "credit" && typeof t.orderId === "string");
  const pgCredits = pgTxns.filter((t) => t.type === "credit" && t.order_id);
  const fsCreditByOrder = new Map(fsCredits.map((t) => [t.orderId, t]));
  const pgCreditByOrder = new Map(pgCredits.map((t) => [t.order_id, t]));

  const onlyInFs = [];
  const onlyInPg = [];
  const txDiffs  = [];

  for (const [orderId, fsTx] of fsCreditByOrder) {
    const pgTx = pgCreditByOrder.get(orderId);
    if (!pgTx) { onlyInFs.push({ orderId, type: "credit", amount: N(fsTx.amount) }); continue; }
    if (!numClose(N(fsTx.amount), N(pgTx.amount))) txDiffs.push(`credit ${orderId} amount fs=${N(fsTx.amount)} pg=${pgTx.amount}`);
    const fsStatus = typeof fsTx.status === "string" ? fsTx.status : "(none)";
    if (pgTx.status && fsStatus !== "(none)" && fsStatus !== pgTx.status) txDiffs.push(`credit ${orderId} status fs=${fsStatus} pg=${pgTx.status}`);
    const fsMs = toMillis(fsTx.createdAt), pgMs = pgTx.created_at ? new Date(pgTx.created_at).getTime() : null;
    if (fsMs && pgMs && Math.abs(fsMs - pgMs) > CREATED_AT_TOLERANCE_MS) txDiffs.push(`credit ${orderId} createdAt delta=${Math.round(Math.abs(fsMs - pgMs)/1000)}s`);
  }
  for (const [orderId, pgTx] of pgCreditByOrder) {
    if (!fsCreditByOrder.has(orderId)) onlyInPg.push({ orderId, type: "credit", amount: N(pgTx.amount) });
  }

  // ---- payouts: no orderId, compare counts (sign convention reported separately) ----
  const fsPayouts = fsTxns.filter((t) => t.type === "payout");
  const pgPayouts = pgTxns.filter((t) => t.type === "payout");
  if (fsPayouts.length !== pgPayouts.length) {
    txDiffs.push(`payout count fs=${fsPayouts.length} pg=${pgPayouts.length}`);
  }

  // overall txn count
  if (fsTxns.length !== pgTxns.length) txDiffs.push(`total count fs=${fsTxns.length} pg=${pgTxns.length}`);

  const hasTxIssue = txDiffs.length > 0 || onlyInFs.length > 0 || onlyInPg.length > 0;
  hasTxIssue ? txDiff++ : txMatch++;
  totalOnlyInFs += onlyInFs.length;
  totalOnlyInPg += onlyInPg.length;

  if (walletDiffs.length || hasTxIssue) {
    driverReports.push({ uid, walletDiffs, txDiffs, onlyInFs, onlyInPg, fsTxCount: fsTxns.length, pgTxCount: pgTxns.length });
  }
}

// ── 3. Duplicate credit rows in PG ──────────────────────────────────────────
const dupRes = await pool.query(`
  SELECT driver_uid, order_id, COUNT(*) AS n
  FROM wallet_transactions
  WHERE type = 'credit' AND order_id IS NOT NULL
  GROUP BY driver_uid, order_id
  HAVING COUNT(*) > 1
  ORDER BY n DESC
`);
const duplicateCreditRows = dupRes.rows;

// ── 4. Report ────────────────────────────────────────────────────────────────
console.log("══════════════════════════════════════════════════════════════");
console.log("  PHASE 3D-B — WALLET PG-PRIMARY READINESS REPORT");
console.log("══════════════════════════════════════════════════════════════\n");

console.log("Wallet comparison:");
console.log(`  PG_WALLET_MATCH : ${walletMatch}`);
console.log(`  PG_WALLET_DIFF  : ${walletDiff}\n`);

console.log("Transaction comparison:");
console.log(`  PG_TX_MATCH     : ${txMatch}`);
console.log(`  PG_TX_DIFF      : ${txDiff}`);
console.log(`  onlyInFirestore : ${totalOnlyInFs}`);
console.log(`  onlyInPostgres  : ${totalOnlyInPg}\n`);

console.log("Payout sign convention:");
console.log(`  Firestore payouts → negative=${fsPayoutNeg} positive=${fsPayoutPos} zero=${fsPayoutZero}`);
console.log(`  PostgreSQL payouts → negative=${pgPayoutNeg} positive=${pgPayoutPos} zero=${pgPayoutZero}`);
// Divergence = PG sign distribution does NOT mirror Firestore's. Because the
// backfill copies amounts exactly, a faithful mirror has identical counts. A
// store having an internally mixed sign (legacy FS data) is NOT divergence.
const signDivergence = fsPayoutNeg !== pgPayoutNeg || fsPayoutPos !== pgPayoutPos || fsPayoutZero !== pgPayoutZero;
const mixedSignSource = (fsPayoutNeg > 0 && fsPayoutPos > 0);
console.log(`  Sign divergence (FS vs PG): ${signDivergence ? "YES — PG does not mirror FS signs" : "no — PG mirrors FS exactly"}`);
if (mixedSignSource) console.log(`  Note: Firestore itself stores mixed-sign payouts (legacy data); PG preserves this faithfully.`);
console.log("");

console.log("Credit idempotency:");
console.log(`  Duplicate credit rows (driver_uid+order_id, type=credit): ${duplicateCreditRows.length}`);
for (const d of duplicateCreditRows.slice(0, 10)) {
  console.log(`    driver=${d.driver_uid} order=${d.order_id} count=${d.n}`);
}
console.log("");

if (driverReports.length) {
  console.log("Per-driver discrepancies:");
  for (const r of driverReports.slice(0, 20)) {
    console.log(`  • ${r.uid}  (fsTx=${r.fsTxCount} pgTx=${r.pgTxCount})`);
    for (const w of r.walletDiffs) console.log(`      wallet: ${w}`);
    for (const t of r.txDiffs)     console.log(`      tx:     ${t}`);
    if (r.onlyInFs.length) console.log(`      onlyInFirestore: ${r.onlyInFs.map((x) => x.orderId).join(", ")}`);
    if (r.onlyInPg.length) console.log(`      onlyInPostgres:  ${r.onlyInPg.map((x) => x.orderId).join(", ")}`);
  }
  console.log("");
}

// ── 5. Verdict ────────────────────────────────────────────────────────────────
const blockers = [];
if (walletDiff > 0)               blockers.push(`${walletDiff} wallet diff(s)`);
if (txDiff > 0)                   blockers.push(`${txDiff} transaction diff(s)`);
if (totalOnlyInFs > 0)            blockers.push(`${totalOnlyInFs} txn(s) only in Firestore`);
if (duplicateCreditRows.length)   blockers.push(`${duplicateCreditRows.length} duplicate credit row group(s)`);
if (signDivergence)               blockers.push("payout sign convention divergence");

console.log("══════════════════════════════════════════════════════════════");
if (blockers.length === 0) {
  console.log("  VERDICT: READY_FOR_PG_PRIMARY");
} else {
  console.log("  VERDICT: NOT_READY");
  console.log("  Blockers:");
  for (const b of blockers) console.log(`    - ${b}`);
}
console.log("══════════════════════════════════════════════════════════════");

await pool.end();
process.exit(0);
