/**
 * require-admin-jwt.ts
 *
 * Express middleware that validates admin session JWTs.
 *
 * Usage:
 *   router.get("/admin/users", requireAdminJwt, handler);
 *   router.post("/admin/users", requireAdminJwt, requireOwner, handler);
 *
 * On success, attaches `req.adminUser` for use in the handler.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAdminJwt, type AdminJwtPayload } from "./admin-jwt";

// Augment Express Request so TypeScript knows about req.adminUser
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUser?: AdminJwtPayload;
    }
  }
}

export function requireAdminJwt(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  const auth = (req.headers["authorization"] ?? "") as string;
  if (!auth.startsWith("Bearer ")) {
    req.log.warn({ ip: req.ip }, "admin-jwt: missing Bearer token");
    res.status(401).json({ ok: false, error: "Authentication required." });
    return;
  }

  const token   = auth.slice(7).trim();
  const payload = verifyAdminJwt(token);

  if (!payload) {
    req.log.warn({ ip: req.ip }, "admin-jwt: invalid or expired token");
    res
      .status(401)
      .json({ ok: false, error: "Invalid or expired session. Please log in again." });
    return;
  }

  req.adminUser = payload;
  next();
}

/** Additional guard — must come after requireAdminJwt */
export function requireOwner(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  if (req.adminUser?.role !== "owner") {
    res.status(403).json({ ok: false, error: "Owner access required." });
    return;
  }
  next();
}
