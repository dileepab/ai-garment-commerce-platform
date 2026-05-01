'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Thread } from '@/components/SupportComponents';
import type { SupportStats, SupportThread } from './types';
import { SUPPORT_THREAD_POLL_MS } from './format';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8",
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  messenger: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 3.22 1.47 6.08 3.75 7.94V22l2.23-1.22c1.24.34 2.56.53 3.92.53 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2zm1.06 12.5l-2.52-2.67-4.92 2.67 5.41-5.74 2.58 2.67 4.86-2.67-5.41 5.74z"/></svg>,
  instagram: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.43-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.77.13 4.9.33 4.14.63c-.78.3-1.45.72-2.11 1.38C1.38 2.68.96 3.35.66 4.14.36 4.9.16 5.77.1 7.05.04 8.33.03 8.74.03 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.45 1.39 2.11.66.67 1.33 1.08 2.12 1.39.76.3 1.63.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.45-.72 2.11-1.39.67-.66 1.08-1.33 1.39-2.12.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.45-1.39-2.11-.66-.67-1.33-1.08-2.12-1.39-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0z"/><path d="M12 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zM18.41 4.15a1.44 1.44 0 100 2.88 1.44 1.44 0 000-2.88z"/></svg>,
};

const CHANNEL_CLASS: Record<string, string> = { messenger: "badge-messenger", instagram: "badge-instagram" };

interface SupportPageClientProps {
  initialEscalations: SupportThread[];
  stats: SupportStats;
}

type SupportFilter = "all" | "escalated" | "resolved";

interface SupportInboxResponse {
  success: boolean;
  data?: {
    escalations: SupportThread[];
    stats: SupportStats;
  };
  error?: string;
}

function mergeEscalationList(
  currentEscalations: SupportThread[],
  nextEscalations: SupportThread[]
): SupportThread[] {
  const currentById = new Map(
    currentEscalations.map((escalation) => [escalation.id, escalation])
  );

  return nextEscalations.map((nextEscalation) => {
    const currentEscalation = currentById.get(nextEscalation.id);

    if (!currentEscalation) return nextEscalation;

    return {
      ...nextEscalation,
      hasOlderMessages: currentEscalation.hasOlderMessages,
      messages: currentEscalation.messages,
    };
  });
}

export default function SupportPageClient({ initialEscalations, stats }: SupportPageClientProps) {
  const [escalations, setEscalations] = useState(initialEscalations);
  const [liveStats, setLiveStats] = useState(stats);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SupportFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(
    initialEscalations.find((escalation) => escalation.status !== "resolved")?.id ||
      initialEscalations[0]?.id ||
      null
  );

  useEffect(() => {
    setEscalations(initialEscalations);
  }, [initialEscalations]);

  useEffect(() => {
    setLiveStats(stats);
  }, [stats]);

  const updateEscalation = useCallback((id: number, patch: Partial<SupportThread>) => {
    setEscalations((currentEscalations) =>
      currentEscalations.map((escalation) =>
        escalation.id === id ? { ...escalation, ...patch } : escalation
      )
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshInbox = async () => {
      try {
        const response = await fetch('/api/support/escalations', { cache: 'no-store' });
        const payload = (await response.json()) as SupportInboxResponse;

        if (cancelled || !response.ok || !payload.success || !payload.data) return;

        setEscalations((currentEscalations) =>
          mergeEscalationList(currentEscalations, payload.data!.escalations)
        );
        setLiveStats(payload.data.stats);
      } catch (error) {
        console.error('Failed to refresh support inbox', error);
      }
    };

    void refreshInbox();
    const intervalId = window.setInterval(refreshInbox, SUPPORT_THREAD_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const filtered = useMemo(() => escalations.filter(e => {
    if (filter === "escalated" && !["escalated", "open", "pending", "in_progress"].includes(e.status)) return false;
    if (filter === "resolved" && e.status !== "resolved") return false;
    if (search) {
      const query = search.toLowerCase();
      const searchableText = [
        e.customer?.name,
        e.contactName,
        e.senderId,
      ].filter(Boolean).join(' ').toLowerCase();

      if (!searchableText.includes(query)) return false;
    }
    return true;
  }), [escalations, search, filter]);

  const activeConvo = useMemo(
    () => escalations.find(e => e.id === selectedId) || null,
    [escalations, selectedId]
  );

  return (
    <main className="main support-main">
      <div className="topbar">
        <div className="topbar-title-group">
          <div className="topbar-title">Support Inbox</div>
          <div className="topbar-subtitle" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="live-dot" />
            {liveStats.open} active cases · Bot paused during handoff · <span suppressHydrationWarning>{liveStats.dateLabel || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "var(--color-accent-muted)", borderRadius: "var(--radius-md)" }}>
            <Icon d={ic.zap} size={12} color="var(--color-accent)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-accent)" }}>{liveStats.open > 0 ? "Bot Paused" : "AI Live"}</span>
          </div>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label">Open Cases</div>
          <div className="stat-val">{liveStats.open}</div>
          <div className="stat-note">across 2 channels</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Linked Orders</div>
          <div className="stat-val" style={{ color: "#8B2020" }}>{liveStats.linkedOrders}</div>
          <div className="stat-note">need human reply</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Avg. Wait Time</div>
          <div className="stat-val" style={{ color: "#9B6B00" }}>2h 22m</div>
          <div className="stat-note">↑ above 1h target</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Bot Lock</div>
          <div className="stat-val" style={{ color: liveStats.open > 0 ? "#9B6B00" : "#1E6B45" }}>{liveStats.open > 0 ? "On" : "Off"}</div>
          <div className="stat-note">{liveStats.open > 0 ? "support active" : "bot handling"}</div>
        </div>
      </div>

      <div className="inbox-body">
        <div className="convo-panel">
          <div className="convo-header">
            <div className="convo-search">
              <Icon d={ic.search} size={12} color="var(--color-fg-3)" />
              <input 
                placeholder="Search conversations…" 
                value={search} 
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="convo-filter-tabs">
              <div className={`convo-tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All</div>
              <div className={`convo-tab${filter === "escalated" ? " active" : ""}`} onClick={() => setFilter("escalated")}>Active</div>
              <div className={`convo-tab${filter === "resolved" ? " active" : ""}`} onClick={() => setFilter("resolved")}>Resolved</div>
            </div>
          </div>
          <div className="convo-list">
            {filtered.map(e => (
              <div 
                key={e.id} 
                className={`convo-item${selectedId === e.id ? " active" : ""}${e.status !== 'resolved' ? ' unread' : ''}`}
                onClick={() => setSelectedId(e.id)}
              >
                <div className="convo-item-top">
                  <span className="convo-item-name">{e.customer?.name || e.contactName || 'Unknown'}</span>
                  <span className="convo-item-time" suppressHydrationWarning>{e.updatedAtLabel}</span>
                </div>
                <div className="convo-item-mid">
                  <span className={`badge-ch ${CHANNEL_CLASS[e.channel] || ''}`}>
                    {CHANNEL_ICONS[e.channel]}
                    {e.channel}
                  </span>
                  {e.status !== 'resolved' && <span className="unread-dot" />}
                </div>
                <div className="convo-item-preview">
                  {e.latestCustomerMessage || e.summary || 'No message preview available.'}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--color-fg-3)", fontSize: 13 }}>
                No conversations found.
              </div>
            )}
          </div>
        </div>
        <Thread convo={activeConvo} onConvoUpdate={updateEscalation} />
      </div>
    </main>
  );
}
