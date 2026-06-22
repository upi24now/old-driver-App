import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgCreatePayoutRequest } from "../lib/wallet-pg-service";

const router = Router();

// Minimum balance that must remain in the wallet at all times (₹50 lock).
const WALLET_LOCK_AMOUNT = 50;

// ─── POST /api/payouts/request ─────────────────────────────────────────────────
//
// Driver-initiated withdrawal request.
//
// Atomically in a single Firestore transaction:
//   1. Validates withdrawable balance (balance − WALLET_LOCK_AMOUNT ≥ amount)
//   2. Debits  wallets/{driverUid}           — balance, totalPaid
//   3. Creates withdrawalRequests/{autoId}   — pending payout record (admin sees this)
//   4. Creates transactions/{autoId}         — ledger entry, type = "payout"
//
// driverUid is taken from the verified Firebase ID token — never from body.
router.post("/payouts/request", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { amount, upiId } = req.body as { amount?: unknown; upiId?: unknown };

  if (typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount)) {
    res.status(400).json({ ok: false, error: "amount_invalid" });
    return;
  }
  if (typeof upiId !== "string" || !upiId.trim()) {
    res.status(400).json({ ok: false, error: "upi_id_required" });
    return;
  }

  const db        = await adminFirestore();
  const walletRef = db.doc(`wallets/${driverUid}`);
  const payoutRef = db.collection("withdrawalRequests").doc();
  const txnRef    = db.collection("transactions").doc();

  type TxErr = Error & { code: string };
  const txErr = (code: string): TxErr =>
    Object.assign(new Error(code), { code }) as TxErr;

  try {
    await db.runTransaction(async (tx) => {
      const walletSnap      = await tx.get(walletRef);
      const w               = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : {};
      const balance         = (w["balance"] as number | undefined) ?? 0;
      const maxWithdrawable = balance - WALLET_LOCK_AMOUNT;

      if (maxWithdrawable <= 0) throw txErr("insufficient_balance");
      if (amount > maxWithdrawable) throw txErr("exceeds_withdrawable");

      const newBalance = balance - amount;

      // 1. Debit wallet
      tx.set(walletRef, {
        balance:       newBalance,
        totalPaid:     FieldValue.increment(amount),
        lastUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // 2. Payout request (admin panel reads this)
      tx.set(payoutRef, {
        driverUid,
        amount,
        upiId:       upiId.trim(),
        status:      "pending",
        requestedAt: FieldValue.serverTimestamp(),
        createdAt:   FieldValue.serverTimestamp(),
      });

      // 3. Ledger entry
      tx.set(txnRef, {
        driverUid,
        type:          "payout",
        amount:        -amount,
        description:   "UPI withdrawal request",
        balanceBefore: balance,
        balanceAfter:  newBalance,
        createdAt:     FieldValue.serverTimestamp(),
      });
    });

    req.log.info({ driverUid, amount }, "payouts/request: withdrawal request created");

    // ── PG shadow write: payout request (non-blocking) ────────────────────────
    void pgCreatePayoutRequest(driverUid, amount)
      .then(() => req.log.info({ driverUid, amount }, "[PG_PAYOUT_SHADOW]"))
      .catch((e) => req.log.error({ err: e, driverUid, amount }, "[PG_PAYOUT_SHADOW] shadow write failed — non-blocking"));

    res.json({ ok: true, requestId: payoutRef.id });
  } catch (err: unknown) {
    const code = (err as Partial<TxErr>).code;
    if (code === "insufficient_balance" || code === "exceeds_withdrawable") {
      res.status(400).json({ ok: false, error: code });
      return;
    }
    req.log.error({ err, driverUid }, "payouts/request: transaction failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
