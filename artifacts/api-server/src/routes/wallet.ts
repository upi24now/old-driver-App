import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";

const router = Router();

// ─── GET /api/wallet/:uid ──────────────────────────────────────────────────────
//
// Returns the wallets/{uid} document.
// Zero-value defaults are returned if the document does not yet exist
// (new drivers who have never completed a delivery).
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
  } catch (err) {
    req.log.error({ err, uid }, "GET /wallet/:uid failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ─── GET /api/wallet/:uid/transactions ────────────────────────────────────────
//
// Returns up to `limit` (max 100, default 50) transactions from the
// `transactions` collection, ordered newest-first.
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
  } catch (err) {
    req.log.error({ err, uid }, "GET /wallet/:uid/transactions failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
