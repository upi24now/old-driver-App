import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgGetOrder, pgShadowSetStatus, pgAcceptOffer, pgRejectOffer, pgTimeoutOffer, pgRemoveFromOfferSet, pgDriverCancelOrder, pgSetOrderStage, pgSetOrderLocation, pgCreateOffer, pgUpsertOrder, type DeliveryStage } from "../lib/order-pg-service";
import { pgCreditOrderEarning, pgUpdateDriverDailyStats, pgCompleteDelivery, isCashPayment } from "../lib/wallet-pg-service";
import { db, ordersTable } from "@workspace/db";
import { inArray, gte, and } from "drizzle-orm";

const router = Router();

// ─── POST /api/orders/:orderId/complete ────────────────────────────────────────
//
// Server-side delivery completion.
//
// PG-AUTHORITATIVE (completion-PG-migration):
//   The PostgreSQL transaction is now the source of truth for all business data.
//   Firestore is written afterwards as a best-effort projection so the customer
//   app and the FCM dispatcher keep seeing live order status.
//
// Security model:
//   • driverUid comes from the verified Firebase ID token — never trusted from body
//   • fareAmount and paymentMode come from the PG order row — never from body
//   • OTP is still read from the Firestore private subcollection (written by the
//     customer app; no PG OTP store exists yet)
//   • Admin SDK bypasses Firestore client rules so the private OTP subcollection
//     is accessible here even when denied to the driver client SDK
//
// Fallback:
//   If the order has no PG row (legacy order pre-dating PG dispatch), the handler
//   falls back to the original Firestore transaction to guarantee no regression.

// ── Firestore projection helpers (best-effort, non-blocking) ─────────────────
//
// Called AFTER the PG transaction commits.  All helpers swallow their own errors
// so a Firestore outage never rolls back an already-committed PG completion.

async function projectOrderDeliveredToFirestore(
  fsDb:      FirebaseFirestore.Firestore,
  orderId:   string,
  driverUid: string,
  log:       Request["log"],
): Promise<void> {
  try {
    await fsDb.doc(`orders/${orderId}`).update({
      status:      "delivered",
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt:   FieldValue.serverTimestamp(),
    });
    log.info({ orderId, driverUid }, "[PG_COMPLETE_PROJ] order delivered projected to Firestore");
  } catch (err) {
    log.error({ err, orderId, driverUid }, "[PG_COMPLETE_PROJ] order projection failed — PG authoritative, continuing");
  }
}

async function projectWalletCreditToFirestore(
  fsDb:        FirebaseFirestore.Firestore,
  driverUid:   string,
  orderId:     string,
  fareAmount:  number,
  paymentMode: string,
  newBalance:  number,
  log:         Request["log"],
): Promise<void> {
  try {
    const cash         = isCashPayment(paymentMode);
    const creditAmount = cash ? 0 : fareAmount;
    const walletRef = fsDb.doc(`wallets/${driverUid}`);
    const txnRef    = fsDb.doc(`transactions/${orderId}_earn`);
    const prevBalance = newBalance - creditAmount;

    // Use FieldValue.increment so this is safe even if FS wallet diverged
    // from PG (e.g. due to a FS-authoritative payout not yet mirrored to PG).
    // CASH/COD increments 0 so the payable balance is never bumped (no double-pay).
    await walletRef.set({
      balance:             FieldValue.increment(creditAmount),
      totalEarnings:       FieldValue.increment(creditAmount),
      completedDeliveries: FieldValue.increment(cash ? 0 : 1),
      lastUpdatedAt:       FieldValue.serverTimestamp(),
    }, { merge: true });

    // Legacy ledger entry — customer-facing wallet history; no longer authoritative.
    // CASH/COD writes a non-payable audit row (amount 0; fare noted in description).
    await txnRef.set({
      driverUid,
      orderId,
      type:          cash ? "cash_collected" : "credit",
      amount:        cash ? 0 : fareAmount,
      description:   cash
        ? `Cash collected #${orderId.slice(-6).toUpperCase()} (₹${fareAmount.toFixed(2)} paid directly to driver)`
        : `Delivery #${orderId.slice(-6).toUpperCase()}`,
      paymentMode,
      balanceBefore: prevBalance,
      balanceAfter:  newBalance,
      createdAt:     FieldValue.serverTimestamp(),
    });

    log.info({ driverUid, orderId, fareAmount }, "[PG_COMPLETE_PROJ] wallet + ledger projected to Firestore");
  } catch (err) {
    log.error({ err, driverUid, orderId }, "[PG_COMPLETE_PROJ] wallet projection failed — PG authoritative, continuing");
  }
}

async function projectDriverStatsToFirestore(
  fsDb:          FirebaseFirestore.Firestore,
  driverUid:     string,
  todayEarnings: number,
  tripsToday:    number,
  todayDate:     string,
  log:           Request["log"],
): Promise<void> {
  try {
    await fsDb.doc(`drivers/${driverUid}`).set({
      todayEarnings,
      tripsToday,
      todayDate,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    log.info({ driverUid, todayEarnings, tripsToday, todayDate }, "[PG_COMPLETE_PROJ] driver stats projected to Firestore");
  } catch (err) {
    log.error({ err, driverUid }, "[PG_COMPLETE_PROJ] driver stats projection failed — PG authoritative, continuing");
  }
}

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

  const fsDb = await adminFirestore();

  const orderRef      = fsDb.doc(`orders/${orderId}`);
  const privateOtpRef = fsDb.doc(`orders/${orderId}/private/otp`);

  // ── 3. Read and verify OTP from Firestore ────────────────────────────────────
  // OTP is written by the customer app to the Firestore private subcollection
  // (invisible to the driver client SDK).  No PG OTP store exists yet — this
  // read stays Firestore for now and does not affect PG authority.
  let expectedOtp: string | null = null;
  let isLegacyOtp = false;

  const privateOtpSnap = await privateOtpRef.get();
  if (privateOtpSnap.exists) {
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

  if (otpEntered !== expectedOtp) {
    req.log.info({ orderId, driverUid }, "complete-order: OTP mismatch");
    res.json({ ok: false, error: "incorrect_otp" });
    return;
  }

  // ── 4. PG-authoritative completion ────────────────────────────────────────────
  let pgResult: Awaited<ReturnType<typeof pgCompleteDelivery>>;

  try {
    pgResult = await pgCompleteDelivery(orderId, driverUid);
  } catch (err) {
    // PG infra error — do NOT fall back to Firestore (that would breach PG
    // authority: FS could mark delivered while PG remains at_drop).
    req.log.error({ err, orderId, driverUid }, "complete-order: pgCompleteDelivery infra error — returning 500");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  // ── 4a. PG business-logic rejection ──────────────────────────────────────────
  if (!pgResult.ok && pgResult.reason !== "no_pg_row") {
    req.log.info({ orderId, driverUid, reason: pgResult.reason }, "complete-order: PG rejected");
    res.json({ ok: false, error: pgResult.reason });
    return;
  }

  // ── 4b. PG succeeded — project to Firestore + respond ────────────────────────
  if (pgResult.ok) {
    req.log.info({ orderId, driverUid, isLegacyOtp }, "complete-order: PG-authoritative delivery completed");

    // Best-effort Firestore projections — non-blocking, errors swallowed inside helpers.
    void projectOrderDeliveredToFirestore(fsDb, orderId, driverUid, req.log);
    void projectWalletCreditToFirestore(fsDb, driverUid, orderId, pgResult.fareAmount, pgResult.paymentMode, pgResult.newBalance, req.log);
    void projectDriverStatsToFirestore(fsDb, driverUid, pgResult.todayEarnings, pgResult.tripsToday, pgResult.todayDate, req.log);

    res.json({
      ok:            true,
      newBalance:    pgResult.newBalance,
      todayEarnings: pgResult.todayEarnings,
      tripsToday:    pgResult.tripsToday,
      todayDate:     pgResult.todayDate,
    });
    return;
  }

  // ── 5. Firestore fallback — legacy order only (no_pg_row) ─────────────────────
  //
  // Only reached when pgResult.reason === "no_pg_row" (order predates PG dispatch).
  // PG infra errors are caught above and return 500 — they do NOT reach this path.
  req.log.info(
    { orderId, driverUid, reason: pgResult.reason },
    "complete-order: no PG row — falling back to Firestore transaction",
  );

  const txnRef   = fsDb.doc(`transactions/${orderId}_earn`);
  const today    = new Date().toISOString().slice(0, 10);

  type TxError = Error & { code: string };
  function txError(code: string): TxError {
    return Object.assign(new Error(code), { code }) as TxError;
  }

  let fareAmount  = 0;
  let newBalance  = 0;
  let newToday    = 0;
  let newTrips    = 0;
  let isCashOrder = false;

  try {
    await fsDb.runTransaction(async (tx) => {
      const driverRef = fsDb.doc(`drivers/${driverUid}`);
      const walletRef = fsDb.doc(`wallets/${driverUid}`);

      const [orderSnap, txnSnap, driverSnap, walletSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(txnRef),
        tx.get(driverRef),
        tx.get(walletRef),
      ]);

      if (txnSnap.exists) throw txError("already_completed");
      if (!orderSnap.exists) throw txError("forbidden");

      const order = orderSnap.data() as Record<string, unknown>;
      if (order["driverUid"] !== driverUid) throw txError("forbidden");

      req.log.info({ orderId, driverUid, orderStatus: order["status"] }, "complete-order: FS stage check");
      if (order["status"] !== "at_drop") throw txError("invalid_stage");

      fareAmount        = typeof order["fareEstimate"] === "number" ? order["fareEstimate"] : 0;
      const paymentMode = typeof order["paymentMode"]  === "string"  ? order["paymentMode"]  : "Cash";
      isCashOrder       = isCashPayment(paymentMode);

      // CASH/COD: driver keeps the customer's cash → credit 0 to the payable
      // wallet. ONLINE/prepaid: credit the full fare. Daily activity stats
      // (todayEarnings/tripsToday) still count the delivery either way.
      const creditAmount = isCashOrder ? 0 : fareAmount;

      const w                 = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : {};
      const prevBalance       = (w["balance"]             as number | undefined) ?? 0;
      const prevTotalEarnings = (w["totalEarnings"]       as number | undefined) ?? 0;
      const prevCompleted     = (w["completedDeliveries"] as number | undefined) ?? 0;
      newBalance = prevBalance + creditAmount;

      const d         = driverSnap.exists ? (driverSnap.data() as Record<string, unknown>) : {};
      const isSameDay = d["todayDate"] === today;
      newToday = ((isSameDay ? (d["todayEarnings"] as number | undefined) : undefined) ?? 0) + fareAmount;
      newTrips = ((isSameDay ? (d["tripsToday"]    as number | undefined) : undefined) ?? 0) + 1;

      tx.update(orderRef, {
        status:      "delivered",
        deliveredAt: FieldValue.serverTimestamp(),
      });

      tx.set(walletRef, {
        balance:             newBalance,
        totalEarnings:       prevTotalEarnings + creditAmount,
        completedDeliveries: prevCompleted + (isCashOrder ? 0 : 1),
        lastUpdatedAt:       FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(driverRef, {
        todayEarnings: newToday,
        tripsToday:    newTrips,
        todayDate:     today,
        updatedAt:     FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(txnRef, {
        driverUid,
        orderId,
        type:          isCashOrder ? "cash_collected" : "credit",
        amount:        isCashOrder ? 0 : fareAmount,
        description:   isCashOrder
          ? `Cash collected #${orderId.slice(-6).toUpperCase()} (₹${fareAmount.toFixed(2)} paid directly to driver)`
          : `Delivery #${orderId.slice(-6).toUpperCase()}`,
        paymentMode,
        balanceBefore: prevBalance,
        balanceAfter:  newBalance,
        createdAt:     FieldValue.serverTimestamp(),
      });
    });

    req.log.info({ orderId, driverUid, isLegacyOtp }, "complete-order: FS delivery completed (fallback path)");

    // PG shadow writes (non-blocking) — mirror the FS result into PG
    void pgShadowSetStatus(orderId, "delivered")
      .then(() => req.log.info({ orderId, driverUid }, "[PG_SHADOW_STATUS] delivered"))
      .catch((e) => req.log.error({ err: e, orderId }, "[PG_SHADOW_STATUS] delivered error — continuing"));

    // CASH/COD: never shadow-credit the payable PG wallet (driver kept the cash).
    // ONLINE/prepaid: mirror the FS credit into PG as before.
    if (!isCashOrder) {
      void pgCreditOrderEarning(driverUid, orderId, fareAmount, `Delivery #${orderId.slice(-6).toUpperCase()}`)
        .then(() => req.log.info({ orderId, driverUid, fareAmount }, "[PG_WALLET_CREDIT]"))
        .catch((e) => req.log.error({ err: e, orderId, driverUid }, "[PG_WALLET_CREDIT] shadow write failed — non-blocking"));
    } else {
      req.log.info({ orderId, driverUid, fareAmount }, "[PG_WALLET_CREDIT] skipped — cash order, no payable credit");
    }

    void pgUpdateDriverDailyStats(driverUid, today, newToday, newTrips)
      .then(() => req.log.info({ driverUid, today, todayEarnings: newToday, tripsToday: newTrips }, "[PG_DRIVER_STATS]"))
      .catch((e) => req.log.error({ err: e, driverUid }, "[PG_DRIVER_STATS] shadow write failed — non-blocking"));

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

// ─── POST /api/orders/:orderId/accept ──────────────────────────────────────────
//
// Phase 5J-Tier-4: PG-authoritative driver accept — replaces the Driver App's
// direct Firestore acceptOrder transaction.
//
//   1. pgAcceptOffer atomically claims the offer + order in PostgreSQL (the new
//      source of truth).  PostgreSQL MVCC guarantees exactly one driver wins the
//      race; concurrent claims fail the guarded WHERE and return already_claimed.
//   2. The result is projected to Firestore (status=driver_assigned + driver
//      fields + activeOfferDriverUids=[]) so the Firestore FCM dispatcher stops
//      offering the order and the customer app shows the assigned driver.
//
// Security: driverUid comes from the verified ID token ONLY.  driverName/Rating/
// Trips are display-only fields echoed to the customer; they are accepted from
// the body (non-authoritative — the same values the client previously wrote to
// Firestore directly).
//
// Duplicate accept: a second call from the SAME driver for an order already
// assigned to them returns { ok: true } (idempotent) instead of already_claimed.

const ACCEPT_ACTIVE_STATUSES = new Set([
  "driver_assigned", "accepted", "to_pickup", "at_pickup", "to_drop", "at_drop",
]);

async function projectAcceptToFirestore(
  orderId:      string,
  driverUid:    string,
  driverName:   string | null,
  driverRating: string | number,
  driverTrips:  number,
  log:          Request["log"],
): Promise<void> {
  try {
    const fdb = await adminFirestore();
    const ref = fdb.doc(`orders/${orderId}`);
    await fdb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        log.warn({ orderId }, "[PG_ACCEPT_PROJECTION] Firestore doc missing — skip mirror");
        return;
      }
      const status = (snap.data() as Record<string, unknown>)["status"];
      // Never clobber a terminal/cancelled order — cancel stays Firestore-authoritative.
      if (status === "cancelled" || status === "delivered") {
        log.warn({ orderId, status }, "[PG_ACCEPT_PROJECTION] terminal status — skip mirror");
        return;
      }
      tx.update(ref, {
        status:                "driver_assigned",
        driverUid,
        driverName:            driverName ?? "",
        driverRating:          driverRating ?? "5.0",
        driverTrips:           driverTrips ?? 0,
        acceptedAt:            FieldValue.serverTimestamp(),
        activeOfferDriverUids: [],
        updatedAt:             FieldValue.serverTimestamp(),
      });
    });
    log.info({ orderId, driverUid }, "[PG_ACCEPT_PROJECTION] mirrored to Firestore");
  } catch (err) {
    log.error({ err, orderId, driverUid }, "[PG_ACCEPT_PROJECTION] mirror failed — PG authoritative, continuing");
  }
}

/**
 * Self-heal a missing PG offer row from the authoritative live Firestore order.
 *
 * In production the actual driver dispatch + FCM are performed outside the
 * api-server's offer-creating code paths (the order is offered via Firestore by
 * the customer/dispatch side, and PG_FCM_SEND_ENABLED is off), so no
 * order_offers row is ever written. pgAcceptOffer then returns not_in_offer even
 * though the driver WAS legitimately offered the order — the user sees the popup
 * (driven by the Firestore offer + FCM) but Accept fails.
 *
 * This reads the authoritative Firestore order doc and, ONLY if that doc proves
 * the order is currently being offered to THIS driver (status still offerable,
 * driver present in activeOfferDriverUids or the single driverUid field, and the
 * dispatch window not expired), mirrors the parent order into PG and creates the
 * pending offer row. The caller then retries pgAcceptOffer, which finds the row
 * and claims it atomically.
 *
 * Returns true  → an offer row now exists; caller should retry the claim.
 * Returns false → Firestore does NOT authorise this driver; caller keeps the
 *                 original not_in_offer rejection (a driver can never accept an
 *                 order that was not offered to them).
 */
async function selfHealOfferFromFirestore(
  orderId:   string,
  driverUid: string,
  log:       Request["log"],
): Promise<boolean> {
  try {
    const fdb  = await adminFirestore();
    const snap = await fdb.doc(`orders/${orderId}`).get();
    if (!snap.exists) {
      log.info({ orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] Firestore order missing — not authorised");
      return false;
    }

    const data   = snap.data() as Record<string, unknown>;
    const status = typeof data["status"] === "string" ? data["status"] : null;

    // A LIVE offer always sits at status "dispatched" — the dispatch transition
    // sets status=dispatched + activeOfferDriverUids together. A "searching"/
    // "pending" order has no active offer yet (and its driver fields may be
    // stale), so we never self-heal those: only "dispatched" authorises healing.
    if (status !== "dispatched") {
      log.info({ orderId, driverUid, status }, "[PG_ACCEPT_SELFHEAL] order not dispatched — not authorised");
      return false;
    }

    // Driver must be on the live offer: Phase-2 activeOfferDriverUids array, or
    // the Phase-1 single driverUid field.
    const offerUids = Array.isArray(data["activeOfferDriverUids"])
      ? (data["activeOfferDriverUids"] as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const singleUid = typeof data["driverUid"] === "string" ? data["driverUid"] : null;
    if (!offerUids.includes(driverUid) && singleUid !== driverUid) {
      log.info({ orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] driver not on live offer — not authorised");
      return false;
    }

    // Respect the dispatch window if Firestore carries one (Timestamp → millis).
    let timeoutAt: Date | undefined;
    const rawTimeout = data["dispatchTimeoutAt"] as { toMillis?: () => number } | undefined;
    if (rawTimeout && typeof rawTimeout.toMillis === "function") {
      const ms = rawTimeout.toMillis();
      if (ms <= Date.now()) {
        log.info({ orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] dispatch window expired — not authorised");
        return false;
      }
      timeoutAt = new Date(ms);
    }

    // Authorised. Ensure the parent PG order row exists (so the offer FK holds and
    // the offer columns are populated), then create the missing pending offer row.
    await pgUpsertOrder(orderId, data, { guardRegression: true, mirrorOfferSet: true });
    const created = await pgCreateOffer(orderId, driverUid, timeoutAt);
    if (!created.ok) {
      log.warn({ orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] offer create failed");
      return false;
    }

    log.info({ orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] offer row created from live Firestore offer");
    return true;
  } catch (err) {
    log.error({ err, orderId, driverUid }, "[PG_ACCEPT_SELFHEAL] error — keeping rejection");
    return false;
  }
}

router.post("/orders/:orderId/accept", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const body         = (req.body ?? {}) as { driverName?: unknown; driverRating?: unknown; driverTrips?: unknown };
  const driverName   = typeof body.driverName === "string" ? body.driverName : null;
  const driverRating =
    typeof body.driverRating === "number" || typeof body.driverRating === "string"
      ? body.driverRating
      : "5.0";
  const driverTrips  = typeof body.driverTrips === "number" ? body.driverTrips : 0;

  // ── 1. PG-authoritative claim ────────────────────────────────────────────────
  let pgRes = await pgAcceptOffer(orderId, driverUid, driverName);

  // Self-heal: in production the live offer is created in Firestore (outside the
  // api-server's offer-creating paths), so no PG order_offers row exists and the
  // claim above returns not_in_offer even though the driver was legitimately
  // offered the order. If the authoritative Firestore order confirms this driver
  // is on the live offer, create the missing offer row and retry the claim once.
  if (!pgRes.ok && pgRes.reason === "not_in_offer") {
    const healed = await selfHealOfferFromFirestore(orderId, driverUid, req.log);
    if (healed) {
      pgRes = await pgAcceptOffer(orderId, driverUid, driverName);
    }
  }

  let accepted = pgRes.ok;

  // Duplicate accept by the SAME driver → idempotent success.
  if (!pgRes.ok && pgRes.reason === "already_claimed") {
    const existing = await pgGetOrder(orderId);
    if (existing && existing.driverUid === driverUid && ACCEPT_ACTIVE_STATUSES.has(existing.status)) {
      req.log.info({ orderId, driverUid }, "[PG_ACCEPT] idempotent re-accept by same driver");
      accepted = true;
    }
  }

  if (!accepted) {
    const reason = pgRes.ok ? "unknown" : pgRes.reason;
    req.log.info({ orderId, driverUid, reason }, "[PG_ACCEPT] rejected");
    res.json({ ok: false, reason });
    return;
  }

  // ── 2. Firestore projection (best-effort; PG already committed) ──────────────
  await projectAcceptToFirestore(orderId, driverUid, driverName, driverRating, driverTrips, req.log);

  req.log.info({ orderId, driverUid }, "[PG_ACCEPT] accepted");
  res.json({ ok: true });
});

// ─── POST /api/orders/:orderId/reject ──────────────────────────────────────────
//
// Phase 5J-Tier-9B: PG-authoritative offer reject — replaces the Driver App's
// direct Firestore arrayRemove(activeOfferDriverUids) write.
//
//   1. pgRejectOffer authoritatively records the rejection in PostgreSQL
//      (order_offers.status=rejected + orders.rejected_by append) so the PG
//      dispatcher skips this driver for the current cycle. CANONICAL state.
//   2. pgRemoveFromOfferSet drops the driver from the active_offer_driver_uids
//      read-model (so the PG-backed offer SSE stream removes the offer instantly)
//      and enqueues a durable offer_removal projection that mirrors the
//      arrayRemove into Firestore for the customer app / FCM read-model.
//
// Idempotent: pgRejectOffer only acts on a still-pending offer row, and
// pgRemoveFromOfferSet only acts while the driver is still in the offer set, so a
// repeat call is a safe no-op. Security: driverUid comes from the verified ID
// token only — never from the body.
router.post("/orders/:orderId/reject", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  // ── 1. PG-authoritative reject (canonical) ───────────────────────────────────
  const pgRes = await pgRejectOffer(orderId, driverUid);
  if (!pgRes.ok) {
    req.log.error({ orderId, driverUid, reason: pgRes.reason }, "[PG_REJECT] failed");
    res.status(500).json({ ok: false, error: pgRes.reason });
    return;
  }

  // ── 2. Read-model removal + durable Firestore projection enqueue ─────────────
  // Runs in its own transaction AFTER the canonical reject committed. If it hits
  // an infra error the read-model + projection were skipped; surface a 500 so the
  // (idempotent) client retry can heal the drift instead of leaving it silent.
  const rm = await pgRemoveFromOfferSet(orderId, driverUid);
  if (!rm.ok) {
    req.log.error({ orderId, driverUid }, "[PG_REJECT] read-model/projection step failed after canonical commit");
    res.status(500).json({ ok: false, error: "projection_failed" });
    return;
  }

  req.log.info({ orderId, driverUid, removed: rm.removed }, "[PG_REJECT] rejected");
  res.json({ ok: true });
});

// ─── POST /api/orders/:orderId/timeout ─────────────────────────────────────────
//
// Phase 5J-Tier-9B: PG-authoritative offer timeout — replaces the Driver App's
// direct Firestore arrayRemove(activeOfferDriverUids) write.
//
// Unlike reject, timeout does NOT add the driver to orders.rejected_by, so the
// dispatcher MAY re-offer the same order to this driver in a later cycle.
//
//   1. pgTimeoutOffer marks the offer row timed_out in PostgreSQL (canonical).
//   2. pgRemoveFromOfferSet drops the driver from the active_offer_driver_uids
//      read-model + enqueues the durable Firestore offer_removal projection.
//
// Idempotent + token-derived driverUid, exactly like reject.
router.post("/orders/:orderId/timeout", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  // ── 1. PG-authoritative timeout (canonical) ──────────────────────────────────
  const pgRes = await pgTimeoutOffer(orderId, driverUid);
  if (!pgRes.ok) {
    req.log.error({ orderId, driverUid, reason: pgRes.reason }, "[PG_TIMEOUT] failed");
    res.status(500).json({ ok: false, error: pgRes.reason });
    return;
  }

  // ── 2. Read-model removal + durable Firestore projection enqueue ─────────────
  // Runs in its own transaction AFTER the canonical timeout committed. If it hits
  // an infra error the read-model + projection were skipped; surface a 500 so the
  // (idempotent) client retry / server-side poller can heal the drift.
  const rm = await pgRemoveFromOfferSet(orderId, driverUid);
  if (!rm.ok) {
    req.log.error({ orderId, driverUid }, "[PG_TIMEOUT] read-model/projection step failed after canonical commit");
    res.status(500).json({ ok: false, error: "projection_failed" });
    return;
  }

  req.log.info({ orderId, driverUid, removed: rm.removed }, "[PG_TIMEOUT] timed out");
  res.json({ ok: true });
});

// ─── POST /api/orders/:orderId/driver-cancel ───────────────────────────────────
//
// Phase 5J-Tier-9C: PG-authoritative driver pre-pickup cancellation — replaces
// the Driver App's direct Firestore write (status="pending" + driverUid=null).
// The order RETURNS TO THE POOL (it is NOT terminally cancelled) so the PG
// dispatcher re-offers it to another driver.
//
//   1. pgDriverCancelOrder atomically returns the order to the pool in
//      PostgreSQL (status=pending, driver cleared, offer set cleared, cancel
//      metadata stamped) AND enqueues the durable driver_cancel projection in
//      the SAME transaction — so the canonical state and the projection commit
//      together (no separate read-model step that can silently drift).
//   2. The projector mirrors the return-to-pool into the Firestore order doc for
//      the customer app / FCM read-model.
//
// Allowed only pre-pickup (status driver_assigned / to_pickup). Idempotent: a
// repeat call by the same driver after the order is back in the pool returns ok.
// Security: driverUid comes from the verified ID token only — never the body.
router.post("/orders/:orderId/driver-cancel", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const body   = (req.body ?? {}) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  // ── [ORDER_CANCEL_REASON_GATE] — reject if no reason supplied ─────────────
  // The driver app must always present the 3-reason modal before calling this
  // route.  An empty reason means the modal was bypassed (stale client, bug, or
  // malicious call) — reject with 400 so the API never silently accepts a
  // reason-less cancellation.
  if (!reason) {
    req.log.warn({ orderId, driverUid }, "[DRIVER_CANCEL_REASON_MISSING] cancel rejected — no reason");
    res.status(400).json({ ok: false, error: "cancel_reason_required" });
    return;
  }

  const r = await pgDriverCancelOrder(orderId, driverUid, reason);
  if (!r.ok) {
    const code =
      r.reason === "not_found" ? 404 :
      r.reason === "forbidden" ? 403 :
      r.reason === "too_late"  ? 409 :
      500;
    req.log.info({ orderId, driverUid, reason: r.reason }, "[PG_DRIVER_CANCEL] rejected");
    res.status(code).json({ ok: false, error: r.reason });
    return;
  }

  req.log.info({ orderId, driverUid, cancelReason: reason }, "[PG_DRIVER_CANCEL] cancelled (returned to pool)");
  res.json({ ok: true });
});

// ─── PATCH /api/orders/:orderId/stage ──────────────────────────────────────────
//
// Phase 5J-Tier-4: PG-authoritative delivery-stage advance — replaces the
// Driver App's direct Firestore updateOrderStage write.
//
//   1. pgSetOrderStage authoritatively advances the order in PostgreSQL, guarded
//      by driver ownership and a non-terminal status check.
//   2. The new stage is mirrored to Firestore (status + <stage>At timestamp) so
//      the customer app's real-time tracking keeps working.
//
// Allowed stages: to_pickup, at_pickup, to_drop, at_drop.  "delivered" is NOT
// accepted here — completion runs through POST /orders/:orderId/complete.
// Security: driverUid comes from the verified ID token only.

const ADVANCE_STAGES = new Set<string>(["to_pickup", "at_pickup", "to_drop", "at_drop"]);

async function projectStageToFirestore(
  orderId:   string,
  driverUid: string,
  stage:     string,
  log:       Request["log"],
): Promise<void> {
  try {
    const fdb = await adminFirestore();
    const ref = fdb.doc(`orders/${orderId}`);
    await fdb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        log.warn({ orderId, stage }, "[PG_STAGE_PROJECTION] Firestore doc missing — skip mirror");
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      if (data["driverUid"] !== driverUid) {
        log.warn({ orderId, stage }, "[PG_STAGE_PROJECTION] driver mismatch — skip mirror");
        return;
      }
      const status = data["status"];
      if (status === "cancelled" || status === "delivered") {
        log.warn({ orderId, stage, status }, "[PG_STAGE_PROJECTION] terminal status — skip mirror");
        return;
      }
      tx.update(ref, {
        status:         stage,
        [`${stage}At`]: FieldValue.serverTimestamp(),
        updatedAt:      FieldValue.serverTimestamp(),
      });
    });
    log.info({ orderId, driverUid, stage }, "[PG_STAGE_PROJECTION] mirrored to Firestore");
  } catch (err) {
    log.error({ err, orderId, driverUid, stage }, "[PG_STAGE_PROJECTION] mirror failed — PG authoritative, continuing");
  }
}

router.patch("/orders/:orderId/stage", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { stage } = (req.body ?? {}) as { stage?: unknown };
  if (typeof stage !== "string" || !ADVANCE_STAGES.has(stage)) {
    res.status(400).json({ ok: false, error: "invalid_stage" });
    return;
  }

  // ── 1. PG-authoritative stage advance ────────────────────────────────────────
  const pgRes = await pgSetOrderStage(orderId, driverUid, stage as DeliveryStage);
  if (!pgRes.ok) {
    req.log.info({ orderId, driverUid, stage, reason: pgRes.reason }, "[PG_STAGE] rejected");
    res.json({ ok: false, error: pgRes.reason });
    return;
  }

  // ── 2. Firestore mirror (best-effort; PG already committed) ──────────────────
  await projectStageToFirestore(orderId, driverUid, stage, req.log);

  req.log.info({ orderId, driverUid, stage }, "[PG_STAGE] advanced");
  res.json({ ok: true });
});

// ─── PATCH /api/orders/:orderId/location ───────────────────────────────────────
//
// Phase 5J-Tier-5: PG-authoritative live-location write — replaces the Driver
// App's direct Firestore updateDriverLocation write during active delivery.
//
//   1. pgSetOrderLocation authoritatively records driverLat/driverLng (+accuracy)
//      in PostgreSQL, guarded by driver ownership and a non-terminal status check.
//   2. The coordinates are mirrored to Firestore (driverLat/driverLng/
//      locationUpdatedAt/locationAccuracy) so the customer app's live driver map
//      keeps working via onSnapshot.
//
// High-frequency endpoint (~1 write / 10 s / active order). A missed Firestore
// mirror self-heals on the next GPS tick, so projection failures are logged and
// swallowed — PG stays authoritative. Security: driverUid from the ID token only.

async function projectLocationToFirestore(
  orderId:   string,
  driverUid: string,
  latitude:  number,
  longitude: number,
  accuracy:  number | undefined,
  log:       Request["log"],
): Promise<void> {
  try {
    const fdb = await adminFirestore();
    const ref = fdb.doc(`orders/${orderId}`);
    await fdb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        log.warn({ orderId }, "[PG_LOCATION_PROJECTION] Firestore doc missing — skip mirror");
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      if (data["driverUid"] !== driverUid) {
        log.warn({ orderId }, "[PG_LOCATION_PROJECTION] driver mismatch — skip mirror");
        return;
      }
      const status = data["status"];
      if (status === "cancelled" || status === "delivered") {
        log.warn({ orderId, status }, "[PG_LOCATION_PROJECTION] terminal status — skip mirror");
        return;
      }
      const payload: Record<string, unknown> = {
        driverLat:         latitude,
        driverLng:         longitude,
        locationUpdatedAt: FieldValue.serverTimestamp(),
      };
      if (typeof accuracy === "number") payload["locationAccuracy"] = accuracy;
      tx.update(ref, payload);
    });
  } catch (err) {
    log.error({ err, orderId, driverUid }, "[PG_LOCATION_PROJECTION] mirror failed — PG authoritative, continuing");
  }
}

router.patch("/orders/:orderId/location", async (req: Request, res: Response) => {
  const { orderId } = req.params as { orderId: string };

  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { latitude, longitude, accuracy } = (req.body ?? {}) as {
    latitude?:  unknown;
    longitude?: unknown;
    accuracy?:  unknown;
  };
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    res.status(400).json({ ok: false, error: "invalid_body" });
    return;
  }
  const acc = typeof accuracy === "number" ? accuracy : undefined;

  // ── 1. PG-authoritative location write ───────────────────────────────────────
  const pgRes = await pgSetOrderLocation(orderId, driverUid, latitude, longitude, acc);
  if (!pgRes.ok) {
    req.log.info({ orderId, driverUid, reason: pgRes.reason }, "[PG_LOCATION] rejected");
    res.json({ ok: false, error: pgRes.reason });
    return;
  }

  // ── 2. Firestore mirror (best-effort; PG already committed) ──────────────────
  await projectLocationToFirestore(orderId, driverUid, latitude, longitude, acc, req.log);

  res.json({ ok: true });
});

// ─── GET /api/orders/:orderId ──────────────────────────────────────────────────
//
// PG-primary fetch endpoint — Phase 2B-2A.
//
// Strategy:
//   1. Read PostgreSQL first (sequential, awaited).
//   2. PG hit  → log [PG_PRIMARY_HIT], return PG data immediately.
//               Fire off a non-blocking Firestore read in parallel for field
//               comparison; logs [PG_COMPARE_MATCH] or [PG_COMPARE_DIFF].
//   3. PG miss / exception / mapping failure
//              → log [PG_PRIMARY_FALLBACK], await Firestore, return Firestore data.
//
// Log tags:
//   [PG_PRIMARY_HIT]      — PG row found; PG data returned to caller
//   [PG_PRIMARY_FALLBACK] — PG missing or threw; Firestore data returned
//   [PG_COMPARE_MATCH]    — background comparison: all 9 fields agree
//   [PG_COMPARE_DIFF]     — background comparison: one or more fields diverge
//
// Field comparison notes:
//   fareEstimate / distanceKm — PG stores as numeric string ("85.00"); Firestore
//     stores as JS number (85).  Compared after parseFloat with ±0.01 tolerance.
//   durationMin — PG stores as integer; compared with Number() coercion.
//   All other fields — strict string equality after String() coercion.

function comparePgFirestore(
  pg: Awaited<ReturnType<typeof pgGetOrder>>,
  fsData: Record<string, unknown>,
  orderId: string,
  log: Request["log"],
): void {
  if (!pg) {
    log.info({ orderId }, "[PG_COMPARE_DIFF] PG row not found (compare skipped)");
    return;
  }

  const diffs: { field: string; pg: unknown; fs: unknown }[] = [];

  const strFields = ["status", "paymentMode", "pickup", "drop", "customerName", "customerPhone"] as const;
  for (const field of strFields) {
    const pgVal = (pg[field] as string | null) ?? null;
    const fsVal = (fsData[field] as string | null | undefined) ?? null;
    if (pgVal !== fsVal) diffs.push({ field, pg: pgVal, fs: fsVal });
  }

  const numFields: { pg: string | null; fs: unknown; field: string }[] = [
    { field: "fareEstimate", pg: pg.fareEstimate, fs: fsData["fareEstimate"] },
    { field: "distanceKm",   pg: pg.distanceKm,   fs: fsData["distanceKm"]   },
  ];
  for (const { field, pg: pgVal, fs: fsVal } of numFields) {
    if (pgVal === null && fsVal == null) continue;
    if (pgVal === null || fsVal == null) { diffs.push({ field, pg: pgVal, fs: fsVal }); continue; }
    if (Math.abs(parseFloat(pgVal) - Number(fsVal)) > 0.01) diffs.push({ field, pg: pgVal, fs: fsVal });
  }

  const durPg = pg.durationMin;
  const durFs = fsData["durationMin"];
  if (!(durPg == null && durFs == null)) {
    if (durPg == null || durFs == null || durPg !== Number(durFs)) {
      diffs.push({ field: "durationMin", pg: durPg, fs: durFs });
    }
  }

  if (diffs.length === 0) {
    log.info({ orderId }, "[PG_COMPARE_MATCH]");
  } else {
    log.info({ orderId, diffs }, "[PG_COMPARE_DIFF]");
  }
}

router.get("/orders/:orderId", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const { orderId } = req.params as { orderId: string };

  const firestoreDb = await adminFirestore();

  // ── 1. PG primary read ───────────────────────────────────────────────────────
  let pgRow: Awaited<ReturnType<typeof pgGetOrder>> = null;
  let pgFailed = false;

  try {
    pgRow = await pgGetOrder(orderId);
  } catch (err) {
    req.log.error({ err, orderId }, "[PG_PRIMARY_FALLBACK] PG read threw");
    pgFailed = true;
  }

  // ── 2. PG hit — return PG data; compare Firestore in background ──────────────
  if (!pgFailed && pgRow !== null) {
    let pgData: Record<string, unknown>;
    try {
      pgData = {
        id:            pgRow.id,
        status:        pgRow.status,
        driverUid:     pgRow.driverUid ?? null,
        customerName:  pgRow.customerName ?? "",
        customerPhone: pgRow.customerPhone ?? "",
        pickup:        pgRow.pickup ?? "",
        pickupCity:    pgRow.pickupCity ?? "",
        drop:          pgRow.drop ?? "",
        distanceKm:    pgRow.distanceKm  != null ? parseFloat(pgRow.distanceKm)  : undefined,
        durationMin:   pgRow.durationMin != null ? pgRow.durationMin             : undefined,
        fareEstimate:  pgRow.fareEstimate != null ? parseFloat(pgRow.fareEstimate) : 0,
        paymentMode:   pgRow.paymentMode ?? "Cash",
      };
    } catch (err) {
      req.log.error({ err, orderId }, "[PG_PRIMARY_FALLBACK] PG field mapping threw");
      pgFailed = true;
      pgData = {};
    }

    if (!pgFailed) {
      req.log.info({ orderId }, "[PG_PRIMARY_HIT]");

      // Fire off Firestore read + comparison non-blocking (response already sent below)
      void firestoreDb.doc(`orders/${orderId}`).get()
        .then((snap) => {
          if (!snap.exists) {
            req.log.info({ orderId }, "[PG_COMPARE_DIFF] Firestore doc missing — PG has row");
            return;
          }
          const fsData = { id: snap.id, ...snap.data() } as Record<string, unknown>;
          comparePgFirestore(pgRow, fsData, orderId, req.log);
        })
        .catch((err) => {
          req.log.error({ err, orderId }, "GET /orders/:orderId background Firestore compare failed");
        });

      res.json({ ok: true, order: pgData });
      return;
    }
  }

  // ── 3. Firestore fallback — PG missing or threw ───────────────────────────────
  if (!pgFailed) {
    // pgRow was null (order not yet in PG)
    req.log.info({ orderId }, "[PG_PRIMARY_FALLBACK] PG row not found");
  }

  try {
    const snap = await firestoreDb.doc(`orders/${orderId}`).get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }
    const fsData = { id: snap.id, ...snap.data() } as Record<string, unknown>;
    res.json({ ok: true, order: fsData });
  } catch (err) {
    req.log.error({ err, orderId }, "GET /orders/:orderId Firestore fallback read failed");
    res.status(500).json({ ok: false, error: "firestore_error" });
  }
});

// ─── GET /api/orders/hotzone ──────────────────────────────────────────────────
//
// Phase 5J-Tier-1: PG-backed hot-zone endpoint — replaces LiveMap Firestore read.
//
// Returns orders (status: searching|pending, created in last 30 min) grouped by
// pickup area, sorted by orderCount DESC, top 10 zones.
// Zone name: pickupCity → first comma-segment of pickup → "Nearby Zone".
// lat/lng/distanceKm are not stored in PG — callers receive null for those fields.
//
// Auth: Bearer token required.
//
router.get("/orders/hotzone", async (req: Request, res: Response) => {
  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  let rows: Array<{ pickup: string | null; pickupCity: string | null }> = [];
  try {
    rows = await db
      .select({ pickup: ordersTable.pickup, pickupCity: ordersTable.pickupCity })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.status, ["finding_driver", "searching", "pending"]),
          gte(ordersTable.createdAt, cutoff),
        ),
      )
      .limit(60);
  } catch (err) {
    req.log.error({ err }, "[HOTZONE_PG_ERROR]");
    res.status(500).json({ ok: false, error: "db_error" });
    return;
  }

  const zoneMap = new Map<string, number>();
  for (const row of rows) {
    const zoneName =
      row.pickupCity?.trim() ||
      (row.pickup ? (row.pickup.split(",")[0]?.trim() ?? null) : null) ||
      "Nearby Zone";
    zoneMap.set(zoneName, (zoneMap.get(zoneName) ?? 0) + 1);
  }

  const zones = [...zoneMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, orderCount]) => ({ name, orderCount }));

  req.log.info({ total: rows.length, zones: zones.length }, "[HOTZONE_HIT]");
  res.json({ ok: true, zones });
});

export default router;
