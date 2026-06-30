/**
 * verify-kyc-verify-lock.mjs
 *
 * Behavioral proof for the injected lock. Extracts the EXACT inserted block
 * from the patched bundle and runs it with a mocked `db` for each driver state,
 * asserting the documented outcomes:
 *   approved / verified (either column)  -> 403 "Documents are locked after verification."
 *   pending / submitted / rejected       -> passes through (upload allowed)
 *   no driver row                         -> passes through (upload allowed)
 *   DB error                              -> 503 (fail-closed; upload NOT allowed)
 */

import fs from "fs";

const file = new URL("./production-api.js", import.meta.url);
const src = fs.readFileSync(file, "utf8");

// Pull the injected block verbatim: from the sentinel line to the matching
// closing brace that ends the `{ ... }` lock scope.
const start = src.indexOf("// KYC_VERIFY_LOCK_V1");
if (start === -1) { console.error("FAIL: sentinel not found"); process.exit(1); }
const openBrace = src.indexOf("{", start);
let depth = 0, end = -1;
for (let i = openBrace; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const block = src.slice(start, end);
console.log("=== injected block under test ===\n" + block + "\n");

// Wrap the block in an async fn exposing the same free vars it relies on.
// `return` inside the block exits this fn (a 403/503 path); if it falls through,
// we return the PASSTHROUGH sentinel (upload would proceed).
const runBlock = new Function(
  "db", "driversTable", "eq", "rawUid", "res", "req",
  `return (async () => {\n${block}\n return "PASSTHROUGH"; })();`
);

const driversTable = { uid: "uid", verificationStatus: "vs", kycStatus: "ks" };
const eq = () => ({});
const req = { log: { error() {}, warn() {}, info() {} } };
function mkDb(rows, throwIt = false) {
  // Mimics drizzle's chainable builder ending in a thenable.
  const result = {
    from() { return this; },
    where() { return this; },
    limit() { return this; },
    then(resolve, reject) { throwIt ? reject(new Error("db down")) : resolve(rows); },
  };
  return { select() { return result; } };
}
function mkRes() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const LOCK_MSG = "Documents are locked after verification.";
const cases = [
  { name: "approved (verificationStatus)",        rows: [{ vs: "approved", ks: "approved" }], expect: 403 },
  { name: "verified (verificationStatus)",         rows: [{ vs: "verified", ks: "pending" }],  expect: 403 },
  { name: "approved via kycStatus only",           rows: [{ vs: "pending", ks: "approved" }],  expect: 403 },
  { name: "mixed vs=submitted ks=verified",        rows: [{ vs: "submitted", ks: "verified" }], expect: 403 },
  { name: "APPROVED upper-case",                   rows: [{ vs: "APPROVED", ks: "" }],         expect: 403 },
  { name: "pending (unverified)",                  rows: [{ vs: "pending", ks: "pending" }],   expect: "PASSTHROUGH" },
  { name: "submitted (unverified)",                rows: [{ vs: "pending", ks: "submitted" }], expect: "PASSTHROUGH" },
  { name: "rejected (unverified)",                 rows: [{ vs: "rejected", ks: "rejected" }], expect: "PASSTHROUGH" },
  { name: "no driver row",                         rows: [],                                   expect: "PASSTHROUGH" },
  { name: "DB error (fail-closed)",                rows: null, throwIt: true,                  expect: 503 },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const res = mkRes();
  const out = await runBlock(mkDb(c.rows, c.throwIt), driversTable, eq, "9999999999", res, req);
  let ok;
  if (c.expect === 403)      ok = res.code === 403 && res.body?.error === LOCK_MSG;
  else if (c.expect === 503) ok = res.code === 503 && /could not verify/i.test(res.body?.error ?? "");
  else                       ok = out === "PASSTHROUGH" && res.code === null;
  const shown = res.code ? `${res.code} ${JSON.stringify(res.body)}` : out;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(34)} -> ${shown}`);
  ok ? pass++ : fail++;
}
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
