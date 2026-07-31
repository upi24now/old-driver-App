import { Router, type Request, type Response } from "express";
import { eq, lt, and, gte } from "drizzle-orm";
import { adminAuth } from "../lib/firebase-admin";
import { db, authOtpsTable, driversTable, otpSendEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../lib/require-auth";
import { hashPin, verifyPinHash } from "../lib/pin-hash";
import { mintSessionId, setActiveSession } from "../lib/session";

const router = Router();

// ─── OTP send rate limit ────────────────────────────────────────────────────
// At most OTP_SEND_MAX OTP requests per rolling OTP_SEND_WINDOW_MS per phone.
const OTP_SEND_MAX       = 3;
const OTP_SEND_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

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

  // ── Rate limit: at most OTP_SEND_MAX sends per rolling window per phone ─────
  try {
    const windowStart = new Date(Date.now() - OTP_SEND_WINDOW_MS);
    const recent = await db
      .select({ id: otpSendEventsTable.id })
      .from(otpSendEventsTable)
      .where(
        and(
          eq(otpSendEventsTable.phone, phone),
          gte(otpSendEventsTable.sentAt, windowStart),
        ),
      );
    if (recent.length >= OTP_SEND_MAX) {
      req.log.warn({ phoneSuffix: phone.slice(-4), count: recent.length }, "send-otp: rate limit exceeded");
      res.status(429).json({
        error: "Too many OTP requests. Please try again after 2 hours or log in with your PIN.",
      });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "send-otp: rate-limit check failed");
    res.status(500).json({ error: "Could not send OTP. Please try again." });
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

  // Record this send for the rolling rate-limit window (best-effort; a logging
  // failure must not block a successfully-stored OTP).
  try {
    await db.insert(otpSendEventsTable).values({ phone });
  } catch (err) {
    req.log.warn({ err }, "send-otp: rate-limit event insert failed (non-fatal)");
  }

  req.log.info({ phoneSuffix: phone.slice(-4) }, "OTP generated and stored in PG");

  // devOtp: only in non-production environments (never expose real OTPs in prod).
  const isDev = process.env["NODE_ENV"] !== "production";

  // DEV ONLY — print the actual OTP to the server console so developers can
  // complete the login flow without an SMS provider.
  // This block is compiled out in production (NODE_ENV === "production" skips it).
  // OTP verification logic, expiry, and API response are completely unchanged.
  if (isDev) {
    console.log(
      `\n[SMS] DEV OTP\nPhone: +91${phone}\nOTP: ${otp}\n`,
    );
  }

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

  // ── Issue Firebase custom token + mint single-device session ───────────────
  try {
    const uid   = `91${phone}`;
    const auth  = await adminAuth();
    const token = await auth.createCustomToken(uid);

    // Single-device login: mint a fresh session id, claim it as the active
    // device (no-op UPDATE if the driver row doesn't exist yet), and return it.
    const sessionId = mintSessionId();
    await setActiveSession(uid, sessionId);

    req.log.info({ uid }, "OTP verified — custom token issued");
    res.json({ token, sessionId });
  } catch (err) {
    req.log.error({ err }, "verify-otp custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

// ─── PIN login (Phase 1 — parallel to OTP, OTP unchanged) ───────────────────────
//
// Two routes add an OPTIONAL 6-digit PIN factor:
//   • POST /auth/set-pin    — Firebase-authenticated; stores a scrypt hash.
//   • POST /auth/verify-pin — phone + PIN → same custom token as verify-otp.
// The OTP routes above are untouched. The uid scheme stays exactly "91"+phone.

const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCK_MS      = 24 * 60 * 60 * 1000; // 24 hours

router.post("/auth/set-pin", async (req, res) => {
  // Requires an existing valid Firebase session (driver already OTP-verified).
  const uid = await requireAuth(req, res);
  if (!uid) return; // requireAuth already wrote a 401 JSON body.

  const { pin } = req.body as { pin?: string };
  if (!pin || !/^\d{6}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 6 digits." });
    return;
  }

  try {
    const pinHash   = await hashPin(pin); // raw PIN never stored or logged.
    const sessionId = mintSessionId();    // first-time setup also claims this device.

    const updated = await db
      .update(driversTable)
      .set({
        pinHash,
        pinSetAt:          new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil:    null,
        activeSessionId:   sessionId,
        activeSessionAt:   new Date(),
        updatedAt:         new Date(),
      })
      .where(eq(driversTable.uid, uid))
      .returning({ uid: driversTable.uid });

    if (updated.length === 0) {
      res.status(404).json({ error: "Driver not found. Complete login before setting a PIN." });
      return;
    }

    res.json({ ok: true, sessionId });
  } catch (err) {
    req.log.error({ err }, "set-pin: failed");
    res.status(500).json({ error: "Could not set PIN. Please try again." });
  }
});

// GET /auth/pin-status — Firebase-authenticated read-only check.
// Lets the mobile app decide whether to show the "Create PIN" step after a
// fresh OTP login. Returns { hasPin } only; never exposes the hash. OTP login
// and all other flows are unaffected.
router.get("/auth/pin-status", async (req, res) => {
  const uid = await requireAuth(req, res);
  if (!uid) return; // requireAuth already wrote a 401 JSON body.

  try {
    const rows = await db
      .select({ pinHash: driversTable.pinHash })
      .from(driversTable)
      .where(eq(driversTable.uid, uid))
      .limit(1);

    const hasPin = rows.length > 0 && !!rows[0]?.pinHash;
    res.json({ hasPin });
  } catch (err) {
    req.log.error({ err }, "pin-status: failed");
    res.status(500).json({ error: "Could not check PIN status. Please try again." });
  }
});

// ── Shared handler — POST /auth/verify-pin  AND  POST /v2/auth/verify-pin ──────
// The mobile client (utils/auth-api.ts) calls BASE_URL + "/v2/auth/verify-pin".
// Both paths delegate to this identical function so there is no logic duplication.
// The v2 body optionally includes `user_type` (ignored — route is driver-only).
async function handleVerifyPin(req: Request, res: Response): Promise<void> {
  const { phone, pin } = req.body as { phone?: string; pin?: string; user_type?: string };

  // Normalize phone the same way the OTP flow does: strip to 10 digits.
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(digits) || !pin || !/^\d{6}$/.test(pin)) {
    res.status(400).json({ error: "A valid 10-digit phone and 6-digit PIN are required." });
    return;
  }

  const uid = `91${digits}`;

  // ── Atomic lock + verify (SELECT FOR UPDATE → conditional UPDATE) ──────────
  // Mirrors the OTP verify pattern: the row is locked before any check so
  // concurrent verify requests cannot race the attempt counter. Fail-closed —
  // a DB error yields a 500 and never mints a token.
  type VerifyOutcome =
    | { ok: true }
    | { ok: false; status: 401 | 404 | 429; error: string };

  let outcome: VerifyOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<VerifyOutcome> => {
      const rows = await tx.execute(
        sql`SELECT pin_hash, pin_failed_attempts, pin_locked_until
            FROM drivers
            WHERE uid = ${uid}
            FOR UPDATE`,
      );

      const row = rows.rows[0] as {
        pin_hash:            string | null;
        pin_failed_attempts: number;
        pin_locked_until:    Date | null;
      } | undefined;

      if (!row || !row.pin_hash) {
        // No PIN configured — client should fall back to OTP setup.
        return { ok: false, status: 404, error: "No PIN set for this account. Please log in with OTP and set a PIN." };
      }

      if (row.pin_locked_until && new Date() < new Date(row.pin_locked_until)) {
        return { ok: false, status: 429, error: "Too many incorrect attempts. Try again later or log in with OTP." };
      }

      const match = await verifyPinHash(pin, row.pin_hash);
      if (!match) {
        const attempts = (row.pin_failed_attempts ?? 0) + 1;
        const lock     = attempts >= PIN_MAX_ATTEMPTS;
        const lockedUntil = lock ? new Date(Date.now() + PIN_LOCK_MS) : null;
        await tx.execute(
          sql`UPDATE drivers
              SET pin_failed_attempts = ${attempts},
                  pin_locked_until    = ${lockedUntil}
              WHERE uid = ${uid}`,
        );
        if (lock) {
          return { ok: false, status: 429, error: "Too many incorrect attempts. PIN locked for 24 hours. Log in with OTP." };
        }
        return { ok: false, status: 401, error: "Incorrect PIN. Try again." };
      }

      // Correct PIN — reset the lockout counters atomically.
      await tx.execute(
        sql`UPDATE drivers
            SET pin_failed_attempts = 0,
                pin_locked_until    = NULL
            WHERE uid = ${uid}`,
      );
      return { ok: true };
    });
  } catch (err) {
    req.log.error({ err }, "verify-pin: transaction failed");
    res.status(500).json({ error: "Verification failed. Please try again." });
    return;
  }

  if (!outcome.ok) {
    req.log.warn({ phoneSuffix: digits.slice(-4), status: outcome.status }, "verify-pin: rejected");
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  // ── Issue Firebase custom token + mint single-device session ───────────────
  try {
    const auth  = await adminAuth();
    const token = await auth.createCustomToken(uid);

    // Single-device login: this PIN login claims the active device. Any other
    // device's stored session id no longer matches and will be logged out.
    const sessionId = mintSessionId();
    await setActiveSession(uid, sessionId);

    req.log.info({ uid }, "PIN verified — custom token issued");
    res.json({ token, sessionId });
  } catch (err) {
    req.log.error({ err }, "verify-pin custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
}

// Register both the v1 path and the v2 path (used by the mobile client).
// The v2 body may include `user_type`; the handler ignores it — route is driver-only.
router.post("/auth/verify-pin",    handleVerifyPin);
router.post("/v2/auth/verify-pin", handleVerifyPin);

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
