/**
 * SSE event trigger installer (Phase 5J-Tier-6).
 *
 * Drizzle-kit cannot express PL/pgSQL triggers, so the trigger function and the
 * trigger binding are installed here at server startup. The statements are fully
 * idempotent (CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER), so re-running on
 * every boot is safe.
 *
 * The trigger is the single, write-path-agnostic source of SSE events: it fires
 * for EVERY insert/update on `orders` regardless of which code path (PG
 * dispatcher, projector, shadow-writer, REST routes) made the change, so no
 * realtime event can be missed.
 *
 * Safety: the whole trigger body is wrapped in BEGIN/EXCEPTION WHEN OTHERS so a
 * fault in event bookkeeping can NEVER abort the underlying order write (which
 * would, in turn, kill the authoritative dispatcher writes).
 *
 * Emission rules (mirror the Firestore onSnapshot semantics the apps relied on):
 *   • order topic — emit when row is inserted or status changes. Location-only
 *     updates (status unchanged) are skipped to avoid spamming the stream.
 *   • offer topic — emit one event per affected driver uid (union of OLD and NEW
 *     active_offer_driver_uids) when the offer set changes OR the status changes
 *     while a non-empty offer set exists. Active-delivery location updates clear
 *     the offer set on accept, so they never produce offer events.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const INSTALL_SQL = `
CREATE OR REPLACE FUNCTION sse_orders_emit() RETURNS trigger AS $$
DECLARE
  old_arr   text[] := COALESCE(OLD.active_offer_driver_uids, '{}');
  new_arr   text[] := COALESCE(NEW.active_offer_driver_uids, '{}');
  affected  text[];
  uid       text;
  new_id    bigint;
  status_changed boolean := (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status);
  offer_changed  boolean := (TG_OP = 'INSERT' AND array_length(new_arr, 1) > 0)
                            OR (old_arr IS DISTINCT FROM new_arr);
BEGIN
  -- ── order topic: status transitions only (skip location-only updates) ──────
  IF status_changed THEN
    INSERT INTO sse_events (topic, order_id, status)
    VALUES ('order', NEW.id, NEW.status)
    RETURNING id INTO new_id;
    PERFORM pg_notify('sse_event', json_build_object('t','order','o',NEW.id,'i',new_id)::text);
  END IF;

  -- ── offer topic: per affected driver uid ──────────────────────────────────
  IF offer_changed OR (status_changed AND array_length(new_arr, 1) > 0) THEN
    affected := ARRAY(SELECT DISTINCT u FROM unnest(old_arr || new_arr) AS u);
    FOREACH uid IN ARRAY affected LOOP
      INSERT INTO sse_events (topic, driver_uid, order_id, status)
      VALUES ('offer', uid, NEW.id, NEW.status)
      RETURNING id INTO new_id;
      PERFORM pg_notify('sse_event', json_build_object('t','offer','d',uid,'i',new_id)::text);
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let SSE bookkeeping abort the underlying order write.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sse_orders_emit_trg ON orders;
CREATE TRIGGER sse_orders_emit_trg
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION sse_orders_emit();
`;

let installed = false;

/**
 * Install (or refresh) the orders → sse_events trigger. Idempotent; safe to call
 * on every boot. Logs and swallows errors so a trigger-install failure never
 * crashes the server (SSE simply degrades; everything else keeps working).
 */
export async function ensureSseTrigger(): Promise<void> {
  if (installed) return;
  try {
    await pool.query(INSTALL_SQL);
    installed = true;
    logger.info("[SSE_TRIGGER] orders → sse_events trigger installed");
  } catch (err) {
    logger.error({ err }, "[SSE_TRIGGER] failed to install trigger (SSE degraded)");
  }
}
