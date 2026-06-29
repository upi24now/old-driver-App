// Deterministic, side-effect-free runtime proof for the driver self-profile patch.
//
// It runs the EXACT inserted block (drivers-me-body.js) against an Express app whose
// route mount order MIRRORS the live bundle: the new app-level GET /api/drivers/me is
// registered FIRST, then a mock "/api/drivers" router that reproduces the live admin
// route  router11.get("/:uid", adminAuth)  is mounted (so "/:uid" would 403 a driver).
//
// Asserts:
//   1. GET /api/drivers/me  (valid driver token, row exists)      → 200 + {ok, driver, location}
//   2. GET /api/drivers/me  (valid driver token, NO row)          → 404  (new-signup path preserved)
//   3. GET /api/drivers/me  (no/invalid token)                    → 401  (driverAuth enforced)
//   4. GET /api/drivers/<realUid> (driver token, no admin claim)  → 403  (ADMIN ROUTE STILL GATED)
//   5. GET /api/drivers/me does NOT reach adminAuth (precedence)  → never 403 "admin access"
// Exit code 0 = all pass.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = readFileSync(path.join(HERE, "drivers-me-body.js"), "utf8");

// ---- mock module-scope bindings the inserted block closes over ----------------
const DRIVERS = new Map(); // uid -> driver row
const LOCATIONS = new Map(); // driverUid -> location row
DRIVERS.set("918299013350", { uid: "918299013350", name: "Test Driver", phone: "8299013350", verificationStatus: "verified" });
LOCATIONS.set("918299013350", { driverUid: "918299013350", lat: "12.9", lng: "77.5", isOnline: true });

// Minimal drizzle-style query builder backed by the maps above.
const driversTable = { __t: "drivers", uid: { __c: "uid" } };
const driverLocationsTable = { __t: "driver_locations", driverUid: { __c: "driverUid" } };
const eq = (col, val) => ({ __c: col.__c, val });
function makeSelect() {
  let table, pred;
  const api = {
    from(t) { table = t; return api; },
    where(p) { pred = p; return api; },
    async limit() {
      const map = table.__t === "drivers" ? DRIVERS : LOCATIONS;
      const row = map.get(pred.val);
      return row ? [row] : [];
    },
  };
  return api;
}
const db = { select: () => makeSelect() };

// driverAuth: mirrors the live middleware — Bearer id-token → req.driverUid.
// In the harness, the token string IS the uid (after a fixed prefix) and
// "admin-claim" tokens are explicitly NOT issued to drivers.
async function driverAuth(req, res, next) {
  const h = req.headers["authorization"] ?? "";
  if (!h.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized — missing token" }); return; }
  const tok = h.slice(7).trim();
  if (!tok.startsWith("driver:")) { res.status(401).json({ error: "Unauthorized — invalid or expired token" }); return; }
  req.driverUid = tok.slice("driver:".length);
  next();
}

// adminAuth: mirrors the live middleware's reject for a non-admin token.
async function adminAuth(req, res, next) {
  // A plain driver token carries no admin claim → exactly the live 403.
  res.status(403).json({ error: "Forbidden — account does not have admin access" });
}

const app = express();
app.use((req, _res, n) => { req.log = { error() {} }; n(); });

// 1) Insert the REAL patch block (registers app.get("/api/drivers/me", driverAuth, ...)).
new Function("app", "driverAuth", "db", "driversTable", "driverLocationsTable", "eq", BODY)(
  app, driverAuth, db, driversTable, driverLocationsTable, eq,
);

// 2) Mount the mock admin drivers router AFTER, mirroring live order:
//    router33.use("/drivers", drivers_default) → router11.get("/:uid", adminAuth)
const drivers = express.Router();
drivers.get("/:uid", adminAuth, (_req, res) => res.json({ ok: true, source: "ADMIN-ROUTE" }));
app.use("/api/drivers", drivers);

const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

async function get(p, token) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  → " + detail}`);
  if (!cond) failed++;
}

const driverTok = "driver:918299013350";       // valid driver, row exists
const newDriverTok = "driver:919999999999";    // valid driver, NO row yet

const r1 = await get("/api/drivers/me", driverTok);
check("1. /drivers/me driver+row → 200 {ok,driver}", r1.status === 200 && r1.body?.ok === true && r1.body?.driver?.uid === "918299013350", JSON.stringify(r1));
check("1b. returns location field", r1.body?.location?.driverUid === "918299013350", JSON.stringify(r1.body?.location));

const r2 = await get("/api/drivers/me", newDriverTok);
check("2. /drivers/me driver, no row → 404 (new-signup path)", r2.status === 404, JSON.stringify(r2));

const r3 = await get("/api/drivers/me", null);
check("3. /drivers/me no token → 401 (driverAuth)", r3.status === 401, JSON.stringify(r3));

const r4 = await get("/api/drivers/918299013350", driverTok);
check("4. /drivers/<realUid> driver token → 403 ADMIN STILL GATED", r4.status === 403 && /admin access/.test(r4.body?.error ?? ""), JSON.stringify(r4));

check("5. /drivers/me NEVER hits admin 403 (precedence)", r1.status === 200 && !/admin access/.test(JSON.stringify(r1.body)), JSON.stringify(r1));

server.close();
console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
