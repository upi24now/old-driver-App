/**
 * Support ticket PostgreSQL service layer (Firestore retirement).
 *
 * All operations are PG-authoritative.  Firestore gets best-effort
 * projections from the route handlers — never from here.
 *
 * Error contract (matching wallet-pg-service.ts):
 *   Business-logic failures → return { ok: false; reason: string }.
 *   Infrastructure errors   → logged + re-thrown so callers surface 500.
 */

import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  supportTicketsTable,
  supportMessagesTable,
  type SupportTicket,
  type SupportMessage,
} from "@workspace/db";
import { logger } from "./logger";

// ── pgCreateSupportTicket ─────────────────────────────────────────────────────

/**
 * Atomically create a support ticket and its first message.
 * Returns the PG-assigned UUID for both the ticket and the message.
 */
export async function pgCreateSupportTicket(opts: {
  driverUid:    string;
  subject:      string;
  category:     string;
  priority:     string;
  fromField:    string;
  userName:     string;
  userPhone:    string;
  orderId?:     string;
  firstMessage: string;
}): Promise<{ ok: true; ticketId: string; messageId: string }> {
  const lastMessage = opts.firstMessage.trim().slice(0, 120);

  try {
    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .insert(supportTicketsTable)
        .values({
          driverUid:   opts.driverUid,
          subject:     opts.subject.trim(),
          category:    opts.category,
          priority:    opts.priority,
          fromField:   opts.fromField || "driver",
          userName:    opts.userName,
          userPhone:   opts.userPhone,
          orderId:     opts.orderId ?? undefined,
          status:      "open",
          lastMessage,
        })
        .returning({ id: supportTicketsTable.id });

      if (!ticket) throw new Error("support_tickets insert returned no row");

      const [msg] = await tx
        .insert(supportMessagesTable)
        .values({
          ticketId:  ticket.id,
          fromField: "user",
          senderUid: opts.driverUid,
          text:      opts.firstMessage.trim(),
        })
        .returning({ id: supportMessagesTable.id });

      if (!msg) throw new Error("support_messages insert returned no row");

      return { ticketId: ticket.id, messageId: msg.id };
    });

    logger.info(
      { driverUid: opts.driverUid, ticketId: result.ticketId },
      "[pgCreateSupportTicket] created",
    );
    return { ok: true, ...result };
  } catch (err) {
    logger.error({ err, driverUid: opts.driverUid }, "[pgCreateSupportTicket] failed");
    throw err;
  }
}

// ── pgGetTicketsForDriver ─────────────────────────────────────────────────────

/**
 * Return up to 50 support tickets for a driver, newest-updated-first.
 */
export async function pgGetTicketsForDriver(
  driverUid: string,
): Promise<SupportTicket[]> {
  return db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.driverUid, driverUid))
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(50);
}

// ── pgGetTicketWithMessages ───────────────────────────────────────────────────

/**
 * Fetch the ticket + all messages for an ownership-verified read.
 *
 * Returns:
 *   { ok: true; ticket; messages } — caller owns the ticket.
 *   { ok: false; reason: "not_found" }  — no ticket with this id.
 *   { ok: false; reason: "forbidden" }  — ticket exists but belongs to another driver.
 */
export async function pgGetTicketWithMessages(
  ticketId:  string,
  authedUid: string,
): Promise<
  | { ok: true;  ticket: SupportTicket; messages: SupportMessage[] }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  try {
    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, ticketId))
      .limit(1);

    if (!ticket) return { ok: false, reason: "not_found" };
    if (ticket.driverUid !== authedUid) return { ok: false, reason: "forbidden" };

    const messages = await db
      .select()
      .from(supportMessagesTable)
      .where(eq(supportMessagesTable.ticketId, ticketId))
      .orderBy(asc(supportMessagesTable.createdAt));

    return { ok: true, ticket, messages };
  } catch (err) {
    logger.error({ err, ticketId }, "[pgGetTicketWithMessages] failed");
    throw err;
  }
}

// ── pgAddSupportMessage ───────────────────────────────────────────────────────

/**
 * Append a follow-up message to a ticket and bump lastMessage / updatedAt.
 *
 * Returns:
 *   { ok: true; messageId } — message inserted.
 *   { ok: false; reason: "not_found" }  — no ticket with this id.
 *   { ok: false; reason: "forbidden" }  — ticket belongs to another driver.
 */
export async function pgAddSupportMessage(opts: {
  ticketId:  string;
  authedUid: string;
  fromField: string;
  senderUid: string;
  text:      string;
}): Promise<
  | { ok: true;  messageId: string }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  const lastMessage = opts.text.trim().slice(0, 120);
  const now         = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [ticket] = await tx
        .select({ id: supportTicketsTable.id, driverUid: supportTicketsTable.driverUid })
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.id, opts.ticketId))
        .limit(1);

      if (!ticket) return { ok: false as const, reason: "not_found" as const };
      if (ticket.driverUid !== opts.authedUid) return { ok: false as const, reason: "forbidden" as const };

      const [msg] = await tx
        .insert(supportMessagesTable)
        .values({
          ticketId:  opts.ticketId,
          fromField: opts.fromField || "user",
          senderUid: opts.senderUid,
          text:      opts.text.trim(),
        })
        .returning({ id: supportMessagesTable.id });

      if (!msg) throw new Error("support_messages insert returned no row");

      await tx
        .update(supportTicketsTable)
        .set({ lastMessage, updatedAt: now })
        .where(eq(supportTicketsTable.id, opts.ticketId));

      logger.info(
        { ticketId: opts.ticketId, messageId: msg.id },
        "[pgAddSupportMessage] added",
      );
      return { ok: true as const, messageId: msg.id };
    });
  } catch (err) {
    logger.error({ err, ticketId: opts.ticketId }, "[pgAddSupportMessage] failed");
    throw err;
  }
}
