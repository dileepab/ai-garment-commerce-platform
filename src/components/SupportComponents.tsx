'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { SupportThread, SupportThreadMessage } from '@/app/support/types';
import { SUPPORT_THREAD_POLL_MS } from '@/app/support/format';
import { updateEscalationWorkflowAction, sendSupportReplyAction } from '@/app/support/actions';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  message: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8",
  clock: ["M12 22a10 10 0 100-20 10 10 0 000 20", "M12 6v6l4 2"],
  check: "M20 6L9 17l-5-5",
  moreH: ["M12 13a1 1 0 100-2 1 1 0 000 2", "M19 13a1 1 0 100-2 1 1 0 000 2", "M5 13a1 1 0 100-2 1 1 0 000 2"],
};

const CHANNEL_COLORS: Record<string, string> = { messenger: "#0866FF", instagram: "#C13584", direct: "#6A635A" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct" };
const STATUS_CLASS: Record<string, string> = { escalated: "pill-escalated", pending: "pill-pending", resolved: "pill-resolved" };
const STATUS_LABEL: Record<string, string> = { escalated: "Escalated", pending: "Pending Reply", resolved: "Resolved" };

function getDisplayName(convo: SupportThread): string {
  return convo.customer?.name || convo.contactName || 'Unknown';
}

function getInitials(name: string): string {
  return name.substring(0, 2).toUpperCase();
}

function getMessageRole(role: string): 'customer' | 'ai' | 'agent' {
  const r = role.toLowerCase();
  if (r === 'customer' || r === 'user') return 'customer';
  if (r === 'ai' || r === 'assistant') return 'ai';
  return 'agent';
}

interface SupportMessagesPayload {
  messages: SupportThreadMessage[];
  hasMoreOlder?: boolean;
  escalation: {
    status: string;
    latestCustomerMessage: string | null;
    summary: string;
    updatedAt: string;
    updatedAtLabel: string;
    resolvedAt: string | null;
  };
}

interface SupportMessagesResponse {
  success: boolean;
  data?: SupportMessagesPayload;
  error?: string;
}

function getMessageText(msg: SupportThreadMessage): string {
  return msg.message;
}

function mergeMessages(messages: SupportThreadMessage[]): SupportThreadMessage[] {
  const byId = new Map<number, SupportThreadMessage>();
  for (const m of messages) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function getEscalationPatch(data: SupportMessagesPayload): Partial<SupportThread> {
  return {
    status: data.escalation.status,
    latestCustomerMessage: data.escalation.latestCustomerMessage,
    summary: data.escalation.summary,
    updatedAt: data.escalation.updatedAt,
    updatedAtLabel: data.escalation.updatedAtLabel,
    resolvedAt: data.escalation.resolvedAt,
  };
}

export function Thread({
  convo,
  onConvoUpdate = () => {},
}: {
  convo: SupportThread | null;
  onConvoUpdate?: (id: number, patch: Partial<SupportThread>) => void;
}) {
  const [reply, setReply] = useState("");
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const convoRef = useRef(convo);

  const selectedConvoId = convo?.id;
  const selectedConvoStatus = convo?.status;

  useEffect(() => {
    convoRef.current = convo;
  }, [convo]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [selectedConvoId]);

  useEffect(() => {
    if (shouldStickToBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedConvoId, convo?.messages?.length]);

  const loadOlderMessages = useCallback(async () => {
    const currentConvo = convoRef.current;
    if (!currentConvo || isLoadingOlder) return;
    setIsLoadingOlder(true);
    shouldStickToBottomRef.current = false;

    try {
      const beforeId = currentConvo.messages[0]?.id;
      if (!beforeId) return;

      const res = await fetch(`/api/support/escalations/${currentConvo.id}/messages?beforeId=${beforeId}`);
      const payload = (await res.json()) as SupportMessagesResponse;

      if (payload.success && payload.data) {
        const prevScrollHeight = messagesRef.current?.scrollHeight || 0;

        onConvoUpdate(currentConvo.id, {
          hasOlderMessages: payload.data.hasMoreOlder ?? false,
          messages: mergeMessages([...payload.data.messages, ...currentConvo.messages]),
        });

        // Wait for the prepended messages to render before restoring the viewport.
        setTimeout(() => {
          if (messagesRef.current) {
            messagesRef.current.scrollTop = messagesRef.current.scrollHeight - prevScrollHeight;
          }
        }, 0);
      }
    } catch (error) {
      console.error('Failed to load older messages', error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, onConvoUpdate]);

  const handleMessagesScroll = () => {
    if (!messagesRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    shouldStickToBottomRef.current = isAtBottom;

    if (scrollTop === 0 && convo?.hasOlderMessages && !isLoadingOlder) {
      void loadOlderMessages();
    }
  };

  useEffect(() => {
    let cancelled = false;

    const pollMessages = async () => {
      if (!selectedConvoId || pollingRef.current) return;
      pollingRef.current = true;

      try {
        const currentConvo = convoRef.current;
        if (!currentConvo) return;

        const latestMessageId = currentConvo.messages[currentConvo.messages.length - 1]?.id;
        const url = `/api/support/escalations/${selectedConvoId}/messages${latestMessageId ? `?afterId=${latestMessageId}` : ''}`;

        const response = await fetch(url, { cache: 'no-store' });
        const payload = (await response.json()) as SupportMessagesResponse;

        if (cancelled || !response.ok || !payload.success || !payload.data) return;

        const { data } = payload;
        const latestConvo = convoRef.current;
        if (!latestConvo || latestConvo.id !== currentConvo.id) return;

        const nextMessages = latestMessageId
          ? mergeMessages([...latestConvo.messages, ...data.messages])
          : data.messages;

        const hasNewMessages = data.messages.length > 0;
        const shouldScrollAfterUpdate = shouldStickToBottomRef.current;

        onConvoUpdate(currentConvo.id, {
          ...getEscalationPatch(data),
          hasOlderMessages: data.hasMoreOlder ?? latestConvo.hasOlderMessages,
          messages: nextMessages,
        });

        if (hasNewMessages && shouldScrollAfterUpdate) {
          shouldStickToBottomRef.current = true;
        }
      } catch (error) {
        console.error('Failed to refresh support messages', error);
      } finally {
        pollingRef.current = false;
      }
    };

    void pollMessages();
    const intervalId = window.setInterval(pollMessages, SUPPORT_THREAD_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedConvoId, selectedConvoStatus, onConvoUpdate]);

  if (!convo) return (
    <div className="thread-panel">
      <div className="thread-empty">
        <Icon d={ic.message} size={32} color="var(--color-border)" strokeWidth={1.2} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Select a conversation</div>
        <div style={{ fontSize: 12 }}>Choose from the list to view the thread</div>
      </div>
    </div>
  );

  const displayName = getDisplayName(convo);
  const initials = getInitials(displayName);
  const isResolved = convo.status === "resolved";
  const statusClass = STATUS_CLASS[convo.status || 'pending'] || "pill-pending";
  const statusLabel = STATUS_LABEL[convo.status || 'pending'] || "Pending Reply";

  return (
    <div className="thread-panel">
      <div className="thread-header">
        <div className="thread-header-info">
          <div className="thread-avatar" style={{ background: 'var(--color-accent)' }}>{initials}</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{displayName}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: "999px", background: CHANNEL_COLORS[convo.channel || 'direct'] + "20", color: CHANNEL_COLORS[convo.channel || 'direct'], fontSize: 10, fontWeight: 700 }}>
                {CHANNEL_LABELS[convo.channel || 'direct']}
              </span>
              <span className={`pill ${statusClass}`}>{statusLabel}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-fg-3)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
              {convo.orderId ? (
                <code style={{ fontFamily: "var(--font-mono)" }}>#ORD-{convo.orderId}</code>
              ) : (
                <span>No linked order</span>
              )}
              {!isResolved && (
                <>
                  <span>·</span>
                  <Icon d={ic.clock} size={11} color="var(--color-fg-3)" />
                  <span>Waiting {convo.wait || '—'}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isResolved && (
            <form action={updateEscalationWorkflowAction}>
              <input type="hidden" name="escalationId" value={convo.id} />
              <input type="hidden" name="nextStatus" value="resolved" />
              <button type="submit" className="btn btn-secondary" style={{ fontSize: 11 }}>
                <Icon d={ic.check} size={12} />Mark Resolved
              </button>
            </form>
          )}
          <button className="btn btn-ghost" style={{ padding: "6px" }}>
            <Icon d={ic.moreH} size={15} color="var(--color-fg-2)" />
          </button>
        </div>
      </div>

      <div className="thread-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--color-border-subtle)" }} />
          <span style={{ fontSize: 10, color: "var(--color-fg-3)", fontWeight: 600, whiteSpace: "nowrap" }}>Conversation Thread</span>
          <div style={{ flex: 1, height: 1, background: "var(--color-border-subtle)" }} />
        </div>
        <div className="thread-history-loader" aria-live="polite">
          {isLoadingOlder && <span>Loading earlier messages</span>}
        </div>

        {convo.messages.map((msg, i) => {
          const messageRole = getMessageRole(msg.role);
          const isCustomer = messageRole === "customer";
          const isAI = messageRole === "ai";
          const isAgent = messageRole === "agent";
          const showLabel = i === 0 || getMessageRole(convo.messages[i - 1].role) !== messageRole;

          return (
            <div key={msg.id || i} className={`msg-row ${messageRole}`}>
              {isCustomer && (
                <div className="msg-avatar" style={{ background: 'var(--color-accent)' }}>{initials}</div>
              )}
              {(isAI || isAgent) && (
                <div className="msg-avatar" style={{ background: isAI ? "var(--color-accent)" : "var(--color-navy)" }}>
                  {isAI ? <Icon d={ic.zap} size={11} color="white" strokeWidth={2.5} /> : "SA"}
                </div>
              )}
              <div className="msg-col">
                {showLabel && isAI && <div className="msg-label" style={{ color: "var(--color-accent)" }}>AI Assistant</div>}
                {showLabel && isAgent && <div className="msg-label" style={{ color: "var(--color-navy)" }}>Sara Altan · Agent</div>}
                <div className="msg-bubble">{getMessageText(msg)}</div>
                <span className="msg-time" suppressHydrationWarning>{msg.createdAtLabel}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {isResolved ? (
        <div className="reply-area reply-area-resolved">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="ai-badge"><Icon d={ic.zap} size={10} color="#7A3A18" />Bot resumed</span>
            <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>
              This support case is resolved. New customer messages are handled by the bot.
            </span>
          </div>
        </div>
      ) : (
        <div className="reply-area">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-2)" }}>Replying as</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)" }}>Sara Altan</span>
            <span style={{ fontSize: 11, color: "var(--color-fg-3)" }}>·</span>
            <span className="ai-badge"><Icon d={ic.clock} size={10} color="#7A3A18" />Bot paused</span>
          </div>
          <form
            action={sendSupportReplyAction}
            className="reply-inner"
            onSubmit={() => setReply("")}
          >
            <input type="hidden" name="escalationId" value={convo.id} />
            <textarea
              className="reply-textarea"
              name="reply"
              placeholder={`Reply to ${displayName}…`}
              value={reply}
              onChange={e => setReply(e.target.value)}
              required
            />
            <div className="reply-footer">
              <span className="reply-hint">Shift+Enter for new line</span>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: "6px 14px" }}
                disabled={!reply.trim()}
              >
                <Icon d={ic.send} size={12} />Send Reply
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
