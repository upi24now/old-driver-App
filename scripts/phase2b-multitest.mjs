import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const projectId   = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const apiKey      = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;

const app  = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, "phase2b-multi");
const db   = getFirestore(app);
const auth = getAuth(app);

// Get all PG-shadowed orders
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows: orders } = await pool.query(
  "SELECT id, driver_uid, status FROM orders ORDER BY created_at DESC LIMIT 5"
);
console.log("PG orders to test:", orders.map(r => `${r.id}(${r.status})`).join(", "));

// Token cache
const tokenCache = {};
async function getToken(uid) {
  if (tokenCache[uid]) return tokenCache[uid];
  const custom = await auth.createCustomToken(uid);
  const ex = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) }
  );
  const d = await ex.json();
  tokenCache[uid] = d.idToken;
  return d.idToken;
}

let matches = 0, diffs = 0, missing = 0;

for (const row of orders) {
  // Need any valid authenticated driver UID for auth — use the order's assigned driver if available
  const uid = row.driver_uid || "918299013350"; // fallback to known driver
  const token = await getToken(uid);
  
  const resp = await fetch(`http://localhost:80/api/orders/${row.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (resp.status === 404) { missing++; console.log(`  ${row.id}: 404 (not in Firestore)`); continue; }
  if (!resp.ok) { console.log(`  ${row.id}: HTTP ${resp.status}`); continue; }
  
  const body = await resp.json();
  console.log(`  ${row.id}: returned ok=${body.ok}, status=${body.order?.status}`);
}

await pool.end();
console.log("\nResults: server logs show [PG_COMPARE_MATCH]/[PG_COMPARE_DIFF] — grep them above.");
