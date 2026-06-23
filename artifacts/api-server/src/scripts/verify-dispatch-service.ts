/**
 * Phase 5E-A verification harness — PG DISPATCH WRITE SERVICES.
 *
 * Exercises the five new write services against the REAL PostgreSQL using a
 * self-contained, prefixed set of test rows that are inserted at the start and
 * deleted at the end.  Touches nothing in Firestore and triggers no FCM sends —
 * the services under test do neither by design.
 *
 * Scenarios:
 *   1. pgFindEligibleDrivers — online + subscription + rejected_by + sort
 *   2. assignment succeeds once
 *   3. double assignment blocked
 *   4. claim succeeds once
 *   5. duplicate claim blocked
 *   6. timeout query finds expired
 *   7. return-to-pool succeeds then guarded (second call blocked)
 */

import { db, driversTable, orderOffersTable, ordersTable, pool } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import {
  pgAssignDriverToOrder,
  pgCheckExpiredDispatches,
  pgClaimFcmDispatch,
  pgFindEligibleDrivers,
  pgReturnOrderToPool,
} from "../lib/pg-dispatch-service";

const PREFIX = `TEST_5EA_${Date.now()}`;
const ORDER  = `${PREFIX}_ORDER`;
const ORDER2 = `${PREFIX}_ORDER2`;

// Drivers: deterministic uids so sort order is predictable.
const D_A = `${PREFIX}_a`; // online, no subscription          → eligible
const D_B = `${PREFIX}_b`; // online, future subscription      → eligible
const D_C = `${PREFIX}_c`; // online, expired subscription     → NOT eligible
const D_D = `${PREFIX}_d`; // offline                          → NOT eligible
const D_E = `${PREFIX}_e`; // online, eligible but rejected_by → NOT eligible

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  \u2717 ${label}  ${detail}`);
  }
}

async function seed(): Promise<void> {
  const now = Date.now();
  const future = new Date(now + 7 * 24 * 3600 * 1000);
  const past   = new Date(now - 7 * 24 * 3600 * 1000);

  await db.insert(driversTable).values([
    { uid: D_A, phone: `${PREFIX}_p_a`, name: "Driver A", isOnline: true,  subscriptionExpiresAt: null,   rating: 4.8, tripsTotal: 10 },
    { uid: D_B, phone: `${PREFIX}_p_b`, name: "Driver B", isOnline: true,  subscriptionExpiresAt: future, rating: 4.5, tripsTotal: 20 },
    { uid: D_C, phone: `${PREFIX}_p_c`, name: "Driver C", isOnline: true,  subscriptionExpiresAt: past,   rating: 4.0, tripsTotal: 5  },
    { uid: D_D, phone: `${PREFIX}_p_d`, name: "Driver D", isOnline: false, subscriptionExpiresAt: null,   rating: 5.0, tripsTotal: 0  },
    { uid: D_E, phone: `${PREFIX}_p_e`, name: "Driver E", isOnline: true,  subscriptionExpiresAt: null,   rating: 4.9, tripsTotal: 30 },
  ]);

  await db.insert(ordersTable).values([
    { id: ORDER,  status: "searching", rejectedBy: [D_E] },
    { id: ORDER2, status: "searching", rejectedBy: [] },
  ]);
}

async function cleanup(): Promise<void> {
  // order_offers cascade on order delete; delete orders + drivers by prefix.
  await db.delete(ordersTable).where(like(ordersTable.id, `${PREFIX}%`));
  await db.delete(driversTable).where(like(driversTable.uid, `${PREFIX}%`));
}

async function main(): Promise<void> {
  console.log(`=== Phase 5E-A: PG dispatch write service harness (prefix ${PREFIX}) ===\n`);

  await cleanup(); // defensive — clear any stale rows from a prior aborted run
  await seed();

  try {
    // ── 1. pgFindEligibleDrivers ────────────────────────────────────────────
    // The service correctly returns ALL eligible PG drivers (including any real
    // online drivers in the dev DB), so scope every list assertion to our test
    // prefix to keep the harness isolated from pre-existing data.
    console.log("[1] pgFindEligibleDrivers");
    const eligibleAll = await pgFindEligibleDrivers(ORDER);
    const uids = eligibleAll.map((d) => d.uid).filter((u) => u.startsWith(PREFIX));
    check("excludes offline / expired / rejected_by", JSON.stringify(uids) === JSON.stringify([D_A, D_B]),
      `got ${JSON.stringify(uids)}`);
    check("returned in uid-ascending order", JSON.stringify(uids) === JSON.stringify([...uids].sort()),
      `got ${JSON.stringify(uids)}`);
    const dA = eligibleAll.find((d) => d.uid === D_A);
    check("rating stringified, metadata present",
      dA?.rating === "4.8" && dA?.trips === 10,
      `got ${JSON.stringify(dA)}`);
    // ORDER2 has empty rejected_by → D_E now also eligible.
    const eligible2 = (await pgFindEligibleDrivers(ORDER2)).map((d) => d.uid).filter((u) => u.startsWith(PREFIX));
    check("rejected_by honored per-order", JSON.stringify(eligible2) === JSON.stringify([D_A, D_B, D_E]),
      `got ${JSON.stringify(eligible2)}`);

    // ── 2. assignment succeeds once ─────────────────────────────────────────
    console.log("[2] pgAssignDriverToOrder — succeeds once");
    const a1 = await pgAssignDriverToOrder(ORDER, D_A, { driverName: "Driver A", driverRating: "4.8", driverTrips: 10 });
    check("assign returns ok", a1.ok === true, JSON.stringify(a1));
    const afterAssign = (await db.select().from(ordersTable).where(eq(ordersTable.id, ORDER)))[0]!;
    check("order status=dispatched", afterAssign.status === "dispatched", afterAssign.status);
    check("driver_uid set", afterAssign.driverUid === D_A, String(afterAssign.driverUid));
    check("dispatched_at set", afterAssign.dispatchedAt != null);
    check("dispatch_timeout_at set", afterAssign.dispatchTimeoutAt != null);
    check("last_dispatched_uid set", afterAssign.lastDispatchedUid === D_A, String(afterAssign.lastDispatchedUid));
    const offerRows = await db.select().from(orderOffersTable)
      .where(and(eq(orderOffersTable.orderId, ORDER), eq(orderOffersTable.driverUid, D_A)));
    check("pending offer row created", offerRows.length === 1 && offerRows[0]!.status === "pending",
      JSON.stringify(offerRows.map((o) => o.status)));

    // ── 3. double assignment blocked ────────────────────────────────────────
    console.log("[3] pgAssignDriverToOrder — double assignment blocked");
    const a2 = await pgAssignDriverToOrder(ORDER, D_B, { driverName: "Driver B" });
    check("second assign blocked (ok:false)", a2.ok === false, JSON.stringify(a2));
    check("blocked reason=not_assignable", a2.ok === false && a2.reason === "not_assignable",
      JSON.stringify(a2));
    const stillA = (await db.select().from(ordersTable).where(eq(ordersTable.id, ORDER)))[0]!;
    check("driver unchanged after blocked assign", stillA.driverUid === D_A, String(stillA.driverUid));

    // ── 4. claim succeeds once ──────────────────────────────────────────────
    console.log("[4] pgClaimFcmDispatch — succeeds once");
    const c1 = await pgClaimFcmDispatch(ORDER, "instance-A");
    check("first claim ok", c1.ok === true, JSON.stringify(c1));
    const afterClaim = (await db.select().from(ordersTable).where(eq(ordersTable.id, ORDER)))[0]!;
    check("fcm_dispatch_claimed_at set", afterClaim.fcmDispatchClaimedAt != null);
    check("fcm_dispatch_claimed_by=instance-A", afterClaim.fcmDispatchClaimedBy === "instance-A",
      String(afterClaim.fcmDispatchClaimedBy));

    // ── 5. duplicate claim blocked ──────────────────────────────────────────
    console.log("[5] pgClaimFcmDispatch — duplicate blocked");
    const c2 = await pgClaimFcmDispatch(ORDER, "instance-B");
    check("duplicate claim blocked (ok:false)", c2.ok === false, JSON.stringify(c2));
    check("blocked reason=already_claimed", c2.ok === false && c2.reason === "already_claimed",
      JSON.stringify(c2));
    const afterDup = (await db.select().from(ordersTable).where(eq(ordersTable.id, ORDER)))[0]!;
    check("claimed_by still instance-A", afterDup.fcmDispatchClaimedBy === "instance-A",
      String(afterDup.fcmDispatchClaimedBy));
    const cMissing = await pgClaimFcmDispatch(`${PREFIX}_NOPE`, "instance-A");
    check("claim on missing order → order_missing", cMissing.ok === false && cMissing.reason === "order_missing",
      JSON.stringify(cMissing));

    // ── 6. timeout query finds expired ──────────────────────────────────────
    console.log("[6] pgCheckExpiredDispatches — finds expired");
    // Force the dispatch timeout into the past for ORDER.
    await db.update(ordersTable)
      .set({ dispatchTimeoutAt: new Date(Date.now() - 60_000) })
      .where(eq(ordersTable.id, ORDER));
    const expired = await pgCheckExpiredDispatches();
    check("expired list includes our order", expired.some((o) => o.id === ORDER),
      `ids=${JSON.stringify(expired.map((o) => o.id))}`);
    check("expired entries are all dispatched+past",
      expired.every((o) => o.status === "dispatched" && o.dispatchTimeoutAt != null && o.dispatchTimeoutAt.getTime() <= Date.now()));

    // ── 7. return-to-pool succeeds then guarded ─────────────────────────────
    console.log("[7] pgReturnOrderToPool — succeeds then guarded");
    const r1 = await pgReturnOrderToPool(ORDER);
    check("return-to-pool ok", r1.ok === true, JSON.stringify(r1));
    const afterReturn = (await db.select().from(ordersTable).where(eq(ordersTable.id, ORDER)))[0]!;
    check("status back to searching", afterReturn.status === "searching", afterReturn.status);
    check("driver_uid cleared", afterReturn.driverUid === null, String(afterReturn.driverUid));
    check("claim fields cleared", afterReturn.fcmDispatchClaimedAt === null && afterReturn.fcmDispatchClaimedBy === null);
    const offersAfter = await db.select().from(orderOffersTable)
      .where(eq(orderOffersTable.orderId, ORDER));
    check("pending offers marked timed_out", offersAfter.every((o) => o.status !== "pending"),
      JSON.stringify(offersAfter.map((o) => o.status)));
    const r2 = await pgReturnOrderToPool(ORDER);
    check("second return blocked (ok:false)", r2.ok === false, JSON.stringify(r2));
    check("blocked reason=not_dispatched", r2.ok === false && r2.reason === "not_dispatched",
      JSON.stringify(r2));

  } finally {
    await cleanup();
    console.log("\n(cleanup complete — all TEST_5EA_* rows removed)");
  }

  console.log(`\n=== RESULTS ===\npass: ${pass}\nfail: ${fail}`);
  if (fail > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }

  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
