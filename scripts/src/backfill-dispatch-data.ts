/**
 * Phase 5A.3 — Dispatch data backfill (idempotent, repeatable).
 *
 * Mirrors Firestore driver + order data into the additive PostgreSQL shadow
 * columns so a future PG dispatcher can reproduce dispatcher decisions.
 *
 *   - Drivers   : upsert ALL Firestore drivers into PG (uid, phone, name,
 *                 fcm_token, subscription_expires_at, rating, trips_total,
 *                 online status + latest location).
 *   - Orders    : backfill active_offer_driver_uids / fcm_dispatch_claimed_at /
 *                 fcm_dispatch_claimed_by / fcm_message_id onto EXISTING PG
 *                 order rows only (never creates rows).
 *
 * Firestore stays the source of truth. This script only WRITES PG shadow data;
 * it changes no dispatcher / FCM / order-assign logic.
 *
 * Run: pnpm --filter @workspace/scripts run backfill-dispatch-data
 *
 * NOTE: never prints FCM token values — only presence booleans + counts.
 */
export {};

import { pool } from "@workspace/db";

const projectId   = process.env["FIREBASE_PROJECT_ID"];
const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
const rawKey      = process.env["FIREBASE_PRIVATE_KEY"];

if (!projectId || !clientEmail || !rawKey) {
  console.error("Missing env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

const { initializeApp, cert, getApps } = await import("firebase-admin/app");
const { getFirestore }                 = await import("firebase-admin/firestore");

const app = getApps().length
  ? getApps()[0]!
  : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const fs = getFirestore(app);

// ── helpers ───────────────────────────────────────────────────────────────────

function toDateOrNull(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  if (typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
    try { return (v as { toDate: () => Date }).toDate(); } catch { return null; }
  }
  if (v instanceof Date) return v;
  return null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── 1) Drivers + tokens + metadata ──────────────────────────────────────────

const driverSnap = await fs.collection("drivers").get();
const fsDriverCount = driverSnap.size;

let fsTokenCount = 0;
let driversUpserted = 0;
let driversFailed = 0;
let phoneFallbacks = 0;

console.log(`\n=== DRIVERS BACKFILL (Firestore drivers: ${fsDriverCount}) ===`);

for (const doc of driverSnap.docs) {
  const uid = doc.id;
  const d   = doc.data();

  const token   = nonEmptyString(d["fcmToken"]);
  const hasTok  = token !== null;
  if (hasTok) fsTokenCount++;

  // phone is NOT NULL + UNIQUE in PG. Use FS phone (coerce numeric phones to
  // string). When Firestore has no phone, fall back to a clearly-namespaced
  // sentinel ("missing:<uid>") so it can never be mistaken for a real E.164
  // number nor collide with one. NOTE: on ON CONFLICT (uid) the existing PG
  // phone is preserved — this sentinel is only ever used for a brand-new row.
  const rawPhone = d["phone"];
  let phone =
    nonEmptyString(rawPhone) ??
    (typeof rawPhone === "number" && Number.isFinite(rawPhone) ? String(rawPhone) : null);
  if (!phone) { phone = `missing:${uid}`; phoneFallbacks++; }

  const name      = nonEmptyString(d["name"]);
  const subExpiry = toDateOrNull(d["subscriptionExpiresAt"]);
  const rating    = toNumberOrNull(d["rating"]);
  const trips     = toNumberOrNull(d["tripsTotal"]) ?? toNumberOrNull(d["trips"]);
  const isOnline  = typeof d["isOnline"] === "boolean" ? (d["isOnline"] as boolean) : false;
  const onlineSt  = nonEmptyString(d["onlineStatus"]);
  const lastSeen  = toDateOrNull(d["lastSeenAt"]);
  const lat       = toNumberOrNull(d["latitude"]);
  const lng       = toNumberOrNull(d["longitude"]);
  const acc       = toNumberOrNull(d["accuracy"]);

  try {
    await pool.query(
      `INSERT INTO drivers (
         uid, phone, name, fcm_token, fcm_token_updated_at,
         subscription_expires_at, rating, trips_total,
         is_online, online_status, last_seen_at,
         latitude, longitude, accuracy, updated_at
       ) VALUES (
         $1, $2, $3, $4::text, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END,
         $5::timestamptz, $6::double precision, $7::integer,
         $8::boolean, $9::text, $10::timestamptz,
         $11::double precision, $12::double precision, $13::double precision, now()
       )
       ON CONFLICT (uid) DO UPDATE SET
         name                    = COALESCE(EXCLUDED.name, drivers.name),
         fcm_token               = COALESCE(EXCLUDED.fcm_token, drivers.fcm_token),
         fcm_token_updated_at    = CASE WHEN EXCLUDED.fcm_token IS NOT NULL
                                        THEN now() ELSE drivers.fcm_token_updated_at END,
         subscription_expires_at = COALESCE(EXCLUDED.subscription_expires_at, drivers.subscription_expires_at),
         rating                  = COALESCE(EXCLUDED.rating, drivers.rating),
         trips_total             = COALESCE(EXCLUDED.trips_total, drivers.trips_total),
         is_online               = EXCLUDED.is_online,
         online_status           = COALESCE(EXCLUDED.online_status, drivers.online_status),
         last_seen_at            = COALESCE(EXCLUDED.last_seen_at, drivers.last_seen_at),
         latitude                = COALESCE(EXCLUDED.latitude, drivers.latitude),
         longitude               = COALESCE(EXCLUDED.longitude, drivers.longitude),
         accuracy                = COALESCE(EXCLUDED.accuracy, drivers.accuracy),
         updated_at              = now()`,
      [uid, phone, name, token, subExpiry, rating, trips,
       isOnline, onlineSt, lastSeen, lat, lng, acc],
    );
    driversUpserted++;
    console.log(
      `  ${uid}: token=${hasTok ? "Y" : "N"} sub=${subExpiry ? "Y" : "N"} ` +
      `rating=${rating != null ? "Y" : "N"} trips=${trips != null ? "Y" : "N"} online=${isOnline}`,
    );
  } catch (err) {
    driversFailed++;
    console.error(`  ${uid}: UPSERT FAILED — ${(err as Error).message}`);
  }
}

console.log(
  `\nDrivers upserted=${driversUpserted} failed=${driversFailed} ` +
  `phoneFallbacks=${phoneFallbacks} fsTokenCount=${fsTokenCount}`,
);

// ── 2) Orders FCM/offer fields ──────────────────────────────────────────────

const orderSnap = await fs.collection("orders").get();
const fsOrderCount = orderSnap.size;

let ordersPopulated = 0; // FS had ≥1 field AND a matching PG row was updated
let ordersEmpty = 0;     // FS had none of the 4 fields
let ordersSkipped = 0;   // FS had ≥1 field but no matching PG row

console.log(`\n=== ORDERS BACKFILL (Firestore orders: ${fsOrderCount}) ===`);

for (const doc of orderSnap.docs) {
  const id = doc.id;
  const o  = doc.data();

  const offerUids =
    Array.isArray(o["activeOfferDriverUids"])
      ? (o["activeOfferDriverUids"] as unknown[]).filter((x): x is string => typeof x === "string")
      : null;
  const claimedAt = toDateOrNull(o["fcmDispatchClaimedAt"]);
  const claimedBy = nonEmptyString(o["fcmDispatchClaimedBy"]);
  const messageId = nonEmptyString(o["fcmMessageId"]);

  const hasAny =
    (offerUids != null && offerUids.length > 0) ||
    claimedAt != null || claimedBy != null || messageId != null;

  if (!hasAny) { ordersEmpty++; continue; }

  const r = await pool.query(
    `UPDATE orders SET
       active_offer_driver_uids = COALESCE($2, active_offer_driver_uids),
       fcm_dispatch_claimed_at  = COALESCE($3, fcm_dispatch_claimed_at),
       fcm_dispatch_claimed_by  = COALESCE($4, fcm_dispatch_claimed_by),
       fcm_message_id           = COALESCE($5, fcm_message_id),
       updated_at               = now()
     WHERE id = $1`,
    [id, offerUids, claimedAt, claimedBy, messageId],
  );

  if (r.rowCount && r.rowCount > 0) {
    ordersPopulated++;
    console.log(`  ${id}: populated (offers=${offerUids?.length ?? 0} claim=${claimedBy ? "Y" : "N"} msg=${messageId ? "Y" : "N"})`);
  } else {
    ordersSkipped++;
    console.log(`  ${id}: skipped (no PG row)`);
  }
}

console.log(
  `\nOrders populated=${ordersPopulated} empty=${ordersEmpty} skipped=${ordersSkipped}`,
);

// ── 3) Verification audit ───────────────────────────────────────────────────

const pgDriverCountRes = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM drivers`);
const pgDriverCount = Number(pgDriverCountRes.rows[0]?.c ?? "0");

const pgTokenCountRes = await pool.query<{ c: string }>(
  `SELECT count(*)::text AS c FROM drivers WHERE fcm_token IS NOT NULL AND length(fcm_token) > 0`,
);
const pgTokenCount = Number(pgTokenCountRes.rows[0]?.c ?? "0");

const pgMetaRes = await pool.query<{ sub: string; rat: string; trp: string }>(
  `SELECT
     count(*) FILTER (WHERE subscription_expires_at IS NOT NULL)::text AS sub,
     count(*) FILTER (WHERE rating IS NOT NULL)::text                  AS rat,
     count(*) FILTER (WHERE trips_total IS NOT NULL)::text             AS trp
   FROM drivers`,
);

const pgOrderColsRes = await pool.query<{ off: string; ca: string; cb: string; mid: string }>(
  `SELECT
     count(*) FILTER (WHERE active_offer_driver_uids IS NOT NULL)::text AS off,
     count(*) FILTER (WHERE fcm_dispatch_claimed_at IS NOT NULL)::text  AS ca,
     count(*) FILTER (WHERE fcm_dispatch_claimed_by IS NOT NULL)::text  AS cb,
     count(*) FILTER (WHERE fcm_message_id IS NOT NULL)::text           AS mid
   FROM orders`,
);

console.log(`\n=== VERIFICATION AUDIT ===`);
console.log(`Driver coverage : FS=${fsDriverCount}  PG=${pgDriverCount}  match=${fsDriverCount === pgDriverCount}`);
console.log(`Token coverage  : FS=${fsTokenCount}  PG=${pgTokenCount}  match=${fsTokenCount === pgTokenCount}`);
console.log(`Metadata (PG)   : subscription=${pgMetaRes.rows[0]?.sub} rating=${pgMetaRes.rows[0]?.rat} trips_total=${pgMetaRes.rows[0]?.trp}`);
console.log(`Dispatch cols   : offerUids=${pgOrderColsRes.rows[0]?.off} claimedAt=${pgOrderColsRes.rows[0]?.ca} claimedBy=${pgOrderColsRes.rows[0]?.cb} messageId=${pgOrderColsRes.rows[0]?.mid}`);

await pool.end();
process.exit(0);
