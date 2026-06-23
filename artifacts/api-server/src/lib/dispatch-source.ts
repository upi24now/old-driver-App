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
