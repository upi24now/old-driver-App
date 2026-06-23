/**
 * Phase 5B verification harness — PG dispatcher SHADOW MODE.
 *
 * READ-ONLY. Exercises the shadow comparator across multiple simulated dispatch
 * cycles and prints match / diff / error counts plus the exact reason for every
 * diff. Touches nothing in Firestore and performs only SELECTs against PG.
 *
 * Two parts:
 *   1. Deterministic scenario matrix — drives the pure comparison logic through
 *      a match case and every diff reason (missing driver, subscription
 *      mismatch, rejected list mismatch, offer history mismatch, different
 *      candidate pool, online count mismatch) plus timeout match/diff.
 *   2. Live read-path cycles — calls readPgSnapshot() against the REAL PG and
 *      replays several round-robin cycles over the live online drivers,
 *      confirming the production read path runs and reproduces the decision.
 */

import { db, ordersTable, pool } from "@workspace/db";
import {
  compareDispatchDecision,
  compareTimeoutDecision,
  readPgSnapshot,
  selectPgCandidate,
  type FsDecision,
  type PgSnapshot,
  type ShadowDriver,
} from "../lib/pg-dispatch-shadow";

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
const past = now - 60 * 60 * 1000;

const drv = (uid: string, expiry: number | null): ShadowDriver => ({
  uid,
  subscriptionExpiresAtMs: expiry,
});

// A baseline pool of three subscribed, online drivers (a,b,c).
const baseDrivers: ShadowDriver[] = [drv("a", future), drv("b", future), drv("c", future)];
const basePool = ["a", "b", "c"];

function pgSnap(over: Partial<PgSnapshot> = {}): PgSnapshot {
  return {
    onlineDrivers: baseDrivers,
    rejectedBy: [],
    offerHistoryRejected: [],
    nowMs: now,
    ...over,
  };
}

function run(label: string, fs: FsDecision, pg: PgSnapshot, expect: "match" | "diff", expectReason?: string): void {
  let res;
  try {
    res = compareDispatchDecision(fs, pg);
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

// 1. Perfect match — FS and PG see identical state, cursor null → both pick "a".
run(
  "match (identical state)",
  { firestoreDriver: "a", pool: basePool, rejectedBy: [], lastUid: null, onlineCount: 3 },
  pgSnap(),
  "match",
);

// 2. Match with round-robin cursor — lastUid="a" → both pick "b".
run(
  "match (cursor advance)",
  { firestoreDriver: "b", pool: basePool, rejectedBy: [], lastUid: "a", onlineCount: 3 },
  pgSnap(),
  "match",
);

// 3. Missing driver — FS chose "d" which PG does not see online at all.
run(
  "diff: missing driver",
  { firestoreDriver: "d", pool: ["d"], rejectedBy: [], lastUid: null, onlineCount: 1 },
  pgSnap({ onlineDrivers: [], }),
  "diff",
  "missing driver",
);

// 4. Subscription mismatch — FS chose "a", but in PG "a"'s subscription expired.
run(
  "diff: subscription mismatch",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 3 },
  pgSnap({ onlineDrivers: [drv("a", past), drv("b", future), drv("c", future)] }),
  "diff",
  "subscription mismatch",
);

// 4b. Legacy subscription passthrough — PG stores a Firestore `0` as Date(0)
//     (0 ms). Firestore's `expiry === 0 || expiry > now` rule lets that driver
//     through, so the shadow MUST also treat 0 as legacy-allowed (not expired).
run(
  "match (legacy expiry=0)",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 3 },
  pgSnap({ onlineDrivers: [drv("a", 0), drv("b", future), drv("c", future)] }),
  "match",
);

// 5. Rejected list mismatch — PG order has an extra rejected driver.
run(
  "diff: rejected list mismatch",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 3 },
  pgSnap({ rejectedBy: ["c"], offerHistoryRejected: ["c"] }),
  "diff",
  "rejected list mismatch",
);

// 6. Offer history mismatch — rejected_by matches FS, but order_offers history
//    records a rejection that rejected_by[] does not (drift between the two).
run(
  "diff: offer history mismatch",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 3 },
  pgSnap({ rejectedBy: [], offerHistoryRejected: ["b"] }),
  "diff",
  "offer history mismatch",
);

// 7. Different candidate pool — PG sees an extra eligible driver "z" so pools
//    differ even though the chosen head ("a") still matches.
run(
  "diff: different candidate pool",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 4 },
  pgSnap({ onlineDrivers: [...baseDrivers, drv("z", future)] }),
  "diff",
  "different candidate pool",
);

// 8. Online count mismatch — same eligible pool & choice, but FS counted a
//    different number of online drivers (e.g. an offline-but-counted driver).
run(
  "diff: online count mismatch",
  { firestoreDriver: "a", pool: ["a", "b", "c"], rejectedBy: [], lastUid: null, onlineCount: 5 },
  pgSnap(),
  "diff",
  "online count mismatch",
);

// ── Timeout eligibility ───────────────────────────────────────────────────────
console.log("=== timeout eligibility ===");
{
  const t1 = compareTimeoutDecision(true, past, now); // FS timed out, PG offer expired → match
  record(t1.outcome, t1.reason);
  console.log(`  ${t1.outcome === "match" ? "✓" : "✗"} timeout match (offer expired)   → ${t1.outcome}`);

  const t2 = compareTimeoutDecision(true, future, now); // FS timed out, PG offer still valid → diff
  record(t2.outcome, t2.reason);
  console.log(`  ${t2.outcome === "diff" ? "✓" : "✗"} timeout diff (offer still valid) → ${t2.outcome}(${t2.reason})`);
}

// ── PART 2: live read-path cycles against REAL PG (read-only) ─────────────────
async function livePart(): Promise<void> {
  console.log("=== PART 2: live read-path cycles (real PG, read-only) ===");

  // Pick a few real order ids to drive readPgSnapshot through the production path.
  const orderRows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .limit(5);

  if (orderRows.length === 0) {
    console.log("  (no orders in PG to sample — skipping live snapshot reads)");
  }

  let liveSnapshot: PgSnapshot | null = null;
  for (const { id } of orderRows) {
    try {
      const snap = await readPgSnapshot(id);
      if (!liveSnapshot) liveSnapshot = snap;
      console.log(
        `  readPgSnapshot(${id}) ok → online=${snap.onlineDrivers.length} rejected=${snap.rejectedBy.length} offerHist=${snap.offerHistoryRejected.length}`,
      );
    } catch {
      record("error");
      console.log(`  [ERROR] readPgSnapshot(${id}) threw`);
    }
  }

  // Replay several round-robin cycles over the live online drivers. We simulate
  // the FS decision as "what PG itself would pick" for each successive cursor,
  // proving the comparator reports MATCH when both stores agree (the expected
  // steady-state in shadow mode). This is the multi-cycle dispatch simulation.
  if (liveSnapshot && liveSnapshot.onlineDrivers.length > 0) {
    let cursor: string | null = null;
    const cycles = Math.min(6, Math.max(3, liveSnapshot.onlineDrivers.length * 2));
    console.log(`  replaying ${cycles} round-robin cycles over ${liveSnapshot.onlineDrivers.length} live online driver(s)`);

    for (let i = 0; i < cycles; i++) {
      const sel = selectPgCandidate(
        liveSnapshot.onlineDrivers,
        liveSnapshot.rejectedBy,
        cursor,
        liveSnapshot.nowMs,
      );
      if (!sel.chosen) { console.log(`  cycle ${i + 1}: no eligible driver`); break; }

      const fs: FsDecision = {
        firestoreDriver: sel.chosen,
        pool: sel.pool,
        rejectedBy: liveSnapshot.rejectedBy,
        lastUid: cursor,
        onlineCount: liveSnapshot.onlineDrivers.length,
      };
      const res = compareDispatchDecision(fs, liveSnapshot);
      record(res.outcome, res.reason);
      console.log(`  cycle ${i + 1}: cursor=${cursor ?? "∅"} → chose ${sel.chosen}  [${res.outcome}]`);
      cursor = sel.chosen;
    }
  } else {
    console.log("  (no live online drivers — round-robin cycle replay skipped)");
  }
}

async function main(): Promise<void> {
  try {
    await livePart();
  } catch (err) {
    record("error");
    console.error("  live part fatal error:", err);
  }

  console.log("\n=== VERIFICATION RESULTS ===");
  console.log(`match count : ${match}`);
  console.log(`diff count  : ${diff}`);
  console.log(`error count : ${error}`);
  if (diffReasons.length > 0) {
    console.log("diff reasons:");
    for (const r of diffReasons) console.log(`  - ${r}`);
  }

  await pool.end().catch(() => {});
  process.exit(0);
}

void main();
