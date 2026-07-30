/**
 * config.ts — Single authoritative configuration source.
 *
 * Architecture
 * ───────────
 * • All env var reads for infrastructure concerns are centralised here.
 * • Business feature-flags (RAZORPAY_KEY_ID, TEST_OTP_PHONES, …) remain in
 *   the route/service files that use them — they are not infrastructure config.
 * • getConfig() is lazy: the first call validates and freezes the config object.
 *   Call it AFTER dotenv has been loaded (index.ts does this explicitly).
 *
 * Firebase credential priority
 * ────────────────────────────
 *   1. Individual vars   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *   2. Inline JSON       FIREBASE_SERVICE_ACCOUNT_JSON  (full service-account object)
 *   3. File-based ADC    GOOGLE_APPLICATION_CREDENTIALS  (path to service-account JSON)
 *
 * Fail-fast
 * ─────────
 * Missing required vars → descriptive error → process.exit(1) at startup.
 * No silent fallbacks.  No stub / mock modes in any environment.
 *
 * Secret safety
 * ─────────────
 * Private-key and session-secret values are NEVER written to logs.
 * logConfigSummary() emits only safe metadata (presence, project id, domain).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type FirebaseCredentialMethod =
  | "individual"          // FIREBASE_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY
  | "serviceAccountJson"  // FIREBASE_SERVICE_ACCOUNT_JSON
  | "applicationDefault"; // GOOGLE_APPLICATION_CREDENTIALS file

export interface FirebaseIndividualCreds {
  method:       "individual";
  projectId:    string;
  clientEmail:  string;
  privateKey:   string; // newlines already normalised
}

export interface FirebaseJsonCreds {
  method:         "serviceAccountJson";
  serviceAccount: Record<string, unknown>;
}

export interface FirebaseAdcCreds {
  method: "applicationDefault";
}

export type FirebaseCredentials =
  | FirebaseIndividualCreds
  | FirebaseJsonCreds
  | FirebaseAdcCreds;

export interface AppConfig {
  server: {
    port:          number;
    nodeEnv:       string;
    uploadsDir:    string; // "" ⇒ resolved to <dist>/../uploads in index.ts
    apiPublicUrl:  string; // "" ⇒ derived from Host header at request time
  };
  firebase:  FirebaseCredentials;
  session:   { secret: string };
  log:       { level: string };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Collect all errors before exiting so the operator sees everything at once. */
function readRequired(key: string, errors: string[]): string {
  const v = process.env[key]?.trim();
  if (!v) {
    errors.push(`${key} is required but is not set.`);
    return "";
  }
  return v;
}

function readOptional(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v || fallback;
}

function resolveFirebaseCredentials(errors: string[]): FirebaseCredentials | null {
  // ── Method 1: individual vars ──────────────────────────────────────────────
  const projectId   = process.env["FIREBASE_PROJECT_ID"]?.trim();
  const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"]?.trim();
  const rawKey      = process.env["FIREBASE_PRIVATE_KEY"]?.trim();

  if (projectId && clientEmail && rawKey) {
    // Replit (and many CI systems) store the private key with literal "\n"
    // escape sequences.  Replace them with real newlines so the PEM is valid.
    const privateKey = rawKey.includes("\\n")
      ? rawKey.replace(/\\n/g, "\n")
      : rawKey;
    return { method: "individual", projectId, clientEmail, privateKey };
  }

  // ── Method 2: inline service-account JSON ─────────────────────────────────
  const saJson = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"]?.trim();
  if (saJson) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(saJson) as Record<string, unknown>;
    } catch {
      errors.push(
        "FIREBASE_SERVICE_ACCOUNT_JSON is set but contains invalid JSON. " +
        "Paste the full service-account JSON object (from Firebase console → " +
        "Project settings → Service accounts → Generate new private key).",
      );
      return null;
    }
    return { method: "serviceAccountJson", serviceAccount: parsed };
  }

  // ── Method 3: file-based Application Default Credentials ──────────────────
  const googleCreds = process.env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim();
  if (googleCreds) {
    return { method: "applicationDefault" };
  }

  // ── No credentials found ───────────────────────────────────────────────────
  errors.push(
    "Firebase Admin credentials are not configured.  Provide ONE of:\n" +
    "    (A) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY\n" +
    "    (B) FIREBASE_SERVICE_ACCOUNT_JSON  (full service-account JSON string)\n" +
    "    (C) GOOGLE_APPLICATION_CREDENTIALS (absolute path to service-account JSON file)",
  );
  return null;
}

// ─── Config singleton ─────────────────────────────────────────────────────────

let _config: AppConfig | null = null;

/**
 * Return the validated, frozen AppConfig.
 *
 * MUST be called after dotenv has been loaded (index.ts calls it explicitly).
 * Subsequent calls return the cached object with no re-validation.
 * On the first call, any validation errors are printed and the process exits.
 */
export function getConfig(): AppConfig {
  if (_config) return _config;

  const errors: string[] = [];

  // ── PORT ──────────────────────────────────────────────────────────────────
  let port = 0;
  const rawPort = process.env["PORT"]?.trim();
  if (!rawPort) {
    errors.push("PORT is required but is not set.");
  } else {
    port = Number(rawPort);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      errors.push(`PORT must be a valid TCP port (1–65535), got: "${rawPort}"`);
    }
  }

  // ── SESSION_SECRET ────────────────────────────────────────────────────────
  const sessionSecret = readRequired("SESSION_SECRET", errors);

  // ── Firebase ──────────────────────────────────────────────────────────────
  const firebase = resolveFirebaseCredentials(errors);

  // ── Fail fast ─────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    const banner =
      "\n╔══════════════════════════════════════════════════════════╗\n" +
      "║          CONFIGURATION ERROR — SERVER CANNOT START        ║\n" +
      "╚══════════════════════════════════════════════════════════╝\n";
    const body = errors
      .map((e, i) => `  ${i + 1}. ${e}`)
      .join("\n\n");
    const footer =
      "\nFix the environment variables above and restart the server.\n";
    console.error(banner + body + footer);
    process.exit(1);
  }

  _config = Object.freeze({
    server: {
      port,
      nodeEnv:      readOptional("NODE_ENV",      "production"),
      uploadsDir:   readOptional("UPLOADS_DIR",   ""),
      apiPublicUrl: readOptional("API_PUBLIC_URL", ""),
    },
    firebase:  firebase!,
    session:   { secret: sessionSecret },
    log:       { level: readOptional("LOG_LEVEL", "info") },
  }) as AppConfig;

  return _config;
}

/**
 * Log a startup summary.  Safe: never emits private-key or secret values.
 * Call after getConfig() has succeeded and the logger is available.
 */
export function logConfigSummary(
  log: (obj: Record<string, unknown>, msg: string) => void,
): void {
  const c = getConfig();

  // Firebase metadata — project id and method only, no key material
  let firebaseSummary: string;
  const fb = c.firebase;
  if (fb.method === "individual") {
    const domain = fb.clientEmail.includes("@")
      ? fb.clientEmail.split("@")[1]
      : "?";
    firebaseSummary = `individual vars  project=${fb.projectId}  svc-acct-domain=${domain}`;
  } else if (fb.method === "serviceAccountJson") {
    const pid = (fb.serviceAccount["project_id"] as string | undefined) ?? "?";
    firebaseSummary = `inline JSON  project=${pid}`;
  } else {
    const path = process.env["GOOGLE_APPLICATION_CREDENTIALS"] ?? "?";
    firebaseSummary = `applicationDefault  GOOGLE_APPLICATION_CREDENTIALS=${path}`;
  }

  log(
    {
      port:              c.server.port,
      nodeEnv:           c.server.nodeEnv,
      uploadsDir:        c.server.uploadsDir  || "(default: <dist>/../uploads)",
      apiPublicUrl:      c.server.apiPublicUrl || "(derived from Host header)",
      logLevel:          c.log.level,
      firebaseCredentials: firebaseSummary,
      sessionSecretSet:  c.session.secret.length > 0,
    },
    "[CONFIG] Startup configuration validated",
  );
}
