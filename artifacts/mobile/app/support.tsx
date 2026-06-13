import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import {
  createTicket,
  getDriverTickets,
  getTicketMessages,
  sendMessage,
  type SupportTicket,
  type TicketMessage,
} from "@/utils/support-api";

// ─── Constants ────────────────────────────────────────────────────────────────

type ScreenView = "list" | "create" | "thread";

const CATEGORIES = [
  { value: "general",   label: "General" },
  { value: "delivery",  label: "Delivery" },
  { value: "payment",   label: "Payment" },
  { value: "account",   label: "Account" },
  { value: "technical", label: "Technical" },
] as const;

const PRIORITIES = [
  { value: "low",    label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high",   label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

type Category = typeof CATEGORIES[number]["value"];
type Priority = typeof PRIORITIES[number]["value"];

const CAT_ICON: Record<string, string> = {
  general:   "help-circle",
  delivery:  "package",
  payment:   "credit-card",
  account:   "user",
  technical: "tool",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    "  ·  " +
    d
      .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
      .toUpperCase()
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const cfgMap: Record<string, { label: string; bg: string; fg: string }> = {
    open:        { label: "Open",        bg: colors.infoSoft,    fg: colors.info },
    in_progress: { label: "In Progress", bg: colors.warningSoft, fg: colors.warningText },
    resolved:    { label: "Resolved",    bg: colors.successSoft, fg: colors.successText },
    closed:      { label: "Closed",      bg: colors.muted,       fg: colors.mutedForeground },
  };
  const c = cfgMap[status] ?? cfgMap["open"]!;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

// ─── ChipPicker ──────────────────────────────────────────────────────────────

function ChipPicker({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const colors = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              activeOpacity={0.7}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor:     active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driverUid, profile, phone } = useDriver();

  const [view,           setView]           = useState<ScreenView>("list");
  const [tickets,        setTickets]        = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages,       setMessages]       = useState<TicketMessage[]>([]);
  const [loadingMsgs,    setLoadingMsgs]    = useState(false);

  // Create form
  const [subject,    setSubject]    = useState("");
  const [category,   setCategory]   = useState<Category>("general");
  const [priority,   setPriority]   = useState<Priority>("normal");
  const [msgText,    setMsgText]    = useState("");
  const [orderId,    setOrderId]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState<string | null>(null);
  const [formDone,   setFormDone]   = useState(false);

  // Reply
  const [replyText,    setReplyText]    = useState("");
  const [replySending, setReplySending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadTickets = async () => {
    if (!driverUid) return;
    setLoadingTickets(true);
    const r = await getDriverTickets(driverUid);
    if (r.ok) setTickets(r.tickets);
    setLoadingTickets(false);
  };

  useEffect(() => {
    void loadTickets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverUid]);

  const openThread = async (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setMessages([]);
    setView("thread");
    setLoadingMsgs(true);
    const r = await getTicketMessages(ticket.id);
    if (r.ok) setMessages(r.messages);
    setLoadingMsgs(false);
  };

  // ── Submit new ticket ──────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!driverUid || submitting) return;
    setFormError(null);
    if (!subject.trim()) { setFormError("Please enter a subject."); return; }
    if (!msgText.trim()) { setFormError("Please describe your issue."); return; }

    setSubmitting(true);
    const r = await createTicket({
      subject:      subject.trim(),
      category,
      priority,
      from:         "driver",
      userName:     profile?.name ?? "",
      userPhone:    phone ?? "",
      userUid:      driverUid,
      orderId:      orderId.trim() || undefined,
      firstMessage: msgText.trim(),
    });
    setSubmitting(false);

    if (r.ok) {
      setFormDone(true);
      setSubject(""); setCategory("general"); setPriority("normal");
      setMsgText(""); setOrderId("");
      void loadTickets();
      setTimeout(() => { setFormDone(false); setView("list"); }, 1500);
    } else {
      setFormError("Failed to submit. Please check your connection and try again.");
    }
  };

  // ── Send reply ─────────────────────────────────────────────────────────────

  const handleSendReply = async () => {
    if (!driverUid || !selectedTicket || !replyText.trim() || replySending) return;
    setReplySending(true);
    const r = await sendMessage(selectedTicket.id, {
      from:      "user",
      senderUid: driverUid,
      text:      replyText.trim(),
    });
    if (r.ok) {
      setReplyText("");
      const updated = await getTicketMessages(selectedTicket.id);
      if (updated.ok) {
        setMessages(updated.messages);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      }
    }
    setReplySending(false);
  };

  // ── Back ───────────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (view === "create") { setView("list"); return; }
    if (view === "thread") {
      setSelectedTicket(null);
      setMessages([]);
      setView("list");
      return;
    }
    router.back();
  };

  const headerTitle =
    view === "create" ? "New Ticket" :
    view === "thread" ? "Ticket Thread" :
    "Help & Support";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 12,
            backgroundColor:   colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {headerTitle}
        </Text>

        {view === "list" ? (
          <TouchableOpacity
            onPress={() => { setFormError(null); setFormDone(false); setView("create"); }}
            style={[styles.newBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={14} color="#FFFFFF" />
            <Text style={styles.newBtnText}>New</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {/* ── LIST VIEW ──────────────────────────────────────────────────────── */}
      {view === "list" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {loadingTickets ? (
            <ActivityIndicator style={{ marginTop: 64 }} size="large" color={colors.primary} />
          ) : tickets.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
                <Feather name="message-square" size={32} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No tickets yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Tap "New" to raise a support request. We typically respond within a few hours.
              </Text>
            </View>
          ) : (
            tickets.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.ticketCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => openThread(t)}
                activeOpacity={0.75}
              >
                <View style={styles.ticketCardTop}>
                  <View style={[styles.catIcon, { backgroundColor: colors.muted }]}>
                    <Feather
                      name={(CAT_ICON[t.category] ?? "help-circle") as any}
                      size={14}
                      color={colors.foreground}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.ticketSubject, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {t.subject}
                    </Text>
                    <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>
                      {t.category.charAt(0).toUpperCase() + t.category.slice(1)}
                      {t.orderId ? `  ·  #${t.orderId.slice(-6).toUpperCase()}` : ""}
                    </Text>
                  </View>
                  <StatusBadge status={t.status} />
                </View>

                {!!t.lastMessage && (
                  <Text
                    style={[styles.ticketPreview, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                  >
                    {t.lastMessage}
                  </Text>
                )}

                <Text style={[styles.ticketTime, { color: colors.mutedForeground }]}>
                  {fmtTime(t.updatedAt)}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* ── CREATE VIEW ────────────────────────────────────────────────────── */}
      {view === "create" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 18 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Subject */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Subject *</Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              placeholder="Brief summary of your issue"
              placeholderTextColor={colors.mutedForeground}
              value={subject}
              onChangeText={setSubject}
              maxLength={120}
            />
          </View>

          {/* Category */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Category</Text>
            <ChipPicker
              options={CATEGORIES}
              value={category}
              onChange={(v) => setCategory(v as Category)}
            />
          </View>

          {/* Priority */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Priority</Text>
            <ChipPicker
              options={PRIORITIES}
              value={priority}
              onChange={(v) => setPriority(v as Priority)}
            />
          </View>

          {/* Description */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Description *</Text>
            <TextInput
              style={[
                styles.textarea,
                { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              placeholder="Describe your issue in detail…"
              placeholderTextColor={colors.mutedForeground}
              value={msgText}
              onChangeText={setMsgText}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              maxLength={1000}
            />
          </View>

          {/* Order ID (optional) */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              Order ID{" "}
              <Text style={{ color: colors.mutedForeground, fontWeight: "400" }}>(optional)</Text>
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              placeholder="e.g. ABC123"
              placeholderTextColor={colors.mutedForeground}
              value={orderId}
              onChangeText={setOrderId}
              autoCapitalize="characters"
              maxLength={30}
            />
          </View>

          {/* Error */}
          {!!formError && (
            <View style={[styles.alertBox, { backgroundColor: colors.errorSoft }]}>
              <Feather name="alert-circle" size={14} color={colors.error} />
              <Text style={[styles.alertText, { color: colors.error }]}>{formError}</Text>
            </View>
          )}

          {/* Success */}
          {formDone && (
            <View style={[styles.alertBox, { backgroundColor: colors.successSoft }]}>
              <Feather name="check-circle" size={14} color={colors.successText} />
              <Text style={[styles.alertText, { color: colors.successText }]}>
                Ticket submitted! We'll get back to you shortly.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: submitting || formDone ? colors.muted : colors.primary },
            ]}
            onPress={handleSubmit}
            disabled={submitting || formDone}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {formDone ? "Submitted!" : "Submit Ticket"}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── THREAD VIEW ────────────────────────────────────────────────────── */}
      {view === "thread" && !!selectedTicket && (
        <>
          {/* Ticket info strip */}
          <View
            style={[
              styles.threadInfo,
              { backgroundColor: colors.surface, borderBottomColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.threadSubject, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {selectedTicket.subject}
              </Text>
              <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>
                {selectedTicket.category.charAt(0).toUpperCase() + selectedTicket.category.slice(1)}
              </Text>
            </View>
            <StatusBadge status={selectedTicket.status} />
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 10 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {loadingMsgs ? (
              <ActivityIndicator style={{ marginTop: 48 }} color={colors.primary} />
            ) : messages.length === 0 ? (
              <Text
                style={[
                  styles.emptyBody,
                  { color: colors.mutedForeground, textAlign: "center", marginTop: 48 },
                ]}
              >
                No messages yet.
              </Text>
            ) : (
              messages.map((m) => {
                const isDriver = m.from === "user";
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.bubble,
                      isDriver
                        ? [styles.bubbleDriver, { backgroundColor: colors.primary }]
                        : [styles.bubbleSupport, { backgroundColor: colors.surface, borderColor: colors.border }],
                    ]}
                  >
                    {!isDriver && (
                      <Text style={[styles.bubbleSender, { color: colors.mutedForeground }]}>
                        Support
                      </Text>
                    )}
                    <Text
                      style={[
                        styles.bubbleText,
                        { color: isDriver ? "#FFFFFF" : colors.foreground },
                      ]}
                    >
                      {m.text}
                    </Text>
                    <Text
                      style={[
                        styles.bubbleTime,
                        { color: isDriver ? "rgba(255,255,255,0.6)" : colors.mutedForeground },
                      ]}
                    >
                      {fmtTime(m.createdAt)}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Reply bar — only shown while ticket is open or in_progress */}
          {(selectedTicket.status === "open" || selectedTicket.status === "in_progress") && (
            <View
              style={[
                styles.replyBar,
                {
                  backgroundColor: colors.surface,
                  borderTopColor:  colors.border,
                  paddingBottom:   insets.bottom + 8,
                },
              ]}
            >
              <TextInput
                style={[
                  styles.replyInput,
                  { color: colors.foreground, backgroundColor: colors.muted },
                ]}
                placeholder="Type a message…"
                placeholderTextColor={colors.mutedForeground}
                value={replyText}
                onChangeText={setReplyText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                onPress={handleSendReply}
                disabled={!replyText.trim() || replySending}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor:
                      replyText.trim() && !replySending ? colors.primary : colors.muted,
                  },
                ]}
                activeOpacity={0.8}
              >
                {replySending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather
                    name="send"
                    size={16}
                    color={replyText.trim() ? "#FFFFFF" : colors.mutedForeground}
                  />
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Closed/resolved notice */}
          {(selectedTicket.status === "resolved" || selectedTicket.status === "closed") && (
            <View
              style={[
                styles.closedNotice,
                { backgroundColor: colors.muted, borderTopColor: colors.border, paddingBottom: insets.bottom + 10 },
              ]}
            >
              <Feather name="check-circle" size={14} color={colors.mutedForeground} />
              <Text style={[styles.closedText, { color: colors.mutedForeground }]}>
                This ticket is {selectedTicket.status}. Open a new ticket if you need further help.
              </Text>
            </View>
          )}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               12,
    paddingHorizontal: 16,
    paddingBottom:     14,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width:          36,
    height:         36,
    borderRadius:   18,
    alignItems:     "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex:       1,
    fontSize:   17,
    fontWeight: "700",
    textAlign:  "center",
  },
  newBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius:    18,
  },
  newBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },

  // Empty state
  emptyState: {
    alignItems:      "center",
    gap:             12,
    marginTop:       80,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width:          72,
    height:         72,
    borderRadius:   36,
    alignItems:     "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyBody:  { fontSize: 14, lineHeight: 20, textAlign: "center" },

  // Ticket card
  ticketCard: {
    borderRadius: 12,
    borderWidth:  1,
    padding:      14,
    gap:          8,
  },
  ticketCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  catIcon: {
    width:          32,
    height:         32,
    borderRadius:   8,
    alignItems:     "center",
    justifyContent: "center",
  },
  ticketSubject: { fontSize: 14, fontWeight: "700" },
  ticketMeta:    { fontSize: 12, marginTop: 2 },
  ticketPreview: { fontSize: 13, lineHeight: 18 },
  ticketTime:    { fontSize: 11 },

  // Status badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      8,
    alignSelf:         "flex-start",
  },
  badgeText: { fontSize: 11, fontWeight: "700" },

  // Form fields
  fieldBlock: { gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "600" },
  input: {
    height:            44,
    borderRadius:      10,
    borderWidth:       1,
    paddingHorizontal: 12,
    fontSize:          14,
  },
  textarea: {
    minHeight:    120,
    borderRadius: 10,
    borderWidth:  1,
    padding:      12,
    fontSize:     14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical:   7,
    borderRadius:      20,
    borderWidth:       1,
  },
  chipText: { fontSize: 13, fontWeight: "600" },

  // Alerts
  alertBox: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
    padding:       12,
    borderRadius:  10,
  },
  alertText: { fontSize: 13, flex: 1 },

  // Submit
  submitBtn: {
    height:         50,
    borderRadius:   12,
    alignItems:     "center",
    justifyContent: "center",
  },
  submitBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },

  // Thread info strip
  threadInfo: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               12,
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: 1,
  },
  threadSubject: { fontSize: 14, fontWeight: "700" },

  // Chat bubbles
  bubble: {
    maxWidth:     "80%",
    padding:      12,
    borderRadius: 14,
    gap:          4,
  },
  bubbleDriver: {
    alignSelf:             "flex-end",
    borderBottomRightRadius: 4,
  },
  bubbleSupport: {
    alignSelf:            "flex-start",
    borderWidth:          1,
    borderBottomLeftRadius: 4,
  },
  bubbleSender: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  bubbleText:   { fontSize: 14, lineHeight: 20 },
  bubbleTime:   { fontSize: 10, alignSelf: "flex-end" },

  // Reply bar
  replyBar: {
    flexDirection:     "row",
    alignItems:        "flex-end",
    gap:               10,
    paddingTop:        10,
    paddingHorizontal: 16,
    borderTopWidth:    1,
  },
  replyInput: {
    flex:              1,
    borderRadius:      20,
    paddingHorizontal: 14,
    paddingVertical:   10,
    fontSize:          14,
    maxHeight:         100,
  },
  sendBtn: {
    width:          40,
    height:         40,
    borderRadius:   20,
    alignItems:     "center",
    justifyContent: "center",
  },

  // Closed notice
  closedNotice: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               8,
    paddingHorizontal: 16,
    paddingTop:        12,
    borderTopWidth:    1,
  },
  closedText: { fontSize: 13, flex: 1, lineHeight: 18 },
});
