import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgGetWallet, pgGetWalletTransactions } from "../lib/wallet-pg-service";

const router = Router();

// ── Numeric comparison helper ─────────────────────────────────────────────────
// Tolerates sub-paisa floating-point noise (< 0.005 ₹).
function numClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

// ─── GET /api/wallet/:uid ──────────────────────────────────────────────────────
//
// Returns the wallets/{uid} document.
// Zero-value defaults are returned if the document does not yet exist
// (new drivers who have never completed a delivery).
//
// Phase 3C — dual-read: after sending the Firestore response, a fire-and-forget
// PG read compares the four summary fields and logs [PG_WALLET_MATCH] or
// [PG_WALLET_DIFF].  PG failure never affects the Firestore response.
router.get("/wallet/:uid", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { uid } = req.params as { uid: string };
  if (uid !== driverUid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  try {
    const db   = await adminFirestore();
    const snap = await db.doc(`wallets/${uid}`).get();
    const wallet = snap.exists
      ? snap.data()
      : { balance: 0, totalEarnings: 0, totalPaid: 0, completedDeliveries: 0 };
    res.json({ ok: true, wallet });

    // ── PG dual-read: wallet balance comparison (non-blocking) ────────────────
    const w             = (wallet ?? {}) as Record<string, unknown>;
    const fsBalance     = typeof w["balance"]             === "number" ? w["balance"]             : 0;
    const fsEarnings    = typeof w["totalEarnings"]       === "number" ? w["totalEarnings"]       : 0;
    const fsPaid        = typeof w["totalPaid"]           === "number" ? w["totalPaid"]           : 0;
    const fsCompleted   = typeof w["completedDeliveries"] === "number" ? w["completedDeliveries"] : 0;

    void pgGetWallet(uid)
      .then((pgRow) => {
        if (!pgRow) {
          const allZero = fsBalance === 0 && fsEarnings === 0 && fsPaid === 0 && fsCompleted === 0;
          if (allZero) {
            req.log.info({ uid }, "[PG_WALLET_MATCH] both empty");
          } else {
            req.log.warn({ uid, fsBalance, fsEarnings, fsPaid, fsCompleted },
              "[PG_WALLET_DIFF] PG row missing but FS has data");
          }
          return;
        }

        const pgBalance   = parseFloat(pgRow.balance);
        const pgEarnings  = parseFloat(pgRow.totalEarnings);
        const pgPaid      = parseFloat(pgRow.totalPaid);
        const pgCompleted = pgRow.completedDeliveries;

        const diffs: string[] = [];
        if (!numClose(fsBalance,  pgBalance))   diffs.push(`balance fs=${fsBalance} pg=${pgBalance}`);
        if (!numClose(fsEarnings, pgEarnings))  diffs.push(`totalEarnings fs=${fsEarnings} pg=${pgEarnings}`);
        if (!numClose(fsPaid,     pgPaid))      diffs.push(`totalPaid fs=${fsPaid} pg=${pgPaid}`);
        if (fsCompleted          !== pgCompleted) diffs.push(`completedDeliveries fs=${fsCompleted} pg=${pgCompleted}`);

        if (diffs.length === 0) {
          req.log.info({ uid, balance: fsBalance, completedDeliveries: fsCompleted }, "[PG_WALLET_MATCH]");
        } else {
          req.log.warn({ uid, diffs }, "[PG_WALLET_DIFF]");
        }
      })
      .catch((e) => req.log.error({ err: e, uid }, "[PG_WALLET_MATCH] PG read error — non-blocking"));

  } catch (err) {
    req.log.error({ err, uid }, "GET /wallet/:uid failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ─── GET /api/wallet/:uid/transactions ────────────────────────────────────────
//
// Returns up to `limit` (max 100, default 50) transactions from the
// `transactions` collection, ordered newest-first.
//
// Phase 3C — dual-read: after sending the Firestore response, a fire-and-forget
// PG read compares count and per-order-id amount/type/status, then logs
// [PG_TX_MATCH] or [PG_TX_DIFF].  PG failure never affects the Firestore response.
router.get("/wallet/:uid/transactions", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { uid } = req.params as { uid: string };
  if (uid !== driverUid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  const limitParam = parseInt(String(req.query["limit"] ?? "50"), 10);
  const pageSize   = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100);

  try {
    const db   = await adminFirestore();
    const snap = await db
      .collection("transactions")
      .where("driverUid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(pageSize)
      .get();

    const transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, transactions });

    // ── PG dual-read: transaction ledger comparison (non-blocking) ─────────────
    void pgGetWalletTransactions(uid, pageSize)
      .then((pgTxns) => {
        const fsTxns = transactions as Array<Record<string, unknown>>;

        // Build orderId → PG transaction map (credit rows have orderId set).
        const pgByOrderId = new Map<string, typeof pgTxns[0]>();
        for (const t of pgTxns) {
          if (t.orderId) pgByOrderId.set(t.orderId, t);
        }

        const diffs: string[] = [];

        // Count comparison: expected to diverge until all FS txns are mirrored
        // (payouts not yet shadowed into wallet_transactions).
        if (fsTxns.length !== pgTxns.length) {
          diffs.push(`count fs=${fsTxns.length} pg=${pgTxns.length}`);
        }

        // Per-order comparison: only FS credit rows have orderId.
        for (const fsTx of fsTxns) {
          const fsOrderId = typeof fsTx["orderId"] === "string" ? fsTx["orderId"] : null;
          if (!fsOrderId) continue; // payout ledger rows have no orderId — skip for now

          const pgTx = pgByOrderId.get(fsOrderId);
          if (!pgTx) {
            diffs.push(`orderId=${fsOrderId} present in FS but missing in PG`);
            continue;
          }

          const fsAmount = typeof fsTx["amount"] === "number" ? fsTx["amount"] : 0;
          const pgAmount = parseFloat(pgTx.amount);
          if (!numClose(fsAmount, pgAmount)) {
            diffs.push(`orderId=${fsOrderId} amount fs=${fsAmount} pg=${pgAmount}`);
          }

          const fsType = typeof fsTx["type"] === "string" ? fsTx["type"] : "";
          if (fsType !== pgTx.type) {
            diffs.push(`orderId=${fsOrderId} type fs=${fsType} pg=${pgTx.type}`);
          }
        }

        if (diffs.length === 0) {
          req.log.info({ uid, fsCount: fsTxns.length, pgCount: pgTxns.length }, "[PG_TX_MATCH]");
        } else {
          req.log.warn({ uid, diffs }, "[PG_TX_DIFF]");
        }
      })
      .catch((e) => req.log.error({ err: e, uid }, "[PG_TX_MATCH] PG read error — non-blocking"));

  } catch (err) {
    req.log.error({ err, uid }, "GET /wallet/:uid/transactions failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
