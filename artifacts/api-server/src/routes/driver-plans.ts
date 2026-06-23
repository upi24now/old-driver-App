import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import Razorpay from "razorpay";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import { db, driversTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ─── Plan constants ────────────────────────────────────────────────────────────

type PlanType = "daily" | "weekly" | "monthly";

const VALID_PLAN_TYPES = new Set<string>(["daily", "weekly", "monthly"]);

const PLAN_AMOUNT_PAISE: Record<PlanType, number> = {
  daily:   300,
  weekly:  1900,
  monthly: 10000,
};

const PLAN_AMOUNT_RUPEES: Record<PlanType, number> = {
  daily:   3,
  weekly:  19,
  monthly: 100,
};

const PLAN_DAYS: Record<PlanType, number> = {
  daily:   0.5,   // 12 hours
  weekly:  7,
  monthly: 30,
};

const MS_PER_DAY = 86_400_000;

// ─── Razorpay lazy singleton ───────────────────────────────────────────────────

let _rzp: Razorpay | null = null;
let _rzpKeyId: string | null = null;

function getRazorpay(): { client: Razorpay; keyId: string } {
  if (_rzp && _rzpKeyId) return { client: _rzp, keyId: _rzpKeyId };

  const keyId     = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];

  if (!keyId || !keySecret) {
    throw new Error(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required",
    );
  }

  _rzp      = new Razorpay({ key_id: keyId, key_secret: keySecret });
  _rzpKeyId = keyId;
  return { client: _rzp, keyId };
}

// ─── POST /api/driver-plans/create-order ──────────────────────────────────────

router.post("/driver-plans/create-order", async (req, res) => {
  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  const { driverUid, planType } = req.body as {
    driverUid?: string;
    planType?:  string;
  };

  if (!driverUid || typeof driverUid !== "string") {
    res.status(400).json({ error: "driverUid is required" });
    return;
  }

  if (tokenUid !== driverUid) {
    res.status(403).json({ error: "Token UID does not match driverUid" });
    return;
  }

  if (!planType || !VALID_PLAN_TYPES.has(planType)) {
    res.status(400).json({
      error: `planType must be one of: ${[...VALID_PLAN_TYPES].join(", ")}`,
    });
    return;
  }

  const plan = planType as PlanType;

  let rzp: { client: Razorpay; keyId: string };
  try {
    rzp = getRazorpay();
  } catch (err) {
    req.log.error({ err }, "Razorpay not configured");
    res.status(503).json({ error: "Payment service not configured" });
    return;
  }

  const receipt = `${driverUid}-${plan}-${Date.now()}`;

  try {
    const order = await rzp.client.orders.create({
      amount:   PLAN_AMOUNT_PAISE[plan],
      currency: "INR",
      receipt,
    });

    req.log.info({ driverUid, plan, orderId: order.id }, "Razorpay order created");

    res.json({
      razorpayOrderId: order.id,
      amount:          PLAN_AMOUNT_PAISE[plan],
      currency:        "INR",
      keyId:           rzp.keyId,
    });
  } catch (err) {
    req.log.error({ err }, "Razorpay order creation failed");
    res.status(502).json({ error: "Failed to create payment order" });
  }
});

// ─── POST /api/driver-plans/verify-payment ────────────────────────────────────

router.post("/driver-plans/verify-payment", async (req, res) => {
  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  const {
    driverUid,
    planType,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  } = req.body as {
    driverUid?:         string;
    planType?:          string;
    razorpayOrderId?:   string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  };

  if (!driverUid || typeof driverUid !== "string") {
    res.status(400).json({ error: "driverUid is required" });
    return;
  }

  if (tokenUid !== driverUid) {
    res.status(403).json({ error: "Token UID does not match driverUid" });
    return;
  }

  if (!planType || !VALID_PLAN_TYPES.has(planType)) {
    res.status(400).json({
      error: `planType must be one of: ${[...VALID_PLAN_TYPES].join(", ")}`,
    });
    return;
  }

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({
      error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required",
    });
    return;
  }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    req.log.error("RAZORPAY_KEY_SECRET is not set");
    res.status(503).json({ error: "Payment service not configured" });
    return;
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const signaturesMatch = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, "hex"),
    Buffer.from(razorpaySignature,  "hex"),
  );

  if (!signaturesMatch) {
    req.log.warn({ driverUid, razorpayOrderId }, "Razorpay signature verification failed");
    res.status(400).json({ error: "Payment verification failed — invalid signature" });
    return;
  }

  const plan         = planType as PlanType;
  const planStartAt  = Date.now();
  const planExpiryAt = planStartAt + PLAN_DAYS[plan] * MS_PER_DAY;

  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    const fsDb = await adminFirestore();

    await fsDb.doc(`drivers/${driverUid}`).set(
      {
        subscriptionPlan:      plan,
        subscriptionExpiresAt: planExpiryAt,
        planType:              plan,
        planStatus:            "active",
        planStartAt,
        planExpiryAt,
        lastPlanAmount:        PLAN_AMOUNT_RUPEES[plan],
        razorpayOrderId,
        razorpayPaymentId,
        updatedAt:             FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    req.log.info(
      { driverUid, plan, planExpiryAt, razorpayPaymentId },
      "Driver plan activated",
    );

    // ── PG shadow write (Phase 5A.3; non-blocking, never throws) ───────────────
    // Mirror the new subscription expiry into the PG drivers row so a future
    // PG dispatcher can reproduce the eligibility filter. Firestore above stays
    // the source of truth; a PG failure must NEVER affect plan activation.
    void (async () => {
      try {
        await db
          .update(driversTable)
          .set({
            subscriptionExpiresAt: new Date(planExpiryAt),
            updatedAt:             new Date(),
          })
          .where(eq(driversTable.uid, driverUid));
        req.log.info({ driverUid, planExpiryAt }, "[PG_DRIVER_META_SAVE]");
      } catch (err) {
        req.log.warn({ err, driverUid }, "[PG_DRIVER_META_FALLBACK]");
      }
    })();

    res.json({ ok: true, planStartAt, planExpiryAt });
  } catch (err) {
    req.log.error({ err }, "Firestore plan write failed");
    res.status(500).json({ error: "Plan activation failed — please contact support" });
  }
});

// ── Registration fee floor ────────────────────────────────────────────────────
//
// Minimum amount the server will ever charge, regardless of remote config.
// To change the fee, update this constant AND the Firestore document AND
// the signup route default (all three must stay in sync).
const REGISTRATION_FEE_MIN_INR = 10;

// ─── POST /api/driver-plans/onboarding-fee/create-order ──────────────────────
//
// Creates a Razorpay order for the one-time onboarding registration fee.
// Amount is read from the PG drivers row (set at signup).
// Falls back to Firestore app_config/driver_onboarding if PG has no amount.
// The result is always floored to REGISTRATION_FEE_MIN_INR (₹10).

router.post("/driver-plans/onboarding-fee/create-order", async (req, res) => {
  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  const { driverUid } = req.body as { driverUid?: string };

  if (!driverUid || typeof driverUid !== "string") {
    res.status(400).json({ error: "driverUid is required" });
    return;
  }
  if (tokenUid !== driverUid) {
    res.status(403).json({ error: "Token UID does not match driverUid" });
    return;
  }

  // ── Read fee amount: PG first, Firestore fallback ─────────────────────────
  let amountInr = REGISTRATION_FEE_MIN_INR;
  let currency  = "INR";

  try {
    const [pgDriver] = await db
      .select({
        onboardingFeeApplies: driversTable.onboardingFeeApplies,
        onboardingFeeStatus:  driversTable.onboardingFeeStatus,
        onboardingFeeAmount:  driversTable.onboardingFeeAmount,
        onboardingFeeCurrency: driversTable.onboardingFeeCurrency,
      })
      .from(driversTable)
      .where(eq(driversTable.uid, driverUid))
      .limit(1);

    if (pgDriver) {
      // PG path: validate eligibility from PG row
      if (!pgDriver.onboardingFeeApplies) {
        res.status(403).json({ error: "Onboarding fee does not apply to this account" });
        return;
      }
      if (pgDriver.onboardingFeeStatus === "paid") {
        res.status(409).json({ error: "Onboarding fee already paid" });
        return;
      }
      if (pgDriver.onboardingFeeAmount && pgDriver.onboardingFeeAmount > 0) {
        amountInr = pgDriver.onboardingFeeAmount;
      }
      if (pgDriver.onboardingFeeCurrency) {
        currency = pgDriver.onboardingFeeCurrency;
      }
    } else {
      // Firestore fallback for drivers not yet in PG
      const fsDb = await adminFirestore();
      try {
        const configSnap = await fsDb.doc("app_config/driver_onboarding").get();
        if (configSnap.exists) {
          const c = configSnap.data() as Record<string, unknown>;
          if (typeof c["amount"] === "number" && (c["amount"] as number) > 0) {
            amountInr = c["amount"] as number;
          }
          if (typeof c["currency"] === "string") currency = c["currency"] as string;
        }
      } catch (fsErr) {
        req.log.warn({ fsErr }, "Failed to read onboarding fee config from Firestore, using floor");
      }
      // Eligibility fallback from Firestore
      try {
        const driverSnap = await fsDb.doc(`drivers/${driverUid}`).get();
        if (driverSnap.exists) {
          const d = driverSnap.data() as Record<string, unknown>;
          if (d["onboardingFeeApplies"] !== true) {
            res.status(403).json({ error: "Onboarding fee does not apply to this account" });
            return;
          }
          if (d["onboardingFeeStatus"] === "paid") {
            res.status(409).json({ error: "Onboarding fee already paid" });
            return;
          }
        }
      } catch (fsErr) {
        req.log.warn({ fsErr }, "Could not validate driver fee eligibility from Firestore — continuing");
      }
    }
  } catch (err) {
    req.log.warn({ err }, "onboarding-fee create-order: PG read failed, using floor amount");
  }

  // Floor: never charge below minimum
  amountInr = Math.max(amountInr, REGISTRATION_FEE_MIN_INR);

  // ── Create Razorpay order ──────────────────────────────────────────────────
  let rzp: { client: Razorpay; keyId: string };
  try {
    rzp = getRazorpay();
  } catch (err) {
    req.log.error({ err }, "Razorpay not configured");
    res.status(503).json({ error: "Payment service not configured" });
    return;
  }

  const amountPaise = Math.round(amountInr * 100);
  const receipt     = `onboarding-${driverUid}-${Date.now()}`;

  req.log.info({ driverUid, amountInr, amountPaise }, "onboarding-fee create-order: amount resolved");

  try {
    const order = await rzp.client.orders.create({ amount: amountPaise, currency, receipt });
    req.log.info({ driverUid, amountInr, amountPaise, orderId: order.id }, "onboarding-fee: Razorpay order created");
    res.json({ razorpayOrderId: order.id, amount: amountPaise, currency, keyId: rzp.keyId });
  } catch (err) {
    req.log.error({ err }, "Razorpay onboarding-fee order creation failed");
    res.status(502).json({ error: "Failed to create payment order" });
  }
});

// ─── POST /api/driver-plans/onboarding-fee/verify-payment ────────────────────
//
// Verifies the Razorpay HMAC-SHA256 signature.
// Valid signature only:
//
// ── Authority model ───────────────────────────────────────────────────────────
//   PostgreSQL is AUTHORITATIVE.
//   - PG UPDATE (drivers table) is awaited before the HTTP response is sent.
//   - Firestore writes (payment audit record + driver doc mirror) are
//     fire-and-forget after the response. They are kept for the admin panel
//     and backward compat but are NOT in the critical path.
//
// PG write:
//   UPDATE drivers SET
//     onboarding_fee_status  = "paid"
//     onboarding_fee_paid_at = now
//     registration_fee_paid  = true
//     registration_fee_amount = amount
//     registration_fee_paid_at = now
//     documents_submitted    = true
//     documents_submitted_at = now
//     verification_status    = "pending"
//     updated_at             = now
//   WHERE uid = driverUid
//
// Firestore (fire-and-forget):
//   driver_payments/{auto-id}  — immutable audit record
//   drivers/{uid}              — admin panel mirror

router.post("/driver-plans/onboarding-fee/verify-payment", async (req, res) => {
  const tokenUid = await requireAuth(req, res);
  if (!tokenUid) return;

  const { driverUid, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
    driverUid?:         string;
    razorpayOrderId?:   string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  };

  if (!driverUid || typeof driverUid !== "string") {
    res.status(400).json({ error: "driverUid is required" });
    return;
  }
  if (tokenUid !== driverUid) {
    res.status(403).json({ error: "Token UID does not match driverUid" });
    return;
  }
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({
      error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required",
    });
    return;
  }

  // ── HMAC-SHA256 signature verification ────────────────────────────────────
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    req.log.error("RAZORPAY_KEY_SECRET is not set");
    res.status(503).json({ error: "Payment service not configured" });
    return;
  }

  const expectedSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  let sigsMatch = false;
  try {
    sigsMatch = crypto.timingSafeEqual(
      Buffer.from(expectedSig,       "hex"),
      Buffer.from(razorpaySignature, "hex"),
    );
  } catch {
    sigsMatch = false;
  }

  if (!sigsMatch) {
    req.log.warn({ driverUid, razorpayOrderId }, "Onboarding fee payment signature verification failed");
    res.status(400).json({ error: "Payment verification failed — invalid signature" });
    return;
  }

  // ── Signature valid ────────────────────────────────────────────────────────

  // Read fee amount from PG (set at signup). Fall back to floor if absent.
  let registrationFeeAmount = REGISTRATION_FEE_MIN_INR;
  try {
    const [pgRow] = await db
      .select({ onboardingFeeAmount: driversTable.onboardingFeeAmount })
      .from(driversTable)
      .where(eq(driversTable.uid, driverUid))
      .limit(1);
    if (pgRow?.onboardingFeeAmount && pgRow.onboardingFeeAmount > 0) {
      registrationFeeAmount = pgRow.onboardingFeeAmount;
    }
  } catch (pgReadErr) {
    req.log.warn({ pgReadErr, driverUid }, "onboarding-fee verify: could not read fee amount from PG, using floor");
  }

  const now = new Date();

  // ── PostgreSQL write (AUTHORITATIVE) ─────────────────────────────────────
  try {
    const result = await db
      .update(driversTable)
      .set({
        onboardingFeeStatus:   "paid",
        onboardingFeePaidAt:   now,
        registrationFeePaid:   true,
        registrationFeeAmount,
        registrationFeePaidAt: now,
        documentsSubmitted:    true,
        documentsSubmittedAt:  now,
        verificationStatus:    "pending",
        updatedAt:             now,
      })
      .where(eq(driversTable.uid, driverUid))
      .returning({ uid: driversTable.uid });

    if (result.length === 0) {
      // Driver has no PG row — old Firestore-only driver. Log and continue
      // so Firestore write still marks the payment. App will read Firestore fallback.
      req.log.warn({ driverUid }, "onboarding-fee verify: no PG row — old driver, Firestore will be written");
    } else {
      req.log.info({ driverUid, razorpayPaymentId, registrationFeeAmount }, "onboarding-fee: PG drivers row updated (authoritative)");
    }
  } catch (pgErr) {
    req.log.error({ pgErr, driverUid }, "onboarding-fee verify: PG update failed");
    res.status(500).json({ error: "Payment recorded but database update failed — please contact support" });
    return;
  }

  // ── Response sent before Firestore (Firestore is fire-and-forget mirror) ──
  res.json({ ok: true });

  // ── Firestore (fire-and-forget — admin panel + old-driver mirror) ─────────
  void (async () => {
    try {
      const { FieldValue } = await import("firebase-admin/firestore");
      const fsDb  = await adminFirestore();
      const fsNow = FieldValue.serverTimestamp();

      // 1. Immutable payment audit record
      await fsDb.collection("driver_payments").add({
        uid:              driverUid,
        type:             "onboarding_fee",
        razorpayOrderId,
        razorpayPaymentId,
        status:           "paid",
        amountInr:        registrationFeeAmount,
        createdAt:        fsNow,
      });

      // 2. Driver doc mirror (admin panel reads this)
      await fsDb.doc(`drivers/${driverUid}`).set(
        {
          onboardingFeeStatus:     "paid",
          onboardingFeePaidAt:     fsNow,
          onboardingFeePaymentId:  razorpayPaymentId,
          onboardingFeeUpdatedAt:  fsNow,
          registrationFeePaid:     true,
          registrationFeeAmount,
          registrationFeePaidAt:   fsNow,
          onboardingSubmittedAt:   fsNow,
          verificationStatus:      "pending",
          documentsSubmitted:      true,
          documentsSubmittedAt:    fsNow,
          updatedAt:               fsNow,
        },
        { merge: true },
      );

      req.log.info({ driverUid, razorpayPaymentId }, "onboarding-fee: Firestore mirror updated");
    } catch (fsErr) {
      req.log.error({ fsErr, driverUid }, "onboarding-fee: Firestore mirror failed — PG remains authoritative");
    }
  })();
});

export default router;
