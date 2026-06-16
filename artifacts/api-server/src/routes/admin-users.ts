/**
 * admin-users.ts
 *
 * Admin user management routes (owner-only for mutations).
 *
 *   GET  /api/admin/users                  — list all admin users (any admin)
 *   POST /api/admin/users                  — add admin user (owner only)
 *   PATCH /api/admin/users/:phone/disable  — disable admin (owner only)
 *   PATCH /api/admin/users/:phone/enable   — re-enable admin (owner only)
 *
 * All routes require a valid admin JWT (requireAdminJwt middleware).
 * Mutation routes additionally require role=owner (requireOwner middleware).
 *
 * Firestore collection: adminUsers/{+91XXXXXXXXXX}
 * Fields: phone, name, role, isActive, createdAt, createdBy
 */

import { Router }       from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { FieldValue }   from "firebase-admin/firestore";
import { requireAdminJwt, requireOwner } from "../lib/require-admin-jwt";

const router = Router();

const VALID_ROLES = new Set(["owner", "manager", "support"]);

function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, "");
  if (/^\+91\d{10}$/.test(s)) return s;
  if (/^91\d{10}$/.test(s))   return `+${s}`;
  if (/^0\d{10}$/.test(s))    return `+91${s.slice(1)}`;
  if (/^\d{10}$/.test(s))     return `+91${s}`;
  return null;
}

// ─── GET /api/admin/users ──────────────────────────────────────────────────────

router.get("/admin/users", requireAdminJwt, async (req, res) => {
  try {
    const db   = await adminFirestore();
    const snap = await db.collection("adminUsers").orderBy("createdAt", "asc").get();

    const users = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        phone:     d["phone"]     ?? doc.id,
        name:      d["name"]      ?? null,
        role:      d["role"]      ?? "support",
        isActive:  d["isActive"]  ?? true,
        createdAt: d["createdAt"]
          ? (d["createdAt"] as import("firebase-admin/firestore").Timestamp)
              .toDate()
              .toISOString()
          : null,
        createdBy: d["createdBy"] ?? null,
      };
    });

    req.log.info({ count: users.length }, "admin-users: listed");
    res.json({ ok: true, users });
  } catch (err) {
    req.log.error({ err }, "admin-users: GET failed");
    res.status(500).json({ ok: false, error: "Failed to fetch admin users." });
  }
});

// ─── POST /api/admin/users ─────────────────────────────────────────────────────

router.post("/admin/users", requireAdminJwt, requireOwner, async (req, res) => {
  const { phone: rawPhone, name, role } = (req.body ?? {}) as {
    phone?: unknown;
    name?:  unknown;
    role?:  unknown;
  };

  if (typeof rawPhone !== "string" || !rawPhone.trim()) {
    res.status(400).json({ ok: false, error: "phone is required." });
    return;
  }
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ ok: false, error: "name is required." });
    return;
  }
  if (typeof role !== "string" || !VALID_ROLES.has(role)) {
    res.status(400).json({ ok: false, error: "role must be owner | manager | support." });
    return;
  }

  const phone = normalisePhone(rawPhone.trim());
  if (!phone) {
    res.status(400).json({ ok: false, error: "Invalid phone number." });
    return;
  }

  try {
    const db  = await adminFirestore();
    const ref = db.collection("adminUsers").doc(phone);

    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({ ok: false, error: "Admin user with this phone already exists." });
      return;
    }

    await ref.set({
      phone,
      name:      name.trim(),
      role,
      isActive:  true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.adminUser!.phone,
    });

    req.log.info({ phone, role, addedBy: req.adminUser!.phone }, "admin-users: created");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin-users: POST failed");
    res.status(500).json({ ok: false, error: "Failed to create admin user." });
  }
});

// ─── PATCH /api/admin/users/:phone/disable ────────────────────────────────────

router.patch(
  "/admin/users/:phone/disable",
  requireAdminJwt,
  requireOwner,
  async (req, res) => {
    const targetPhone = decodeURIComponent(req.params["phone"] as string);

    // Prevent owner from disabling themselves
    if (targetPhone === req.adminUser!.phone) {
      res.status(400).json({ ok: false, error: "You cannot disable your own account." });
      return;
    }

    try {
      const db  = await adminFirestore();
      const ref = db.collection("adminUsers").doc(targetPhone);
      const snap = await ref.get();

      if (!snap.exists) {
        res.status(404).json({ ok: false, error: "Admin user not found." });
        return;
      }

      await ref.update({ isActive: false, disabledAt: FieldValue.serverTimestamp() });
      req.log.info({ targetPhone }, "admin-users: disabled");
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "admin-users: disable failed");
      res.status(500).json({ ok: false, error: "Failed to disable admin user." });
    }
  },
);

// ─── PATCH /api/admin/users/:phone/enable ─────────────────────────────────────

router.patch(
  "/admin/users/:phone/enable",
  requireAdminJwt,
  requireOwner,
  async (req, res) => {
    const targetPhone = decodeURIComponent(req.params["phone"] as string);

    try {
      const db  = await adminFirestore();
      const ref = db.collection("adminUsers").doc(targetPhone);
      const snap = await ref.get();

      if (!snap.exists) {
        res.status(404).json({ ok: false, error: "Admin user not found." });
        return;
      }

      await ref.update({ isActive: true, enabledAt: FieldValue.serverTimestamp() });
      req.log.info({ targetPhone }, "admin-users: enabled");
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "admin-users: enable failed");
      res.status(500).json({ ok: false, error: "Failed to enable admin user." });
    }
  },
);

export default router;
