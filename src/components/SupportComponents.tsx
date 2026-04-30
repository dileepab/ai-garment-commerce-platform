'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  sendSupportReplyAction,
  updateEscalationWorkflowAction,
} from '@/app/support/actions';
import { SUPPORT_THREAD_MESSAGE_LIMIT, SUPPORT_THREAD_POLL_MS } from '@/app/support/format';
import type { SupportThread, SupportThreadMessage } from '@/app/support/types';

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
const STATUS_CLASS: Record<string, string> = {
  escalated: "pill-escalated",
  open: "pill-escalated",
  pending: "pill-pending",
  in_progress: "pill-pending",
  resolved: "pill-resolved",
};
const STATUS_LABEL: Record<string, string> = {
  escalated: "Escalated",
  open: "Escalated",
  pending: "Pending Reply",
  in_progress: "Human Active",
  resolved: "Resolved",
};

function getDisplayName(convo: SupportThread): string {
  return convo.customer?.name || convo.contactName || `Customer ${convo.senderId || convo.id}`;
}

function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return initials || 'CU';
}

function getMessageRole(role?: string): 'customer' | 'ai' | 'agent' {
  const normalizedRole = role?.toLowerCase();

  if (normalizedRole === 'user' || normalizedRole === 'customer') {
    return 'customer';
  }

  if (normalizedRole === 'assistant' || normalizedRole === 'ai') {
    return 'ai';
  }

  return 'agent';
}

function getMessageText(msg: SupportThreadMessage): string {
  return msg.message;
}

interface SupportMessagesPayload {
  messages: SupportThreadMessage[];
  hasMoreOlder?: boolean;
  escalation: {
    id: number;
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

interface ThreadProps {
  convo: SupportThread | null;
  onConvoUpdate: (id: number, patch: Partial<SupportThread>) => void;
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

function mergeMessages(messages: SupportThreadMessage[]): SupportThreadMessage[] {
  const seen = new Set<number>();

  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function isNearThreadBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
}

async function fetchThreadMessages(
  escalationId: number,
  params: { afterId?: number; beforeId?: number } = {}
): Promise<SupportMessagesPayload> {
  const searchParams = new URLSearchParams({
    limit: String(SUPPORT_THREAD_MESSAGE_LIMIT),
  });

  if (params.afterId) searchParams.set('afterId', String(params.afterId));
  if (params.beforeId) searchParams.set('beforeId', String(params.beforeId));

  const response = await fetch(
    `/api/support/escalations/${escalationId}/messages?${searchParams.toString()}`,
    { cache: 'no-store' }
  );
  const payload = (await response.json()) as SupportMessagesResponse;

  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || 'Unable to load support messages.');
  }

  return payload.data;
}

export function Thread({ convo, onConvoUpdate }: ThreadProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const convoRef = useRef(convo);
  const lastConvoIdRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const pollingRef = useRef(false);
  const shouldStickToBottomRef = useRef(false);
  const [reply, setReply] = useState("");
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const selectedConvoId = convo?.id ?? null;
  const selectedConvoStatus = convo?.status ?? null;

  useEffect(() => {
    convoRef.current = convo;
  }, [convo]);

  useEffect(() => {
    if (!convo) return;

    const isNewConversation = lastConvoIdRef.current !== convo.id;
    if (!isNewConversation && !shouldStickToBottomRef.current) return;

    lastConvoIdRef.current = convo.id;
    shouldStickToBottomRef.current = false;

    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: isNewConversation ? 'auto' : 'smooth' });
    });
  }, [convo?.id, convo?.messages.length, convo]);

  const loadOlderMessages = useCallback(async () => {
    const currentConvo = convoRef.current;
    const firstMessageId = currentConvo?.messages[0]?.id;
    const messageContainer = messagesRef.current;

    if (!currentConvo || !firstMessageId || !currentConvo.hasOlderMessages || loadingOlderRef.current) {
      return;
    }

    const previousScrollHeight = messageContainer?.scrollHeight ?? 0;
    const previousScrollTop = messageContainer?.scrollTop ?? 0;

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    try {
      const data = await fetchThreadMessages(currentConvo.id, { beforeId: firstMessageId });
      const latestConvo = convoRef.current;

      if (!latestConvo || latestConvo.id !== currentConvo.id) return;

      onConvoUpdate(currentConvo.id, {
        ...getEscalationPatch(data),
        hasOlderMessages: data.hasMoreOlder ?? false,
        messages: mergeMessages([...data.messages, ...latestConvo.messages]),
      });

      window.requestAnimationFrame(() => {
        const latestMessageContainer = messagesRef.current;
        if (!latestMessageContainer) return;

        latestMessageContainer.scrollTop =
          latestMessageContainer.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch (error) {
      console.error('Failed to load older support messages', error);
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [onConvoUpdate]);

  const handleMessagesScroll = useCallback(() => {
    const messageContainer = messagesRef.current;
    const currentConvo = convoRef.current;

    if (!messageContainer || !currentConvo?.hasOlderMessages || loadingOlderRef.current) {
      return;
    }

    if (messageContainer.scrollTop <= 32) {
      void loadOlderMessages();
    }
  }, [loadOlderMessages]);

  useEffect(() => {
    const messageContainer = messagesRef.current;

    if (
      convo?.hasOlderMessages &&
      messageContainer &&
      messageContainer.scrollHeight <= messageContainer.clientHeight + 20
    ) {
      void loadOlderMessages();
    }
  }, [convo?.id, convo?.messages.length, convo?.hasOlderMessages, loadOlderMessages]);

  useEffect(() => {
    if (!selectedConvoId || selectedConvoStatus === 'resolved') return;

    let cancelled = false;

    const pollMessages = async () => {
      const currentConvo = convoRef.current;
      if (!currentConvo || pollingRef.current) return;

      const latestMessageId = currentConvo.messages[currentConvo.messages.length - 1]?.id;
      const messageContainer = messagesRef.current;
      const shouldScrollAfterUpdate = messageContainer ? isNearThreadBottom(messageContainer) : true;

      pollingRef.current = true;

      try {
        const data = await fetchThreadMessages(
          currentConvo.id,
          latestMessageId ? { afterId: latestMessageId } : {}
        );

        if (cancelled) return;

        const latestConvo = convoRef.current;
        if (!latestConvo || latestConvo.id !== currentConvo.id) return;

        const nextMessages = latestMessageId
          ? mergeMessages([...latestConvo.messages, ...data.messages])
          : data.messages;

        if (data.messages.length > 0 && shouldScrollAfterUpdate) {
          shouldStickToBottomRef.current = true;
        }

        onConvoUpdate(currentConvo.id, {
          ...getEscalationPatch(data),
          hasOlderMessages: data.hasMoreOlder ?? latestConvo.hasOlderMessages,
          messages: nextMessages,
        });
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
                <span className="msg-time">{msg.createdAtLabel}</span>
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
