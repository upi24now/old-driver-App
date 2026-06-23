// ── Dispatch source feature-flag resolver (Phase 5E-B) ──────────────────────
// SKELETON ONLY. This resolves the DISPATCH_SOURCE env flag and reports it, but
// NOTHING in the codebase routes dispatch logic on the result yet. The Firestore
// dispatcher always starts exactly as before. This file exists so a future
// cutover phase has a single, validated source of truth for the flag.
//
// Allowed values: "firestore" | "pg_shadow" | "pg".  Default + safe fallback:
// "firestore". Missing or invalid values resolve to "firestore".
import { logger } from "./logger";

export const DISPATCH_SOURCES = ["firestore", "pg_shadow", "pg"] as const;
export type DispatchSource = (typeof DISPATCH_SOURCES)[number];

export const DEFAULT_DISPATCH_SOURCE: DispatchSource = "firestore";

export interface DispatchSourceConfig {
  /** The configured/requested source after validation (invalid/missing → firestore). */
  value: DispatchSource;
  /**
   * The source that would actually be used. In this skeleton phase it always
   * equals `value` — no routing or downgrade happens yet. The field exists so a
   * future cutover phase can diverge it from `value` when adding real routing.
   */
  effective: DispatchSource;
  /** Whether the runtime prerequisites for the PG dispatch services are present. */
  pgAvailable: boolean;
  /** The raw, unvalidated env string (for diagnostics). */
  raw: string | undefined;
}

function isDispatchSource(v: string): v is DispatchSource {
  return (DISPATCH_SOURCES as readonly string[]).includes(v);
}

// ── PG write/FCM safety gates (Phase 5G-A) ───────────────────────────────────
// Two independent boolean env guards that must BOTH be opened, on top of
// DISPATCH_SOURCE=pg, before the PG dispatcher can commit writes or send FCM.
// Strict parsing: a gate is open ONLY when the trimmed, lowercased value is
// exactly "true". Anything else (missing, "1", "yes", "false", typo) ⇒ closed.
// Closed-by-default is the safe state.

/** Resolved state of the PG write/FCM safety gates. */
export interface PgWriteGates {
  /** ALLOW_PG_DISPATCH_WRITES === "true" — permits PG assign/timeout/claim commits. */
  allowPgDispatchWrites: boolean;
  /** PG_FCM_SEND_ENABLED === "true" — permits PG-originated FCM sends (only meaningful when writes are allowed). */
  pgFcmSendEnabled: boolean;
}

/** Default — both gates CLOSED. Used wherever gates are not explicitly supplied. */
export const CLOSED_PG_WRITE_GATES: PgWriteGates = {
  allowPgDispatchWrites: false,
  pgFcmSendEnabled: false,
};

function isFlagTrue(name: string): boolean {
  return (process.env[name]?.trim().toLowerCase() ?? "") === "true";
}

/**
 * Read the PG write/FCM safety gates from the environment. Pure read — no side
 * effects. Both default to false (closed) when unset/invalid.
 */
export function resolvePgWriteGates(): PgWriteGates {
  return {
    allowPgDispatchWrites: isFlagTrue("ALLOW_PG_DISPATCH_WRITES"),
    pgFcmSendEnabled: isFlagTrue("PG_FCM_SEND_ENABLED"),
  };
}

/**
 * Phase 5H-BRIDGE-3 projector gate. Strict — open ONLY when
 * PG_PROJECTION_ENABLED is exactly "true". This is the third independent,
 * closed-by-default safety gate (alongside ALLOW_PG_DISPATCH_WRITES and
 * PG_FCM_SEND_ENABLED): it permits the PG → Firestore projector to commit
 * Firestore writes. The projector additionally requires DISPATCH_SOURCE=pg, so a
 * projection can never write Firestore while the Firestore dispatcher is
 * authoritative. Pure read — no side effects.
 */
export function resolvePgProjectionEnabled(): boolean {
  return isFlagTrue("PG_PROJECTION_ENABLED");
}

/**
 * Defense-in-depth gate for the write path. Given the requested verify-only flag
 * and the resolved gates, decide the EFFECTIVE verify-only state.
 *
 * Safer-option policy (documented choice for Phase 5G-A): if a caller requests
 * writes (verifyOnly=false) but ALLOW_PG_DISPATCH_WRITES is not "true", we DO
 * NOT crash — we FORCE verifyOnly=true and report `forced`. Crashing would take
 * down the process that also runs the always-authoritative Firestore dispatcher;
 * silently degrading to verify-only keeps Firestore serving while guaranteeing
 * no PG writes ever escape an un-gated environment.
 */
export function resolveEffectiveVerifyOnly(
  requestedVerifyOnly: boolean,
  gates: PgWriteGates,
): { verifyOnly: boolean; forced: boolean } {
  if (!requestedVerifyOnly && !gates.allowPgDispatchWrites) {
    return { verifyOnly: true, forced: true };
  }
  return { verifyOnly: requestedVerifyOnly, forced: false };
}

/**
 * Reports whether the runtime prerequisites for the PG dispatch write services
 * are present. The service functions themselves are statically compiled into the
 * bundle, so the only prerequisite that can actually be missing at runtime is a
 * database connection string. This is a pure config read — it does NOT connect
 * to the database or start anything.
 */
function checkPgAvailable(): boolean {
  return !!process.env["DATABASE_URL"];
}

/**
 * Resolve the dispatch-source feature flag. Pure read of env — no side effects
 * beyond returning the resolved config.
 */
export function resolveDispatchSource(): DispatchSourceConfig {
  const raw = process.env["DISPATCH_SOURCE"];
  const trimmed = raw?.trim().toLowerCase() ?? "";

  const value: DispatchSource =
    trimmed && isDispatchSource(trimmed) ? trimmed : DEFAULT_DISPATCH_SOURCE;

  // Skeleton phase: nothing routes on this, so the effective source is exactly
  // the resolved value. A future cutover phase will introduce real divergence.
  const effective: DispatchSource = value;

  return { value, effective, pgAvailable: checkPgAvailable(), raw };
}

/**
 * The dispatcher startup plan derived from the resolved source. The Firestore
 * dispatcher ALWAYS starts (it is authoritative in every mode this phase). The
 * plan adds the read-only PG dry-run (pg_shadow) or the PG dispatcher (pg). In
 * Phase 5F the PG dispatcher always runs in VERIFY_ONLY mode (commits nothing,
 * sends no FCM), so Firestore stays authoritative even in `pg`.
 *
 * Startup matrix:
 *   firestore → Firestore dispatcher only
 *   pg_shadow → Firestore dispatcher + PG dry-run (read-only)
 *   pg        → Firestore dispatcher + PG dispatcher (VERIFY_ONLY)
 */
export interface DispatchStartupPlan {
  /** Always true — the Firestore dispatcher starts in every mode. */
  startFirestore: true;
  /** Start the read-only PG dispatcher dry-run loop. Only in pg_shadow. */
  startPgDryRun: boolean;
  /** Start the PG dispatcher. Only in pg. */
  startPgDispatcher: boolean;
  /**
   * Whether the PG dispatcher runs in VERIFY_ONLY mode (logs intended writes,
   * commits nothing, sends no FCM). True unless DISPATCH_SOURCE=pg AND the
   * ALLOW_PG_DISPATCH_WRITES gate is open. Default config ⇒ always true.
   */
  pgDispatcherVerifyOnly: boolean;
  /**
   * Whether PG-originated FCM sends are permitted (PG_FCM_SEND_ENABLED gate).
   * Only meaningful when writes are allowed; the dispatcher still never sends
   * FCM while verify-only.
   */
  pgFcmSendEnabled: boolean;
}

/**
 * Pure mapping from the resolved dispatch source + safety gates to what should
 * start at boot. Firestore ALWAYS starts. pg_shadow adds the read-only dry-run.
 * pg adds the PG dispatcher, which stays VERIFY_ONLY unless the
 * ALLOW_PG_DISPATCH_WRITES gate is open (closed-by-default).
 */
export function planDispatchStartup(
  value: DispatchSource,
  gates: PgWriteGates = CLOSED_PG_WRITE_GATES,
): DispatchStartupPlan {
  const startPgDispatcher = value === "pg";
  // Verify-only unless we are in pg mode AND writes are explicitly allowed.
  const pgDispatcherVerifyOnly = !(startPgDispatcher && gates.allowPgDispatchWrites);
  return {
    startFirestore: true,
    startPgDryRun: value === "pg_shadow",
    startPgDispatcher,
    pgDispatcherVerifyOnly,
    pgFcmSendEnabled: gates.pgFcmSendEnabled,
  };
}

/**
 * Emit the startup write-guard log. Logging only — does not change behavior.
 * `writesAllowed` is the inverse of the effective verify-only state.
 */
export function logPgWriteGuard(plan: DispatchStartupPlan): void {
  const writesAllowed = plan.startPgDispatcher && !plan.pgDispatcherVerifyOnly;
  const log = writesAllowed ? logger.warn.bind(logger) : logger.info.bind(logger);
  log(
    {
      writesAllowed,
      startPgDispatcher: plan.startPgDispatcher,
      pgDispatcherVerifyOnly: plan.pgDispatcherVerifyOnly,
      pgFcmSendEnabled: plan.pgFcmSendEnabled,
    },
    `[PG_DISPATCH_WRITE_GUARD] writesAllowed=${writesAllowed}`,
  );
}

/**
 * Log the resolved dispatch source at startup. Logging only — does NOT change
 * any runtime behavior. Emits a warning when the configured env value was
 * invalid, or when PG was requested but its prerequisites are missing.
 */
export function logDispatchSource(): DispatchSourceConfig {
  const config = resolveDispatchSource();

  const trimmedRaw = config.raw?.trim().toLowerCase() ?? "";
  if (trimmedRaw !== "" && config.value !== trimmedRaw) {
    logger.warn(
      { raw: config.raw, allowed: DISPATCH_SOURCES, fallback: DEFAULT_DISPATCH_SOURCE },
      "[DISPATCH_SOURCE] invalid DISPATCH_SOURCE value — falling back to firestore",
    );
  }

  if ((config.value === "pg" || config.value === "pg_shadow") && !config.pgAvailable) {
    logger.warn(
      { value: config.value },
      "[DISPATCH_SOURCE] PG dispatch requested but required PG prerequisites are missing (DATABASE_URL) — behavior unchanged (firestore)",
    );
  }

  logger.info(
    {
      value: config.value,
      effective: config.effective,
      pgAvailable: config.pgAvailable,
    },
    `[DISPATCH_SOURCE] value=${config.value} effective=${config.effective}`,
  );

  return config;
}
