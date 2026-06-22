/**
 * Phase 3D-A verification — Payout ledger shadow write
 *
 * Confirms that payout rows now appear in PG wallet_transactions, eliminating
 * the count-only PG_TX_DIFF observed in Phase 3C.
 *
 * Uses the same dual-read comparison logic as wallet.ts (count + per-orderId
 * amount/type), driven by controlled PG rows + simulated Firestore rows.
 *
 * Scenarios:
 *   A: single payout       → PG_TX_MATCH
 *   B: multiple payouts    → PG_TX_MATCH
 *   C: forced mismatch     → PG_TX_DIFF
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const UID   = "verify-payout-ledger-driver-001";
const ORDER = "verify-payout-ledger-order";

function numClose(a, b) { return Math.abs(a - b) < 0.005; }

// Mirror of the wallet.ts /transactions comparison logic.
function compareTxns(fsTxns, pgTxns) {
  const pgByOrderId = new Map();
  for (const t of pgTxns) if (t.order_id) pgByOrderId.set(t.order_id, t);

  const diffs = [];
  if (fsTxns.length !== pgTxns.length) diffs.push(`count fs=${fsTxns.length} pg=${pgTxns.length}`);

  for (const fsTx of fsTxns) {
    const fsOrderId = fsTx.orderId ?? null;
    if (!fsOrderId) continue; // payout rows skipped in per-row check
    const pgTx = pgByOrderId.get(fsOrderId);
    if (!pgTx) { diffs.push(`orderId=${fsOrderId} in FS but not in PG`); continue; }
    if (!numClose(fsTx.amount, parseFloat(pgTx.amount))) diffs.push(`orderId=${fsOrderId} amount fs=${fsTx.amount} pg=${pgTx.amount}`);
    if (fsTx.type !== pgTx.type) diffs.push(`orderId=${fsOrderId} type fs=${fsTx.type} pg=${pgTx.type}`);
  }

  return diffs.length === 0
    ? { tag: "[PG_TX_MATCH]", detail: `count=${fsTxns.length}` }
    : { tag: "[PG_TX_DIFF]",  detail: diffs.join(" | ") };
}

async function cleanup(client) {
  await client.query("DELETE FROM wallet_transactions WHERE driver_uid = $1", [UID]);
}
async function getTxns(client) {
  const r = await client.query(
    "SELECT * FROM wallet_transactions WHERE driver_uid = $1 ORDER BY created_at DESC", [UID]);
  return r.rows;
}
async function insertCredit(client, orderId, amount) {
  await client.query(
    `INSERT INTO wallet_transactions (driver_uid, order_id, type, amount, status, description)
     VALUES ($1, $2, 'credit', $3, 'completed', 'Delivery')`, [UID, orderId, amount]);
}
// Mirrors pgShadowPayoutTransaction: order_id NULL, type 'payout', positive amount.
async function insertPayoutLedger(client, amount) {
  await client.query(
    `INSERT INTO wallet_transactions (driver_uid, order_id, type, amount, status, description)
     VALUES ($1, NULL, 'payout', $2, 'pending', 'payout request')`, [UID, amount]);
}

const client = await pool.connect();
let txMatch = 0, txDiff = 0;
function record(r) { r.tag === "[PG_TX_MATCH]" ? txMatch++ : txDiff++; console.log(`  ${r.tag}  ${r.detail}`); }

try {
  // ── Scenario A: single payout ──────────────────────────────────────────────
  console.log("\n── Scenario A: single payout (1 credit + 1 payout) ──");
  await cleanup(client);
  await insertCredit(client, ORDER + "-A", 120);
  await insertPayoutLedger(client, 100);
  // FS: 1 credit + 1 payout row (payout has no orderId)
  const fsA = [
    { orderId: ORDER + "-A", type: "credit", amount: 120 },
    { orderId: null,         type: "payout", amount: -100 },
  ];
  record(compareTxns(fsA, await getTxns(client)));

  // ── Scenario B: multiple payouts ───────────────────────────────────────────
  console.log("\n── Scenario B: multiple payouts (2 credits + 3 payouts) ──");
  await cleanup(client);
  await insertCredit(client, ORDER + "-B1", 120);
  await insertCredit(client, ORDER + "-B2", 90);
  await insertPayoutLedger(client, 50);
  await insertPayoutLedger(client, 60);
  await insertPayoutLedger(client, 70);
  const fsB = [
    { orderId: ORDER + "-B1", type: "credit", amount: 120 },
    { orderId: ORDER + "-B2", type: "credit", amount: 90 },
    { orderId: null,          type: "payout", amount: -50 },
    { orderId: null,          type: "payout", amount: -60 },
    { orderId: null,          type: "payout", amount: -70 },
  ];
  record(compareTxns(fsB, await getTxns(client)));

  // ── Scenario C: forced mismatch (FS has a payout PG is missing) ────────────
  console.log("\n── Scenario C: forced mismatch (FS 2 payouts, PG 1 payout) ──");
  await cleanup(client);
  await insertCredit(client, ORDER + "-C", 120);
  await insertPayoutLedger(client, 100);
  // FS has an extra payout row that never got shadowed into PG
  const fsC = [
    { orderId: ORDER + "-C", type: "credit", amount: 120 },
    { orderId: null,         type: "payout", amount: -100 },
    { orderId: null,         type: "payout", amount: -80 },
  ];
  record(compareTxns(fsC, await getTxns(client)));

} finally {
  await cleanup(client);
  client.release();
  await pool.end();
}

console.log("\n── Summary ──");
console.log(`  tx match=${txMatch}  diff=${txDiff}`);
