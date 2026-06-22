import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgGetOrder, pgShadowSetStatus } from "../lib/order-pg-service";

const router = Router();

// ─── POST /api/orders/:orderId/complete ────────────────────────────────────────
//
// Server-side delivery completion.
// Verifies the delivery OTP, then atomically:
//   • marks the order status = "delivered"
//   • creates driver_transactions/{orderId}_earn  (idempotency doc)
//   • credits the driver wallet
//
// Security model:
//   • driverUid comes from the verified Firebase ID token — never trusted from body
//   • fareAmount and paymentMode come from the order document — never trusted from body
//   • OTP is read server-side and never returned to the client
//   • Admin SDK bypasses Firestore client rules, so the private OTP subcollection
//     is accessible here even when denied to the driver client SDK

router.post("/orders/:orderId/complete", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };
  const { otpEntered } = req.body as { otpEntered?: unknown };

  // ── 1. Auth — driverUid from token only ──────────────────────────────────────
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  req.log.info({ orderId, driverUid, otpLength: typeof otpEntered === "string" ? otpEntered.length : -1 }, "complete-order: received");

  // ── 2. Input validation ───────────────────────────────────────────────────────
  if (typeof otpEntered !== "string" || !/^\d{4}$/.test(otpEntered)) {
    res.status(400).json({ ok: false, error: "otp_invalid_format" });
    return;
  }

  const db = await adminFirestore();

  const orderRef      = db.doc(`orders/${orderId}`);
  const privateOtpRef = db.doc(`orders/${orderId}/private/otp`);
  const txnRef        = db.doc(`transactions/${orderId}_earn`);        // idempotency doc

  // ── 3. Read and verify OTP before entering the transaction ───────────────────
  // The private/otp document is immutable after creation, so reading it outside
  // the transaction is safe and keeps the transaction's read-set smaller.
  let expectedOtp: string | null = null;
  let isLegacyOtp = false;

  const privateOtpSnap = await privateOtpRef.get();
  if (privateOtpSnap.exists) {
    // Phase-1 path: OTP stored in private subcollection, invisible to driver SDK
    const d = privateOtpSnap.data() as Record<string, unknown>;
    expectedOtp = typeof d["value"] === "string" ? d["value"] : null;
  } else {
    // Legacy fallback: OTP on the root order document (pre-Phase-1 orders)
    const rootSnap = await orderRef.get();
    if (rootSnap.exists) {
      const d = rootSnap.data() as Record<string, unknown>;
      if (typeof d["deliveryOtp"] === "string") {
        expectedOtp = d["deliveryOtp"];
        isLegacyOtp = true;
      }
    }
  }

  if (expectedOtp === null) {
    req.log.warn({ orderId, driverUid }, "complete-order: no OTP configured for order");
    res.json({ ok: false, error: "otp_missing" });
    return;
  }

  // OTP comparison — no logging of the actual value
  if (otpEntered !== expectedOtp) {
    req.log.info({ orderId, driverUid }, "complete-order: OTP mismatch");
    res.json({ ok: false, error: "incorrect_otp" });
    return;
  }

  // ── 4. Firestore transaction ──────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  type TxError = Error & { code: string };

  function txError(code: string): TxError {
    return Object.assign(new Error(code), { code }) as TxError;
  }

  let newBalance    = 0;
  let newToday      = 0;
  let newTrips      = 0;

  try {
    await db.runTransaction(async (tx) => {
      const driverRef = db.doc(`drivers/${driverUid}`);
      const walletRef = db.doc(`wallets/${driverUid}`);

      const [orderSnap, txnSnap, driverSnap, walletSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(txnRef),
        tx.get(driverRef),
        tx.get(walletRef),
      ]);

      // ── Idempotency guard ─────────────────────────────────────────────────────
      if (txnSnap.exists) throw txError("already_completed");

      // ── Order existence + ownership ───────────────────────────────────────────
      if (!orderSnap.exists) throw txError("forbidden");

      const order = orderSnap.data() as Record<string, unknown>;

      if (order["driverUid"] !== driverUid) throw txError("forbidden");

      // ── Stage guard ───────────────────────────────────────────────────────────
      req.log.info({ orderId, driverUid, orderStatus: order["status"] }, "complete-order: stage check");
      if (order["status"] !== "at_drop") throw txError("invalid_stage");

      // ── Fare and payment from order doc — never from client ───────────────────
      const fareAmount  = typeof order["fareEstimate"] === "number" ? order["fareEstimate"] : 0;
      const paymentMode = typeof order["paymentMode"]  === "string"  ? order["paymentMode"]  : "Cash";

      // ── Wallet arithmetic (wallets/{uid} is the authoritative balance) ─────────
      const w                 = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : {};
      const prevBalance       = (w["balance"]             as number | undefined) ?? 0;
      const prevTotalEarnings = (w["totalEarnings"]       as number | undefined) ?? 0;
      const prevCompleted     = (w["completedDeliveries"] as number | undefined) ?? 0;
      newBalance = prevBalance + fareAmount;

      // ── Daily stats arithmetic (driver doc — reset if date rolled over) ────────
      const d         = driverSnap.exists ? (driverSnap.data() as Record<string, unknown>) : {};
      const isSameDay = d["todayDate"] === today;
      newToday = ((isSameDay ? (d["todayEarnings"] as number | undefined) : undefined) ?? 0) + fareAmount;
      newTrips = ((isSameDay ? (d["tripsToday"]    as number | undefined) : undefined) ?? 0) + 1;

      // ── Writes ────────────────────────────────────────────────────────────────
      tx.update(orderRef, {
        status:      "delivered",
        deliveredAt: FieldValue.serverTimestamp(),
      });

      // Wallet document — balance, totalEarnings, completedDeliveries
      tx.set(walletRef, {
        balance:             newBalance,
        totalEarnings:       prevTotalEarnings + fareAmount,
        completedDeliveries: prevCompleted + 1,
        lastUpdatedAt:       FieldValue.serverTimestamp(),
      }, { merge: true });

      // Driver document — daily stats only (no balance fields)
      tx.set(driverRef, {
        todayEarnings: newToday,
        tripsToday:    newTrips,
        todayDate:     today,
        updatedAt:     FieldValue.serverTimestamp(),
      }, { merge: true });

      // Transaction ledger entry
      tx.set(txnRef, {
        driverUid,
        orderId,
        type:          "credit",
        amount:        fareAmount,
        description:   `Delivery #${orderId.slice(-6).toUpperCase()}`,
        paymentMode,
        balanceBefore: prevBalance,
        balanceAfter:  newBalance,
        createdAt:     FieldValue.serverTimestamp(),
      });
    });

    req.log.info(
      { orderId, driverUid, isLegacyOtp },
      "complete-order: delivery completed and wallet credited",
    );

    // ── PG shadow write: mirror delivered status (non-blocking) ──────────────
    void pgShadowSetStatus(orderId, "delivered")
      .then(() => req.log.info({ orderId, driverUid }, "[PG_SHADOW_STATUS] delivered"))
      .catch((e) => req.log.error({ err: e, orderId }, "[PG_SHADOW_STATUS] delivered error — continuing"));

    res.json({ ok: true, newBalance, todayEarnings: newToday, tripsToday: newTrips, todayDate: today });

  } catch (err: unknown) {
    const code = (err as Partial<TxError>).code;
    if (code === "already_completed" || code === "forbidden" || code === "invalid_stage") {
      req.log.info({ orderId, driverUid, code }, "complete-order: request rejected");
      res.json({ ok: false, error: code });
      return;
    }
    req.log.error({ err, orderId, driverUid }, "complete-order: transaction failed unexpectedly");
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ─── GET /api/orders/:orderId ──────────────────────────────────────────────────
//
// Dual-read verification endpoint — Phase 2B-1.
//
// Reads the order from BOTH PostgreSQL and Firestore in parallel, then
// compares 9 key fields to verify shadow-write fidelity.  The Firestore
// document is always returned to the caller — PG is verification-only.
//
// Log tags:
//   [PG_COMPARE_MATCH] — all 9 fields match exactly
//   [PG_COMPARE_DIFF]  — one or more fields diverge (diffs logged as structured data)
//
// Field comparison notes:
//   fareEstimate / distanceKm — PG stores as numeric string ("85.00"); Firestore
//     stores as JS number (85).  Compared after parseFloat with ±0.01 tolerance.
//   durationMin — PG stores as integer; compared with Number() coercion.
//   All other fields — strict string equality after String() coercion.

router.get("/orders/:orderId", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { orderId } = req.params as { orderId: string };

  const db = await adminFirestore();

  // ── 1. Parallel reads ────────────────────────────────────────────────────────
  const [pgResult, fsResult] = await Promise.allSettled([
    pgGetOrder(orderId),
    db.doc(`orders/${orderId}`).get(),
  ]);

  // ── 2. Firestore result — source of truth returned to caller ─────────────────
  if (fsResult.status === "rejected" || !fsResult.value.exists) {
    if (fsResult.status === "rejected") {
      req.log.error({ err: fsResult.reason, orderId }, "GET /orders/:orderId Firestore read failed");
      res.status(500).json({ ok: false, error: "firestore_error" });
    } else {
      res.status(404).json({ ok: false, error: "not_found" });
    }
    return;
  }

  const fsData = { id: fsResult.value.id, ...fsResult.value.data() } as Record<string, unknown>;

  // ── 3. PG comparison (non-blocking; never alters response) ───────────────────
  if (pgResult.status === "rejected") {
    req.log.error({ err: pgResult.reason, orderId }, "[PG_COMPARE_DIFF] PG read threw — skipping compare");
  } else if (pgResult.value === null) {
    req.log.info({ orderId }, "[PG_COMPARE_DIFF] PG row not found");
  } else {
    const pg   = pgResult.value;
    const diffs: { field: string; pg: unknown; fs: unknown }[] = [];

    // String fields — strict equality after null normalisation
    const strFields = ["status", "paymentMode", "pickup", "drop", "customerName", "customerPhone"] as const;
    for (const field of strFields) {
      const pgVal = (pg[field] as string | null) ?? null;
      const fsVal = (fsData[field] as string | null | undefined) ?? null;
      if (pgVal !== fsVal) {
        diffs.push({ field, pg: pgVal, fs: fsVal });
      }
    }

    // Numeric fields — PG returns numeric columns as strings; compare as floats
    const numFields: { pg: string | null; fs: unknown; field: string }[] = [
      { field: "fareEstimate", pg: pg.fareEstimate, fs: fsData["fareEstimate"] },
      { field: "distanceKm",   pg: pg.distanceKm,   fs: fsData["distanceKm"]   },
    ];
    for (const { field, pg: pgVal, fs: fsVal } of numFields) {
      if (pgVal === null && (fsVal == null)) continue;
      if (pgVal === null || fsVal == null) {
        diffs.push({ field, pg: pgVal, fs: fsVal });
        continue;
      }
      if (Math.abs(parseFloat(pgVal) - Number(fsVal)) > 0.01) {
        diffs.push({ field, pg: pgVal, fs: fsVal });
      }
    }

    // durationMin — integer
    const durPg = pg.durationMin;
    const durFs = fsData["durationMin"];
    if (!(durPg == null && durFs == null)) {
      if (durPg == null || durFs == null || durPg !== Number(durFs)) {
        diffs.push({ field: "durationMin", pg: durPg, fs: durFs });
      }
    }

    if (diffs.length === 0) {
      req.log.info({ orderId }, "[PG_COMPARE_MATCH]");
    } else {
      req.log.info({ orderId, diffs }, "[PG_COMPARE_DIFF]");
    }
  }

  // ── 4. Always return Firestore data ──────────────────────────────────────────
  res.json({ ok: true, order: fsData });
});

export default router;
