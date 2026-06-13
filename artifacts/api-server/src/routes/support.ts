import { FieldValue } from "firebase-admin/firestore";
import { Router, type Request, type Response } from "express";
import { adminFirestore } from "../lib/firebase-admin";
import { requireAuth } from "../lib/require-auth";

const router = Router();

// ─── POST /api/support/tickets ────────────────────────────────────────────────
//
// Creates a new support ticket and its first message in a single batch write.
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

  const db        = await adminFirestore();
  const ticketRef = db.collection("supportTickets").doc();
  const msgRef    = ticketRef.collection("messages").doc();
  const batch     = db.batch();

  const ticketData: Record<string, unknown> = {
    subject:     (subject as string).trim(),
    category,
    priority,
    from:        fromField ?? "driver",
    userName:    typeof userName  === "string" ? userName  : "",
    userPhone:   typeof userPhone === "string" ? userPhone : "",
    userUid:     typeof userUid   === "string" ? userUid   : driverUid,
    status:      "open",
    lastMessage: (firstMessage as string).trim().slice(0, 120),
    createdAt:   FieldValue.serverTimestamp(),
    updatedAt:   FieldValue.serverTimestamp(),
  };
  if (orderId && typeof orderId === "string" && orderId.trim()) {
    ticketData["orderId"] = orderId.trim();
  }

  batch.set(ticketRef, ticketData);
  batch.set(msgRef, {
    from:      "user",
    senderUid: driverUid,
    text:      (firstMessage as string).trim(),
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  req.log.info({ driverUid, ticketId: ticketRef.id }, "support/tickets: created");
  res.status(201).json({ ok: true, ticketId: ticketRef.id });
});

// ─── GET /api/support/driver/:uid ─────────────────────────────────────────────
//
// Returns all tickets for a driver, ordered by updatedAt desc.
// The authenticated driver can only see their own tickets.
//
router.get("/support/driver/:uid", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { uid } = req.params as { uid: string };
  if (authedUid !== uid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  const db   = await adminFirestore();
  const snap = await db
    .collection("supportTickets")
    .where("userUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();

  const tickets = snap.docs.map((d) => {
    const data = d.data();
    return {
      id:          d.id,
      subject:     data["subject"]     ?? "",
      category:    data["category"]    ?? "general",
      priority:    data["priority"]    ?? "normal",
      status:      data["status"]      ?? "open",
      lastMessage: data["lastMessage"] ?? "",
      orderId:     data["orderId"]     ?? null,
      createdAt:   (data["createdAt"] as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
      updatedAt:   (data["updatedAt"] as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
    };
  });

  res.json({ ok: true, tickets });
});

// ─── GET /api/support/tickets/:id/messages ────────────────────────────────────
//
// Returns all messages for a ticket, oldest-first, for the thread view.
// Only the ticket owner can fetch messages.
//
router.get("/support/tickets/:id/messages", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { id: ticketId } = req.params as { id: string };
  const db               = await adminFirestore();
  const ticketSnap       = await db.collection("supportTickets").doc(ticketId).get();

  if (!ticketSnap.exists) {
    res.status(404).json({ ok: false, error: "ticket_not_found" });
    return;
  }
  const td = ticketSnap.data() as Record<string, unknown>;
  if (td["userUid"] !== authedUid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  const msgSnap = await db
    .collection("supportTickets")
    .doc(ticketId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();

  const messages = msgSnap.docs.map((d) => {
    const data = d.data();
    return {
      id:        d.id,
      from:      data["from"]      ?? "user",
      senderUid: data["senderUid"] ?? "",
      text:      data["text"]      ?? "",
      createdAt: (data["createdAt"] as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
    };
  });

  res.json({ ok: true, messages });
});

// ─── POST /api/support/tickets/:id/messages ───────────────────────────────────
//
// Appends a follow-up message to an existing ticket and updates lastMessage/updatedAt.
// Body: { from, senderUid, text }
// Only the ticket owner can send follow-up messages.
//
router.post("/support/tickets/:id/messages", async (req: Request, res: Response) => {
  const authedUid = await requireAuth(req, res);
  if (!authedUid) return;

  const { id: ticketId } = req.params as { id: string };
  const { from: fromField, senderUid, text } = req.body as {
    from?:      unknown;
    senderUid?: unknown;
    text?:      unknown;
  };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ ok: false, error: "text_required" });
    return;
  }

  const db         = await adminFirestore();
  const ticketRef  = db.collection("supportTickets").doc(ticketId);
  const ticketSnap = await ticketRef.get();

  if (!ticketSnap.exists) {
    res.status(404).json({ ok: false, error: "ticket_not_found" });
    return;
  }
  const td = ticketSnap.data() as Record<string, unknown>;
  if (td["userUid"] !== authedUid) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  const msgRef = ticketRef.collection("messages").doc();
  const batch  = db.batch();

  batch.set(msgRef, {
    from:      typeof fromField  === "string" ? fromField  : "user",
    senderUid: typeof senderUid === "string" ? senderUid : authedUid,
    text:      (text as string).trim(),
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(ticketRef, {
    lastMessage: (text as string).trim().slice(0, 120),
    updatedAt:   FieldValue.serverTimestamp(),
  });

  await batch.commit();

  req.log.info({ authedUid, ticketId, msgId: msgRef.id }, "support/tickets/messages: added");
  res.status(201).json({ ok: true, messageId: msgRef.id });
});

export default router;
