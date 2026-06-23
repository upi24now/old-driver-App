/**
 * Phase 5C-B verification harness — PG TIMEOUT SHADOW.
 *
 * READ-ONLY. Exercises the timeout validator across multiple timeout scenarios
 * and prints match / diff / error counts plus the exact reason for every diff.
 * Touches nothing in Firestore and performs only SELECTs against PG.
 *
 * Two parts:
 *   1. Deterministic scenario matrix — drives the pure comparison + guard logic
 *      through a valid-timeout match case and every required diff reason:
 *      not yet expired, already accepted, already rejected, already timed out,
 *      missing offer, order id mismatch (plus value-mismatch coverage).
 *   2. Live read-path cycles — calls readPgTimeoutInputs() against the REAL PG
 *      for existing orders, confirming the production read path runs.
 */

import { db, ordersTable, pool } from "@workspace/db";
import {
  compareTimeout,
  evaluatePgTimeout,
  readPgTimeoutInputs,
  type FsTimeout,
  type PgTimeoutInputs,
} from "../lib/pg-timeout-shadow";

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
const dispatchTimeoutAt = now - 1000; // dispatch deadline already elapsed (timed out)

// A clean PG input set describing an order whose offer to "a" has expired.
function pgInputs(over: Partial<PgTimeoutInputs> = {}): PgTimeoutInputs {
  return {
    orderId:                  "order-1",
    orderExists:              true,
    orderStatus:              "searching", // FS just reset it; tolerated
    orderDispatchTimeoutAtMs: dispatchTimeoutAt,
    offerExists:              true,
    offerDriverUid:           "a",
    offerStatus:              "pending",
    offerExpiresAtMs:         dispatchTimeoutAt,
    nowMs:                    now,
    ...over,
  };
}

// A clean Firestore timeout: driver "a" timed out, order returned to pool.
function fsTimeout(over: Partial<FsTimeout> = {}): FsTimeout {
  return {
    orderId:             "order-1",
    driverUid:           "a",
    dispatchTimeoutAtMs: dispatchTimeoutAt,
    eligible:            true,
    returnedToPool:      true,
    ...over,
  };
}

function run(
  label:        string,
  fs:           FsTimeout,
  pg:           PgTimeoutInputs,
  expect:       "match" | "diff",
  expectReason?: string,
): void {
  let res;
  try {
    res = compareTimeout(fs, pg);
  } catch {
    record("error");
    console.log(`  [ERROR]  ${label}`);
    return;
  }
  record(res.outcome, res.reason);
  const ok = res.outcome === expect && (expectReason === undefined || res.reason === expectReason);
  const tag = res.outcome === "match" ? "MATCH" : `DIFF(${res.reason})`;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(36)} → ${tag}  pgEligible=${res.pgEligible}`);
}

console.log("=== PART 1: deterministic timeout scenario matrix ===");

// 1. Valid timeout — FS and PG agree: offer expired, return order to pool.
run("valid timeout", fsTimeout(), pgInputs(), "match");

// 2. Valid timeout while PG order still shows "dispatched" (pre-reset race).
run("valid timeout (order dispatched)", fsTimeout(), pgInputs({ orderStatus: "dispatched" }), "match");

// 3. Not yet expired — PG offer deadline is still in the future.
run(
  "not yet expired",
  fsTimeout(),
  pgInputs({ offerExpiresAtMs: now + 60 * 1000, orderDispatchTimeoutAtMs: now + 60 * 1000 }),
  "diff",
  "not yet expired",
);

// 4. Already accepted — driver accepted the offer; PG would not time out.
run(
  "already accepted",
  fsTimeout(),
  pgInputs({ offerStatus: "accepted" }),
  "diff",
  "already accepted",
);

// 5. Already rejected — driver rejected the offer.
run(
  "already rejected",
  fsTimeout(),
  pgInputs({ offerStatus: "rejected" }),
  "diff",
  "already rejected",
);

// 6. Already timed out — offer already in terminal timed_out state.
run(
  "already timed out",
  fsTimeout(),
  pgInputs({ offerStatus: "timed_out" }),
  "diff",
  "already timed out",
);

// 7. Missing offer — no PG offer row for the timed-out driver.
run(
  "missing offer",
  fsTimeout(),
  pgInputs({ offerExists: false, offerDriverUid: null, offerStatus: null, offerExpiresAtMs: null }),
  "diff",
  "missing offer",
);

// 8. Order id mismatch — FS order id differs from the PG inputs' order id.
run(
  "order id mismatch",
  fsTimeout({ orderId: "order-1" }),
  pgInputs({ orderId: "order-2" }),
  "diff",
  "order id mismatch",
);

// ── Additional coverage (order existence + value drift) ─────────────────────────

// 9. Order missing in PG.
run(
  "order missing in PG",
  fsTimeout(),
  pgInputs({ orderExists: false, orderStatus: null, orderDispatchTimeoutAtMs: null, offerExists: false, offerDriverUid: null, offerStatus: null, offerExpiresAtMs: null }),
  "diff",
  "order missing in PG",
);

// 9b. Driver uid mismatch — PG offer row belongs to a different driver.
run(
  "driver uid mismatch",
  fsTimeout({ driverUid: "a" }),
  pgInputs({ offerDriverUid: "b" }),
  "diff",
  "driver uid mismatch",
);

// 9c. Dispatch timeout missing — order has no dispatch_timeout_at in PG.
run(
  "dispatch timeout missing",
  fsTimeout(),
  pgInputs({ orderDispatchTimeoutAtMs: null }),
  "diff",
  "dispatch timeout missing",
);

// 10. Order not eligible — order in a non-dispatch status (e.g. delivered).
run(
  "order not eligible",
  fsTimeout(),
  pgInputs({ orderStatus: "delivered" }),
  "diff",
  "order not eligible",
);

// 11. Dispatch timeout value mismatch — FS deadline far from PG order deadline.
run(
  "dispatch timeout value mismatch",
  fsTimeout({ dispatchTimeoutAtMs: now - 10 * 60 * 1000 }),
  pgInputs({ orderDispatchTimeoutAtMs: dispatchTimeoutAt, offerExpiresAtMs: now - 10 * 60 * 1000 }),
  "diff",
  "dispatch timeout value mismatch",
);

// 12. Offer expiry value mismatch — FS deadline matches order row but not the offer.
run(
  "offer expiry value mismatch",
  fsTimeout({ dispatchTimeoutAtMs: dispatchTimeoutAt }),
  pgInputs({ orderDispatchTimeoutAtMs: dispatchTimeoutAt, offerExpiresAtMs: now - 10 * 60 * 1000 }),
  "diff",
  "offer expiry value mismatch",
);

// ── Pure guard function smoke checks ────────────────────────────────────────────
console.log("=== timeout reproduction (pure) ===");
{
  const g1 = evaluatePgTimeout(pgInputs());
  console.log(`  ${g1.eligible && g1.returnToPool ? "✓" : "✗"} eligible+returnToPool on expired pending offer → ${g1.eligible}/${g1.returnToPool}`);
  const g2 = evaluatePgTimeout(pgInputs({ offerStatus: "accepted" }));
  console.log(`  ${!g2.eligible && g2.reason === "already accepted" ? "✓" : "✗"} accepted offer blocks timeout → ${g2.reason}`);
  const g3 = evaluatePgTimeout(pgInputs({ offerExpiresAtMs: now + 60_000 }));
  console.log(`  ${!g3.eligible && g3.reason === "not yet expired" ? "✓" : "✗"} unexpired offer blocks timeout → ${g3.reason}`);
}

// ── PART 2: live read-path cycles (real PG, read-only) ──────────────────────────
async function livePart(): Promise<void> {
  console.log("=== PART 2: live read-path cycles (real PG, read-only) ===");

  const orderRows = await db
    .select({ id: ordersTable.id, driverUid: ordersTable.driverUid })
    .from(ordersTable)
    .limit(5);

  if (orderRows.length === 0) {
    console.log("  (no PG orders — skipping live read path)");
    return;
  }

  for (const { id, driverUid } of orderRows) {
    const inputs = await readPgTimeoutInputs(id, driverUid ?? "none");
    console.log(
      `  readPgTimeoutInputs(${id}) ok → orderStatus=${inputs.orderStatus}` +
      ` offer=${inputs.offerExists} offerStatus=${inputs.offerStatus}`,
    );
    // Validate a synthetic FS timeout against the live read (read-only, no writes).
    const fs = fsTimeout({
      orderId:             id,
      driverUid:           driverUid ?? "none",
      dispatchTimeoutAtMs: inputs.orderDispatchTimeoutAtMs ?? Date.now() - 1000,
    });
    const res = compareTimeout(fs, { ...inputs, orderId: id });
    record(res.outcome, res.reason);
    console.log(`    live compare → [${res.outcome}${res.reason ? `:${res.reason}` : ""}]`);
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
