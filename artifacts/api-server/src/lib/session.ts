import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, driversTable } from "@workspace/db";

// ─── Single-device session ──────────────────────────────────────────────────
//
// One account = one active device. Every successful login (verify-pin /
// verify-otp / set-pin) mints a fresh random session id, stores it on the
// driver row, and returns it to the client. The client echoes it on every
// authenticated request via the `x-session-id` header. requireAuth rejects any
// request whose header does not match the stored active_session_id (when set)
// with 401 SESSION_REPLACED, logging out the superseded device.

export const SESSION_HEADER = "x-session-id";

export function mintSessionId(): string {
  return randomUUID();
}

/**
 * Persist `sessionId` as the driver's single active session.
 *
 * If the driver row does not exist yet (brand-new user who hasn't registered),
 * the UPDATE affects 0 rows — that is fine: the id is still returned to the
 * client for local storage, and the server persists it on the next login once
 * the row exists. Enforcement only kicks in once active_session_id is non-null.
 */
export async function setActiveSession(uid: string, sessionId: string): Promise<void> {
  await db
    .update(driversTable)
    .set({
      activeSessionId: sessionId,
      activeSessionAt: new Date(),
      updatedAt:       new Date(),
    })
    .where(eq(driversTable.uid, uid));
}
