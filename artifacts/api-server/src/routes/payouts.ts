import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgRequestPayout } from "../lib/wallet-pg-service";

const router = Router();

// ─── POST /api/payouts/request ─────────────────────────────────────────────────
//
// Driver-initiated withdrawal request (PG-authoritative).
//
// Atomically in a single PG transaction (with FOR UPDATE lock):
//   1. Reads driver_wallets.balance with row-level lock (prevents concurrent races).
//   2. Validates withdrawable balance (balance − ₹50_lock ≥ amount).
//   3. Debits  driver_wallets           — balance, totalPaid.
//   4. Inserts payout_requests          — pending cash-out record.
//   5. Inserts wallet_transactions      — pending ledger debit row.
//
// After PG commit: best-effort Firestore projection for admin-panel visibility:
//   - wallets/{driverUid}              — balance/totalPaid update.
//   - withdrawalRequests/{requestId}   — pending payout record (admin sees this).
//   - transactions/{txnId}             — payout ledger entry.
//
// driverUid is taken from the verified Firebase ID token — never from body.
//
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

  let pgResult: Awaited<ReturnType<typeof pgRequestPayout>>;
  try {
    pgResult = await pgRequestPayout(driverUid, amount, upiId.trim());
  } catch (err) {
    req.log.error({ err, driverUid }, "payouts/request: PG transaction failed");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  if (!pgResult.ok) {
    const code = pgResult.reason === "no_wallet" ? "insufficient_balance" : pgResult.reason;
    req.log.warn({ driverUid, amount, reason: pgResult.reason }, "payouts/request: guard rejected");
    res.status(400).json({ ok: false, error: code });
    return;
  }

  req.log.info(
    { driverUid, amount, requestId: pgResult.requestId, newBalance: pgResult.newBalance },
    "payouts/request: PG withdrawal committed",
  );

  // ── Best-effort Firestore projection (admin-panel visibility) ─────────────
  void (async () => {
    try {
      const db        = await adminFirestore();
      const walletRef = db.doc(`wallets/${driverUid}`);
      const payoutRef = db.collection("withdrawalRequests").doc(pgResult.requestId);
      const txnRef    = db.collection("transactions").doc();
      const batch     = db.batch();

      batch.set(walletRef, {
        balance:       FieldValue.increment(-amount),
        totalPaid:     FieldValue.increment(amount),
        lastUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      batch.set(payoutRef, {
        driverUid,
        amount,
        upiId:       upiId.trim(),
        status:      "pending",
        pgRequestId: pgResult.requestId,
        requestedAt: FieldValue.serverTimestamp(),
        createdAt:   FieldValue.serverTimestamp(),
      });

      batch.set(txnRef, {
        driverUid,
        type:          "payout",
        amount:        -amount,
        description:   "UPI withdrawal request",
        pgRequestId:   pgResult.requestId,
        createdAt:     FieldValue.serverTimestamp(),
      });

      await batch.commit();
      req.log.info({ driverUid, requestId: pgResult.requestId }, "[FS_PROJECTION] payout projected");
    } catch (e) {
      req.log.warn({ err: e, driverUid, requestId: pgResult.requestId }, "[FS_PROJECTION] payout — non-blocking");
    }
  })();

  res.json({ ok: true, requestId: pgResult.requestId });
});

export default router;
