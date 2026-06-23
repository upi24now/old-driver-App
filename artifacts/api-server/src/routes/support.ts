import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";
import {
  pgCreateSupportTicket,
  pgGetTicketsForDriver,
  pgGetTicketWithMessages,
  pgAddSupportMessage,
} from "../lib/support-pg-service";

const router = Router();

// UUID v4 guard — rejects malformed IDs before they reach PG and cause cast exceptions.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean { return UUID_RE.test(s); }

// ─── POST /api/support/tickets ────────────────────────────────────────────────
//
// Creates a new support ticket and its first message (PG-authoritative).
// Firestore gets a best-effort projection for admin-panel visibility.
// Body: { subject, category, priority, from, userName, userPhone, userUid, orderId?, firstMessage }
//
router.post("/support/tickets", async (req: Request, res: Response) => {
  const driverUid = await requireAuth(req, res);
  if (!driverUid) return;

  const {
    subject,
    category,
    priority,
    from: fromField,
    userName,
    userPhone,
    userUid,
    orderId,
    firstMessage,
  } = req.body as {
    subject?:      unknown;
    category?:     unknown;
    priority?:     unknown;
    from?:         unknown;
    userName?:     unknown;
    userPhone?:    unknown;
    userUid?:      unknown;
    orderId?:      unknown;
    firstMessage?: unknown;
  };

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    res.status(400).json({ ok: false, error: "subject_required" });
    return;
  }
  if (!category || typeof category !== "string") {
    res.status(400).json({ ok: false, error: "category_required" });
    return;
  }
  if (!priority || typeof priority !== "string") {
    res.status(400).json({ ok: false, error: "priority_required" });
    return;
  }
  if (!firstMessage || typeof firstMessage !== "string" || !firstMessage.trim()) {
    res.status(400).json({ ok: false, error: "message_required" });
    return;
  }

  let pgResult: Awaited<ReturnType<typeof pgCreateSupportTicket>>;
  try {
    pgResult = await pgCreateSupportTicket({
      driverUid,
      subject:      subject.trim(),
      category,
      priority,
      fromField:    typeof fromField === "string" ? fromField : "driver",
      userName:     typeof userName  === "string" ? userName  : "",
      userPhone:    typeof userPhone === "string" ? userPhone : "",
      orderId:      typeof orderId   === "string" && orderId.trim() ? orderId.trim() : undefined,
      firstMessage: firstMessage.trim(),
    });
  } catch (err) {
    req.log.error({ err, driverUid }, "support/tickets: PG create failed");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  req.log.info({ driverUid, ticketId: pgResult.ticketId }, "support/tickets: created (PG)");

  // ── Best-effort Firestore projection (admin visibility) ────────────────────
  void (async () => {
    try {
      const db        = await adminFirestore();
      const ticketRef = db.collection("supportTickets").doc(pgResult.ticketId);
      const msgRef    = ticketRef.collection("messages").doc(pgResult.messageId);
      const batch     = db.batch();

      const ticketData: Record<string, unknown> = {
        subject:     (subject as string).trim(),
        category,
        priority,
        from:        typeof fromField === "string" ? fromField : "driver",
        userName:    typeof userName  === "string" ? userName  : "",
        userPhone:   typeof userPhone === "string" ? userPhone : "",
        userUid:     typeof userUid   === "string" ? userUid   : driverUid,
        status:      "open",
        lastMessage: (firstMessage as string).trim().slice(0, 120),
        pgTicketId:  pgResult.ticketId,
        createdAt:   FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      };
      if (orderId && typeof orderId === "string" && orderId.trim()) {
        ticketData["orderId"] = orderId.trim();
      }

      batch.set(ticketRef, ticketData);
      batch.set(msgRef, {
        from:      "user",
        senderUid: driverUid,   // always server-authoritative
        text:      (firstMessage as string).trim(),
        createdAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();
    } catch (e) {
      req.log.warn({ err: e, ticketId: pgResult.ticketId }, "[FS_PROJECTION] support ticket — non-blocking");
    }
  })();

  res.status(201).json({ ok: true, ticketId: pgResult.ticketId });
});

// ─── GET /api/support/driver/:uid ─────────────────────────────────────────────
//
// Returns all tickets for a driver, ordered by updatedAt desc (PG-authoritative).
//
router.get("/support/driver/:uid", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { uid } = req.params as { uid: string };
  if (authedUid !== uid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  let rows: Awaited<ReturnType<typeof pgGetTicketsForDriver>>;
  try {
    rows = await pgGetTicketsForDriver(uid);
  } catch (err) {
    req.log.error({ err, uid }, "support/driver: PG list failed");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  const tickets = rows.map((t) => ({
    id:          t.id,
    subject:     t.subject,
    category:    t.category,
    priority:    t.priority,
    status:      t.status,
    lastMessage: t.lastMessage ?? "",
    orderId:     t.orderId ?? null,
    createdAt:   t.createdAt ? t.createdAt.getTime() : null,
    updatedAt:   t.updatedAt ? t.updatedAt.getTime() : null,
  }));

  res.json({ ok: true, tickets });
});

// ─── GET /api/support/tickets/:id/messages ────────────────────────────────────
//
// Returns all messages for a ticket, oldest-first (PG-authoritative).
// Only the ticket owner can fetch messages.
//
router.get("/support/tickets/:id/messages", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { id: ticketId } = req.params as { id: string };

  // Reject non-UUID IDs before they reach PG (avoids cast exceptions).
  if (!isUuid(ticketId)) {
    res.status(404).json({ ok: false, error: "ticket_not_found" });
    return;
  }

  let result: Awaited<ReturnType<typeof pgGetTicketWithMessages>>;
  try {
    result = await pgGetTicketWithMessages(ticketId, authedUid);
  } catch (err) {
    req.log.error({ err, ticketId }, "support/tickets/messages GET: PG query failed");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 403;
    res.status(status).json({ ok: false, error: result.reason });
    return;
  }

  const messages = result.messages.map((m) => ({
    id:        m.id,
    from:      m.fromField,
    senderUid: m.senderUid,
    text:      m.text,
    createdAt: m.createdAt ? m.createdAt.getTime() : null,
  }));

  res.json({ ok: true, messages });
});

// ─── POST /api/support/tickets/:id/messages ───────────────────────────────────
//
// Appends a follow-up message to an existing ticket (PG-authoritative).
// Only the ticket owner can send follow-up messages.
// Sender fields (from, senderUid) are server-authoritative — body values are
// ignored to prevent spoofing (e.g. impersonating support agents).
// Firestore gets a best-effort projection.
// Body: { text }  (from and senderUid are intentionally ignored)
//
router.post("/support/tickets/:id/messages", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { id: ticketId } = req.params as { id: string };

  // Reject non-UUID IDs before they reach PG.
  if (!isUuid(ticketId)) {
    res.status(404).json({ ok: false, error: "ticket_not_found" });
    return;
  }

  const { text } = req.body as { text?: unknown };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ ok: false, error: "text_required" });
    return;
  }

  // from and senderUid are server-authoritative — ignore client body values.
  const safeFrom      = "user";
  const safeSenderUid = authedUid;

  let result: Awaited<ReturnType<typeof pgAddSupportMessage>>;
  try {
    result = await pgAddSupportMessage({
      ticketId,
      authedUid,
      fromField: safeFrom,
      senderUid: safeSenderUid,
      text:      (text as string).trim(),
    });
  } catch (err) {
    req.log.error({ err, ticketId }, "support/tickets/messages POST: PG write failed");
    res.status(500).json({ ok: false, error: "server_error" });
    return;
  }

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 403;
    res.status(status).json({ ok: false, error: result.reason });
    return;
  }

  req.log.info({ authedUid, ticketId, messageId: result.messageId }, "support/tickets/messages: added (PG)");

  // ── Best-effort Firestore projection ──────────────────────────────────────
  void (async () => {
    try {
      const db        = await adminFirestore();
      const ticketRef = db.collection("supportTickets").doc(ticketId);
      const msgRef    = ticketRef.collection("messages").doc(result.messageId);
      const batch     = db.batch();

      batch.set(msgRef, {
        from:      safeFrom,        // server-authoritative
        senderUid: safeSenderUid,   // server-authoritative
        text:      (text as string).trim(),
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.update(ticketRef, {
        lastMessage: (text as string).trim().slice(0, 120),
        updatedAt:   FieldValue.serverTimestamp(),
      });

      await batch.commit();
    } catch (e) {
      req.log.warn({ err: e, ticketId, messageId: result.messageId }, "[FS_PROJECTION] support message — non-blocking");
    }
  })();

  res.status(201).json({ ok: true, messageId: result.messageId });
});

export default router;
