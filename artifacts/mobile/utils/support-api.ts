import { firebaseAuth } from "@/utils/firebase";

const DOMAIN   = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";

async function getIdToken(): Promise<string | null> {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TicketStatus   = "open" | "in_progress" | "resolved" | "closed";
export type TicketCategory = "general" | "delivery" | "payment" | "account" | "technical";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface SupportTicket {
  id:          string;
  subject:     string;
  category:    string;
  priority:    string;
  status:      TicketStatus;
  lastMessage: string;
  orderId:     string | null;
  createdAt:   number | null;
  updatedAt:   number | null;
}

export interface TicketMessage {
  id:        string;
  from:      "user" | "support";
  senderUid: string;
  text:      string;
  createdAt: number | null;
}

export interface CreateTicketBody {
  subject:      string;
  category:     string;
  priority:     string;
  from:         "driver";
  userName:     string;
  userPhone:    string;
  userUid:      string;
  orderId?:     string;
  firstMessage: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/support/tickets
 * Create a new support ticket with its first message.
 */
export async function createTicket(
  body: CreateTicketBody,
): Promise<{ ok: true; ticketId: string } | { ok: false; error: string }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "not_authenticated" };
  try {
    const res  = await fetch(`${BASE_URL}/support/tickets`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body:    JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; ticketId?: string };
    if (!json.ok) return { ok: false, error: json.error ?? "create_failed" };
    return { ok: true, ticketId: json.ticketId ?? "" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * GET /api/support/driver/:uid
 * Fetch all tickets for the authenticated driver.
 */
export async function getDriverTickets(
  uid: string,
): Promise<{ ok: true; tickets: SupportTicket[] } | { ok: false; error: string }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "not_authenticated" };
  try {
    const res  = await fetch(`${BASE_URL}/support/driver/${encodeURIComponent(uid)}`, {
      headers: { "Authorization": `Bearer ${idToken}` },
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; tickets?: SupportTicket[] };
    if (!json.ok) return { ok: false, error: json.error ?? "fetch_failed" };
    return { ok: true, tickets: json.tickets ?? [] };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * GET /api/support/tickets/:id/messages
 * Fetch all messages for a ticket thread (oldest first).
 */
export async function getTicketMessages(
  ticketId: string,
): Promise<{ ok: true; messages: TicketMessage[] } | { ok: false; error: string }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "not_authenticated" };
  try {
    const res  = await fetch(`${BASE_URL}/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      headers: { "Authorization": `Bearer ${idToken}` },
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; messages?: TicketMessage[] };
    if (!json.ok) return { ok: false, error: json.error ?? "fetch_failed" };
    return { ok: true, messages: json.messages ?? [] };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * POST /api/support/tickets/:id/messages
 * Send a follow-up message on an existing ticket.
 */
export async function sendMessage(
  ticketId: string,
  body: { from: "user"; senderUid: string; text: string },
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, error: "not_authenticated" };
  try {
    const res  = await fetch(`${BASE_URL}/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body:    JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; messageId?: string };
    if (!json.ok) return { ok: false, error: json.error ?? "send_failed" };
    return { ok: true, messageId: json.messageId ?? "" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
