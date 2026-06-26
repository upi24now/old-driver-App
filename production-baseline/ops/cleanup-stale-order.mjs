#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// ONE-TIME cleanup for a single stale stuck order in Firestore.
//
// Firebase is allowed ONLY for OTP/Auth + FCM. This is a manual ops fix for ONE
// stuck document — it is NOT app code and does NOT deploy anything.
//
// Dependency-free: uses Node built-ins only (node:crypto + global fetch), so it
// runs on the VPS without installing firebase-admin or any npm package.
// Requires Node >= 18 and the SAME service-account env the API already uses:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//
// Behaviour (touches ONLY this order + driver markers pointing at it; no deletes):
//   1. Reads + prints orders/<ORDER_ID> BEFORE any change.
//   2. Reads + prints drivers/<DRIVER_UID>.
//   3. Marks the order cancelled (status/cancelledBy/cancelReason/cancelledAt[server]
//      + activeOfferDriverUids=[] + offerExpiresAt=null + dispatchTimeoutAt=null).
//   4. Clears ONLY driver-doc fields whose value points at THIS order
//      (string == orderId -> null; array containing orderId -> orderId removed).
//   5. Re-reads + prints the order AFTER.
//
//   DRY-RUN (default, read-only):  node cleanup-stale-order.mjs
//   APPLY   (writes once):         node cleanup-stale-order.mjs --apply
// ──────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

const ORDER_ID = "1cJqStLYLBmdxPbJ50j7";
const DRIVER_UID = "918299013350";
const APPLY = process.argv.includes("--apply");

const PROJECT = process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
let PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
if (!PROJECT || !CLIENT_EMAIL || !PRIVATE_KEY) {
  console.error("FATAL: missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in env.");
  process.exit(1);
}
PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");

const DB = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DB}`;

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), PRIVATE_KEY));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("OAuth token error: " + JSON.stringify(j));
  return j.access_token;
}

async function getDoc(token, path) {
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { __missing: true };
  const j = await res.json();
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(j)}`);
  return j;
}

(async () => {
  console.log(`[cleanup] project=${PROJECT} order=${ORDER_ID} driver=${DRIVER_UID} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const token = await getAccessToken();

  const order = await getDoc(token, `orders/${ORDER_ID}`);
  if (order.__missing) {
    console.error(`orders/${ORDER_ID} NOT FOUND in Firestore — aborting. No other order touched.`);
    process.exit(2);
  }
  console.log(`\n=== BEFORE: orders/${ORDER_ID} ===`);
  console.log(JSON.stringify(order.fields ?? {}, null, 2));

  const driver = await getDoc(token, `drivers/${DRIVER_UID}`);
  console.log(`\n=== driver doc: drivers/${DRIVER_UID} ===`);
  console.log(driver.__missing ? "(driver doc missing)" : JSON.stringify(driver.fields ?? {}, null, 2));

  // Surgical: only clear KNOWN active-ride marker fields, and only when their
  // value points at THIS order. Two conditions must BOTH hold, so an unrelated
  // audit/history field that happens to reference this orderId is never touched.
  const ACTIVE_MARKER_FIELDS = new Set([
    // single-order pointer markers
    "currentOrderId", "activeOrderId", "currentActiveOrderId", "ongoingOrderId",
    "currentOrder", "activeOrder", "currentRideId", "activeRideId",
    "current_order_id", "active_order_id", "current_active_order_id",
    "ongoing_order_id", "current_order", "active_order", "current_ride_id", "active_ride_id",
    // array-of-active-orders markers
    "activeOrderIds", "currentOrderIds", "activeOfferOrderIds",
    "active_order_ids", "current_order_ids", "active_offer_order_ids",
  ]);
  const driverFields = driver.__missing ? {} : (driver.fields ?? {});
  const driverUpdates = {};
  const driverMask = [];
  for (const [k, v] of Object.entries(driverFields)) {
    if (!ACTIVE_MARKER_FIELDS.has(k)) continue; // allowlist gate
    if (v && v.stringValue === ORDER_ID) {
      driverUpdates[k] = { nullValue: null };
      driverMask.push(k);
    } else if (v && v.arrayValue && Array.isArray(v.arrayValue.values) &&
               v.arrayValue.values.some((x) => x.stringValue === ORDER_ID)) {
      driverUpdates[k] = { arrayValue: { values: v.arrayValue.values.filter((x) => x.stringValue !== ORDER_ID) } };
      driverMask.push(k);
    }
  }
  console.log("\n[plan] active-ride marker fields pointing at this order to clear:",
              driverMask.length ? driverMask : "(none — driver doc will NOT be written)");
  if (driverMask.length) {
    console.log("[plan] proposed driver-doc mutations:", JSON.stringify(driverUpdates, null, 2));
  }

  if (!APPLY) {
    console.log("\nDRY-RUN only — no changes made. Re-run with --apply to write the cancellation.");
    return;
  }

  const writes = [{
    update: {
      name: `${DB}/orders/${ORDER_ID}`,
      fields: {
        status: { stringValue: "cancelled" },
        cancelledBy: { stringValue: "admin_cleanup" },
        cancelReason: { stringValue: "manual_test_cleanup_stale_active_ride" },
        activeOfferDriverUids: { arrayValue: { values: [] } },
        offerExpiresAt: { nullValue: null },
        dispatchTimeoutAt: { nullValue: null },
      },
    },
    updateMask: { fieldPaths: ["status", "cancelledBy", "cancelReason", "activeOfferDriverUids", "offerExpiresAt", "dispatchTimeoutAt"] },
    updateTransforms: [{ fieldPath: "cancelledAt", setToServerValue: "REQUEST_TIME" }],
    currentDocument: { exists: true },
  }];
  if (driverMask.length) {
    writes.push({
      update: { name: `${DB}/drivers/${DRIVER_UID}`, fields: driverUpdates },
      updateMask: { fieldPaths: driverMask },
      currentDocument: { exists: true },
    });
  }

  const res = await fetch(`${BASE}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error("commit failed: " + JSON.stringify(out));
  console.log("\n[commit OK]");

  const after = await getDoc(token, `orders/${ORDER_ID}`);
  console.log(`\n=== AFTER: orders/${ORDER_ID} ===`);
  console.log(JSON.stringify(after.fields ?? {}, null, 2));
  console.log("\nDONE. Only this order + driver markers pointing at it were modified. No documents deleted.");
})().catch((e) => {
  console.error("CLEANUP FAILED:", e.message);
  process.exit(1);
});
