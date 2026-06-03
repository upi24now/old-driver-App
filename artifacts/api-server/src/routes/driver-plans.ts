import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import Razorpay from "razorpay";
import { adminAuth, adminFirestore } from "../lib/firebase-admin";

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

// ─── Auth helper ──────────────────────────────────────────────────────────────
//
// Validates the Firebase ID token from the Authorization header.
// Returns the decoded UID on success, or writes a 401 and returns null.

async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
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

export default router;
