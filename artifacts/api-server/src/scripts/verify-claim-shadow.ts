/**
 * Phase 5C-C verification harness — PG FCM CLAIM SHADOW.
 *
 * READ-ONLY. Exercises the claim validator across every required scenario and
 * prints match / diff / error counts plus the exact reason for every diff.
 * Touches nothing in Firestore and performs only SELECTs against PG.
 *
 * Two parts:
 *   1. Deterministic scenario matrix — drives the pure comparison + guard logic
 *      through a valid-claim match case and every required diff reason:
 *      already claimed, no target drivers, missing PG token, Firestore token
 *      fallback, missing order, mismatched active offer list, mismatched
 *      claimedBy, mismatched messageId (plus target/order-id coverage).
 *   2. Live read-path cycles — calls readPgClaimInputs() against the REAL PG for
 *      existing orders, confirming the production read path runs.
 */

import { db, ordersTable, pool } from "@workspace/db";
import {
  compareClaim,
  evaluatePgClaim,
  readPgClaimInputs,
  resolveTokenOutcome,
  type FsClaim,
  type PgClaimInputs,
} from "../lib/pg-claim-shadow";

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
const INSTANCE = "instance-A";
const MESSAGE_ID = "msg-123";

// A clean PG input set: order "order-1" dispatched, offer to "a", PG token
// present, no prior claim. claim-result fields mirror Firestore's values so the
// valid-claim case is a clean MATCH.
function pgInputs(over: Partial<PgClaimInputs> = {}): PgClaimInputs {
  return {
    orderId:               "order-1",
    orderExists:           true,
    orderStatus:           "dispatched",
    activeOfferDriverUids: ["a"],
    targetDriverUid:       "a",
    priorClaimPresent:     false,
    claimedAtMs:           now,
    claimedBy:             INSTANCE,
    messageId:             MESSAGE_ID,
    pgTokenPresent:        true,
    nowMs:                 now,
    ...over,
  };
}

// A clean Firestore claim: order "order-1" claimed by INSTANCE, sent to "a".
function fsClaim(over: Partial<FsClaim> = {}): FsClaim {
  return {
    orderId:               "order-1",
    claimed:               true,
    claimedBy:             INSTANCE,
    claimedAtMs:           now,
    messageId:             MESSAGE_ID,
    activeOfferDriverUids: ["a"],
    targetDriverUid:       "a",
    tokenPresent:          true,
    ...over,
  };
}

function run(
  label:         string,
  fs:            FsClaim,
  pg:            PgClaimInputs,
  expect:        "match" | "diff",
  expectReason?: string,
): void {
  let res;
  try {
    res = compareClaim(fs, pg);
  } catch {
    record("error");
    console.log(`  [ERROR]  ${label}`);
    return;
  }
  record(res.outcome, res.reason);
  const ok = res.outcome === expect && (expectReason === undefined || res.reason === expectReason);
  const tag = res.outcome === "match" ? "MATCH" : `DIFF(${res.reason})`;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(34)} → ${tag}  token=${res.tokenOutcome}`);
}

console.log("=== PART 1: deterministic claim scenario matrix ===");

// 1. Valid claim — FS and PG agree: dispatched, target in offer, PG token, no prior claim.
run("valid claim", fsClaim(), pgInputs(), "match");

// 2. Already claimed — PG already holds a claim (same identity) → PG would skip.
run(
  "already claimed",
  fsClaim(),
  pgInputs({ priorClaimPresent: true }),
  "diff",
  "already claimed",
);

// 3. No target drivers — PG offer set empty.
run(
  "no target drivers",
  fsClaim(),
  pgInputs({ activeOfferDriverUids: [] }),
  "diff",
  "no target drivers",
);

// 4. Missing PG token — neither PG nor Firestore has a usable token.
run(
  "missing PG token",
  fsClaim({ tokenPresent: false }),
  pgInputs({ pgTokenPresent: false }),
  "diff",
  "pg token missing",
);

// 5. Firestore token fallback — PG token absent but Firestore still has one.
run(
  "firestore token fallback",
  fsClaim({ tokenPresent: true }),
  pgInputs({ pgTokenPresent: false }),
  "diff",
  "firestore token fallback",
);

// 6. Missing order — order row absent in PG.
run(
  "missing order",
  fsClaim(),
  pgInputs({ orderExists: false, orderStatus: null, activeOfferDriverUids: null }),
  "diff",
  "order missing in PG",
);

// 7. Mismatched active offer list — PG offer set differs from Firestore's.
run(
  "mismatched active offer list",
  fsClaim({ activeOfferDriverUids: ["a", "b"] }),
  pgInputs({ activeOfferDriverUids: ["a", "c"] }),
  "diff",
  "active offer list mismatch",
);

// 8. Mismatched claimedBy — PG mirrored a claim from a different instance.
run(
  "mismatched claimedBy",
  fsClaim({ claimedBy: INSTANCE }),
  pgInputs({ priorClaimPresent: true, claimedBy: "instance-B" }),
  "diff",
  "claimed by mismatch",
);

// 9. Mismatched messageId — PG mirrored a different fcm message id.
run(
  "mismatched messageId",
  fsClaim({ messageId: MESSAGE_ID }),
  pgInputs({ priorClaimPresent: true, messageId: "msg-999" }),
  "diff",
  "message id mismatch",
);

// ── Additional coverage ─────────────────────────────────────────────────────────

// 10. Order not dispatched — order in a non-dispatch status.
run(
  "order not dispatched",
  fsClaim(),
  pgInputs({ orderStatus: "searching" }),
  "diff",
  "order not dispatched",
);

// 11. Target not in active offer — target driver absent from the offer set.
run(
  "target not in active offer",
  fsClaim({ targetDriverUid: "a", activeOfferDriverUids: ["a"] }),
  pgInputs({ targetDriverUid: "a", activeOfferDriverUids: ["b"] }),
  "diff",
  "target not in active offer",
);

// 12. Order id mismatch — FS order id differs from the PG inputs' order id.
run(
  "order id mismatch",
  fsClaim({ orderId: "order-1" }),
  pgInputs({ orderId: "order-2" }),
  "diff",
  "order id mismatch",
);

// 13. Claimed at drift — PG mirrored claim time far from Firestore's.
run(
  "claimed at mismatch",
  fsClaim({ claimedAtMs: now }),
  pgInputs({ priorClaimPresent: true, claimedAtMs: now - 10 * 60 * 1000 }),
  "diff",
  "claimed at mismatch",
);

// ── Pure guard + token function smoke checks ─────────────────────────────────────
console.log("=== claim reproduction (pure) ===");
{
  const g1 = evaluatePgClaim(pgInputs());
  console.log(`  ${g1.claimEligible ? "✓" : "✗"} eligible on dispatched+offered+unclaimed → ${g1.claimEligible}`);
  const g2 = evaluatePgClaim(pgInputs({ priorClaimPresent: true }));
  console.log(`  ${!g2.claimEligible && g2.reason === "already claimed" && !g2.structural ? "✓" : "✗"} prior claim blocks (non-structural) → ${g2.reason}`);
  const g3 = evaluatePgClaim(pgInputs({ orderExists: false }));
  console.log(`  ${!g3.claimEligible && g3.structural ? "✓" : "✗"} missing order blocks (structural) → ${g3.reason}`);
  const t1 = resolveTokenOutcome(fsClaim(), pgInputs());
  console.log(`  ${t1 === "pg_hit" ? "✓" : "✗"} PG token present → ${t1}`);
  const t2 = resolveTokenOutcome(fsClaim({ tokenPresent: true }), pgInputs({ pgTokenPresent: false }));
  console.log(`  ${t2 === "fs_fallback" ? "✓" : "✗"} PG absent, FS present → ${t2}`);
  const t3 = resolveTokenOutcome(fsClaim({ tokenPresent: false }), pgInputs({ pgTokenPresent: false }));
  console.log(`  ${t3 === "missing" ? "✓" : "✗"} neither store → ${t3}`);
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
    const target = driverUid ?? "none";
    const inputs = await readPgClaimInputs(id, target);
    console.log(
      `  readPgClaimInputs(${id}) ok → orderStatus=${inputs.orderStatus}` +
      ` offer=${inputs.activeOfferDriverUids?.length ?? "null"}` +
      ` priorClaim=${inputs.priorClaimPresent} pgToken=${inputs.pgTokenPresent}`,
    );
    // Validate a synthetic FS claim against the live read (read-only, no writes).
    const fs = fsClaim({
      orderId:               id,
      targetDriverUid:       target,
      claimedBy:             inputs.claimedBy,
      claimedAtMs:           inputs.claimedAtMs,
      messageId:             inputs.messageId,
      activeOfferDriverUids: inputs.activeOfferDriverUids ?? [],
      tokenPresent:          inputs.pgTokenPresent,
    });
    const res = compareClaim(fs, { ...inputs, orderId: id });
    record(res.outcome, res.reason);
    console.log(`    live compare → [${res.outcome}${res.reason ? `:${res.reason}` : ""}] token=${res.tokenOutcome}`);
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
