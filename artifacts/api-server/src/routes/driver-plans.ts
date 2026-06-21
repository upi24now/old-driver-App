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
//
// Initialized on first request so that startup never fails due to missing
// env vars (consistent with the Firebase Admin lazy-init pattern).

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
//
// Creates a Razorpay order server-side.
// Mobile receives the order ID + public key ID and opens the checkout.
// The KEY_SECRET is never exposed outside this server.

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
//
// Verifies the Razorpay payment signature (HMAC-SHA256).
// Only on valid signature: activates the plan in Firestore using server time.
// An invalid or missing signature results in a 400 — plan is NOT activated.

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

  // ── Signature verification ─────────────────────────────────────────────────
  //
  // Razorpay signs payments with HMAC-SHA256 over "orderId|paymentId".
  // The expected signature must match exactly — timing-safe comparison used.

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

  // ── Plan activation ────────────────────────────────────────────────────────
  //
  // Signature is valid. Use server time as the authoritative plan start time.
  // Mobile time is never trusted for paid plan validity.

  const plan         = planType as PlanType;
  const planStartAt  = Date.now();
  const planExpiryAt = planStartAt + PLAN_DAYS[plan] * MS_PER_DAY;

  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = await adminFirestore();

    await db.doc(`drivers/${driverUid}`).set(
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

    res.json({ ok: true, planStartAt, planExpiryAt });
  } catch (err) {
    req.log.error({ err }, "Firestore plan write failed");
    res.status(500).json({ error: "Plan activation failed — please contact support" });
  }
});

// ── Registration fee floor ────────────────────────────────────────────────────
//
// This constant is the minimum the server will ever charge, regardless of what
// Firestore app_config/driver_onboarding contains. If a stale remote config still
// has amount: 5, it will be clamped up to REGISTRATION_FEE_MIN_INR.
// To change the fee, update this constant AND the Firestore document together.
const REGISTRATION_FEE_MIN_INR = 10;

// ─── POST /api/driver-plans/onboarding-fee/create-order ──────────────────────
//
// Creates a Razorpay order for the one-time onboarding registration fee.
// Amount is read from Firestore app_config/driver_onboarding, then floored
// to REGISTRATION_FEE_MIN_INR (₹10) so stale configs can never undercharge.
// Validates that the driver's onboardingFeeApplies = true and fee is unpaid.

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

  const db = await adminFirestore();

  // ── Read fee config from Firestore, clamp to floor ───────────────────────
  // ROOT-CAUSE FIX: Firestore app_config/driver_onboarding may still contain
  // amount: 5 from before the fee change. We ALWAYS clamp up to
  // REGISTRATION_FEE_MIN_INR so a stale remote config can never undercharge.
  let amountInr = REGISTRATION_FEE_MIN_INR;
  let currency  = "INR";
  try {
    const configSnap = await db.doc("app_config/driver_onboarding").get();
    if (configSnap.exists) {
      const c = configSnap.data() as Record<string, unknown>;
      if (typeof c["amount"] === "number" && (c["amount"] as number) > 0) {
        amountInr = c["amount"] as number;
      }
      if (typeof c["currency"] === "string") {
        currency = c["currency"] as string;
      }
    }
  } catch (err) {
    req.log.warn({ err }, "Failed to read onboarding fee config, using floor ₹10");
  }

  // Floor: Firestore config (e.g. stale amount: 5) must never go below ₹10.
  amountInr = Math.max(amountInr, REGISTRATION_FEE_MIN_INR);

  // ── Validate driver eligibility ────────────────────────────────────────────
  try {
    const driverSnap = await db.doc(`drivers/${driverUid}`).get();
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
  } catch (err) {
    req.log.warn({ err }, "Could not validate driver fee eligibility — continuing");
  }

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

  req.log.info({ driverUid, amountInr, amountPaise }, "[FeeDebug] server amountInr = " + String(amountInr) + " | server amountPaise = " + String(amountPaise));

  try {
    const order = await rzp.client.orders.create({ amount: amountPaise, currency, receipt });
    req.log.info({ driverUid, amountInr, amountPaise, orderId: order.id, orderAmount: order.amount }, "[FeeDebug] razorpay order response amount = " + String(order.amount));
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
//   1. Writes payment record to driver_payments/{auto-id}
//   2. Sets drivers/{uid}.onboardingFeeStatus = "paid" with audit fields
// Invalid signature → 400, nothing written.

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
    sigsMatch = false;  // Buffer length mismatch — malformed signature
  }

  if (!sigsMatch) {
    req.log.warn({ driverUid, razorpayOrderId }, "Onboarding fee payment signature verification failed");
    res.status(400).json({ error: "Payment verification failed — invalid signature" });
    return;
  }

  // ── Signature valid: write records ────────────────────────────────────────
  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    const db  = await adminFirestore();
    const now = FieldValue.serverTimestamp();

    // Read the fee amount that was stamped on the driver doc at signup.
    // Falls back to 10 (₹10) if the field is absent.
    let registrationFeeAmount = 10;
    try {
      const driverSnap = await db.doc(`drivers/${driverUid}`).get();
      if (driverSnap.exists) {
        const d = driverSnap.data() as Record<string, unknown>;
        if (typeof d["onboardingFeeAmount"] === "number" && (d["onboardingFeeAmount"] as number) > 0) {
          registrationFeeAmount = d["onboardingFeeAmount"] as number;
        }
      }
    } catch {
      // Non-fatal: we still complete the payment record with the fallback amount
    }

    // 1. Immutable payment record
    await db.collection("driver_payments").add({
      uid:                  driverUid,
      type:                 "onboarding_fee",
      razorpayOrderId,
      razorpayPaymentId,
      status:               "paid",
      amountInr:            registrationFeeAmount,
      createdAt:            now,
    });

    // 2. Mark driver doc paid + write all admin-visible onboarding fields.
    //    - registrationFeePaid / registrationFeeAmount / registrationFeePaidAt
    //      are the canonical admin-panel fields for "did this driver pay?"
    //    - onboardingSubmittedAt marks when the full onboarding (docs + fee) completed
    //    - verificationStatus / documentsSubmitted / documentsSubmittedAt may already
    //      be set by submitDriverDocuments(); we write them here too so they are
    //      guaranteed to be present even if the client skipped the call.
    await db.doc(`drivers/${driverUid}`).set(
      {
        // Onboarding fee — routing guard reads onboardingFeeStatus
        onboardingFeeStatus:    "paid",
        onboardingFeePaidAt:    now,
        onboardingFeePaymentId: razorpayPaymentId,
        onboardingFeeUpdatedAt: now,

        // Registration fee — admin-panel / KYC canonical fields
        registrationFeePaid:     true,
        registrationFeeAmount:   registrationFeeAmount,
        registrationFeePaidAt:   now,

        // Onboarding submission timestamp
        onboardingSubmittedAt: now,

        // Verification pipeline — admin sets verificationStatus to "approved"
        // to unlock the driver; we only ever write "pending" here.
        verificationStatus:   "pending",
        documentsSubmitted:   true,
        documentsSubmittedAt: now,

        updatedAt: now,
      },
      { merge: true },
    );

    req.log.info({ driverUid, razorpayPaymentId, registrationFeeAmount }, "Onboarding fee paid and recorded");
    res.json({ ok: true });

    // ── PostgreSQL mirror (fire-and-forget, non-fatal) ────────────────────────
    // Firestore is authoritative for the payment record; PG is mirrored so that
    // GET /api/drivers/me returns the correct onboardingFeeStatus, and session
    // restore (deriveNextRoute) does not loop back to /document-upload or /onboarding-fee.
    void (async () => {
      try {
        const now = new Date();
        await db
          .update(driversTable)
          .set({
            onboardingFeeStatus:  "paid",
            registrationFeePaid:  true,
            registrationFeeAmount,
            registrationFeePaidAt: now,
            documentsSubmitted:   true,
            verificationStatus:   "pending",
            updatedAt:            now,
          })
          .where(eq(driversTable.uid, driverUid));
        req.log.info({ driverUid }, "onboarding-fee: PG mirror updated");
      } catch (pgErr) {
        req.log.error({ pgErr, driverUid }, "onboarding-fee: PG mirror failed — Firestore authoritative");
      }
    })();
  } catch (err) {
    req.log.error({ err }, "Firestore write failed after onboarding fee signature verify");
    res.status(500).json({
      error: "Payment was verified but database update failed — please contact support",
    });
  }
});

export default router;
