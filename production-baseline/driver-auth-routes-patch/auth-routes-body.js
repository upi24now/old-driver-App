const __authNodeCrypto = globalThis.require("node:crypto");
const __authNodeUtil = globalThis.require("node:util");
const __authRandomBytes = __authNodeCrypto.randomBytes;
const __authTimingSafeEqual = __authNodeCrypto.timingSafeEqual;
const __authRandomUUID = __authNodeCrypto.randomUUID;
const __authScrypt = __authNodeUtil.promisify(__authNodeCrypto.scrypt);

const AUTH_KEYLEN = 64;
const AUTH_SALT_BYTES = 16;
const OTP_SEND_MAX = 3;
const OTP_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCK_MS = 24 * 60 * 60 * 1000;

async function authHashPin(pin) {
  const salt = __authRandomBytes(AUTH_SALT_BYTES);
  const derived = await __authScrypt(pin, salt, AUTH_KEYLEN);
  return "scrypt$" + salt.toString("hex") + "$" + derived.toString("hex");
}

async function authVerifyPinHash(pin, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const derived = await __authScrypt(pin, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return __authTimingSafeEqual(derived, expected);
}

function authParseTestPhones() {
  const raw = process.env["TEST_OTP_PHONES"] || "";
  const map = new Map();
  for (const entry of raw.split(",")) {
    const pair = entry.trim().split(":");
    const phone = pair[0];
    const otp = pair[1];
    if (phone && otp) map.set(authNormalizePhone(phone), otp.trim());
  }
  return map;
}

function authNormalizePhone(input) {
  let d = String(input == null ? "" : input).replace(/\D/g, "");
  if (d.length === 12 && d.slice(0, 2) === "91") d = d.slice(2);
  else if (d.length === 11 && d.slice(0, 1) === "0") d = d.slice(1);
  return d;
}

function authLog(req, level, obj, msg) {
  try {
    if (req && req.log && typeof req.log[level] === "function") req.log[level](obj, msg);
  } catch (_e) {}
}

async function authEnsureSchema() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS auth_otps (" +
    "phone text PRIMARY KEY," +
    "otp text NOT NULL," +
    "expires_at timestamptz NOT NULL," +
    "attempts integer NOT NULL DEFAULT 0," +
    "consumed_at timestamptz," +
    "created_at timestamptz NOT NULL DEFAULT now())"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS otp_send_events (" +
    "id bigserial PRIMARY KEY," +
    "phone text NOT NULL," +
    "sent_at timestamptz NOT NULL DEFAULT now())"
  );
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_hash text");
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_set_at timestamptz");
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz");
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_session_id text");
  await pool.query("ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_session_at timestamptz");
}

async function authRequireUid(req, res) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader.indexOf("Bearer ") !== 0) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch (_e) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

async function authSetActiveSession(uid, sessionId) {
  await pool.query(
    "UPDATE drivers SET active_session_id = $1, active_session_at = NOW(), updated_at = NOW() WHERE uid = $2",
    [sessionId, uid]
  );
}

const authRouter = import_express34.default.Router();

authRouter.post("/auth/send-otp", async (req, res) => {
  const body = req.body || {};
  const phone = authNormalizePhone(body.phone);
  if (!phone || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
    return;
  }
  const testPhones = authParseTestPhones();
  if (testPhones.has(phone)) {
    const devOtp = testPhones.get(phone);
    authLog(req, "info", { phoneSuffix: phone.slice(-4) }, "OTP send — test bypass active");
    res.json({ sent: true, devOtp });
    return;
  }
  try {
    const windowStart = new Date(Date.now() - OTP_SEND_WINDOW_MS);
    const recent = await pool.query(
      "SELECT id FROM otp_send_events WHERE phone = $1 AND sent_at >= $2",
      [phone, windowStart]
    );
    if (recent.rowCount >= OTP_SEND_MAX) {
      authLog(req, "warn", { phoneSuffix: phone.slice(-4), count: recent.rowCount }, "send-otp: rate limit exceeded");
      res.status(429).json({ error: "Too many OTP requests. Please try again after 24 hours or log in with your PIN." });
      return;
    }
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "send-otp: rate-limit check failed");
    res.status(500).json({ error: "Could not send OTP. Please try again." });
    return;
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  try {
    await pool.query(
      "INSERT INTO auth_otps (phone, otp, expires_at, attempts, consumed_at, created_at) " +
      "VALUES ($1, $2, $3, 0, NULL, NOW()) " +
      "ON CONFLICT (phone) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, " +
      "attempts = 0, consumed_at = NULL, created_at = NOW()",
      [phone, otp, expiresAt]
    );
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "send-otp: PG upsert failed");
    res.status(500).json({ error: "Could not save OTP. Please try again." });
    return;
  }
  try {
    await pool.query("INSERT INTO otp_send_events (phone) VALUES ($1)", [phone]);
  } catch (err) {
    authLog(req, "warn", { err: String(err) }, "send-otp: rate-limit event insert failed (non-fatal)");
  }
  authLog(req, "info", { phoneSuffix: phone.slice(-4) }, "OTP generated and stored in PG");
  const isDev = process.env["NODE_ENV"] !== "production";
  const out = { sent: true };
  if (isDev) out.devOtp = otp;
  res.json(out);
});

authRouter.post("/auth/verify-otp", async (req, res) => {
  const body = req.body || {};
  const phone = authNormalizePhone(body.phone);
  const otpRaw = body.otp != null ? body.otp : (body.code != null ? body.code : body.otpCode);
  const otp = otpRaw == null ? "" : String(otpRaw).trim();
  if (!phone || !/^\d{10}$/.test(phone) || !otp) {
    res.status(400).json({ error: "phone and otp are required." });
    return;
  }
  const testPhones = authParseTestPhones();
  let verified = false;
  if (testPhones.has(phone) && String(testPhones.get(phone)).trim() === otp) {
    authLog(req, "info", { phoneSuffix: phone.slice(-4) }, "OTP verify — test bypass matched");
    verified = true;
  }
  if (!verified) {
    let outcome;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query(
        "SELECT otp, expires_at, attempts, consumed_at FROM auth_otps WHERE phone = $1 FOR UPDATE",
        [phone]
      );
      const row = rows.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        outcome = { ok: false, status: 401, error: "OTP not found or expired. Request a new code." };
      } else if (row.consumed_at !== null) {
        await client.query("ROLLBACK");
        outcome = { ok: false, status: 401, error: "OTP already used. Request a new code." };
      } else if (new Date() > new Date(row.expires_at)) {
        await client.query("ROLLBACK");
        outcome = { ok: false, status: 401, error: "OTP expired. Request a new code." };
      } else if (row.attempts >= OTP_MAX_ATTEMPTS) {
        await client.query("ROLLBACK");
        outcome = { ok: false, status: 429, error: "Too many attempts. Request a new code." };
      } else if (String(row.otp).trim() !== otp) {
        await client.query("UPDATE auth_otps SET attempts = attempts + 1 WHERE phone = $1", [phone]);
        await client.query("COMMIT");
        outcome = { ok: false, status: 401, error: "Incorrect OTP. Try again." };
      } else {
        await client.query("UPDATE auth_otps SET consumed_at = NOW() WHERE phone = $1", [phone]);
        await client.query("COMMIT");
        outcome = { ok: true };
      }
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_e) {}
      client.release();
      authLog(req, "error", { err: String(err) }, "verify-otp: transaction failed");
      res.status(500).json({ error: "Verification failed. Please try again." });
      return;
    }
    client.release();
    if (!outcome.ok) {
      authLog(req, "warn", { phoneSuffix: phone.slice(-4), error: outcome.error }, "verify-otp: rejected");
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    authLog(req, "info", { phoneSuffix: phone.slice(-4) }, "OTP verified");
  }
  try {
    const uid = "91" + phone;
    const token = await auth.createCustomToken(uid);
    const sessionId = __authRandomUUID();
    await authSetActiveSession(uid, sessionId);
    authLog(req, "info", { uid }, "OTP verified — custom token issued");
    res.json({ token, sessionId });
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "verify-otp custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

authRouter.post("/auth/set-pin", async (req, res) => {
  const uid = await authRequireUid(req, res);
  if (!uid) return;
  const body = req.body || {};
  const pin = body.pin;
  if (!pin || !/^\d{6}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 6 digits." });
    return;
  }
  try {
    const pinHash = await authHashPin(pin);
    const sessionId = __authRandomUUID();
    const updated = await pool.query(
      "UPDATE drivers SET pin_hash = $1, pin_set_at = NOW(), pin_failed_attempts = 0, " +
      "pin_locked_until = NULL, active_session_id = $2, active_session_at = NOW(), updated_at = NOW() " +
      "WHERE uid = $3 RETURNING uid",
      [pinHash, sessionId, uid]
    );
    if (updated.rowCount === 0) {
      res.status(404).json({ error: "Driver not found. Complete login before setting a PIN." });
      return;
    }
    authLog(req, "info", { uid }, "PIN set");
    res.json({ ok: true, sessionId });
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "set-pin: failed");
    res.status(500).json({ error: "Could not set PIN. Please try again." });
  }
});

authRouter.get("/auth/pin-status", async (req, res) => {
  const uid = await authRequireUid(req, res);
  if (!uid) return;
  try {
    const rows = await pool.query("SELECT pin_hash FROM drivers WHERE uid = $1 LIMIT 1", [uid]);
    const hasPin = rows.rowCount > 0 && !!rows.rows[0].pin_hash;
    res.json({ hasPin });
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "pin-status: failed");
    res.status(500).json({ error: "Could not check PIN status. Please try again." });
  }
});

authRouter.post("/auth/verify-pin", async (req, res) => {
  const body = req.body || {};
  const phone = body.phone;
  const pin = body.pin;
  const digits = String(phone || "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(digits) || !pin || !/^\d{6}$/.test(pin)) {
    res.status(400).json({ error: "A valid 10-digit phone and 6-digit PIN are required." });
    return;
  }
  const uid = "91" + digits;
  let outcome;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      "SELECT pin_hash, pin_failed_attempts, pin_locked_until FROM drivers WHERE uid = $1 FOR UPDATE",
      [uid]
    );
    const row = rows.rows[0];
    if (!row || !row.pin_hash) {
      await client.query("ROLLBACK");
      outcome = { ok: false, status: 404, error: "No PIN set for this account. Please log in with OTP and set a PIN." };
    } else if (row.pin_locked_until && new Date() < new Date(row.pin_locked_until)) {
      await client.query("ROLLBACK");
      outcome = { ok: false, status: 429, error: "Too many incorrect attempts. Try again later or log in with OTP." };
    } else {
      const match = await authVerifyPinHash(pin, row.pin_hash);
      if (!match) {
        const attempts = (row.pin_failed_attempts || 0) + 1;
        const lock = attempts >= PIN_MAX_ATTEMPTS;
        const lockedUntil = lock ? new Date(Date.now() + PIN_LOCK_MS) : null;
        await client.query(
          "UPDATE drivers SET pin_failed_attempts = $1, pin_locked_until = $2 WHERE uid = $3",
          [attempts, lockedUntil, uid]
        );
        await client.query("COMMIT");
        if (lock) {
          outcome = { ok: false, status: 429, error: "Too many incorrect attempts. PIN locked for 24 hours. Log in with OTP." };
        } else {
          outcome = { ok: false, status: 401, error: "Incorrect PIN. Try again." };
        }
      } else {
        await client.query("UPDATE drivers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE uid = $1", [uid]);
        await client.query("COMMIT");
        outcome = { ok: true };
      }
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_e) {}
    client.release();
    authLog(req, "error", { err: String(err) }, "verify-pin: transaction failed");
    res.status(500).json({ error: "Verification failed. Please try again." });
    return;
  }
  client.release();
  if (!outcome.ok) {
    authLog(req, "warn", { phoneSuffix: digits.slice(-4), status: outcome.status }, "verify-pin: rejected");
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  try {
    const token = await auth.createCustomToken(uid);
    const sessionId = __authRandomUUID();
    await authSetActiveSession(uid, sessionId);
    authLog(req, "info", { uid }, "PIN verified — custom token issued");
    res.json({ token, sessionId });
  } catch (err) {
    authLog(req, "error", { err: String(err) }, "verify-pin custom token failed");
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

authEnsureSchema().then(
  function () { try { console.log("[AUTH_PATCH] schema ensured (auth_otps, otp_send_events, drivers PIN/session columns)"); } catch (_e) {} },
  function (e) { try { console.error("[AUTH_PATCH] ensureAuthSchema FAILED:", e && e.message); } catch (_e2) {} }
);

app.use("/api", authRouter);
try { console.log("[AUTH_PATCH] /api/auth/* routes mounted (send-otp, verify-otp, verify-pin, set-pin, pin-status)"); } catch (_e) {}
