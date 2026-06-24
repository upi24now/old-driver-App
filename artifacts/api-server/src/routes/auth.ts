import { Router } from "express";
import { eq, lt } from "drizzle-orm";
import { adminAuth } from "../lib/firebase-admin";
import { db, authOtpsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ─── Test phone bypass ────────────────────────────────────────────────────────
// Format: TEST_OTP_PHONES="phone1:otp1,phone2:otp2"
// Example: TEST_OTP_PHONES="8299013350:123456"
//
// Test phones bypass the PG OTP store entirely. The fixed PIN comes from the
// env var. devOtp is ALWAYS returned (regardless of NODE_ENV) so the tester
// can read the PIN on-screen.
//
// WARNING: if TEST_OTP_PHONES is set in a production environment, the
// configured phone numbers receive a publicly visible PIN in every send-otp
// response — this is an explicit intentional bypass for those numbers only.
// Do not include real-user numbers.
function parseTestPhones(): Map<string, string> {
  const raw = process.env["TEST_OTP_PHONES"] ?? "";
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [phone, otp] = entry.trim().split(":");
    if (phone && otp) map.set(phone.trim(), otp.trim());
  }
  return map;
}

const MAX_ATTEMPTS = 5;
const OTP_TTL_MS   = 5 * 60 * 1000; // 5 minutes

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post("/auth/send-otp", async (req, res) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
    return;
  }

  // ── Test phone bypass ──────────────────────────────────────────────────────
  const testPhones = parseTestPhones();
  if (testPhones.has(phone)) {
    const devOtp = testPhones.get(phone)!;
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP send — test bypass active");
    // Always return devOtp for test phones so the tester sees the PIN on-screen.
    res.json({ sent: true, devOtp });
    return;
  }

  // ── Real phone — PG-backed OTP ─────────────────────────────────────────────
  const otp       = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  try {
    // Upsert: one active OTP per phone. Re-sending replaces the old row,
    // resets the attempt counter, and clears consumed_at so a fresh flow works.
    await db
      .insert(authOtpsTable)
      .values({ phone, otp, expiresAt, attempts: 0 })
      .onConflictDoUpdate({
        target: authOtpsTable.phone,
        set: {
          otp,
          expiresAt,
          attempts:   0,
          consumedAt: sql`NULL`,
          createdAt:  sql`NOW()`,
        },
      });
  } catch (err) {
    req.log.error({ err }, "send-otp: PG upsert failed");
    res.status(500).json({ error: "Could not save OTP. Please try again." });
    return;
  }

  req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP generated and stored in PG");

  // devOtp: only in non-production environments (never expose real OTPs in prod).
  const isDev = process.env["NODE_ENV"] !== "production";
  res.json({ sent: true, ...(isDev ? { devOtp: otp } : {}) });
});

router.post("/auth/verify-otp", async (req, res) => {
  const { phone, otp } = req.body as { phone?: string; otp?: string };

  if (!phone || !otp) {
    res.status(400).json({ error: "phone and otp are required." });
    return;
  }

  // ── Test phone bypass ──────────────────────────────────────────────────────
  const testPhones = parseTestPhones();
  if (testPhones.has(phone)) {
    if (testPhones.get(phone) !== otp) {
      res.status(401).json({ error: "Incorrect OTP. Try again." });
      return;
    }
    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP verify — test bypass matched");
  } else {
    // ── PG atomic verify (SELECT FOR UPDATE → conditional UPDATE) ────────────
    //
    // The transaction with FOR UPDATE locks the row before any condition check,
    // preventing TOCTOU races between concurrent verify requests on the same phone.
    // Failing to commit the consume (e.g. DB error) causes a 500 — we never
    // mint a token without a durable consumed_at write (fail-closed).
    type VerifyOutcome =
      | { ok: true }
      | { ok: false; status: 401 | 429 | 500; error: string };

    let outcome: VerifyOutcome;
    try {
      outcome = await db.transaction(async (tx): Promise<VerifyOutcome> => {
        // Lock the row so no concurrent transaction can read+write it simultaneously.
        const rows = await tx.execute(
          sql`SELECT otp, expires_at, attempts, consumed_at
              FROM auth_otps
              WHERE phone = ${phone}
              FOR UPDATE`,
        );

        const row = rows.rows[0] as {
          otp:          string;
          expires_at:   Date;
          attempts:     number;
          consumed_at:  Date | null;
        } | undefined;

        if (!row) {
          return { ok: false, status: 401, error: "OTP not found or expired. Request a new code." };
        }
        if (row.consumed_at !== null) {
          return { ok: false, status: 401, error: "OTP already used. Request a new code." };
        }
        if (new Date() > new Date(row.expires_at)) {
          return { ok: false, status: 401, error: "OTP expired. Request a new code." };
        }
        if (row.attempts >= MAX_ATTEMPTS) {
          return { ok: false, status: 429, error: "Too many attempts. Request a new code." };
        }

        if (row.otp !== otp) {
          // Atomic increment — uses SQL expression, not the stale JS read value.
          await tx.execute(
            sql`UPDATE auth_otps
                SET attempts = attempts + 1
                WHERE phone = ${phone}`,
          );
          return { ok: false, status: 401, error: "Incorrect OTP. Try again." };
        }

        // Correct OTP — mark consumed atomically inside the same transaction.
        await tx.execute(
          sql`UPDATE auth_otps
              SET consumed_at = NOW()
              WHERE phone = ${phone}`,
        );

        return { ok: true };
      });
    } catch (err) {
      // Transaction failed — do NOT mint a token (fail-closed).
      req.log.error({ err }, "verify-otp: transaction failed");
      res.status(500).json({ error: "Verification failed. Please try again." });
      return;
    }

    if (!outcome.ok) {
      req.log.warn({ phoneSuffix: phone.slice(-4), error: outcome.error }, "verify-otp: rejected");
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP verified");
  }

  // ── Issue Firebase custom token ────────────────────────────────────────────
  try {
    const uid   = `91${phone}`;
    const auth  = await adminAuth();
    const token = await auth.createCustomToken(uid);

    req.log.info({ uid }, "OTP verified — custom token issued");
    res.json({ token });
  } catch (err) {
    req.log.error({ err }, "verify-otp custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

// ─── Periodic cleanup ─────────────────────────────────────────────────────────
//
// Deletes expired rows older than 24 h. Non-critical: table stays small even
// without this (rows are tiny; volume is bounded by real login traffic).
// Wire this into a startup timer in index.ts if table growth becomes a concern.
export async function pruneStaleOtps(log?: { warn: (o: unknown, m: string) => void }): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await db
      .delete(authOtpsTable)
      .where(lt(authOtpsTable.expiresAt, cutoff));
  } catch (err) {
    log?.warn({ err }, "pruneStaleOtps: failed");
  }
}

export default router;
