import { type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { adminAuth } from "./firebase-admin";
import { db, driversTable } from "@workspace/db";
import { SESSION_HEADER } from "./session";

/**
 * Validates the Firebase ID token from the Authorization header AND enforces the
 * single-device session.
 *
 * Returns the decoded UID on success, or writes a 401 and returns null.
 * Use in route handlers: const uid = await requireAuth(req, res); if (!uid) return;
 *
 * Single-device enforcement: if the driver row has a non-null active_session_id,
 * the request's `x-session-id` header MUST match it. A mismatch (or missing
 * header) means this device was superseded by a newer login, so we reject with
 * 401 { error: "SESSION_REPLACED" } and the client logs out. When
 * active_session_id is null (legacy rows / pre-first-login), enforcement is
 * skipped so existing sessions keep working until the next login claims a device.
 */
export async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }
  const token = authHeader.slice(7);

  let uid: string;
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }

  // ── Single-device session enforcement ────────────────────────────────────
  try {
    const rows = await db
      .select({ activeSessionId: driversTable.activeSessionId })
      .from(driversTable)
      .where(eq(driversTable.uid, uid))
      .limit(1);

    const activeSessionId = rows[0]?.activeSessionId ?? null;
    if (activeSessionId !== null) {
      const headerRaw = req.headers[SESSION_HEADER];
      const provided  = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
      if (provided !== activeSessionId) {
        res.status(401).json({
          error:   "SESSION_REPLACED",
          message: "Logged in on another device",
        });
        return null;
      }
    }
  } catch (err) {
    // A session-check infra failure must not silently grant access to a possibly
    // superseded device, but also must not hard-block a legitimate driver on a
    // transient DB hiccup. Fail open ONLY to the token-verified uid (the device
    // still proved a valid Firebase identity); log for visibility.
    req.log?.warn?.({ err }, "requireAuth: session check failed (allowing token-verified uid)");
  }

  return uid;
}
