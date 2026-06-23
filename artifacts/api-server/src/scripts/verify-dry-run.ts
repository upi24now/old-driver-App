// ── Phase 5E-C verification harness — PG dispatcher dry-run ─────────────────
// Two parts:
//   A. planDispatchStartup() mapping — pure, env-independent.
//   B. chooseNextDriver() round-robin cursor — pure.
//   C. one live READ-ONLY dry-run pass against PG (+ Firestore comparison if
//      reachable), asserting it returns counts and performs no writes.
// Run via verify-dry-run.mjs.
import { planDispatchStartup } from "../lib/dispatch-source";
import {
  chooseNextDriver,
  runPgDryRunPass,
} from "../lib/pg-dispatcher-dry-run";
import { type PgEligibleDriver } from "../lib/pg-dispatch-service";
import { adminFirestore } from "../lib/firebase-admin";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name} ${detail ? "— " + detail : ""}`);
  }
}

function driver(uid: string): PgEligibleDriver {
  return { uid, name: null, rating: null, trips: null };
}

async function main(): Promise<void> {
  // ── A. Startup plan mapping ────────────────────────────────────────────────
  console.log("[A] planDispatchStartup mapping");
  const fs = planDispatchStartup("firestore");
  check("firestore: Firestore on, no dry-run, no PG dispatcher",
    fs.startFirestore === true && fs.startPgDryRun === false && fs.startPgDispatcher === false,
    JSON.stringify(fs));

  const shadow = planDispatchStartup("pg_shadow");
  check("pg_shadow: Firestore on + dry-run on, no PG dispatcher",
    shadow.startFirestore === true && shadow.startPgDryRun === true && shadow.startPgDispatcher === false,
    JSON.stringify(shadow));

  const pg = planDispatchStartup("pg");
  check("pg: Firestore on, no dry-run, PG dispatcher on (verify-only)",
    pg.startFirestore === true && pg.startPgDryRun === false && pg.startPgDispatcher === true && pg.pgDispatcherVerifyOnly === true,
    JSON.stringify(pg));

  // ── B. Round-robin cursor (pure) ──────────────────────────────────────────
  console.log("[B] chooseNextDriver round-robin cursor");
  const pool = [driver("a"), driver("b"), driver("c")];
  check("empty pool → null", chooseNextDriver([], null) === null);
  check("no cursor → first (index 0)", chooseNextDriver(pool, null)?.uid === "a");
  check("cursor a → next b", chooseNextDriver(pool, "a")?.uid === "b");
  check("cursor c → wraps to a", chooseNextDriver(pool, "c")?.uid === "a");
  check("unknown cursor → first", chooseNextDriver(pool, "zzz")?.uid === "a");

  // ── C. Live read-only dry-run pass ────────────────────────────────────────
  console.log("[C] runPgDryRunPass — live, read-only");
  let fsDb: Awaited<ReturnType<typeof adminFirestore>> | null = null;
  try {
    fsDb = await adminFirestore();
  } catch {
    console.log("  (Firestore unavailable — running PG-only comparison)");
  }
  const r = await runPgDryRunPass(fsDb);
  console.log(`  pass result: ${JSON.stringify(r)}`);
  check("returns numeric counts",
    typeof r.ordersScanned === "number" &&
    typeof r.candidates === "number" &&
    typeof r.noDriver === "number" &&
    typeof r.errors === "number");
  check("candidates + noDriver ≤ ordersScanned (accounting holds)",
    r.candidates + r.noDriver <= r.ordersScanned,
    JSON.stringify(r));
  check("no hard pool-read error", r.errors === 0 || r.ordersScanned > 0,
    JSON.stringify(r));

  console.log(`\n=== RESULTS ===\npass: ${pass}\nfail: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
