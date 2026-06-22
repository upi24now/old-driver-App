/**
 * Phase 3D-C — Wallet + transactions backfill: Firestore → PostgreSQL
 *
 * Reads the Firestore `wallets` and `transactions` collections and upserts them
 * into PG `driver_wallets` / `wallet_transactions` so the dual-read comparison
 * can match.
 *
 * Guardrails:
 *   • Does NOT change balance calculations — Firestore amounts are copied EXACTLY
 *     (payout sign preserved as-is for audit fidelity).
 *   • Idempotent — safe to rerun. Credits dedupe on (driver_uid, order_id, type);
 *     payouts/adjustments dedupe on (driver_uid, type, amount, created_at|description).
 *   • Does NOT switch reads, touch mobile, alter routes, or remove Firestore.
 *
 * Logs:
 *   [PG_WALLET_BACKFILL]        — wallet row upserted
 *   [PG_WALLET_BACKFILL_ERROR]  — wallet upsert failed (non-fatal, continues)
 *   [PG_TX_BACKFILL]            — transaction inserted
 *   [PG_TX_BACKFILL_SKIP]       — transaction skipped (already present / invalid)
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
}, "backfill-wallet");

const fsDb = getFirestore(app);

// ── helpers ─────────────────────────────────────────────────────────────────
const numStr = (v) => {
  if (typeof v === "number" && !isNaN(v)) return v.toFixed(2);
  if (typeof v === "string" && v !== "" && !isNaN(parseFloat(v))) return parseFloat(v).toFixed(2);
  return "0.00";
};
const intV = (v) => (typeof v === "number" ? Math.round(v) : (typeof v === "string" && !isNaN(parseInt(v, 10)) ? parseInt(v, 10) : 0));
const str  = (v) => (typeof v === "string" ? v : null);
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.toMillis === "function") return new Date(v.toMillis());
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  return null;
}
// stable dedupe key for a transaction
function txKey(type, orderId, amount, createdAt, description) {
  if (orderId) return `${type}|order:${orderId}`;
  const t = createdAt ? new Date(createdAt).getTime() : (description ?? "");
  return `${type}|${numStr(amount)}|${t}`;
}

// ── 1. Wallets ───────────────────────────────────────────────────────────────
console.log("Fetching Firestore wallets …");
const walletSnap = await fsDb.collection("wallets").get();
console.log(`Found ${walletSnap.docs.length} wallet(s).\n`);

let walletOk = 0, walletErr = 0;
for (const doc of walletSnap.docs) {
  const uid  = doc.id;
  const data = doc.data();
  const balance    = numStr(data.balance);
  const earnings   = numStr(data.totalEarnings);
  const paid       = numStr(data.totalPaid);
  const completed  = intV(data.completedDeliveries);
  const updatedAt  = toDate(data.lastUpdatedAt) ?? new Date();

  try {
    await pool.query(
      `INSERT INTO driver_wallets
         (driver_uid, balance, total_earnings, total_paid, completed_deliveries, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (driver_uid) DO UPDATE SET
         balance              = EXCLUDED.balance,
         total_earnings       = EXCLUDED.total_earnings,
         total_paid           = EXCLUDED.total_paid,
         completed_deliveries = EXCLUDED.completed_deliveries,
         updated_at           = EXCLUDED.updated_at`,
      [uid, balance, earnings, paid, completed, updatedAt],
    );
    walletOk++;
    console.log(`[PG_WALLET_BACKFILL] uid=${uid} balance=${balance} earnings=${earnings} paid=${paid} completed=${completed}`);
  } catch (err) {
    walletErr++;
    console.error(`[PG_WALLET_BACKFILL_ERROR] uid=${uid} ${err.message}`);
  }
}

// ── 2. Transactions ──────────────────────────────────────────────────────────
console.log("\nFetching Firestore transactions …");
const txSnap = await fsDb.collection("transactions").get();
console.log(`Found ${txSnap.docs.length} transaction doc(s).\n`);

// preload existing PG keys per driver so reruns are idempotent
const existing = await pool.query(
  "SELECT driver_uid, order_id, type, amount, created_at FROM wallet_transactions");
const existingKeys = new Set();
for (const r of existing.rows) {
  existingKeys.add(`${r.driver_uid}::${txKey(r.type, r.order_id, r.amount, r.created_at, null)}`);
}

let txOk = 0, txSkip = 0;
let payoutNeg = 0, payoutPos = 0, payoutZero = 0;

for (const doc of txSnap.docs) {
  const d = doc.data();
  const uid = str(d.driverUid);
  const type = str(d.type);

  if (!uid || !type) {
    txSkip++;
    console.log(`[PG_TX_BACKFILL_SKIP] doc=${doc.id} reason=missing driverUid/type`);
    continue;
  }

  const orderId     = str(d.orderId);
  const status      = str(d.status) ?? "completed";
  const description = str(d.description);
  const createdAt   = toDate(d.createdAt) ?? toDate(d.requestedAt);

  // Strict amount parse — never coerce a malformed ledger amount to 0 (that would
  // corrupt the ledger). Skip + log instead so the row is surfaced, not silently zeroed.
  const rawAmount = d.amount;
  const amountNum =
    typeof rawAmount === "number" ? rawAmount
    : (typeof rawAmount === "string" && rawAmount !== "" && !isNaN(parseFloat(rawAmount)) ? parseFloat(rawAmount) : null);
  if (amountNum === null || !isFinite(amountNum)) {
    txSkip++;
    console.log(`[PG_TX_BACKFILL_SKIP] doc=${doc.id} uid=${uid} type=${type} reason=malformed amount`);
    continue;
  }
  const amount = amountNum.toFixed(2);              // EXACT Firestore amount (sign preserved)

  // Deterministic identity required for safe rerun: a row with neither orderId nor a
  // timestamp has no stable dedupe key (timestamp fallback would drift each run), so
  // skip + log loudly rather than risk a duplicate insert. All real ledger rows have one.
  if (!orderId && !createdAt) {
    txSkip++;
    console.log(`[PG_TX_BACKFILL_SKIP] doc=${doc.id} uid=${uid} type=${type} reason=insufficient identity (no orderId, no timestamp)`);
    continue;
  }
  // When orderId is present the dedupe key is order-based, so the stored timestamp does
  // not affect idempotency; only this branch may use a non-key fallback time.
  const createdAtFinal = createdAt ?? new Date();

  // report payout sign (do not alter)
  if (type === "payout") {
    amountNum < 0 ? payoutNeg++ : amountNum > 0 ? payoutPos++ : payoutZero++;
  }

  const key = `${uid}::${txKey(type, orderId, amount, createdAt, description)}`;
  if (existingKeys.has(key)) {
    txSkip++;
    console.log(`[PG_TX_BACKFILL_SKIP] doc=${doc.id} uid=${uid} type=${type} order=${orderId ?? "-"} reason=already present`);
    continue;
  }

  try {
    await pool.query(
      `INSERT INTO wallet_transactions
         (driver_uid, order_id, type, amount, status, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid, orderId, type, amount, status, description, createdAtFinal],
    );
    existingKeys.add(key);
    txOk++;
    const sign = parseFloat(amount) < 0 ? "negative" : parseFloat(amount) > 0 ? "positive" : "zero";
    console.log(`[PG_TX_BACKFILL] doc=${doc.id} uid=${uid} type=${type} order=${orderId ?? "-"} amount=${amount} (${sign}) status=${status}`);
  } catch (err) {
    txSkip++;
    console.log(`[PG_TX_BACKFILL_SKIP] doc=${doc.id} uid=${uid} reason=${err.message}`);
  }
}

// ── 3. Summary ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("  PHASE 3D-C — BACKFILL SUMMARY");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  Wallets upserted : ${walletOk}  (errors: ${walletErr})`);
console.log(`  Txns inserted    : ${txOk}`);
console.log(`  Txns skipped     : ${txSkip}`);
console.log(`  Payout signs (FS, preserved): negative=${payoutNeg} positive=${payoutPos} zero=${payoutZero}`);
console.log("══════════════════════════════════════════════════════════════");

await pool.end();
process.exit(0);
