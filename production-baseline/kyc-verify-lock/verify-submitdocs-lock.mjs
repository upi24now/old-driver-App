// Behavior harness for the submit-documents KYC lock.
// Extracts the injected block from the patched bundle and runs it against a
// matrix of driver states with mock db/res, proving:
//   approved/verified (either column) -> 403 exact message, write blocked
//   pending/rejected/empty/null       -> falls through (write allowed)
//   DB read error                     -> 503 fail-closed, write blocked
import fs from "node:fs";

const LOCKED_MESSAGE = "Documents are locked after verification.";
const file = process.argv[2] || "testbundle.js";
const src = fs.readFileSync(file, "utf8");

// Pull the exact injected block out of the patched bundle.
const start = src.indexOf("// KYC_SUBMITDOCS_LOCK_V1");
if (start === -1) {
  console.error("FAIL: sentinel not found in", file);
  process.exit(1);
}
// block ends at the closing "    }" of the outer scope block, just before the
// original "\n\n    await db.update"
const tail = src.indexOf("await db.update(driversTable)", start);
const block = src.slice(start, tail);

// Build a runner that executes the block with injected mocks.
function makeRunner(blockSrc) {
  // The block references: db, driversTable, eq, uid, res. It may `return`.
  const fnSrc = `return (async (db, driversTable, eq, uid, res) => {\n${blockSrc}\n  return "FELL_THROUGH";\n});`;
  // eslint-disable-next-line no-new-func
  return new Function(fnSrc)();
}
const run = makeRunner(block);

function mockRes() {
  const out = { code: 200, body: null };
  return {
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
    _out: out,
  };
}
function mockDb(row, throwIt) {
  return {
    select() { return this; },
    from() { return this; },
    where() { return this; },
    async limit() { if (throwIt) throw new Error("db down"); return row ? [row] : []; },
  };
}
const driversTable = { verificationStatus: "vs", kycStatus: "ks", uid: "uid" };
const eq = () => true;

const cases = [
  { name: "verificationStatus=approved", row: { vs: "approved", ks: "pending" }, expect: 403 },
  { name: "kycStatus=approved",          row: { vs: "pending",  ks: "approved" }, expect: 403 },
  { name: "verificationStatus=verified", row: { vs: "verified", ks: "pending" }, expect: 403 },
  { name: "kycStatus=verified",          row: { vs: "pending",  ks: "verified" }, expect: 403 },
  { name: "APPROVED uppercase",          row: { vs: "APPROVED", ks: "pending" }, expect: 403 },
  { name: "pending/pending",             row: { vs: "pending",  ks: "pending" }, expect: 200 },
  { name: "rejected",                    row: { vs: "rejected", ks: "rejected" }, expect: 200 },
  { name: "submitted (resubmit allowed)",row: { vs: "pending",  ks: "submitted" }, expect: 200 },
  { name: "empty strings",               row: { vs: "",         ks: "" }, expect: 200 },
  { name: "null columns",                row: { vs: null,       ks: null }, expect: 200 },
  { name: "no driver row",               row: null, expect: 200 },
  { name: "DB read error",               row: null, throwIt: true, expect: 503 },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const res = mockRes();
  const r = await run(mockDb(c.row, c.throwIt), driversTable, eq, "u1", res);
  const fellThrough = r === "FELL_THROUGH";
  const code = fellThrough ? 200 : res._out.code;
  let ok = code === c.expect;
  if (c.expect === 403) ok = ok && res._out.body && res._out.body.error === LOCKED_MESSAGE;
  if (c.expect === 200) ok = ok && fellThrough; // must continue to the real write
  if (c.expect === 503) ok = ok && !fellThrough;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(34)} -> ${code}${c.expect === 403 ? " (" + (res._out.body?.error ?? "") + ")" : ""}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
