/**
 * admin-data.ts
 *
 * Admin-only data query routes. Authenticated via requireAdminJwt.
 *
 * Routes:
 *   GET /api/admin/orders           — list all orders (paginated, optional ?status=)
 *   GET /api/admin/drivers/:uid/detail — driver profile + order stats + wallet + location
 */

import { Router } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAdminJwt } from "../lib/require-admin-jwt";

const router = Router();

// ─── GET /api/admin/orders ────────────────────────────────────────────────────

/**
 * Returns up to `limit` (max 200, default 100) orders sorted by createdAt desc.
 * Optionally filter by status via ?status=delivered|cancelled|…
 *
 * Response 200:
 * {
 *   ok: true,
 *   orders: Array<{
 *     id:             string
 *     status:         string
 *     customerId?:    string
 *     customerName?:  string
 *     customerPhone?: string
 *     customerRating?: number
 *     driverUid?:     string
 *     driverName?:    string
 *     pickupAddress?: string
 *     dropAddress?:   string
 *     fareEstimate?:  number
 *     paymentMode?:   string
 *     createdAt?:     string   (ISO timestamp)
 *     deliveredAt?:   string
 *     acceptedAt?:    string
 *     rejectedBy?:    string[]
 *   }>
 * }
 */
router.get("/admin/orders", requireAdminJwt, async (req, res) => {
  const statusFilter = typeof req.query["status"] === "string" ? req.query["status"] : null;
  const limitParam   = parseInt(String(req.query["limit"] ?? "100"), 10);
  const pageSize     = Math.min(Math.max(1, isNaN(limitParam) ? 100 : limitParam), 200);

  try {
    const db = await adminFirestore();

    let q: FirebaseFirestore.Query = db.collection("orders");
    if (statusFilter) {
      q = q.where("status", "==", statusFilter);
    }
    // Sort by createdAt desc — index required on (status, createdAt) and (createdAt)
    q = q.orderBy("createdAt", "desc").limit(pageSize);

    const snap = await q.get();

    const tsToIso = (v: unknown): string | null => {
      if (!v) return null;
      if (typeof (v as any).toDate === "function") {
        return (v as any).toDate().toISOString();
      }
      if (typeof v === "number") return new Date(v).toISOString();
      return null;
    };

    const orders = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id:             doc.id,
        status:         (d["status"]         as string | undefined) ?? "unknown",
        customerId:     (d["customerId"]      as string | undefined) ?? null,
        customerName:   (d["customerName"]    as string | undefined) ?? null,
        customerPhone:  (d["customerPhone"]   as string | undefined) ?? null,
        customerRating: (d["customerRating"]  as number | undefined) ?? null,
        driverUid:      (d["driverUid"]       as string | undefined) ?? null,
        driverName:     (d["driverName"]      as string | undefined) ?? null,
        pickupAddress:  (d["pickupAddress"]   as string | undefined) ?? null,
        dropAddress:    (d["dropAddress"]     as string | undefined) ??
                        (d["deliveryAddress"] as string | undefined) ?? null,
        fareEstimate:   (d["fareEstimate"]    as number | undefined) ?? null,
        paymentMode:    (d["paymentMode"]     as string | undefined) ?? null,
        createdAt:      tsToIso(d["createdAt"]),
        deliveredAt:    tsToIso(d["deliveredAt"]),
        acceptedAt:     tsToIso(d["acceptedAt"]),
        rejectedBy:     Array.isArray(d["rejectedBy"]) ? (d["rejectedBy"] as string[]) : [],
      };
    });

    req.log.info({ count: orders.length, statusFilter }, "admin-data: listed orders");
    res.json({ ok: true, orders });
  } catch (err) {
    req.log.error({ err }, "admin-data: GET /admin/orders failed");
    res.status(500).json({ ok: false, error: "Failed to fetch orders." });
  }
});

// ─── GET /api/admin/drivers/:uid/detail ──────────────────────────────────────

/**
 * Returns a full driver profile including order stats, wallet, and live location.
 *
 * Response 200:
 * {
 *   ok: true,
 *   driver: {
 *     uid:                 string
 *     name?:               string
 *     phone?:              string
 *     city?:               string
 *     vehicleNumber?:      string
 *     licenseNumber?:      string
 *     verificationStatus?: string
 *     accountStatus?:      string
 *     rating?:             number
 *     isOnline?:           boolean
 *     // Location
 *     latitude?:           number
 *     longitude?:          number
 *     lastSeenAt?:         string    (ISO)
 *     // Wallet
 *     walletBalance:       number
 *     totalEarnings:       number
 *     completedDeliveries: number
 *     totalPaid:           number
 *     // Order stats
 *     ordersCompleted:     number
 *     ordersCancelled:     number
 *     ordersRejectedBy:    number    (orders where this driver was in rejectedBy[])
 *   }
 * }
 */
router.get("/admin/drivers/:uid/detail", requireAdminJwt, async (req, res) => {
  const uid = req.params["uid"] as string;
  if (!uid) {
    res.status(400).json({ ok: false, error: "uid is required." });
    return;
  }

  try {
    const db = await adminFirestore();

    const tsToIso = (v: unknown): string | null => {
      if (!v) return null;
      if (typeof (v as any).toDate === "function") return (v as any).toDate().toISOString();
      if (typeof v === "number") return new Date(v).toISOString();
      return null;
    };

    // Parallel fetch: driver doc, wallet doc, order stats
    const [driverSnap, walletSnap, completedSnap, cancelledSnap, rejectedSnap] = await Promise.all([
      db.doc(`drivers/${uid}`).get(),
      db.doc(`wallets/${uid}`).get(),
      db.collection("orders")
        .where("driverUid", "==", uid)
        .where("status", "==", "delivered")
        .count()
        .get(),
      db.collection("orders")
        .where("driverUid", "==", uid)
        .where("status", "==", "cancelled")
        .count()
        .get(),
      db.collection("orders")
        .where("rejectedBy", "array-contains", uid)
        .count()
        .get(),
    ]);

    if (!driverSnap.exists) {
      res.status(404).json({ ok: false, error: "driver_not_found" });
      return;
    }

    const d = driverSnap.data() ?? {};
    const w = walletSnap.exists ? (walletSnap.data() ?? {}) : {};

    const driver = {
      uid,
      name:                 (d["name"]               as string  | undefined) ?? null,
      phone:                (d["phone"]              as string  | undefined) ?? null,
      city:                 (d["city"]               as string  | undefined) ?? null,
      vehicleId:            (d["vehicleId"]          as string  | undefined) ?? null,
      vehicleNumber:        (d["vehicleNumber"]      as string  | undefined) ?? null,
      licenseNumber:        (d["licenseNumber"]      as string  | undefined) ?? null,
      verificationStatus:   (d["verificationStatus"] as string  | undefined) ?? null,
      accountStatus:        (d["accountStatus"]      as string  | undefined) ?? null,
      suspendReason:        (d["suspendReason"]      as string  | undefined) ?? null,
      blacklistReason:      (d["blacklistReason"]    as string  | undefined) ?? null,
      rating:               (d["rating"]             as number  | undefined) ?? null,
      isOnline:             (d["isOnline"]           as boolean | undefined) ?? false,
      // Location (written by PATCH /api/drivers/:uid/status and POST /api/drivers/:uid/location)
      latitude:             (d["latitude"]           as number  | undefined) ?? null,
      longitude:            (d["longitude"]          as number  | undefined) ?? null,
      lastSeenAt:           tsToIso(d["lastSeenAt"]),
      // Wallet
      walletBalance:        (w["balance"]             as number | undefined) ?? 0,
      totalEarnings:        (w["totalEarnings"]       as number | undefined) ?? 0,
      completedDeliveries:  (w["completedDeliveries"] as number | undefined) ?? 0,
      totalPaid:            (w["totalPaid"]           as number | undefined) ?? 0,
      // Order stats
      ordersCompleted:  completedSnap.data().count,
      ordersCancelled:  cancelledSnap.data().count,
      ordersRejectedBy: rejectedSnap.data().count,
    };

    req.log.info({ uid }, "admin-data: fetched driver detail");
    res.json({ ok: true, driver });
  } catch (err) {
    req.log.error({ err, uid }, "admin-data: GET /admin/drivers/:uid/detail failed");
    res.status(500).json({ ok: false, error: "Failed to fetch driver detail." });
  }
});

export default router;
