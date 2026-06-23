import { Router, type Request, type Response } from "express";

const router = Router();

// ─── GET /api/config/onboarding-fee ──────────────────────────────────────────
//
// Phase 5J-Tier-1: replaces the Firestore read of app_config/driver_onboarding
// in the Driver App onboarding-fee screen.
//
// No auth required — consistent with prior Firestore client SDK behavior
// (app_config was world-readable).
//
// Source of truth (priority order):
//   1. ONBOARDING_FEE_AMOUNT env var (must be integer ≥ 10)
//   2. Static floor: 10 INR
//
// ONBOARDING_FEE_ENABLED env var defaults to true; set to "false" to disable.
//
router.get("/config/onboarding-fee", (_req: Request, res: Response) => {
  const rawAmount = parseInt(process.env["ONBOARDING_FEE_AMOUNT"] ?? "", 10);
  const amount    = Number.isFinite(rawAmount) && rawAmount >= 10 ? rawAmount : 10;
  const enabled   = process.env["ONBOARDING_FEE_ENABLED"] !== "false";

  res.json({
    ok: true,
    config: {
      enabled,
      amount,
      currency:    "INR",
      title:       "One-time onboarding fee",
      description: "Required to complete driver verification and access all orders.",
    },
  });
});

export default router;
