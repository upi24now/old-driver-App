/**
 * Phase 3B verification — Wallet shadow write smoke test
 *
 * Directly exercises the same SQL that wallet-pg-service.ts runs,
 * without needing a live Firebase auth token.
 *
 * Creates:
 *   1. A credit transaction (mirrors pgCreditOrderEarning)
 *   2. A payout request   (mirrors pgCreatePayoutRequest)
 *
 * Logs:
 *   [PG_WALLET_CREDIT]   — credit row confirmed in DB
 *   [PG_PAYOUT_SHADOW]   — payout_request row confirmed in DB
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TEST_DRIVER_UID = "verify-shadow-test-driver-001";
const TEST_ORDER_ID   = "verify-shadow-test-order-001";
const TEST_FARE       = 120;
const TEST_PAYOUT     = 100;
const DESCRIPTION     = `Delivery #${TEST_ORDER_ID.slice(-6).toUpperCase()}`;

async function run() {
  const client = await pool.connect();
  try {
    // ── 1. pgCreditOrderEarning equivalent ─────────────────────────────────────
    console.log("Step 1: shadow-write wallet credit …");

    // Upsert driver_wallets
    await client.query(`
      INSERT INTO driver_wallets (driver_uid, balance, total_earnings, completed_deliveries)
      VALUES ($1, $2, $2, 1)
      ON CONFLICT (driver_uid) DO UPDATE SET
        balance              = driver_wallets.balance + EXCLUDED.balance,
        total_earnings       = driver_wallets.total_earnings + EXCLUDED.total_earnings,
        completed_deliveries = driver_wallets.completed_deliveries + 1,
        updated_at           = NOW()
    `, [TEST_DRIVER_UID, TEST_FARE]);

    // Insert wallet_transactions
    await client.query(`
      INSERT INTO wallet_transactions (driver_uid, order_id, type, amount, status, description)
      VALUES ($1, $2, 'credit', $3, 'settled', $4)
    `, [TEST_DRIVER_UID, TEST_ORDER_ID, TEST_FARE, DESCRIPTION]);

    // ── 2. pgCreatePayoutRequest equivalent ────────────────────────────────────
    console.log("Step 2: shadow-write payout request …");

    await client.query(`
      INSERT INTO payout_requests (driver_uid, amount, status)
      VALUES ($1, $2, 'pending')
    `, [TEST_DRIVER_UID, TEST_PAYOUT]);

    // ── 3. Verify & print ──────────────────────────────────────────────────────
    const walletRow = await client.query(
      "SELECT * FROM driver_wallets WHERE driver_uid = $1",
      [TEST_DRIVER_UID]
    );
    const txnRow = await client.query(
      "SELECT * FROM wallet_transactions WHERE driver_uid = $1 AND order_id = $2",
      [TEST_DRIVER_UID, TEST_ORDER_ID]
    );
    const payoutRow = await client.query(
      "SELECT * FROM payout_requests WHERE driver_uid = $1 ORDER BY requested_at DESC LIMIT 1",
      [TEST_DRIVER_UID]
    );

    console.log("\n[PG_WALLET_CREDIT] driver_wallets row:");
    console.log(walletRow.rows[0]);

    console.log("\n[PG_WALLET_CREDIT] wallet_transactions row:");
    console.log(txnRow.rows[0]);

    console.log("\n[PG_PAYOUT_SHADOW] payout_requests row:");
    console.log(payoutRow.rows[0]);

    // ── 4. Cleanup ─────────────────────────────────────────────────────────────
    console.log("\nCleaning up test rows …");
    await client.query("DELETE FROM wallet_transactions WHERE driver_uid = $1", [TEST_DRIVER_UID]);
    await client.query("DELETE FROM payout_requests WHERE driver_uid = $1", [TEST_DRIVER_UID]);
    await client.query("DELETE FROM driver_wallets WHERE driver_uid = $1", [TEST_DRIVER_UID]);
    console.log("Done — test rows removed.");

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
