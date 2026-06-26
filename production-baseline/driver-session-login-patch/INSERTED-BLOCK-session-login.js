// === BEGIN single-device login routes (surgical additive patch — PG-ONLY, no Firestore) ===
//
// All routes below are ADDITIVE and registered BEFORE `app.use("/api", routes_default)`,
// so Express first-match-wins makes them OVERRIDE the compiled auth routes of the
// same path. They reuse helpers already present in this bundle: the global `pool`
// (node-postgres) and `auth` (Firebase Admin). PIN hashing uses Node's built-in
// crypto scrypt in the EXACT `scrypt$<saltHex>$<hashHex>` format used by the
// canonical api-server source (src/lib/pin-hash.ts), so PINs set by either side
// verify interchangeably.
//
// SAFETY CONTRACT (see DEPLOY.md):
//   * No business data touches Firestore. Only the `drivers`, `auth_otps`, and
//     `otp_send_events` PG tables are read/written.
//   * Single-device enforcement is layered onto the order-lifecycle auth gate
//     `__dsRequireDriver` by WRAPPING it (the original function declaration is a
//     mutable binding). The original behavior is preserved; we only add a
//     session-id check AFTER the token is verified. Wallet/Plans/KYC/Profile
//     routes (gated by their own compiled auth) are NOT modified.
//   * Enforcement is null-safe: when `drivers.active_session_id` is NULL (legacy
//     rows / pre-first-login) the check is skipped so existing sessions keep
//     working until the next login claims a device.
//   * A session-check infra error fails OPEN to the token-verified uid (never
//     hard-blocks a legitimate driver on a transient DB hiccup).

var __sgCrypto = require("crypto");

// Rate-limit / lockout constants (mirror the canonical source exactly).
var __SG_OTP_SEND_MAX       = 3;
var __SG_OTP_SEND_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
var __SG_OTP_MAX_ATTEMPTS   = 5;                    // OTP verify attempts before "request a new code"
var __SG_OTP_TTL_MS         = 5 * 60 * 1000;        // 5m
var __SG_PIN_MAX_ATTEMPTS   = 3;
var __SG_PIN_LOCK_MS        = 24 * 60 * 60 * 1000;  // 24h

function __sgMintSession() { return __sgCrypto.randomUUID(); }

function __sgScrypt(pin, salt, keylen) {
  return new Promise(function (resolve, reject) {
    __sgCrypto.scrypt(pin, salt, keylen, function (err, dk) {
      if (err) reject(err); else resolve(dk);
    });
  });
}

// scrypt$<saltHex>$<hashHex> — byte-identical to src/lib/pin-hash.ts.
async function __sgHashPin(pin) {
  var salt = __sgCrypto.randomBytes(16);
  var derived = await __sgScrypt(pin, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + derived.toString("hex");
}

async function __sgVerifyPinHash(pin, stored) {
  var parts = String(stored == null ? "" : stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  var saltHex = parts[1], hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  var salt = Buffer.from(saltHex, "hex");
  var expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  var derived = await __sgScrypt(pin, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return __sgCrypto.timingSafeEqual(derived, expected);
}

// TEST_OTP_PHONES="phone:otp,phone2:otp2" — bypasses the PG OTP store entirely.
function __sgParseTestPhones() {
  var raw = process.env["TEST_OTP_PHONES"] || "";
  var map = new Map();
  raw.split(",").forEach(function (entry) {
    var pair = entry.trim().split(":");
    if (pair[0] && pair[1]) map.set(pair[0].trim(), pair[1].trim());
  });
  return map;
}

async function __sgSetActiveSession(uid, sessionId) {
  // No-op (0 rows) when the driver row does not exist yet — matches source.
  await pool.query(
    "UPDATE drivers SET active_session_id = $1, active_session_at = NOW() WHERE uid = $2",
    [sessionId, uid],
  );
}

// ── Single-device enforcement wrapper around the order-lifecycle auth gate ──
// __dsRequireDriver is an async function declaration (mutable binding); wrap it
// so every order-lifecycle route inherits session enforcement without editing
// any compiled bytes.
(function () {
  if (typeof __dsRequireDriver !== "function") return; // defensive: leave as-is
  var __sgOrig = __dsRequireDriver;
  __dsRequireDriver = async function (req, res) {
    var uid = await __sgOrig(req, res);
    if (!uid) return null; // original already wrote a 401 body
    try {
      var r = await pool.query(
        "SELECT active_session_id FROM drivers WHERE uid = $1 LIMIT 1",
        [uid],
      );
      var active = r.rows.length ? r.rows[0].active_session_id : null;
      if (active != null) {
        var hdr = req.headers["x-session-id"];
        var provided = Array.isArray(hdr) ? hdr[0] : hdr;
        if (provided !== active) {
          res.status(401).json({ error: "SESSION_REPLACED", message: "Logged in on another device" });
          return null;
        }
      }
    } catch (e) {
      // Fail open to the token-verified uid; never hard-block on a DB hiccup.
    }
    return uid;
  };
})();

// ── POST /api/auth/send-otp (OVERRIDE) ──────────────────────────────────────
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    var phone = (req.body && req.body.phone) || "";
    if (!phone || !/^\d{10}$/.test(phone)) {
      res.status(400).json({ error: "Invalid phone number. Must be 10 digits." });
      return;
    }

    var testPhones = __sgParseTestPhones();
    if (testPhones.has(phone)) {
      res.json({ sent: true, devOtp: testPhones.get(phone) });
      return;
    }

    // Rate limit: at most __SG_OTP_SEND_MAX sends per rolling window per phone.
    try {
      var windowStart = new Date(Date.now() - __SG_OTP_SEND_WINDOW_MS);
      var recent = await pool.query(
        "SELECT id FROM otp_send_events WHERE phone = $1 AND sent_at >= $2",
        [phone, windowStart],
      );
      if (recent.rows.length >= __SG_OTP_SEND_MAX) {
        res.status(429).json({ error: "Too many OTP requests. Please try again after 24 hours or log in with your PIN." });
        return;
      }
    } catch (e) {
      res.status(500).json({ error: "Could not send OTP. Please try again." });
      return;
    }

    var otp = Math.floor(100000 + Math.random() * 900000).toString();
    var expiresAt = new Date(Date.now() + __SG_OTP_TTL_MS);
    try {
      await pool.query(
        "INSERT INTO auth_otps (phone, otp, expires_at, attempts) VALUES ($1, $2, $3, 0) " +
        "ON CONFLICT (phone) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, " +
        "attempts = 0, consumed_at = NULL, created_at = NOW()",
        [phone, otp, expiresAt],
      );
    } catch (e) {
      res.status(500).json({ error: "Could not save OTP. Please try again." });
      return;
    }

    try { await pool.query("INSERT INTO otp_send_events (phone) VALUES ($1)", [phone]); } catch (e) { /* non-fatal */ }

    var out = { sent: true };
    if (process.env["NODE_ENV"] !== "production") out.devOtp = otp;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Could not send OTP. Please try again." });
  }
});

// ── POST /api/auth/verify-otp (OVERRIDE) ────────────────────────────────────
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    var phone = (req.body && req.body.phone) || "";
    var otp = (req.body && req.body.otp) || "";
    if (!phone || !otp) { res.status(400).json({ error: "phone and otp are required." }); return; }

    var testPhones = __sgParseTestPhones();
    if (testPhones.has(phone)) {
      if (testPhones.get(phone) !== otp) { res.status(401).json({ error: "Incorrect OTP. Try again." }); return; }
    } else {
      var client = await pool.connect();
      var outcome;
      try {
        await client.query("BEGIN");
        var r = await client.query(
          "SELECT otp, expires_at, attempts, consumed_at FROM auth_otps WHERE phone = $1 FOR UPDATE",
          [phone],
        );
        var row = r.rows[0];
        if (!row) {
          outcome = { ok: false, status: 401, error: "OTP not found or expired. Request a new code." };
        } else if (row.consumed_at !== null) {
          outcome = { ok: false, status: 401, error: "OTP already used. Request a new code." };
        } else if (new Date() > new Date(row.expires_at)) {
          outcome = { ok: false, status: 401, error: "OTP expired. Request a new code." };
        } else if (row.attempts >= __SG_OTP_MAX_ATTEMPTS) {
          outcome = { ok: false, status: 429, error: "Too many attempts. Request a new code." };
        } else if (String(row.otp) !== String(otp)) {
          await client.query("UPDATE auth_otps SET attempts = attempts + 1 WHERE phone = $1", [phone]);
          outcome = { ok: false, status: 401, error: "Incorrect OTP. Try again." };
        } else {
          await client.query("UPDATE auth_otps SET consumed_at = NOW() WHERE phone = $1", [phone]);
          outcome = { ok: true };
        }
        await client.query("COMMIT");
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (e2) { /* ignore */ }
        client.release();
        res.status(500).json({ error: "Verification failed. Please try again." });
        return;
      }
      client.release();
      if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.error }); return; }
    }

    var uid = "91" + phone;
    var token = await auth.createCustomToken(uid);
    var sessionId = __sgMintSession();
    await __sgSetActiveSession(uid, sessionId);
    res.json({ token: token, sessionId: sessionId });
  } catch (e) {
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

// ── POST /api/auth/set-pin (NEW — Firebase-gated; first-time setup/reset) ────
app.post("/api/auth/set-pin", async (req, res) => {
  try {
    var uid = await __dsRequireDriver(req, res);
    if (!uid) return; // 401 already written
    var pin = (req.body && req.body.pin) || "";
    if (!pin || !/^\d{6}$/.test(pin)) { res.status(400).json({ error: "PIN must be exactly 6 digits." }); return; }

    var pinHash = await __sgHashPin(pin);
    var sessionId = __sgMintSession();
    var upd = await pool.query(
      "UPDATE drivers SET pin_hash = $1, pin_set_at = NOW(), pin_failed_attempts = 0, " +
      "pin_locked_until = NULL, active_session_id = $2, active_session_at = NOW(), updated_at = NOW() " +
      "WHERE uid = $3",
      [pinHash, sessionId, uid],
    );
    if (!upd.rowCount) { res.status(404).json({ error: "Driver not found. Complete login before setting a PIN." }); return; }
    res.json({ ok: true, sessionId: sessionId });
  } catch (e) {
    res.status(500).json({ error: "Could not set PIN. Please try again." });
  }
});

// ── GET /api/auth/pin-status (NEW — Firebase-gated read-only) ────────────────
app.get("/api/auth/pin-status", async (req, res) => {
  try {
    var uid = await __dsRequireDriver(req, res);
    if (!uid) return;
    var r = await pool.query("SELECT pin_hash FROM drivers WHERE uid = $1 LIMIT 1", [uid]);
    var hasPin = r.rows.length > 0 && !!r.rows[0].pin_hash;
    res.json({ hasPin: hasPin });
  } catch (e) {
    res.status(500).json({ error: "Could not check PIN status. Please try again." });
  }
});

// ── POST /api/auth/verify-pin (NEW — phone + PIN → custom token) ─────────────
app.post("/api/auth/verify-pin", async (req, res) => {
  try {
    var phone = (req.body && req.body.phone) || "";
    var pin = (req.body && req.body.pin) || "";
    var digits = String(phone).replace(/\D/g, "");
    if (!/^\d{10}$/.test(digits) || !pin || !/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: "A valid 10-digit phone and 6-digit PIN are required." });
      return;
    }
    var uid = "91" + digits;

    var client = await pool.connect();
    var outcome;
    try {
      await client.query("BEGIN");
      var r = await client.query(
        "SELECT pin_hash, pin_failed_attempts, pin_locked_until FROM drivers WHERE uid = $1 FOR UPDATE",
        [uid],
      );
      var row = r.rows[0];
      if (!row || !row.pin_hash) {
        outcome = { ok: false, status: 404, error: "No PIN set for this account. Please log in with OTP and set a PIN." };
      } else if (row.pin_locked_until && new Date() < new Date(row.pin_locked_until)) {
        outcome = { ok: false, status: 429, error: "Too many incorrect attempts. Try again later or log in with OTP." };
      } else {
        var match = await __sgVerifyPinHash(pin, row.pin_hash);
        if (!match) {
          var attempts = (row.pin_failed_attempts || 0) + 1;
          var lock = attempts >= __SG_PIN_MAX_ATTEMPTS;
          var lockedUntil = lock ? new Date(Date.now() + __SG_PIN_LOCK_MS) : null;
          await client.query(
            "UPDATE drivers SET pin_failed_attempts = $1, pin_locked_until = $2 WHERE uid = $3",
            [attempts, lockedUntil, uid],
          );
          outcome = lock
            ? { ok: false, status: 429, error: "Too many incorrect attempts. PIN locked for 24 hours. Log in with OTP." }
            : { ok: false, status: 401, error: "Incorrect PIN. Try again." };
        } else {
          await client.query("UPDATE drivers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE uid = $1", [uid]);
          outcome = { ok: true };
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* ignore */ }
      client.release();
      res.status(500).json({ error: "Verification failed. Please try again." });
      return;
    }
    client.release();
    if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.error }); return; }

    var token = await auth.createCustomToken(uid);
    var sessionId = __sgMintSession();
    await __sgSetActiveSession(uid, sessionId);
    res.json({ token: token, sessionId: sessionId });
  } catch (e) {
    res.status(500).json({ error: "Verification failed. Check Firebase Admin configuration." });
  }
});

// === END single-device login routes ===
