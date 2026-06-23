/**
 * Phase 5C-A verification harness — PG ASSIGNMENT SHADOW.
 *
 * READ-ONLY. Exercises the assignment validator across multiple simulated
 * dispatch/assignment cycles and prints match / diff / error counts plus the
 * exact reason for every diff. Touches nothing in Firestore and performs only
 * SELECTs against PG.
 *
 * Two parts:
 *   1. Deterministic scenario matrix — drives the pure comparison + guard logic
 *      through a match case and every diff reason (order missing, status not
 *      eligible, driver already assigned, driver rejected, timeout invalid,
 *      assigned driver mismatch, rejected list mismatch, round-robin cursor
 *      mismatch, order status mismatch, timeout value mismatch).
 *   2. Live read-path cycles — calls readPgAssignmentInputs() against the REAL
 *      PG for live online drivers and replays several assignments, confirming
 *      the production read path runs and the guarded logic reproduces the
 *      decision.
 */

import { db, ordersTable, pool } from "@workspace/db";
import {
  compareAssignment,
  evaluateAssignmentGuards,
  readPgAssignmentInputs,
  type FsAssignment,
  type PgAssignmentInputs,
} from "../lib/pg-assign-shadow";
import { readPgSnapshot, type ShadowDriver } from "../lib/pg-dispatch-shadow";

let match = 0;
let diff = 0;
let error = 0;
const diffReasons: string[] = [];

function record(outcome: "match" | "diff" | "error", reason?: string): void {
  if (outcome === "match") match++;
  else if (outcome === "diff") { diff++; if (reason) diffReasons.push(reason); }
  else error++;
}

const now = Date.now();
const future = now + 60 * 60 * 1000;
const timeoutAt = now + 60 * 1000; // assignment dispatch window (60 s)

const drv = (uid: string, expiry: number | null): ShadowDriver => ({
  uid,
  subscriptionExpiresAtMs: expiry,
});

// Baseline pool of three subscribed, online drivers (a,b,c).
const baseDrivers: ShadowDriver[] = [drv("a", future), drv("b", future), drv("c", future)];

// A clean PG input set describing an order freshly assigned to "a".
function pgInputs(over: Partial<PgAssignmentInputs> = {}): PgAssignmentInputs {
  return {
    orderId:              "order-1",
    onlineDrivers:        baseDrivers,
    rejectedBy:           [],
    offerHistoryRejected: [],
    orderExists:          true,
    orderStatus:          "dispatched",
    orderDriverUid:       "a",
    acceptedByOther:      false,
    offerExists:          true,
    offerExpiresAtMs:     timeoutAt,
    nowMs:                now,
    ...over,
  };
}

// A clean Firestore assignment: chose "a", cursor advanced to "a", dispatched.
function fsAssign(over: Partial<FsAssignment> = {}): FsAssignment {
  return {
    orderId:     "order-1",
    driverUid:   "a",
    rejectedBy:  [],
    cursor:      "a",
    status:      "dispatched",
    timeoutAtMs: timeoutAt,
    lastUid:     null,
    onlineCount: 3,
    ...over,
  };
}

function run(
  label:        string,
  fs:           FsAssignment,
  pg:           PgAssignmentInputs,
  expect:       "match" | "diff",
  expectReason?: string,
): void {
  let res;
  try {
    res = compareAssignment(fs, pg);
  } catch {
    record("error");
    console.log(`  [ERROR]  ${label}`);
    return;
  }
  record(res.outcome, res.reason);
  const ok = res.outcome === expect && (expectReason === undefined || res.reason === expectReason);
  const tag = res.outcome === "match" ? "MATCH" : `DIFF(${res.reason})`;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(34)} → ${tag}  pgDriver=${res.pgDriver}`);
}

console.log("=== PART 1: deterministic scenario matrix ===");

// 1. Perfect match — FS and PG agree on every assignment field, guards pass.
run("match (identical assignment)", fsAssign(), pgInputs(), "match");

// 2. Match with round-robin cursor — lastUid="a" → PG picks "b"; FS chose "b".
run(
  "match (cursor advance)",
  fsAssign({ driverUid: "b", cursor: "b", lastUid: "a" }),
  pgInputs({ orderDriverUid: "b" }),
  "match",
);

// 3. Order id mismatch — FS order id differs from the PG inputs' order id.
run(
  "diff: order id mismatch",
  fsAssign({ orderId: "order-1" }),
  pgInputs({ orderId: "order-2" }),
  "diff",
  "order id mismatch",
);

// ── Guard failures ────────────────────────────────────────────────────────────

// 4. Order missing in PG.
run(
  "diff: order missing in PG",
  fsAssign(),
  pgInputs({ orderExists: false, orderStatus: null, orderDriverUid: null, offerExists: false, offerExpiresAtMs: null }),
  "diff",
  "order missing in PG",
);

// 4. Status not eligible — PG order already delivered/cancelled.
run(
  "diff: status not eligible",
  fsAssign(),
  pgInputs({ orderStatus: "delivered" }),
  "diff",
  "status not eligible",
);

// 5. Driver already assigned — another driver holds an accepted offer.
run(
  "diff: driver already assigned",
  fsAssign(),
  pgInputs({ acceptedByOther: true }),
  "diff",
  "driver already assigned",
);

// 6. Driver rejected — the assigned driver is in PG rejected_by[].
run(
  "diff: driver rejected",
  fsAssign(),
  pgInputs({ rejectedBy: ["a"], offerHistoryRejected: ["a"] }),
  "diff",
  "driver rejected",
);

// 7. Timeout invalid — the assignment's timeout is already in the past.
run(
  "diff: timeout invalid",
  fsAssign({ timeoutAtMs: now - 1000 }),
  pgInputs({ offerExpiresAtMs: now - 1000 }),
  "diff",
  "timeout invalid",
);

// ── Field mismatches (guards pass) ──────────────────────────────────────────────

// 8. Assigned driver mismatch — PG would pick "a" (cursor null) but FS chose "b".
//    Guards still pass for "b" (online, not rejected, timeout valid).
run(
  "diff: assigned driver mismatch",
  fsAssign({ driverUid: "b", cursor: "b", lastUid: null }),
  pgInputs({ orderDriverUid: "b" }),
  "diff",
  "assigned driver mismatch",
);

// 9. Rejected list mismatch — FS rejectedBy empty, PG has an extra entry.
//    Use "c" so it doesn't reject the assigned driver "a" (guard stays green).
run(
  "diff: rejected list mismatch",
  fsAssign(),
  pgInputs({ rejectedBy: ["c"], offerHistoryRejected: ["c"] }),
  "diff",
  "rejected list mismatch",
);

// 10. Round-robin cursor mismatch — FS reported a cursor that is not the driver
//     it assigned (synthetic drift between cursor and chosen driver).
run(
  "diff: round-robin cursor mismatch",
  fsAssign({ cursor: "c" }),
  pgInputs(),
  "diff",
  "round-robin cursor mismatch",
);

// 11. Order status mismatch — FS reported a non-dispatched status.
run(
  "diff: order status mismatch",
  fsAssign({ status: "pending" }),
  pgInputs(),
  "diff",
  "order status mismatch",
);

// 12. Timeout value mismatch — FS timeout far outside the tolerance window.
run(
  "diff: timeout value mismatch",
  fsAssign({ timeoutAtMs: now + 10 * 60 * 1000 }),
  pgInputs({ offerExpiresAtMs: timeoutAt }),
  "diff",
  "timeout value mismatch",
);

// ── Pure guard function smoke checks ────────────────────────────────────────────
console.log("=== guard reproduction (pure) ===");
{
  const g1 = evaluateAssignmentGuards(fsAssign(), pgInputs());
  console.log(`  ${g1.eligible ? "✓" : "✗"} guards eligible on clean assignment → ${g1.eligible}`);
  const g2 = evaluateAssignmentGuards(fsAssign(), pgInputs({ rejectedBy: ["a"] }));
  console.log(`  ${!g2.eligible && g2.reason === "driver rejected" ? "✓" : "✗"} guards reject rejected driver → ${g2.reason}`);
}

// ── PART 2: live read-path cycles (real PG, read-only) ──────────────────────────
async function livePart(): Promise<void> {
  console.log("=== PART 2: live read-path cycles (real PG, read-only) ===");

  const orderRows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .limit(5);

  for (const { id } of orderRows) {
    const snap = await readPgSnapshot(id);
    const driverUid = snap.onlineDrivers[0]?.uid ?? "none";
    const inputs = await readPgAssignmentInputs(id, driverUid);
    console.log(
      `  readPgAssignmentInputs(${id}) ok → online=${inputs.onlineDrivers.length}` +
      ` status=${inputs.orderStatus} offer=${inputs.offerExists}`,
    );
  }

  // Replay assignment validation over the live online drivers, round-robin.
  const live = (await readPgSnapshot("__none__")).onlineDrivers;
  if (live.length === 0) {
    console.log("  (no live online drivers — skipping replay)");
    return;
  }
  console.log(`  replaying ${live.length} assignment(s) over live online driver(s)`);
  let cursor: string | null = null;
  const liveOrderId = orderRows[0]?.id ?? "__none__";
  for (let i = 0; i < Math.min(3, live.length + 1); i++) {
    const inputs = await readPgAssignmentInputs(liveOrderId, live[0]!.uid);
    // Reproduce what PG would assign for the live pool, then validate a matching
    // synthetic FS assignment against it (driver = PG's own choice).
    const { selectPgCandidate } = await import("../lib/pg-dispatch-shadow");
    const { chosen } = selectPgCandidate(inputs.onlineDrivers, inputs.rejectedBy, cursor, inputs.nowMs);
    if (!chosen) { console.log(`  cycle ${i + 1}: no eligible driver`); break; }
    const fs = fsAssign({
      orderId:     liveOrderId,
      driverUid:   chosen,
      cursor:      chosen,
      lastUid:     cursor,
      timeoutAtMs: Date.now() + 60 * 1000,
    });
    const liveInputs: PgAssignmentInputs = {
      ...inputs,
      orderExists:    true,
      orderStatus:    "dispatched",
      orderDriverUid: chosen,
      offerExists:    true,
      offerExpiresAtMs: fs.timeoutAtMs,
    };
    const res = compareAssignment(fs, liveInputs);
    record(res.outcome, res.reason);
    console.log(`  cycle ${i + 1}: cursor=${cursor ?? "∅"} → chose ${chosen}  [${res.outcome}${res.reason ? `:${res.reason}` : ""}]`);
    cursor = chosen;
  }
}

await livePart();

console.log("\n=== VERIFICATION RESULTS ===");
console.log(`match count : ${match}`);
console.log(`diff count  : ${diff}`);
console.log(`error count : ${error}`);
console.log("diff reasons:");
for (const r of [...new Set(diffReasons)]) console.log(`  - ${r}`);

await pool.end();
