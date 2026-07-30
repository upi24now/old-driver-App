// ── Step 1: Load .env BEFORE any config or service imports are evaluated ─────
//
// dotenv must be the very first thing that runs so that all subsequent
// process.env reads (config.ts, firebase-admin.ts, …) see the loaded values.
//
// Path logic: bundle lands at dist/index.mjs; .env sits one level up.
// This works for PM2, direct node invocation, and the Replit dev workflow.
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const bundleDir    = dirname(fileURLToPath(import.meta.url));
const envPath      = resolve(bundleDir, "../.env");
const dotenvResult = dotenvConfig({ path: envPath });

// ── Step 2: Import application modules (all lazy-init; dotenv already ran) ───
import app, { initStaticUploads } from "./app";
import { logger }  from "./lib/logger";
import { getConfig, logConfigSummary } from "./lib/config";
import { startFcmDispatcher }          from "./lib/fcm-dispatcher";
import { startRoundRobinDispatcher }   from "./lib/round-robin-dispatcher";
import { startPgShadowWriter }         from "./lib/pg-shadow-writer";
import {
  logDispatchSource,
  planDispatchStartup,
  resolvePgWriteGates,
  logPgWriteGuard,
} from "./lib/dispatch-source";
import { startPgDispatcherDryRun }  from "./lib/pg-dispatcher-dry-run";
import { startPgDispatcher }        from "./lib/pg-dispatcher";
import { startDispatchProjector }   from "./lib/pg-firestore-projector";
import { ensureSseTrigger }         from "./lib/sse-trigger";
import { startSseHub, startSseEventsCleanup } from "./lib/sse-hub";

// ── Step 3: .env load result ─────────────────────────────────────────────────
if (dotenvResult.error) {
  // Non-fatal: PM2 / Docker / CI inject vars directly; .env is only for local dev.
  logger.warn({ envPath, err: dotenvResult.error.message }, ".env load warning (non-fatal)");
} else {
  logger.info({ envPath, parsed: Object.keys(dotenvResult.parsed ?? {}).length }, ".env loaded");
}

// ── Step 4: Validate all required configuration (fail-fast) ──────────────────
//
// getConfig() reads process.env (now populated by dotenv above), validates every
// required variable, and exits with a descriptive error list if anything is
// missing.  This replaces the previous scattered PORT / Firebase / SESSION_SECRET
// checks that were spread across multiple files.
const cfg = getConfig();

// ── Step 5: Resolve uploadsDir and pin it into process.env ───────────────────
//
// kyc-upload.ts reads UPLOADS_DIR via getUploadsDir() at request time.
// Pinning the resolved path here ensures both multer (write) and express.static
// (serve) operate on the exact same directory regardless of PM2's cwd.
const uploadsDir = cfg.server.uploadsDir || resolve(bundleDir, "../uploads");
process.env["UPLOADS_DIR"] = uploadsDir;

// ── Step 6: Log safe startup summary (no secret values) ──────────────────────
logConfigSummary((obj, msg) => logger.info(obj, msg));

// ── Static uploads route (mounted after dotenv + config so UPLOADS_DIR is set) 
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

app.listen(cfg.server.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: cfg.server.port }, "Server listening");

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
