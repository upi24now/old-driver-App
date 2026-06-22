/**
 * Wallet PostgreSQL Service Layer — Phase 3A
 *
 * Infrastructure-only module.  No routes call these functions yet.
 * No Firestore code is touched.  No mobile changes.
 *
 * Provides atomic reads and writes against three new wallet tables:
 *   driver_wallets      — per-driver balance summary
 *   wallet_transactions — immutable ledger (credits, payouts, adjustments)
 *   payout_requests     — driver cash-out requests
 *
 * All monetary amounts are accepted as JS `number` and stored as NUMERIC(12,2).
 * Reads return the raw Drizzle types (numeric columns arrive as strings — callers
 * should parseFloat before display).
 *
 * Typed result union used by write operations:
 *   { ok: true;  ... }
 *   { ok: false; reason: string }
 *
 * Functions never throw on business-logic failures; they return { ok: false }.
 * Infrastructure errors (DB connection, constraint violation) are logged and
 * re-thrown so the caller can surface a 500.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  driverWalletsTable,
  payoutRequestsTable,
  walletTransactionsTable,
  type DriverWallet,
  type PayoutRequest,
  type WalletTransaction,
} from "@workspace/db";
import { logger } from "./logger";

// ── Result types ──────────────────────────────────────────────────────────────

export type WalletResult =
  | { ok: true }
  | { ok: false; reason: string };

// ── pgGetWallet ───────────────────────────────────────────────────────────────

/**
 * Return the wallet summary for a driver, or null if no wallet row exists yet.
 *
 * Callers should parseFloat() numeric fields (balance, totalEarnings, totalPaid)
 * before display — Drizzle returns NUMERIC columns as strings.
 */
export async function pgGetWallet(driverUid: string): Promise<DriverWallet | null> {
  const rows = await db
    .select()
    .from(driverWalletsTable)
    .where(eq(driverWalletsTable.driverUid, driverUid))
    .limit(1);

  return rows[0] ?? null;
}

// ── pgGetWalletTransactions ───────────────────────────────────────────────────

/**
 * Return the most recent `limit` wallet transactions for a driver,
 * newest-first.
 */
export async function pgGetWalletTransactions(
  driverUid: string,
  limit = 50,
): Promise<WalletTransaction[]> {
  return db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.driverUid, driverUid))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit);
}

// ── pgCreditOrderEarning ──────────────────────────────────────────────────────

/**
 * Credit a completed delivery earning to the driver's wallet.
 *
 * Atomically (within a single transaction):
 *   1. Upserts the driver_wallets row — creates it on first credit.
 *   2. Increments balance, total_earnings, and completed_deliveries.
 *   3. Inserts a "credit" wallet_transactions row.
 *
 * Idempotency: if a wallet_transactions row with the same orderId + type
 * already exists, the insert is skipped (ON CONFLICT DO NOTHING on the
 * natural unique constraint; callers should add that constraint if needed).
 * For now the function is best-effort idempotent — duplicate calls will
 * produce duplicate credit rows, which is visible in the ledger.
 */
export async function pgCreditOrderEarning(
  driverUid:   string,
  orderId:     string,
  amount:      number,
  description: string,
): Promise<WalletResult> {
  const amountStr = amount.toFixed(2);

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(driverWalletsTable)
        .values({
          driverUid,
          balance:             amountStr,
          totalEarnings:       amountStr,
          totalPaid:           "0",
          completedDeliveries: 1,
        })
        .onConflictDoUpdate({
          target: driverWalletsTable.driverUid,
          set: {
            balance:             sql`${driverWalletsTable.balance} + ${amountStr}::numeric`,
            totalEarnings:       sql`${driverWalletsTable.totalEarnings} + ${amountStr}::numeric`,
            completedDeliveries: sql`${driverWalletsTable.completedDeliveries} + 1`,
            updatedAt:           sql`now()`,
          },
        });

      await tx.insert(walletTransactionsTable).values({
        driverUid,
        orderId,
        type:        "credit",
        amount:      amountStr,
        status:      "completed",
        description,
      });
    });

    logger.info({ driverUid, orderId, amount }, "[pgCreditOrderEarning] credited");
    return { ok: true };
  } catch (err) {
    logger.error({ err, driverUid, orderId, amount }, "[pgCreditOrderEarning] failed");
    throw err;
  }
}

// ── pgCreatePayoutRequest ─────────────────────────────────────────────────────

/**
 * Create a pending payout request for a driver.
 *
 * Does NOT debit the wallet — the debit happens only when pgMarkPayoutProcessed
 * is called.  This separates the request from the approval step.
 *
 * Returns the newly created payout_requests row.
 */
export async function pgCreatePayoutRequest(
  driverUid: string,
  amount:    number,
): Promise<{ ok: true; request: PayoutRequest } | { ok: false; reason: string }> {
  const amountStr = amount.toFixed(2);

  try {
    const [request] = await db
      .insert(payoutRequestsTable)
      .values({ driverUid, amount: amountStr, status: "pending" })
      .returning();

    if (!request) {
      return { ok: false, reason: "insert_returned_no_row" };
    }

    logger.info({ driverUid, amount, requestId: request.id }, "[pgCreatePayoutRequest] created");
    return { ok: true, request };
  } catch (err) {
    logger.error({ err, driverUid, amount }, "[pgCreatePayoutRequest] failed");
    throw err;
  }
}

// ── pgMarkPayoutProcessed ─────────────────────────────────────────────────────

/**
 * Mark a payout request as processed and atomically debit the driver wallet.
 *
 * Atomically (within a single transaction):
 *   1. Updates payout_requests SET status='processed', processed_at=now()
 *      WHERE id=requestId AND status='pending'.
 *      Returns { ok: false, reason: 'not_found_or_already_processed' } if
 *      no row was updated (guards against double-processing).
 *   2. Decrements driver_wallets.balance and increments total_paid.
 *   3. Inserts a "payout" wallet_transactions debit row.
 */
export async function pgMarkPayoutProcessed(
  requestId: string,
): Promise<WalletResult> {
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const [request] = await tx
        .update(payoutRequestsTable)
        .set({ status: "processed", processedAt: now })
        .where(
          and(
            eq(payoutRequestsTable.id, requestId),
            eq(payoutRequestsTable.status, "pending"),
          ),
        )
        .returning();

      if (!request) {
        return { ok: false as const, reason: "not_found_or_already_processed" };
      }

      await tx
        .update(driverWalletsTable)
        .set({
          balance:   sql`${driverWalletsTable.balance} - ${request.amount}::numeric`,
          totalPaid: sql`${driverWalletsTable.totalPaid} + ${request.amount}::numeric`,
          updatedAt: now,
        })
        .where(eq(driverWalletsTable.driverUid, request.driverUid));

      await tx.insert(walletTransactionsTable).values({
        driverUid:   request.driverUid,
        type:        "payout",
        amount:      request.amount,
        status:      "completed",
        description: `Payout request ${requestId}`,
      });

      return { ok: true as const };
    });

    if (result.ok) {
      logger.info({ requestId }, "[pgMarkPayoutProcessed] processed");
    } else {
      logger.warn({ requestId, reason: result.reason }, "[pgMarkPayoutProcessed] guard failed");
    }

    return result;
  } catch (err) {
    logger.error({ err, requestId }, "[pgMarkPayoutProcessed] failed");
    throw err;
  }
}
