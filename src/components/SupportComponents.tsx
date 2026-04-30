'use client';

import React, { useState, useRef, useEffect } from 'react';

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

export function Thread({ convo }: { convo: any | null }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState("");

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [convo?.id, convo?.messages?.length]);

  if (!convo) return (
    <div className="thread-panel">
      <div className="thread-empty">
        <Icon d={ic.message} size={32} color="var(--color-border)" strokeWidth={1.2} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Select a conversation</div>
        <div style={{ fontSize: 12 }}>Choose from the list to view the thread</div>
      </div>
    </div>
  );

  return (
    <div className="thread-panel">
      <div className="thread-header">
        <div className="thread-header-info">
          <div className="thread-avatar" style={{ background: 'var(--color-accent)' }}>{convo.customer.name.substring(0, 2).toUpperCase()}</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{convo.customer.name}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: "999px", background: CHANNEL_COLORS[convo.channel || 'direct'] + "20", color: CHANNEL_COLORS[convo.channel || 'direct'], fontSize: 10, fontWeight: 700 }}>
                {CHANNEL_LABELS[convo.channel || 'direct']}
              </span>
              <span className={`pill ${STATUS_CLASS[convo.status || 'pending']}`}>{STATUS_LABEL[convo.status || 'pending']}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-fg-3)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
              <code style={{ fontFamily: "var(--font-mono)" }}>#ORD-{convo.orderId}</code>
              {convo.status !== "resolved" && (
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
          {convo.status !== "resolved" && (
            <button className="btn btn-secondary" style={{ fontSize: 11 }}>
              <Icon d={ic.check} size={12} />Mark Resolved
            </button>
          )}
          <button className="btn btn-ghost" style={{ padding: "6px" }}>
            <Icon d={ic.moreH} size={15} color="var(--color-fg-2)" />
          </button>
        </div>
      </div>

      <div className="thread-messages">
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--color-border-subtle)" }} />
          <span style={{ fontSize: 10, color: "var(--color-fg-3)", fontWeight: 600, whiteSpace: "nowrap" }}>Conversation Thread</span>
          <div style={{ flex: 1, height: 1, background: "var(--color-border-subtle)" }} />
        </div>

        {convo.messages?.map((msg: any, i: number) => {
          const isCustomer = msg.role === "customer" || msg.role === "USER";
          const isAI = msg.role === "ai" || msg.role === "ASSISTANT";
          const isAgent = msg.role === "agent";
          const showLabel = i === 0 || convo.messages[i - 1].role !== msg.role;

          return (
            <div key={i} className={`msg-row ${isCustomer ? 'customer' : isAI ? 'ai' : 'agent'}`}>
              {isCustomer && (
                <div className="msg-avatar" style={{ background: 'var(--color-accent)' }}>{convo.customer.name.substring(0, 2).toUpperCase()}</div>
              )}
              {(isAI || isAgent) && (
                <div className="msg-avatar" style={{ background: isAI ? "var(--color-accent)" : "var(--color-navy)" }}>
                  {isAI ? <Icon d={ic.zap} size={11} color="white" strokeWidth={2.5} /> : "SA"}
                </div>
              )}
              <div className="msg-col">
                {showLabel && isAI && <div className="msg-label" style={{ color: "var(--color-accent)" }}>AI Assistant</div>}
                {showLabel && isAgent && <div className="msg-label" style={{ color: "var(--color-navy)" }}>Sara Altan · Agent</div>}
                <div className="msg-bubble">{msg.text || msg.content}</div>
                <span className="msg-time">{new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {convo.status !== "resolved" && (
        <div className="reply-area">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-2)" }}>Replying as</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)" }}>Sara Altan</span>
            <span style={{ fontSize: 11, color: "var(--color-fg-3)" }}>·</span>
            <span className="ai-badge"><Icon d={ic.zap} size={10} color="#7A3A18" />AI Draft available</span>
          </div>
          <div className="reply-inner">
            <textarea
              className="reply-textarea"
              placeholder={`Reply to ${convo.customer.name}…`}
              value={reply}
              onChange={e => setReply(e.target.value)}
            />
            <div className="reply-footer">
              <span className="reply-hint">Shift+Enter for new line</span>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => setReply("")}>
                <Icon d={ic.send} size={12} />Send Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
