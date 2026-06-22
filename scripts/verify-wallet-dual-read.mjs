/**
 * Phase 3C verification — Wallet dual-read comparison smoke test
 *
 * Exercises the four comparison scenarios without needing a live Firebase
 * auth token by directly inserting controlled PG rows and running the
 * same comparison logic used in wallet.ts.
 *
 * Scenarios:
 *   1. Empty wallet        — FS zero, PG no row     → WALLET_MATCH (both empty)
 *   2. Wallet with earnings — FS=PG                 → WALLET_MATCH
 *   3. Wallet with payout  — FS=PG after debit      → WALLET_MATCH
 *   4. Forced mismatch     — FS ≠ PG               → WALLET_DIFF
 *
 * For transactions (scenarios 2 & 4):
 *   - Matching orderId + amount + type              → TX_MATCH
 *   - Count mismatch / missing orderId in PG        → TX_DIFF
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const UID   = "verify-dualread-test-driver-001";
const ORDER = "verify-dualread-test-order-001";

// ── helpers ───────────────────────────────────────────────────────────────────
function numClose(a, b) { return Math.abs(a - b) < 0.005; }

function compareWallet(fsWallet, pgRow) {
  const fsBalance   = fsWallet.balance             ?? 0;
  const fsEarnings  = fsWallet.totalEarnings       ?? 0;
  const fsPaid      = fsWallet.totalPaid            ?? 0;
  const fsCompleted = fsWallet.completedDeliveries  ?? 0;

  if (!pgRow) {
    const allZero = fsBalance === 0 && fsEarnings === 0 && fsPaid === 0 && fsCompleted === 0;
    return allZero
      ? { tag: "[PG_WALLET_MATCH]", detail: "both empty" }
      : { tag: "[PG_WALLET_DIFF]",  detail: `PG row missing; fs balance=${fsBalance}` };
  }

  const diffs = [];
  if (!numClose(fsBalance,   parseFloat(pgRow.balance)))              diffs.push(`balance fs=${fsBalance} pg=${pgRow.balance}`);
  if (!numClose(fsEarnings,  parseFloat(pgRow.total_earnings)))       diffs.push(`totalEarnings fs=${fsEarnings} pg=${pgRow.total_earnings}`);
  if (!numClose(fsPaid,      parseFloat(pgRow.total_paid)))           diffs.push(`totalPaid fs=${fsPaid} pg=${pgRow.total_paid}`);
  if (fsCompleted           !== pgRow.completed_deliveries)           diffs.push(`completedDeliveries fs=${fsCompleted} pg=${pgRow.completed_deliveries}`);

  return diffs.length === 0
    ? { tag: "[PG_WALLET_MATCH]", detail: `balance=${fsBalance} completedDeliveries=${fsCompleted}` }
    : { tag: "[PG_WALLET_DIFF]",  detail: diffs.join(" | ") };
}

function compareTxns(fsTxns, pgTxns) {
  const pgByOrderId = new Map();
  for (const t of pgTxns) {
    if (t.order_id) pgByOrderId.set(t.order_id, t);
  }

  const diffs = [];
  if (fsTxns.length !== pgTxns.length) {
    diffs.push(`count fs=${fsTxns.length} pg=${pgTxns.length}`);
  }
  for (const fsTx of fsTxns) {
    const fsOrderId = fsTx.orderId ?? null;
    if (!fsOrderId) continue;
    const pgTx = pgByOrderId.get(fsOrderId);
    if (!pgTx) { diffs.push(`orderId=${fsOrderId} in FS but not in PG`); continue; }
    if (!numClose(fsTx.amount, parseFloat(pgTx.amount))) diffs.push(`orderId=${fsOrderId} amount fs=${fsTx.amount} pg=${pgTx.amount}`);
    if (fsTx.type !== pgTx.type) diffs.push(`orderId=${fsOrderId} type fs=${fsTx.type} pg=${pgTx.type}`);
  }

  return diffs.length === 0
    ? { tag: "[PG_TX_MATCH]", detail: `count=${fsTxns.length}` }
    : { tag: "[PG_TX_DIFF]",  detail: diffs.join(" | ") };
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function cleanup(client) {
  await client.query("DELETE FROM wallet_transactions WHERE driver_uid = $1", [UID]);
  await client.query("DELETE FROM payout_requests     WHERE driver_uid = $1", [UID]);
  await client.query("DELETE FROM driver_wallets      WHERE driver_uid = $1", [UID]);
}

async function getWallet(client) {
  const r = await client.query("SELECT * FROM driver_wallets WHERE driver_uid = $1", [UID]);
  return r.rows[0] ?? null;
}

async function getTxns(client) {
  const r = await client.query(
    "SELECT * FROM wallet_transactions WHERE driver_uid = $1 ORDER BY created_at DESC",
    [UID]
  );
  return r.rows;
}

async function insertWallet(client, balance, totalEarnings, totalPaid, completed) {
  await client.query(`
    INSERT INTO driver_wallets (driver_uid, balance, total_earnings, total_paid, completed_deliveries)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (driver_uid) DO UPDATE SET
      balance              = EXCLUDED.balance,
      total_earnings       = EXCLUDED.total_earnings,
      total_paid           = EXCLUDED.total_paid,
      completed_deliveries = EXCLUDED.completed_deliveries,
      updated_at           = NOW()
  `, [UID, balance, totalEarnings, totalPaid, completed]);
}

async function insertTxn(client, orderId, type, amount, status) {
  await client.query(`
    INSERT INTO wallet_transactions (driver_uid, order_id, type, amount, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [UID, orderId, type, amount, status]);
}

// ── run scenarios ─────────────────────────────────────────────────────────────
const client = await pool.connect();
let walletMatch = 0, walletDiff = 0, txMatch = 0, txDiff = 0;

function record(result, kind) {
  if (kind === "wallet") { result.tag === "[PG_WALLET_MATCH]" ? walletMatch++ : walletDiff++; }
  else                   { result.tag === "[PG_TX_MATCH]"     ? txMatch++     : txDiff++;     }
  console.log(`  ${result.tag}  ${result.detail}`);
}

try {
  // ── Scenario 1: empty wallet ──────────────────────────────────────────────
  console.log("\n── Scenario 1: empty wallet ──");
  await cleanup(client);
  const fsEmpty = { balance: 0, totalEarnings: 0, totalPaid: 0, completedDeliveries: 0 };
  const pgEmpty = await getWallet(client);
  record(compareWallet(fsEmpty, pgEmpty), "wallet");

  const pgTxnsEmpty = await getTxns(client);
  record(compareTxns([], pgTxnsEmpty), "tx");

  // ── Scenario 2: wallet with earnings ─────────────────────────────────────
  console.log("\n── Scenario 2: wallet with earnings ──");
  await cleanup(client);
  await insertWallet(client, 240, 240, 0, 2);
  await insertTxn(client, ORDER + "-A", "credit", 120, "completed");
  await insertTxn(client, ORDER + "-B", "credit", 120, "completed");

  const fsEarnings = { balance: 240, totalEarnings: 240, totalPaid: 0, completedDeliveries: 2 };
  const pgEarnings = await getWallet(client);
  record(compareWallet(fsEarnings, pgEarnings), "wallet");

  const fsTxEarnings = [
    { orderId: ORDER + "-A", type: "credit", amount: 120 },
    { orderId: ORDER + "-B", type: "credit", amount: 120 },
  ];
  const pgTxEarnings = await getTxns(client);
  record(compareTxns(fsTxEarnings, pgTxEarnings), "tx");

  // ── Scenario 3: wallet with payout ───────────────────────────────────────
  console.log("\n── Scenario 3: wallet with payout ──");
  await cleanup(client);
  // After a 240 earn + 100 payout: balance=140, totalEarnings=240, totalPaid=100
  await insertWallet(client, 140, 240, 100, 2);
  await insertTxn(client, ORDER + "-A", "credit", 120, "completed");
  await insertTxn(client, ORDER + "-B", "credit", 120, "completed");
  // Payout ledger row has no orderId — mirrored in payout_requests only at this stage

  const fsPayout = { balance: 140, totalEarnings: 240, totalPaid: 100, completedDeliveries: 2 };
  const pgPayout = await getWallet(client);
  record(compareWallet(fsPayout, pgPayout), "wallet");

  // FS transactions include a payout row (no orderId) — count will differ
  const fsTxPayout = [
    { orderId: ORDER + "-A", type: "credit", amount: 120 },
    { orderId: ORDER + "-B", type: "credit", amount: 120 },
    { orderId: null,         type: "payout", amount: -100 },  // no orderId — skipped in per-row check
  ];
  const pgTxPayout = await getTxns(client); // only the 2 credit rows
  record(compareTxns(fsTxPayout, pgTxPayout), "tx");

  // ── Scenario 4: forced mismatch ───────────────────────────────────────────
  console.log("\n── Scenario 4: forced mismatch ──");
  await cleanup(client);
  // PG has 150 balance, but FS shows 200 (stale PG data)
  await insertWallet(client, 150, 150, 0, 1);
  await insertTxn(client, ORDER + "-C", "credit", 150, "completed");

  const fsMismatch = { balance: 200, totalEarnings: 200, totalPaid: 0, completedDeliveries: 1 };
  const pgMismatch = await getWallet(client);
  record(compareWallet(fsMismatch, pgMismatch), "wallet");

  // FS shows orderId-C with amount 200, PG has 150
  const fsTxMismatch = [
    { orderId: ORDER + "-C", type: "credit", amount: 200 },
  ];
  const pgTxMismatch = await getTxns(client);
  record(compareTxns(fsTxMismatch, pgTxMismatch), "tx");

} finally {
  await cleanup(client);
  client.release();
  await pool.end();
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n── Summary ──");
console.log(`  wallet match=${walletMatch}  diff=${walletDiff}`);
console.log(`  tx     match=${txMatch}      diff=${txDiff}`);
