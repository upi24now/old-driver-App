// ── Phase 5E-B verification harness — DISPATCH_SOURCE resolver ──────────────
// Pure unit check of resolveDispatchSource() under different env values. No DB
// access, no dispatcher start. Run via verify-dispatch-source.mjs.
import { resolveDispatchSource, type DispatchSource } from "../lib/dispatch-source";

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

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env["DISPATCH_SOURCE"];
  if (value === undefined) delete process.env["DISPATCH_SOURCE"];
  else process.env["DISPATCH_SOURCE"] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env["DISPATCH_SOURCE"];
    else process.env["DISPATCH_SOURCE"] = prev;
  }
}

function expect(
  label: string,
  envValue: string | undefined,
  expectedValue: DispatchSource,
  expectedEffective: DispatchSource,
): void {
  withEnv(envValue, () => {
    const c = resolveDispatchSource();
    check(
      `${label} → value=${expectedValue}`,
      c.value === expectedValue,
      `got value=${c.value}`,
    );
    check(
      `${label} → effective=${expectedEffective}`,
      c.effective === expectedEffective,
      `got effective=${c.effective}`,
    );
  });
}

async function main(): Promise<void> {
  const hasDbUrl = !!process.env["DATABASE_URL"];
  console.log(`[env] DATABASE_URL present: ${hasDbUrl} (pgAvailable expected ${hasDbUrl})`);

  // Skeleton phase: effective ALWAYS equals value (no routing/downgrade yet),
  // independent of DATABASE_URL. pgAvailable is reported separately for the
  // safety warning only.

  console.log("[1] unset env → firestore");
  expect("unset", undefined, "firestore", "firestore");

  console.log("[2] empty string → firestore");
  expect("empty", "", "firestore", "firestore");

  console.log("[3] invalid value → firestore");
  expect("invalid 'postgres'", "postgres", "firestore", "firestore");
  expect("invalid 'FIRESTOREE'", "FIRESTOREE", "firestore", "firestore");

  console.log("[4] firestore → firestore");
  expect("firestore", "firestore", "firestore", "firestore");

  console.log("[5] pg_shadow → pg_shadow (behavior unchanged)");
  expect("pg_shadow", "pg_shadow", "pg_shadow", "pg_shadow");

  console.log("[6] pg → pg (behavior unchanged)");
  expect("pg", "pg", "pg", "pg");

  console.log("[7] case-insensitive + whitespace tolerant");
  expect("'  PG  '", "  PG  ", "pg", "pg");
  expect("'Pg_Shadow'", "Pg_Shadow", "pg_shadow", "pg_shadow");

  console.log("[8] pgAvailable reflects DATABASE_URL");
  withEnv("pg", () => {
    const c = resolveDispatchSource();
    check("pgAvailable === hasDbUrl", c.pgAvailable === hasDbUrl, `got ${c.pgAvailable}`);
  });

  console.log(`\n=== RESULTS ===\npass: ${pass}\nfail: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
