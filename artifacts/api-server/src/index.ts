// Load .env using an explicit path derived from the bundle's own location so
// this works regardless of PM2's cwd setting.
// The bundle lands in dist/index.mjs; .env sits one level up at the project root.
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const bundleDir = dirname(fileURLToPath(import.meta.url));
const envPath   = resolve(bundleDir, "../.env");
const dotenvResult = dotenvConfig({ path: envPath });

// ── Import app and services (AFTER dotenv so env vars are available) ─────────
// NOTE: Firebase Admin reads env vars lazily (inside getAdminApp()), so it
// correctly picks up values loaded by dotenv above.
import app, { initStaticUploads } from "./app";
import { logger } from "./lib/logger";
import { startFcmDispatcher } from "./lib/fcm-dispatcher";
import { startRoundRobinDispatcher } from "./lib/round-robin-dispatcher";
import { startPgShadowWriter } from "./lib/pg-shadow-writer";
import {
  logDispatchSource,
  planDispatchStartup,
  resolvePgWriteGates,
  logPgWriteGuard,
} from "./lib/dispatch-source";
import { startPgDispatcherDryRun } from "./lib/pg-dispatcher-dry-run";
import { startPgDispatcher } from "./lib/pg-dispatcher";
import { startDispatchProjector } from "./lib/pg-firestore-projector";
import { ensureSseTrigger } from "./lib/sse-trigger";
import { startSseHub, startSseEventsCleanup } from "./lib/sse-hub";

// ── Resolve runtime config (env vars now available from dotenv) ──────────────
const uploadsDir   = process.env["UPLOADS_DIR"]    ?? resolve(bundleDir, "../uploads");
const apiPublicUrl = process.env["API_PUBLIC_URL"]  ?? "";
const rawPort      = process.env["PORT"];

// Pin the resolved uploadsDir back into process.env so that kyc-upload.ts
// (which calls getUploadsDir() at request time) uses the exact same path
// that initStaticUploads() will serve from.  Without this, kyc-upload.ts
// falls back to path.join(process.cwd(), "uploads") which differs from
// resolve(bundleDir, "../uploads") when PM2's cwd is not the project root —
// causing files to be written in one directory but served from another (404).
process.env["UPLOADS_DIR"] = uploadsDir;

if (dotenvResult.error) {
  // Not fatal — PM2 env vars take precedence over .env.
  // Log so the VPS operator can diagnose .env path issues.
  logger.warn({ envPath, err: dotenvResult.error.message }, ".env load warning (non-fatal)");
} else {
  logger.info({ envPath, parsed: Object.keys(dotenvResult.parsed ?? {}).length }, ".env loaded");
}

// ── Static uploads route (mounted after dotenv so UPLOADS_DIR is correct) ───
initStaticUploads(uploadsDir);

// ── One-time package download route ─────────────────────────────────────────
// Allows the VPS operator to wget the latest api-deploy.tar.gz directly from
// the Replit dev domain without needing any external file host.
app.get("/api/dl", (_req, res) => {
  const filePath = resolve(bundleDir, "../api-deploy.tar.gz");
  res.download(filePath, "api-deploy.tar.gz", (err) => {
    if (err) {
      res.status(404).json({ error: "Package not found", path: filePath });
    }
  });
});

// ── Startup config log ───────────────────────────────────────────────────────
logger.info(
  {
    uploadsDir,
    publicUrl: apiPublicUrl || "(derived from Host header at request time)",
  },
  "Startup config",
);

// ── Firebase env check (confirms which project is configured) ────────────────
// Logs project ID and the domain part of the client email only — never the key.
const fbProjectId   = process.env["FIREBASE_PROJECT_ID"]   ?? "(not set)";
const fbClientEmail = process.env["FIREBASE_CLIENT_EMAIL"] ?? "(not set)";
const fbKeyPresent  = !!(process.env["FIREBASE_PRIVATE_KEY"]);
logger.info(
  {
    firebaseProjectId:        fbProjectId,
    firebaseClientEmailDomain: fbClientEmail.includes("@") ? fbClientEmail.split("@")[1] : fbClientEmail,
    firebasePrivateKeyPresent: fbKeyPresent,
  },
  "[STARTUP_FIREBASE_CONFIG]",
);

// ── Dispatch source feature flag (Phase 5E-B / 5E-C) ────────────────────────
// Logging + a read-only PG dry-run gate. The Firestore dispatcher below ALWAYS
// starts and remains authoritative; pg_shadow additionally runs a read-only PG
// dry-run, and pg only logs a warning (PG primary not implemented yet).
const dispatchSource = logDispatchSource();
const pgWriteGates = resolvePgWriteGates();
const dispatchPlan = planDispatchStartup(dispatchSource.value, pgWriteGates);
// Phase 5G-A: surface the resolved write-guard state at startup. Logging only —
// no PG writes/FCM can occur unless the gates below are explicitly opened.
logPgWriteGuard(dispatchPlan);

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the Firestore → FCM order dispatcher (fire-and-forget; errors logged internally)
  startFcmDispatcher().catch((e) =>
    logger.error({ err: e }, "FCM dispatcher startup failed"),
  );

  // Start the round-robin driver dispatch loop (fire-and-forget; errors logged internally)
  startRoundRobinDispatcher().catch((e) =>
    logger.error({ err: e }, "Round-robin dispatcher startup failed"),
  );

  // Start the PG shadow writer — mirrors mobile-initiated Firestore events into PG
  startPgShadowWriter().catch((e) =>
    logger.error({ err: e }, "PG shadow writer startup failed"),
  );

  // Start the PG → Firestore projector (Phase 5H-BRIDGE-3). Started in every
  // mode but inert until PG_PROJECTION_ENABLED=true AND DISPATCH_SOURCE=pg.
  // Drains the durable dispatch_projections outbox to the Firestore order docs
  // the apps + Firestore FCM dispatcher read. No PG-native FCM, no app changes.
  startDispatchProjector().catch((e) =>
    logger.error({ err: e }, "[PG_PROJECTOR_START] startup failed"),
  );

  // Install the orders → sse_events trigger, then open the LISTEN hub that
  // drives the Driver App SSE streams (Phase 5J-Tier-6). Read-only realtime
  // projection of PG order state; no authority, FCM, or app-write changes.
  ensureSseTrigger()
    .then(() => startSseHub())
    .catch((e) => logger.error({ err: e }, "[SSE_START] startup failed"));

  // Prune sse_events rows older than 7 days every 6 hours (retention policy).
  startSseEventsCleanup();

  // ── DISPATCH_SOURCE gate (Phase 5E-C / 5F) ─────────────────────────────────
  // Firestore dispatcher above is authoritative in EVERY mode. This adds a
  // READ-ONLY PG dry-run (pg_shadow) or the PG dispatcher (pg). In Phase 5F the
  // PG dispatcher always runs in VERIFY_ONLY mode: it executes the full decision
  // path and logs intended writes ([PG_VERIFY_*]) but commits nothing and sends
  // no FCM. No authority cutover yet.
  if (dispatchPlan.startPgDryRun) {
    startPgDispatcherDryRun().catch((e) =>
      logger.error({ err: e }, "[PG_DRY_RUN_ERROR] dry-run startup failed"),
    );
  } else if (dispatchPlan.startPgDispatcher) {
    startPgDispatcher(dispatchPlan.pgDispatcherVerifyOnly).catch((e) =>
      logger.error({ err: e }, "[PG_VERIFY_ERROR] PG dispatcher startup failed"),
    );
  }
});
