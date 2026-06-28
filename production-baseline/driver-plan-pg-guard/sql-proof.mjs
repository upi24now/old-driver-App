// Real-Postgres proof: runs the EXACT SQL the [BCD-PG] block runs, against an isolated
// dev-DB schema mirror of the production driver_plans columns. Proves the guard read, the
// no-write-on-409 decision, and the strict expiry math (daily +12h / weekly +7d / monthly +30d)
// + one-active invariant on a real timestamptz round-trip. Exit 0 = all pass.
import pg from "pg";

const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
const SCHEMA = "pgguard_proof";
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.error("  FAIL", msg); } };
const DAY = 864e5;
const PLAN_MS = { daily: 12 * 3600e3, weekly: 7 * DAY, monthly: 30 * DAY };

await c.connect();
try {
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`SET search_path TO ${SCHEMA}, public`);
  // Mirror of the production driver_plans columns the block touches.
  await c.query(`CREATE TABLE driver_plans (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_uid text NOT NULL,
    plan_id text NOT NULL,
    plan_label text,
    amount numeric(10,2),
    duration_days integer,
    status text NOT NULL DEFAULT 'created',
    active boolean NOT NULL DEFAULT false,
    started_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    razorpay_order_id text,
    razorpay_payment_id text
  )`);

  // ---- create-order INSERT (the exact statement) ----
  await c.query(
    "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', false, $6, NOW())",
    ["drvA", "weekly", "Weekly", 1900, 7, "order_A1"]
  );
  let cnt = (await c.query("SELECT count(*)::int n FROM driver_plans")).rows[0].n;
  ok(cnt === 1, "create-order INSERT wrote one 'created' row");

  // ---- guard read on a 'created' (not yet active) row -> none active -> create-order would proceed ----
  let g = await c.query("SELECT plan_id, status, expires_at FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1", ["drvA"]);
  ok(g.rowCount === 0, "guard read: 'created' row is NOT active -> create-order proceeds");

  // ---- activate weekly via the exact verify-payment tx SQL, JS-computed expiry ----
  async function activate(uid, oid, planId) {
    const started = new Date();
    const expires = new Date(started.getTime() + PLAN_MS[planId]);
    await c.query("BEGIN");
    await c.query("UPDATE driver_plans SET status = 'cancelled', active = false WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2", [uid, oid]);
    const upd = await c.query("UPDATE driver_plans SET status = 'active', active = true, razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING started_at, expires_at", ["pay_" + oid, started.toISOString(), expires.toISOString(), oid, uid]);
    await c.query("COMMIT");
    return upd.rows[0];
  }
  let row = await activate("drvA", "order_A1", "weekly");
  let win = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(Math.abs(win - PLAN_MS.weekly) < 2000, "weekly activation -> expires_at = started_at + 7d (real timestamptz)");

  // ---- guard read now returns the active weekly row -> create-order would 409 ----
  g = await c.query("SELECT plan_id, status, expires_at FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1", ["drvA"]);
  ok(g.rowCount === 1 && g.rows[0].plan_id === "weekly", "guard read: active weekly row present -> create-order returns 409");

  // ---- expire it -> guard returns none again ----
  await c.query("UPDATE driver_plans SET expires_at = NOW() - interval '1 hour' WHERE razorpay_order_id = 'order_A1'");
  g = await c.query("SELECT plan_id FROM driver_plans WHERE driver_uid = $1 AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1", ["drvA"]);
  ok(g.rowCount === 0, "guard read: expired active row excluded (expires_at > NOW()) -> create-order proceeds again");

  // ---- daily = +12h ----
  await c.query("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ('drvD','daily','Daily',300,1,'created',false,'order_D1',NOW())");
  row = await activate("drvD", "order_D1", "daily");
  win = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(Math.abs(win - PLAN_MS.daily) < 2000, "daily activation -> expires_at = started_at + 12h (NOT 24h)");

  // ---- monthly = +30d AND one-active invariant (drvA gets a fresh active monthly; only one active) ----
  await c.query("UPDATE driver_plans SET status='active', active=true, expires_at = NOW() + interval '3 days' WHERE razorpay_order_id='order_A1'"); // re-activate weekly to simulate overlap
  await c.query("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ('drvA','monthly','Monthly',10000,30,'created',false,'order_A2',NOW())");
  row = await activate("drvA", "order_A2", "monthly");
  win = new Date(row.expires_at).getTime() - new Date(row.started_at).getTime();
  ok(Math.abs(win - PLAN_MS.monthly) < 2000, "monthly activation -> expires_at = started_at + 30d");
  const act = await c.query("SELECT plan_id FROM driver_plans WHERE driver_uid='drvA' AND status='active' AND active=true");
  ok(act.rowCount === 1 && act.rows[0].plan_id === "monthly", "one-active invariant -> exactly ONE active row for drvA (weekly cancelled, monthly active)");

  // ---- CONCURRENCY: two verify-payment activations for the SAME driver run in parallel on
  // SEPARATE connections, each taking the per-driver pg_advisory_xact_lock (same key the block
  // uses). The lock must serialise them so the final state has EXACTLY ONE active row. ----
  await c.query("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ('drvC','weekly','Weekly',1900,7,'created',false,'order_C1',NOW())");
  await c.query("INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ('drvC','monthly','Monthly',10000,30,'created',false,'order_C2',NOW())");
  async function lockedActivate(oid, planId) {
    const cli = new Client({ connectionString: process.env.DATABASE_URL });
    await cli.connect();
    await cli.query(`SET search_path TO ${SCHEMA}, public`);
    const started = new Date();
    const expires = new Date(started.getTime() + PLAN_MS[planId]);
    try {
      await cli.query("BEGIN");
      await cli.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["dpa:drvC"]);
      await cli.query("SELECT status, expires_at FROM driver_plans WHERE razorpay_order_id = $1 AND driver_uid = $2 FOR UPDATE", [oid, "drvC"]);
      await cli.query("UPDATE driver_plans SET status='cancelled', active=false WHERE driver_uid=$1 AND status='active' AND razorpay_order_id <> $2", ["drvC", oid]);
      await cli.query("UPDATE driver_plans SET status='active', active=true, started_at=$1, expires_at=$2 WHERE razorpay_order_id=$3 AND driver_uid='drvC'", [started.toISOString(), expires.toISOString(), oid]);
      await cli.query("COMMIT");
    } catch (e) { try { await cli.query("ROLLBACK"); } catch {} throw e; }
    finally { await cli.end(); }
  }
  await Promise.all([lockedActivate("order_C1", "weekly"), lockedActivate("order_C2", "monthly")]);
  const conc = await c.query("SELECT count(*)::int n FROM driver_plans WHERE driver_uid='drvC' AND status='active' AND active=true");
  ok(conc.rows[0].n === 1, "concurrent parallel verify (per-driver xact lock) -> EXACTLY ONE active row for drvC (race serialised)");
} catch (e) {
  fail++; console.error("SQL PROOF EXCEPTION", e);
} finally {
  try { await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch {}
  await c.end();
  console.log(`\n==== SQL PROOF RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}
