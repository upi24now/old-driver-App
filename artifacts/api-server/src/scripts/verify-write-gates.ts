/**
 * Phase 5G-A verification — PG dispatcher safety gates.
 *
 * Pure, offline check (no DB, no network) of the env-driven safety gates that
 * sit in front of the PG dispatcher write/FCM path. Exercises the documented
 * verification matrix A–D plus the defense-in-depth runtime force.
 *
 * Run:  node ./verify-write-gates.mjs   (from artifacts/api-server)
 */
import {
  resolvePgWriteGates,
  planDispatchStartup,
  resolveEffectiveVerifyOnly,
  type DispatchSource,
} from "../lib/dispatch-source";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Set/unset the two gate envs, then resolve gates + plan for a given source. */
function scenario(
  source: DispatchSource,
  allow: string | undefined,
  fcm: string | undefined,
) {
  if (allow === undefined) delete process.env.ALLOW_PG_DISPATCH_WRITES;
  else process.env.ALLOW_PG_DISPATCH_WRITES = allow;
  if (fcm === undefined) delete process.env.PG_FCM_SEND_ENABLED;
  else process.env.PG_FCM_SEND_ENABLED = fcm;

  const gates = resolvePgWriteGates();
  const plan = planDispatchStartup(source, gates);
  const writesAllowed = plan.startPgDispatcher && !plan.pgDispatcherVerifyOnly;
  return { gates, plan, writesAllowed };
}

function main(): void {
  console.log("=== Phase 5G-A: PG dispatch write-gate verification ===\n");

  // ── A. firestore, ALLOW unset → Firestore only ─────────────────────────────
  console.log("[A] DISPATCH_SOURCE=firestore, ALLOW_PG_DISPATCH_WRITES unset");
  {
    const { plan, writesAllowed } = scenario("firestore", undefined, undefined);
    check("Firestore dispatcher starts", plan.startFirestore === true);
    check("no PG dry-run", plan.startPgDryRun === false);
    check("no PG dispatcher", plan.startPgDispatcher === false);
    check("verify-only (n/a, no PG)", plan.pgDispatcherVerifyOnly === true);
    check("writesAllowed=false", writesAllowed === false);
  }

  // ── B. pg, ALLOW unset → PG verify-only ────────────────────────────────────
  console.log("\n[B] DISPATCH_SOURCE=pg, ALLOW_PG_DISPATCH_WRITES unset");
  {
    const { plan, writesAllowed } = scenario("pg", undefined, undefined);
    check("PG dispatcher starts", plan.startPgDispatcher === true);
    check("verify-only forced ON", plan.pgDispatcherVerifyOnly === true);
    check("writesAllowed=false", writesAllowed === false);
    check("Firestore still authoritative", plan.startFirestore === true);
  }

  // ── C. pg + ALLOW=true, FCM unset → writes allowed, FCM blocked ────────────
  console.log("\n[C] DISPATCH_SOURCE=pg, ALLOW=true, PG_FCM_SEND_ENABLED unset");
  {
    const { plan, writesAllowed } = scenario("pg", "true", undefined);
    check("PG dispatcher starts", plan.startPgDispatcher === true);
    check("verify-only OFF (writes allowed)", plan.pgDispatcherVerifyOnly === false);
    check("writesAllowed=true", writesAllowed === true);
    check("FCM send blocked", plan.pgFcmSendEnabled === false);
    check("Firestore still authoritative", plan.startFirestore === true);
  }

  // ── D. pg + ALLOW=true + FCM=true → writes + FCM allowed by config ─────────
  console.log("\n[D] DISPATCH_SOURCE=pg, ALLOW=true, PG_FCM_SEND_ENABLED=true");
  {
    const { plan, writesAllowed } = scenario("pg", "true", "true");
    check("PG dispatcher starts", plan.startPgDispatcher === true);
    check("verify-only OFF (writes allowed)", plan.pgDispatcherVerifyOnly === false);
    check("writesAllowed=true", writesAllowed === true);
    check("FCM send allowed by config", plan.pgFcmSendEnabled === true);
    check("Firestore still authoritative", plan.startFirestore === true);
  }

  // ── Strict parsing — only exact "true" opens a gate ────────────────────────
  console.log("\n[E] strict gate parsing (only \"true\" opens)");
  for (const v of ["false", "1", "yes", "TRUE ", " true ", ""]) {
    const { gates } = scenario("pg", v, undefined);
    const expected = v.trim().toLowerCase() === "true";
    check(
      `ALLOW="${v}" → allowPgDispatchWrites=${expected}`,
      gates.allowPgDispatchWrites === expected,
    );
  }

  // ── Defense-in-depth: resolveEffectiveVerifyOnly forces verify-only ────────
  console.log("\n[F] runtime force: verifyOnly=false requested without gate");
  {
    const r1 = resolveEffectiveVerifyOnly(false, {
      allowPgDispatchWrites: false,
      pgFcmSendEnabled: false,
    });
    check("forced verify-only when ungated", r1.verifyOnly === true && r1.forced === true);

    const r2 = resolveEffectiveVerifyOnly(false, {
      allowPgDispatchWrites: true,
      pgFcmSendEnabled: false,
    });
    check("honors writes when gated", r2.verifyOnly === false && r2.forced === false);

    const r3 = resolveEffectiveVerifyOnly(true, {
      allowPgDispatchWrites: true,
      pgFcmSendEnabled: true,
    });
    check("verify-only requested stays verify-only", r3.verifyOnly === true && r3.forced === false);
  }

  console.log(`\n=== RESULTS ===\npass: ${pass}\nfail: ${fail}`);
  console.log(`VERDICT=${fail === 0 ? "PASS" : "FAIL"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
