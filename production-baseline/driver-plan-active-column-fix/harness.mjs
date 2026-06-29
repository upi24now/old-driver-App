// SQL proof for the driver_plans `active`-column fix.
//
// Reproduces the LIVE schema shape (driver_plans WITHOUT an `active` column) in a
// throwaway TEMP table, then proves:
//   - the OLD (buggy) statements fail with PostgreSQL 42703 (column "active" ... does not exist)
//   - the NEW (patched) statements succeed and drive the full money path:
//       create-order insert (status='created')  ->  activate paid row (status='active')
//       ->  cancel other active rows  ->  exactly one active row remains
//
// Uses a TEMP table (auto-dropped on disconnect); touches NO real data.
// Requires DATABASE_URL in the environment (any Postgres; schema is created here).

import pg from "pg";

const OLD = {
  insert: "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, active, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', false, $6, NOW())",
  activate: "UPDATE driver_plans SET status = 'active', active = true, razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at",
};
const NEW = {
  insert: "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, razorpay_order_id, created_at) VALUES ($1, $2, $3, $4, $5, 'created', $6, NOW())",
  insertConflict: "INSERT INTO driver_plans (driver_uid, plan_id, plan_label, amount, duration_days, status, razorpay_order_id, created_at) VALUES ($1,$2,$3,$4,$5,'created',$6,NOW()) ON CONFLICT DO NOTHING",
  cancelOthers: "UPDATE driver_plans SET status = 'cancelled' WHERE driver_uid = $1 AND status = 'active' AND razorpay_order_id <> $2",
  activate: "UPDATE driver_plans SET status = 'active', razorpay_payment_id = $1, started_at = $2, expires_at = $3 WHERE razorpay_order_id = $4 AND driver_uid = $5 RETURNING expires_at",
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS ", m); } else { fail++; console.log("FAIL ", m); } };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // LIVE schema shape — note: NO `active` column.
  await client.query(`
    CREATE TEMP TABLE driver_plans (
      id serial PRIMARY KEY,
      driver_uid text NOT NULL,
      plan_id text,
      plan_label text,
      amount integer,
      duration_days integer,
      status text NOT NULL DEFAULT 'created',
      razorpay_order_id text,
      razorpay_payment_id text,
      started_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz DEFAULT NOW()
    ) ON COMMIT PRESERVE ROWS;
  `);

  const uid = "proofdriver";
  const expires = new Date(Date.now() + 12 * 3600 * 1000).toISOString();

  // 1. OLD insert must fail with 42703 on the active-less schema (reproduces the prod bug).
  try {
    await client.query(OLD.insert, [uid, "daily", "Daily", 1900, 1, "order_OLD"]);
    ok(false, "1. OLD insert should have thrown 42703 but succeeded");
  } catch (e) {
    ok(e && e.code === "42703" && /active/.test(e.message), `1. OLD insert -> 42703 column "active" missing (reproduces prod 500)`);
  }

  // 2. NEW create-order insert succeeds, row is status='created'.
  await client.query(NEW.insert, [uid, "daily", "Daily", 1900, 1, "order_A"]);
  let r = await client.query("SELECT status FROM driver_plans WHERE razorpay_order_id='order_A'");
  ok(r.rows[0]?.status === "created", "2. NEW create-order insert -> row status='created'");

  // 3. A second active plan exists (simulate older active row) to test cancel-others.
  await client.query(NEW.insert, [uid, "weekly", "Weekly", 9900, 7, "order_OLDACTIVE"]);
  await client.query(NEW.activate, ["pay_old", new Date().toISOString(), expires, "order_OLDACTIVE", uid]);

  // 4. cancel every OTHER active row, then activate the paid row (the verify-payment sequence).
  await client.query(NEW.cancelOthers, [uid, "order_A"]);
  const upd = await client.query(NEW.activate, ["pay_A", new Date().toISOString(), expires, "order_A", uid]);
  ok(upd.rowCount === 1, "3. NEW activate paid row -> exactly 1 row updated");

  // 5. exactly ONE active row remains, and it is the paid order.
  r = await client.query("SELECT razorpay_order_id FROM driver_plans WHERE driver_uid=$1 AND status='active'", [uid]);
  ok(r.rowCount === 1 && r.rows[0].razorpay_order_id === "order_A",
     "4. exactly one active row remains, and it is the paid order (one-active invariant holds)");

  // 6. OLD activate (with active=true) still fails on this schema — confirms ALL active writes were the bug.
  try {
    await client.query(OLD.activate, ["pay_x", new Date().toISOString(), expires, "order_A", uid]);
    ok(false, "5. OLD activate should have thrown 42703 but succeeded");
  } catch (e) {
    ok(e && e.code === "42703", "5. OLD activate -> 42703 (confirms every active-column write was broken)");
  }

  console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : "FAILURES: " + fail}  (${pass} passed)`);
} finally {
  await client.end();
}
process.exit(fail === 0 ? 0 : 1);
