import { type Request, type Response } from "express";
import { adminAuth } from "./firebase-admin";

/**
 * Validates the Firebase ID token from the Authorization header.
 * Returns the decoded UID on success, or writes a 401 and returns null.
 * Use in route handlers: const uid = await requireAuth(req, res); if (!uid) return;
 */
export async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const auth    = await adminAuth();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}
