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
// Phase 3D-D — PostgreSQL primary with Firestore fallback.
//
//   1. Read PG first (pgGetWallet).
//   2. If PG returns a row → return PG result ([PG_WALLET_PRIMARY_HIT]) and run a
//      non-blocking Firestore comparison ([PG_WALLET_MATCH] / [PG_WALLET_DIFF]).
//   3. If PG throws OR has no row → fall back to Firestore
//      ([PG_WALLET_PRIMARY_FALLBACK]). PG never breaks the response.
//
// Response shape is unchanged from the previous Firestore contract:
//   { ok: true, wallet: { balance, totalEarnings, totalPaid, completedDeliveries } }
router.get("/wallet/:uid", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { uid } = req.params as { uid: string };
  if (uid !== driverUid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  // ── 1. PG primary read ───────────────────────────────────────────────────────
  let pgRow: Awaited<ReturnType<typeof pgGetWallet>> = null;
  let pgFailed = false;

  try {
    pgRow = await pgGetWallet(uid);
  } catch (err) {
    req.log.error({ err, uid }, "[PG_WALLET_PRIMARY_FALLBACK] PG read threw");
    pgFailed = true;
  }

  // ── 2. PG hit — return PG data; compare Firestore in background ──────────────
  if (!pgFailed && pgRow !== null) {
    let pgWallet: { balance: number; totalEarnings: number; totalPaid: number; completedDeliveries: number } | null = null;
    try {
      pgWallet = {
        balance:             parseFloat(pgRow.balance),
        totalEarnings:       parseFloat(pgRow.totalEarnings),
        totalPaid:           parseFloat(pgRow.totalPaid),
        completedDeliveries: pgRow.completedDeliveries,
      };
    } catch (err) {
      req.log.error({ err, uid }, "[PG_WALLET_PRIMARY_FALLBACK] PG field mapping threw");
      pgFailed = true;
    }

    if (!pgFailed && pgWallet !== null) {
      const pg = pgWallet;
      req.log.info({ uid }, "[PG_WALLET_PRIMARY_HIT]");

      // Non-blocking Firestore comparison (response already sent below).
      void (async () => {
        try {
          const db   = await adminFirestore();
          const snap = await db.doc(`wallets/${uid}`).get();
          const w    = (snap.exists ? snap.data() ?? {} : {}) as Record<string, unknown>;

          const fsBalance   = typeof w["balance"]             === "number" ? w["balance"]             : 0;
          const fsEarnings  = typeof w["totalEarnings"]       === "number" ? w["totalEarnings"]       : 0;
          const fsPaid      = typeof w["totalPaid"]           === "number" ? w["totalPaid"]           : 0;
          const fsCompleted = typeof w["completedDeliveries"] === "number" ? w["completedDeliveries"] : 0;

          if (!snap.exists) {
            req.log.warn({ uid, pg }, "[PG_WALLET_DIFF] Firestore doc missing — PG has row");
            return;
          }

          const diffs: string[] = [];
          if (!numClose(pg.balance,       fsBalance))   diffs.push(`balance pg=${pg.balance} fs=${fsBalance}`);
          if (!numClose(pg.totalEarnings, fsEarnings))  diffs.push(`totalEarnings pg=${pg.totalEarnings} fs=${fsEarnings}`);
          if (!numClose(pg.totalPaid,     fsPaid))      diffs.push(`totalPaid pg=${pg.totalPaid} fs=${fsPaid}`);
          if (pg.completedDeliveries      !== fsCompleted) diffs.push(`completedDeliveries pg=${pg.completedDeliveries} fs=${fsCompleted}`);

          if (diffs.length === 0) {
            req.log.info({ uid, balance: pg.balance, completedDeliveries: pg.completedDeliveries }, "[PG_WALLET_MATCH]");
          } else {
            req.log.warn({ uid, diffs }, "[PG_WALLET_DIFF]");
          }
        } catch (e) {
          req.log.error({ err: e, uid }, "[PG_WALLET_DIFF] background Firestore compare failed — non-blocking");
        }
      })();

      res.json({ ok: true, wallet: pg });
      return;
    }
  }

  // ── 3. Firestore fallback — PG missing or threw ───────────────────────────────
  if (!pgFailed) {
    req.log.info({ uid }, "[PG_WALLET_PRIMARY_FALLBACK] PG row not found");
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
// Phase 3D-D — PostgreSQL primary with Firestore fallback.
//
//   1. Read PG first (pgGetWalletTransactions).
//   2. If PG returns rows → return PG result ([PG_TX_PRIMARY_HIT]) and run a
//      non-blocking Firestore comparison ([PG_TX_MATCH] / [PG_TX_DIFF]).
//   3. If PG throws OR returns no rows → fall back to Firestore
//      ([PG_TX_PRIMARY_FALLBACK]). An empty PG result falls back rather than
//      serving a possibly-blank history for a not-yet-backfilled driver.
//
// Response shape is unchanged from the previous Firestore contract:
//   { ok: true, transactions: [{ id, driverUid, orderId, type, amount, status, description, createdAt }] }
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

  // ── 1. PG primary read ───────────────────────────────────────────────────────
  let pgTxns: Awaited<ReturnType<typeof pgGetWalletTransactions>> | null = null;
  let pgFailed = false;

  try {
    pgTxns = await pgGetWalletTransactions(uid, pageSize);
  } catch (err) {
    req.log.error({ err, uid }, "[PG_TX_PRIMARY_FALLBACK] PG read threw");
    pgFailed = true;
  }

  // ── 2. PG hit — return PG data; compare Firestore in background ──────────────
  if (!pgFailed && pgTxns !== null && pgTxns.length > 0) {
    let mapped: Array<Record<string, unknown>> | null = null;
    try {
      mapped = pgTxns.map((t) => {
        // Payout-sign canonicalization (serialization boundary only).
        // PG stores payout amounts with mixed signs — positive for rows written
        // by pgShadowPayoutTransaction / pgMarkPayoutProcessed, and the verbatim
        // Firestore sign for backfilled historical rows. The canonical ledger
        // contract is "money out = debit", so payout rows are normalized to a
        // negative amount here. This changes NO stored value and NO balance math
        // (driver_wallets totals are untouched) — it only ensures the response
        // sign is consistent regardless of how the underlying row was written.
        const rawAmount = parseFloat(t.amount);
        const amount = t.type === "payout" ? -Math.abs(rawAmount) : rawAmount;
        return {
          id:          t.id,
          driverUid:   t.driverUid,
          orderId:     t.orderId,
          type:        t.type,
          amount,
          status:      t.status,
          description: t.description,
          createdAt:   t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        };
      });
    } catch (err) {
      req.log.error({ err, uid }, "[PG_TX_PRIMARY_FALLBACK] PG field mapping threw");
      pgFailed = true;
    }

    if (!pgFailed && mapped !== null) {
      const pgForCompare = pgTxns;
      req.log.info({ uid, count: mapped.length }, "[PG_TX_PRIMARY_HIT]");

      // Non-blocking Firestore comparison (response already sent below).
      void (async () => {
        try {
          const db   = await adminFirestore();
          const snap = await db
            .collection("transactions")
            .where("driverUid", "==", uid)
            .orderBy("createdAt", "desc")
            .limit(pageSize)
            .get();

          const fsTxns = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown>>;

          // Build orderId → FS transaction map (credit rows carry orderId).
          const fsByOrderId = new Map<string, Record<string, unknown>>();
          for (const t of fsTxns) {
            const oid = typeof t["orderId"] === "string" ? t["orderId"] : null;
            if (oid) fsByOrderId.set(oid, t);
          }

          const diffs: string[] = [];
          if (pgForCompare.length !== fsTxns.length) {
            diffs.push(`count pg=${pgForCompare.length} fs=${fsTxns.length}`);
          }

          // Per-order comparison: PG credit rows have orderId set.
          for (const pgTx of pgForCompare) {
            if (!pgTx.orderId) continue; // payout ledger rows have no orderId
            const fsTx = fsByOrderId.get(pgTx.orderId);
            if (!fsTx) {
              diffs.push(`orderId=${pgTx.orderId} present in PG but missing in FS`);
              continue;
            }
            const pgAmount = parseFloat(pgTx.amount);
            const fsAmount = typeof fsTx["amount"] === "number" ? fsTx["amount"] : 0;
            if (!numClose(pgAmount, fsAmount)) {
              diffs.push(`orderId=${pgTx.orderId} amount pg=${pgAmount} fs=${fsAmount}`);
            }
            const fsType = typeof fsTx["type"] === "string" ? fsTx["type"] : "";
            if (pgTx.type !== fsType) {
              diffs.push(`orderId=${pgTx.orderId} type pg=${pgTx.type} fs=${fsType}`);
            }
          }

          if (diffs.length === 0) {
            req.log.info({ uid, pgCount: pgForCompare.length, fsCount: fsTxns.length }, "[PG_TX_MATCH]");
          } else {
            req.log.warn({ uid, diffs }, "[PG_TX_DIFF]");
          }
        } catch (e) {
          req.log.error({ err: e, uid }, "[PG_TX_DIFF] background Firestore compare failed — non-blocking");
        }
      })();

      res.json({ ok: true, transactions: mapped });
      return;
    }
  }

  // ── 3. Firestore fallback — PG threw or returned no rows ───────────────────────
  if (!pgFailed) {
    req.log.info({ uid }, "[PG_TX_PRIMARY_FALLBACK] PG returned no rows");
  }

  try {
    const db   = await adminFirestore();
    const snap = await db
      .collection("transactions")
      .where("driverUid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(pageSize)
      .get();

    const transactions = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      // Normalise createdAt: Firestore Admin SDK returns Timestamp objects which
      // JSON-serialise to { _seconds, _nanoseconds } — not a valid Date string.
      // Always return an ISO string so the mobile contract is consistent with
      // the PG-primary path.
      const rawCa = data["createdAt"];
      const createdAt =
        rawCa != null && typeof rawCa === "object" && "toDate" in rawCa
          ? (rawCa as { toDate(): Date }).toDate().toISOString()
          : rawCa instanceof Date
          ? rawCa.toISOString()
          : rawCa;
      return { id: d.id, ...data, createdAt };
    });
    res.json({ ok: true, transactions });
  } catch (err) {
    req.log.error({ err, uid }, "GET /wallet/:uid/transactions failed");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
