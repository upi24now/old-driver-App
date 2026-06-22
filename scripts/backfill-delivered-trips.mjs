/**
 * Phase 2C-Backfill — Delivered Trips → PostgreSQL
 *
 * Reads ALL delivered orders from Firestore for all drivers and upserts
 * them into the PG orders table, preserving timestamps.
 *
 * Logs:
 *   [PG_BACKFILL_TRIP]       — row upserted successfully
 *   [PG_BACKFILL_TRIP_SKIP]  — row skipped (driverUid missing)
 *   [PG_BACKFILL_TRIP_ERROR] — upsert failed (non-fatal, continues)
 *
 * Safe to run multiple times — uses ON CONFLICT DO UPDATE with COALESCE
 * so existing timestamps are not overwritten.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_PROJECT_ID,
}, "backfill");

const fsDb = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────────────────────

const str   = (v) => (typeof v === "string" ? v.trim() || null : null);
const num   = (v) => { if (typeof v === "number") return String(v); if (typeof v === "string" && v !== "" && v !== "—" && !isNaN(parseFloat(v))) return v; return null; };
const intV  = (v) => (typeof v === "number" ? Math.round(v) : null);

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();     // Firestore Timestamp
  if (typeof v.toMillis === "function") return new Date(v.toMillis()); // admin Timestamp
  if (typeof v === "number") return new Date(v);
  return null;
}

// ── Fetch all delivered orders ─────────────────────────────────────────────────

console.log("Fetching delivered orders from Firestore...");
const snap = await fsDb
  .collection("orders")
  .where("status", "==", "delivered")
  .get();

console.log(`Found ${snap.docs.length} delivered order(s) in Firestore.\n`);

// ── Upsert each row ───────────────────────────────────────────────────────────

let upserted = 0, skipped = 0, errors = 0;

for (const doc of snap.docs) {
  const id   = doc.id;
  const data = doc.data();

  const driverUid = str(data.driverUid);
  if (!driverUid) {
    console.log(`[PG_BACKFILL_TRIP_SKIP] id=${id} reason=no_driver_uid`);
    skipped++;
    continue;
  }

  const pickup = str(data.pickup) ?? str(data.pickupAddress);
  const drop   = str(data.drop)   ?? str(data.deliveryAddress);

  const deliveredAt  = toDate(data.deliveredAt);
  const acceptedAt   = toDate(data.acceptedAt);
  const createdAt    = toDate(data.createdAt) ?? new Date();

  try {
    await pool.query(
      `INSERT INTO orders (
         id, status, customer_name, customer_phone,
         pickup, pickup_city, "drop", drop_city,
         distance_km, duration_min, fare_estimate, payment_mode,
         driver_uid, driver_name,
         delivered_at, accepted_at, created_at, updated_at
       ) VALUES (
         $1,  $2,  $3,  $4,
         $5,  $6,  $7,  $8,
         $9,  $10, $11, $12,
         $13, $14,
         $15, $16, $17, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         status         = EXCLUDED.status,
         driver_uid     = EXCLUDED.driver_uid,
         driver_name    = COALESCE(orders.driver_name,    EXCLUDED.driver_name),
         customer_name  = COALESCE(orders.customer_name,  EXCLUDED.customer_name),
         customer_phone = COALESCE(orders.customer_phone, EXCLUDED.customer_phone),
         pickup         = COALESCE(orders.pickup,         EXCLUDED.pickup),
         pickup_city    = COALESCE(orders.pickup_city,    EXCLUDED.pickup_city),
         "drop"         = COALESCE(orders."drop",         EXCLUDED."drop"),
         drop_city      = COALESCE(orders.drop_city,      EXCLUDED.drop_city),
         distance_km    = COALESCE(orders.distance_km,    EXCLUDED.distance_km),
         duration_min   = COALESCE(orders.duration_min,   EXCLUDED.duration_min),
         fare_estimate  = COALESCE(orders.fare_estimate,  EXCLUDED.fare_estimate),
         payment_mode   = COALESCE(orders.payment_mode,   EXCLUDED.payment_mode),
         delivered_at   = COALESCE(orders.delivered_at,   EXCLUDED.delivered_at),
         accepted_at    = COALESCE(orders.accepted_at,    EXCLUDED.accepted_at),
         updated_at     = NOW()`,
      [
        id,
        "delivered",
        str(data.customerName),
        str(data.customerPhone),
        pickup,
        str(data.pickupCity),
        drop,
        str(data.dropCity),
        num(data.distanceKm),
        intV(data.durationMin),
        num(data.fareEstimate),
        str(data.paymentMode),
        driverUid,
        str(data.driverName),
        deliveredAt,
        acceptedAt,
        createdAt,
      ],
    );
    console.log(`[PG_BACKFILL_TRIP] id=${id}  driver=${driverUid}  fare=${data.fareEstimate ?? "—"}  deliveredAt=${deliveredAt?.toISOString() ?? "null"}`);
    upserted++;
  } catch (err) {
    console.error(`[PG_BACKFILL_TRIP_ERROR] id=${id}  err=${err.message}`);
    errors++;
  }
}

await pool.end();

console.log(`
════════════════════════════════════
  Total in Firestore : ${snap.docs.length}
  Upserted to PG     : ${upserted}
  Skipped            : ${skipped}
  Errors             : ${errors}
════════════════════════════════════`);
