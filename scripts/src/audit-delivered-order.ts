/**
 * Audit script — prints raw field names of the latest delivered order.
 * Run: pnpm --filter @workspace/scripts run audit-delivered-order
 */

const projectId   = process.env["FIREBASE_PROJECT_ID"];
const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
const rawKey      = process.env["FIREBASE_PRIVATE_KEY"];

if (!projectId || !clientEmail || !rawKey) {
  console.error("Missing env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore }        = await import("firebase-admin/firestore");

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db  = getFirestore(app);

// No orderBy — avoids the composite index requirement.
// Fetches any delivered order; enough to audit field names.
const snap = await db.collection("orders")
  .where("status", "==", "delivered")
  .limit(5)
  .get();

if (snap.empty) {
  console.log("No delivered orders found.");
  process.exit(0);
}

const doc  = snap.docs[0]!;
const data = doc.data();

console.log("\n=== Order ID:", doc.id, "===");
console.log("\n--- All field keys ---");
console.log(Object.keys(data).sort().join("\n"));

console.log("\n--- Address / location / drop / destination related fields ---");
const addressKeys = Object.keys(data).filter(k =>
  /drop|pickup|address|location|destination|delivery|from|to(?!ken)|origin|customer|city|sub/i.test(k)
);
for (const k of addressKeys.sort()) {
  const v = data[k];
  console.log(`  ${k}:`, typeof v === "object" ? JSON.stringify(v) : v);
}

console.log("\n--- Specific field values ---");
const checkFields = [
  "pickup", "pickupSub", "pickupCity", "pickupAddress", "pickupLocation", "pickupText",
  "drop", "dropSub", "dropCity", "dropAddress", "dropLocation", "dropText",
  "fromAddress", "toAddress", "originAddress", "destinationAddress",
  "deliveryAddress", "customerAddress", "destination",
  "customerName", "fareEstimate", "paymentMode", "distanceKm", "status",
];
for (const k of checkFields) {
  if (k in data) {
    const v = data[k];
    console.log(`  ✅ ${k}:`, typeof v === "object" ? JSON.stringify(v) : v);
  } else {
    console.log(`  ❌ ${k}: (not present)`);
  }
}

process.exit(0);
