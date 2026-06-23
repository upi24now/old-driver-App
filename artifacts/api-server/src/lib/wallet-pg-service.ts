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
  driversTable,
  driverWalletsTable,
  ordersTable,
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

// ── pgShadowPayoutTransaction ─────────────────────────────────────────────────

/**
 * Shadow-write a payout ledger row into wallet_transactions.
 *
 * Mirrors the Firestore "payout" transaction created at request time so the
 * wallet_transactions ledger stays count-consistent with Firestore.
 *
 * IMPORTANT: this does NOT touch driver_wallets — no balance debit happens here.
 * The authoritative debit lives in pgMarkPayoutProcessed (admin approval path,
 * not yet wired).  This function only inserts the immutable ledger row.
 *
 *   type        = "payout"
 *   status      = "pending" (default) | "completed"
 *   amount      = payout amount (positive, matching pgMarkPayoutProcessed)
 *   order_id    = null
 *   description = "payout request"
 */
export async function pgShadowPayoutTransaction(
  driverUid: string,
  amount:    number,
  status:    "pending" | "completed" = "pending",
): Promise<WalletResult> {
  const amountStr = amount.toFixed(2);

  try {
    await db.insert(walletTransactionsTable).values({
      driverUid,
      orderId:     null,
      type:        "payout",
      amount:      amountStr,
      status,
      description: "payout request",
    });

    logger.info({ driverUid, amount, status }, "[pgShadowPayoutTransaction] inserted");
    return { ok: true };
  } catch (err) {
    logger.error({ err, driverUid, amount }, "[pgShadowPayoutTransaction] failed");
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

// ── pgRequestPayout ───────────────────────────────────────────────────────────

const WALLET_LOCK_AMOUNT = 50;

export type PgPayoutRequestResult =
  | { ok: true;  requestId: string; newBalance: number }
  | { ok: false; reason: "no_wallet" | "insufficient_balance" | "exceeds_withdrawable" };

/**
 * PG-authoritative driver payout request.
 *
 * Atomically within a single transaction (with row-level lock):
 *   1. SELECT … FOR UPDATE on driver_wallets — prevents concurrent payout races.
 *   2. Validate: balance − WALLET_LOCK_AMOUNT (₹50) ≥ amount.
 *   3. Debit driver_wallets (balance, totalPaid).
 *   4. Insert payout_requests row (with upiId).
 *   5. Insert wallet_transactions "payout" ledger row (status=pending).
 *
 * Business-logic failures return { ok: false }.
 * Infrastructure errors are logged + re-thrown so the caller surfaces 500.
 */
export async function pgRequestPayout(
  driverUid: string,
  amount:    number,
  upiId:     string,
): Promise<PgPayoutRequestResult> {
  const amountStr = amount.toFixed(2);
  const now       = new Date();

  try {
    return await db.transaction(async (tx) => {
      // 1. Lock and read wallet balance (FOR UPDATE prevents double-spend races).
      const [wallet] = await tx
        .select({ balance: driverWalletsTable.balance })
        .from(driverWalletsTable)
        .where(eq(driverWalletsTable.driverUid, driverUid))
        .for("update");

      if (!wallet) {
        return { ok: false as const, reason: "no_wallet" as const };
      }

      const balance         = parseFloat(wallet.balance);
      const maxWithdrawable = balance - WALLET_LOCK_AMOUNT;

      if (maxWithdrawable <= 0) {
        return { ok: false as const, reason: "insufficient_balance" as const };
      }
      if (amount > maxWithdrawable) {
        return { ok: false as const, reason: "exceeds_withdrawable" as const };
      }

      // 2. Debit wallet.
      await tx
        .update(driverWalletsTable)
        .set({
          balance:   sql`${driverWalletsTable.balance}   - ${amountStr}::numeric`,
          totalPaid: sql`${driverWalletsTable.totalPaid} + ${amountStr}::numeric`,
          updatedAt: now,
        })
        .where(eq(driverWalletsTable.driverUid, driverUid));

      const newBalance = balance - amount;

      // 3. Insert payout request.
      const [request] = await tx
        .insert(payoutRequestsTable)
        .values({ driverUid, amount: amountStr, upiId, status: "pending" })
        .returning({ id: payoutRequestsTable.id });

      if (!request) throw new Error("payout_requests insert returned no row");

      // 4. Insert pending ledger row (mirrors what admin approval will later settle).
      await tx.insert(walletTransactionsTable).values({
        driverUid,
        type:        "payout",
        amount:      amountStr,
        status:      "pending",
        description: "UPI withdrawal request",
      });

      return { ok: true as const, requestId: request.id, newBalance };
    });
  } catch (err) {
    logger.error({ err, driverUid, amount }, "[pgRequestPayout] failed");
    throw err;
  }
}

// ── pgUpdateDriverDailyStats ──────────────────────────────────────────────────

/**
 * Shadow-write driver daily stats to PG after each order completion.
 *
 * Values are the server-computed results from the Firestore transaction
 * (todayDate already accounts for same-day accumulation vs. day rollover).
 * Firestore remains authoritative; this is a non-blocking mirror.
 */
export async function pgUpdateDriverDailyStats(
  driverUid:    string,
  todayDate:    string,  // "YYYY-MM-DD"
  todayEarnings: number,
  tripsToday:   number,
): Promise<void> {
  await db
    .update(driversTable)
    .set({ todayDate, todayEarnings, tripsToday, updatedAt: new Date() })
    .where(eq(driversTable.uid, driverUid));
}

// ── pgCompleteDelivery ────────────────────────────────────────────────────────

/**
 * PG-authoritative delivery completion.  Phase completion-PG-migration.
 *
 * Atomically within a single Drizzle transaction:
 *   1. Reads the order row (ownership + stage validation).
 *   2. Guard-updates orders SET status='delivered', delivered_at=now
 *      WHERE id=? AND status='at_drop' AND driver_uid=?.
 *      Zero rows affected → another concurrent call won the race → already_completed.
 *   3. Reads the driver row for daily-stats accumulation / date-rollover.
 *   4. Upserts driver_wallets: creates on first credit, increments on subsequent.
 *      Returns the post-credit balance via RETURNING.
 *   5. Inserts wallet_transactions credit row (idempotent via unique index
 *      wallet_txn_order_id_type_idx — ON CONFLICT DO NOTHING).
 *   6. Updates drivers daily stats (todayDate, todayEarnings, tripsToday).
 *
 * Returns:
 *   ok:true  — all six steps committed; callers should project to Firestore.
 *   no_pg_row — order row not found in PG; caller should fall back to Firestore.
 *   already_completed — order is already delivered; caller returns the error.
 *   forbidden / invalid_stage — business rule violation; caller returns the error.
 *
 * Never returns ok:false for infrastructure errors — those are re-thrown so the
 * caller can surface a 500.  Business-logic failures never throw.
 *
 * Note on tx.rollback():  Do NOT call it.  Early returns inside the callback
 * commit a no-op transaction (nothing was written).  Calling rollback() throws
 * an exception that masks the real reason — see drizzle-tx-rollback memory note.
 */
export type PgCompleteDeliveryResult =
  | {
      ok:           true;
      fareAmount:   number;
      paymentMode:  string;
      newBalance:   number;
      todayEarnings: number;
      tripsToday:   number;
      todayDate:    string;
    }
  | { ok: false; reason: "already_completed" | "forbidden" | "invalid_stage" | "no_pg_row" };

export async function pgCompleteDelivery(
  orderId:   string,
  driverUid: string,
): Promise<PgCompleteDeliveryResult> {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);  // "YYYY-MM-DD"

  try {
    return await db.transaction(async (tx) => {
      // ── 1. Read order row ─────────────────────────────────────────────────────
      const [order] = await tx
        .select({
          status:      ordersTable.status,
          driverUid:   ordersTable.driverUid,
          fareEstimate: ordersTable.fareEstimate,
          paymentMode: ordersTable.paymentMode,
        })
        .from(ordersTable)
        .where(eq(ordersTable.id, orderId))
        .limit(1);

      if (!order) {
        return { ok: false as const, reason: "no_pg_row" as const };
      }

      // ── 2. Pre-guard checks (fast-path meaningful errors) ─────────────────────
      if (order.driverUid !== driverUid) {
        return { ok: false as const, reason: "forbidden" as const };
      }
      if (order.status === "delivered") {
        return { ok: false as const, reason: "already_completed" as const };
      }
      if (order.status !== "at_drop") {
        return { ok: false as const, reason: "invalid_stage" as const };
      }

      // ── 3. Atomic guard update ─────────────────────────────────────────────────
      // Only one concurrent call can succeed — the others see 0 rows affected.
      const updated = await tx
        .update(ordersTable)
        .set({ status: "delivered", deliveredAt: now, updatedAt: now })
        .where(
          and(
            eq(ordersTable.id,        orderId),
            eq(ordersTable.status,    "at_drop"),
            eq(ordersTable.driverUid, driverUid),
          ),
        )
        .returning({ id: ordersTable.id });

      if (updated.length === 0) {
        // Race: a concurrent call committed delivered between our read and write.
        return { ok: false as const, reason: "already_completed" as const };
      }

      const fareAmount   = order.fareEstimate != null ? parseFloat(order.fareEstimate) : 0;
      const paymentMode  = order.paymentMode ?? "Cash";
      const amountStr    = fareAmount.toFixed(2);
      const description  = `Delivery #${orderId.slice(-6).toUpperCase()}`;

      // ── 4. Upsert driver_wallets (create-or-increment) ────────────────────────
      // Uses SQL-level arithmetic — no app-level read required.
      const [wallet] = await tx
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
            balance:             sql`${driverWalletsTable.balance}             + ${amountStr}::numeric`,
            totalEarnings:       sql`${driverWalletsTable.totalEarnings}       + ${amountStr}::numeric`,
            completedDeliveries: sql`${driverWalletsTable.completedDeliveries} + 1`,
            updatedAt:           sql`now()`,
          },
        })
        .returning({ balance: driverWalletsTable.balance });

      const newBalance = wallet ? parseFloat(wallet.balance) : fareAmount;

      // ── 5. Insert wallet_transactions credit row (idempotent) ─────────────────
      // The unique index wallet_txn_order_id_type_idx on (order_id, type) means a
      // duplicate insert is silently ignored via ON CONFLICT DO NOTHING.
      await tx
        .insert(walletTransactionsTable)
        .values({
          driverUid,
          orderId,
          type:        "credit",
          amount:      amountStr,
          status:      "completed",
          description,
        })
        .onConflictDoNothing();

      // ── 6. Atomic driver daily-stats update ───────────────────────────────────
      // CASE WHEN eliminates the read-modify-write race (two concurrent completions
      // for the same driver can no longer overwrite each other under READ COMMITTED
      // because the increment/reset is decided entirely inside the DB).
      const [driverStats] = await tx
        .update(driversTable)
        .set({
          todayEarnings: sql`CASE WHEN ${driversTable.todayDate} = ${today} THEN COALESCE(${driversTable.todayEarnings}, 0) + ${fareAmount} ELSE ${fareAmount} END`,
          tripsToday:    sql`CASE WHEN ${driversTable.todayDate} = ${today} THEN COALESCE(${driversTable.tripsToday},    0) + 1               ELSE 1             END`,
          todayDate:     today,
          updatedAt:     now,
        })
        .where(eq(driversTable.uid, driverUid))
        .returning({
          todayEarnings: driversTable.todayEarnings,
          tripsToday:    driversTable.tripsToday,
        });

      // driverStats is undefined when the driver has no PG row yet — use safe defaults.
      const newTodayEarnings = driverStats?.todayEarnings ?? fareAmount;
      const newTripsToday    = driverStats?.tripsToday    ?? 1;

      return {
        ok:            true as const,
        fareAmount,
        paymentMode,
        newBalance,
        todayEarnings: newTodayEarnings,
        tripsToday:    newTripsToday,
        todayDate:     today,
      };
    });
  } catch (err) {
    logger.error({ err, orderId, driverUid }, "[pgCompleteDelivery] transaction failed — re-throwing");
    throw err;
  }
}
