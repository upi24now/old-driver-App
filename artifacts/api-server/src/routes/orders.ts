import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";

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
  const txnRef        = db.doc(`driver_transactions/${orderId}_earn`);

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

      const [orderSnap, txnSnap, driverSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(txnRef),
        tx.get(driverRef),
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

      // ── Wallet arithmetic — daily reset if date rolled over ───────────────────
      const d = driverSnap.exists ? (driverSnap.data() as Record<string, unknown>) : {};
      const isSameDay = d["todayDate"] === today;

      newBalance = ((d["walletBalance"]    as number | undefined) ?? 0) + fareAmount;
      const newLifetime = ((d["lifetimeEarnings"] as number | undefined) ?? 0) + fareAmount;
      newToday   = ((isSameDay ? (d["todayEarnings"] as number | undefined) : undefined) ?? 0) + fareAmount;
      newTrips   = ((isSameDay ? (d["tripsToday"]    as number | undefined) : undefined) ?? 0) + 1;

      // ── Writes ────────────────────────────────────────────────────────────────
      tx.update(orderRef, {
        status:      "delivered",
        deliveredAt: FieldValue.serverTimestamp(),
      });

      tx.set(txnRef, {
        driverUid,
        orderId,
        type:        "earning",
        amount:      fareAmount,
        paymentMode,
        status:      "completed",
        createdAt:   FieldValue.serverTimestamp(),
      });

      tx.set(driverRef, {
        walletBalance:    newBalance,
        lifetimeEarnings: newLifetime,
        todayEarnings:    newToday,
        tripsToday:       newTrips,
        todayDate:        today,
        updatedAt:        FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    req.log.info(
      { orderId, driverUid, isLegacyOtp },
      "complete-order: delivery completed and wallet credited",
    );
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

export default router;
