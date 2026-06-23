import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { pgGetOrder, pgShadowSetStatus, pgAcceptOffer, pgSetOrderStage, pgSetOrderLocation, type DeliveryStage } from "../lib/order-pg-service";
import { pgCreditOrderEarning, pgUpdateDriverDailyStats } from "../lib/wallet-pg-service";
import { db, ordersTable } from "@workspace/db";
import { inArray, gte, and } from "drizzle-orm";

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

  let fareAmount    = 0;
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
      fareAmount        = typeof order["fareEstimate"] === "number" ? order["fareEstimate"] : 0;
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

    // ── PG shadow write: wallet credit (non-blocking) ─────────────────────────
    void pgCreditOrderEarning(
      driverUid,
      orderId,
      fareAmount,
      `Delivery #${orderId.slice(-6).toUpperCase()}`,
    )
      .then(() => req.log.info({ orderId, driverUid, fareAmount }, "[PG_WALLET_CREDIT]"))
      .catch((e) => req.log.error({ err: e, orderId, driverUid }, "[PG_WALLET_CREDIT] shadow write failed — non-blocking"));

    // ── PG shadow write: driver daily stats (non-blocking) ────────────────────
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
  const pgRes = await pgAcceptOffer(orderId, driverUid, driverName);

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
          inArray(ordersTable.status, ["searching", "pending"]),
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
