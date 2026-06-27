/**
 * Dev-only routes — not mounted in production (NODE_ENV === "production").
 * Protected by SESSION_SECRET header to prevent accidental exposure.
 *
 * POST /api/dev/test-fcm
 *   Sends one FCM test push to drivers/918299013350.
 *   Returns { messageId } on success.
 */
import { Router, type IRouter } from "express";
import { adminMessaging } from "../lib/firebase-admin";
import { db, driversTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const TEST_DRIVER_UID = "918299013350";

function devGuard(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const secret = process.env["SESSION_SECRET"];
  if (!secret || req.headers["x-dev-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/dev/test-fcm", devGuard, async (req, res) => {
  try {
    const rows = await db
      .select({ fcmToken: driversTable.fcmToken })
      .from(driversTable)
      .where(eq(driversTable.uid, TEST_DRIVER_UID))
      .limit(1);
    const fcmToken = rows[0]?.fcmToken ?? undefined;

    if (!fcmToken) {
      res.status(404).json({ error: `No fcmToken for driver ${TEST_DRIVER_UID}` });
      return;
    }

    const messaging = await adminMessaging();
    const messageId = await messaging.send({
      token: fcmToken,
      notification: {
        title: "Test Delivery Alert",
        body: "FCM push test successful",
      },
      data: {
        type: "TEST_FCM",
      },
      android: {
        priority: "high",
        notification: {
          channelId: "incoming_orders_v2",
          sound: "ringtone",
        },
      },
    });

    req.log.info({ messageId, uid: TEST_DRIVER_UID }, "FCM test push sent");
    res.json({ ok: true, messageId, uid: TEST_DRIVER_UID });
  } catch (err) {
    req.log.error({ err }, "FCM test push failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
