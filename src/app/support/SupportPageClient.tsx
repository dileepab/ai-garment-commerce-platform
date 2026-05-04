'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Thread } from '@/components/SupportComponents';
import { PageHeader } from '@/components/PageHeader';
import type { SupportStats, SupportThread } from './types';
import { SUPPORT_THREAD_POLL_MS } from './format';
import { updateEscalationWorkflowAction } from './actions';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8",
  clock: ["M12 22a10 10 0 100-20 10 10 0 000 20", "M12 6v6l4 2"],
  link: ["M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5", "M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5"],
  x: ["M18 6L6 18", "M6 6l12 12"],
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  messenger: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 3.22 1.47 6.08 3.75 7.94V22l2.23-1.22c1.24.34 2.56.53 3.92.53 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2zm1.06 12.5l-2.52-2.67-4.92 2.67 5.41-5.74 2.58 2.67 4.86-2.67-5.41 5.74z"/></svg>,
  instagram: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.43-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.77.13 4.9.33 4.14.63c-.78.3-1.45.72-2.11 1.38C1.38 2.68.96 3.35.66 4.14.36 4.9.16 5.77.1 7.05.04 8.33.03 8.74.03 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.45 1.39 2.11.66.67 1.33 1.08 2.12 1.39.76.3 1.63.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.45-.72 2.11-1.39.67-.66 1.08-1.33 1.39-2.12.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.45-1.39-2.11-.66-.67-1.33-1.08-2.12-1.39-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0z"/><path d="M12 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zM18.41 4.15a1.44 1.44 0 100 2.88 1.44 1.44 0 000-2.88z"/></svg>,
};

const CHANNEL_CLASS: Record<string, string> = { messenger: "badge-messenger", instagram: "badge-instagram" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct", whatsapp: "WhatsApp" };
const SUPPORT_STATUS_LABELS: Record<string, string> = {
  escalated: "Escalated",
  open: "Open",
  pending: "Pending",
  in_progress: "In progress",
  resolved: "Resolved",
};
const SUPPORT_STATUS_CLASSES: Record<string, string> = {
  escalated: "pill-escalated",
  open: "pill-open",
  pending: "pill-pending",
  in_progress: "pill-in_progress",
  resolved: "pill-resolved",
};

interface SupportPageClientProps {
  initialEscalations: SupportThread[];
  stats: SupportStats;
  canReply: boolean;
}

type SupportFilter = "all" | "active" | "resolved";
type SupportSort = "waiting" | "newest" | "updated";

const SORT_OPTIONS: { value: SupportSort; label: string }[] = [
  { value: "waiting", label: "Waiting longest" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];

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

function isActiveStatus(status: string): boolean {
  return ["escalated", "open", "pending", "in_progress"].includes(status);
}

function formatWaitingFrom(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remM = minutes % 60;
    return remM ? `${hours}h ${remM}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getAverageWaitLabel(escalations: SupportThread[]): string {
  const activeCreatedAt = escalations
    .filter((escalation) => isActiveStatus(escalation.status))
    .map((escalation) => new Date(escalation.createdAt).getTime())
    .filter((time) => !Number.isNaN(time));

  if (activeCreatedAt.length === 0) return '0m';

  const avgMs = activeCreatedAt.reduce((acc, time) => acc + (Date.now() - time), 0) / activeCreatedAt.length;
  if (avgMs < 60000) return 'just now';

  const minutes = Math.floor(avgMs / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remM = minutes % 60;
  if (hours < 24) return remM ? `${hours}h ${remM}m` : `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function getSupportStatusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

function getSupportStatusClass(status: string): string {
  return SUPPORT_STATUS_CLASSES[status] || "pill-pending";
}

function SupportStatusAction({
  escalationId,
  nextStatus,
  label,
  variant = "default",
}: {
  escalationId: number;
  nextStatus: "open" | "in_progress" | "resolved";
  label: string;
  variant?: "default" | "strong";
}) {
  return (
    <form action={updateEscalationWorkflowAction}>
      <input type="hidden" name="escalationId" value={escalationId} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <button
        type="submit"
        className={`convo-action-btn${variant === "strong" ? " strong" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </button>
    </form>
  );
}

function SupportQuickActions({ escalation, canReply }: { escalation: SupportThread; canReply: boolean }) {
  const active = isActiveStatus(escalation.status);
  const canTake = active && escalation.status !== "in_progress";

  if (!canReply) {
    return null;
  }

  return (
    <div className="convo-quick-actions" onClick={(event) => event.stopPropagation()}>
      {canTake && (
        <SupportStatusAction escalationId={escalation.id} nextStatus="in_progress" label="Take" />
      )}
      {active ? (
        <SupportStatusAction escalationId={escalation.id} nextStatus="resolved" label="Resolve" variant="strong" />
      ) : (
        <SupportStatusAction escalationId={escalation.id} nextStatus="open" label="Reopen" variant="strong" />
      )}
    </div>
  );
}

export default function SupportPageClient({ initialEscalations, stats, canReply }: SupportPageClientProps) {
  const [escalations, setEscalations] = useState(initialEscalations);
  const [liveStats, setLiveStats] = useState(stats);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SupportFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [sort, setSort] = useState<SupportSort>("waiting");
  const [selectedId, setSelectedId] = useState<number | null>(
    initialEscalations.find((escalation) => escalation.status !== "resolved")?.id ||
      initialEscalations[0]?.id ||
      null
  );
  // Mobile: toggle between conversation list and thread view
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');

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

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    escalations.forEach(e => { if (e.channel) set.add(e.channel); });
    return Array.from(set).sort();
  }, [escalations]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    escalations.forEach(e => { if (e.brand) set.add(e.brand); });
    return Array.from(set).sort();
  }, [escalations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = escalations.filter(e => {
      if (filter === "active" && !isActiveStatus(e.status)) return false;
      if (filter === "resolved" && e.status !== "resolved") return false;
      if (channelFilter !== "all" && e.channel !== channelFilter) return false;
      if (brandFilter !== "all" && (e.brand || '') !== brandFilter) return false;
      if (q) {
        const haystack = [
          e.customer?.name,
          e.contactName,
          e.contactPhone,
          e.senderId,
          e.brand,
          e.reason,
          e.summary,
          e.status,
          e.orderId ? `ord-${e.orderId} #${e.orderId}` : '',
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "updated":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "waiting":
        default: {
          const aActive = isActiveStatus(a.status);
          const bActive = isActiveStatus(b.status);
          if (aActive !== bActive) return aActive ? -1 : 1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
      }
    });
    return sorted;
  }, [escalations, search, filter, channelFilter, brandFilter, sort]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filtered.some((escalation) => escalation.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const activeConvo = useMemo(
    () => escalations.find(e => e.id === selectedId) || null,
    [escalations, selectedId]
  );

  const averageWaitLabel = useMemo(() => getAverageWaitLabel(escalations), [escalations]);
  const hasActiveInboxFilters = filter !== "all" || channelFilter !== "all" || brandFilter !== "all" || sort !== "waiting" || !!search.trim();
  const clearInboxFilters = () => {
    setSearch("");
    setFilter("all");
    setChannelFilter("all");
    setBrandFilter("all");
    setSort("waiting");
  };

  return (
    <main className="main support-main">
      <PageHeader
        title="Support Inbox"
        subtitle={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="live-dot" />
            {liveStats.open} active case locks · AI replies continue for other customers · <span suppressHydrationWarning>{liveStats.dateLabel || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "var(--color-accent-muted)", borderRadius: "var(--radius-md)" }}>
            <Icon d={ic.zap} size={12} color="var(--color-accent)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-accent)" }}>{liveStats.open > 0 ? `${liveStats.open} Case Lock${liveStats.open === 1 ? "" : "s"}` : "AI Live"}</span>
          </div>
        }
      />

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label">Open Cases</div>
          <div className="stat-val">{liveStats.open}</div>
          <div className="stat-note">across {channelOptions.length || 1} channel{channelOptions.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Linked Orders</div>
          <div className="stat-val" style={{ color: "#8B2020" }}>{liveStats.linkedOrders}</div>
          <div className="stat-note">need human reply</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Avg. Wait Time</div>
          <div className="stat-val" style={{ color: liveStats.open > 0 ? "#9B6B00" : "#1E6B45" }} suppressHydrationWarning>{averageWaitLabel}</div>
          <div className="stat-note">{liveStats.open > 0 ? "oldest cases first" : "no active wait"}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Case Locks</div>
          <div className="stat-val" style={{ color: liveStats.open > 0 ? "#9B6B00" : "#1E6B45" }}>{liveStats.open}</div>
          <div className="stat-note">{liveStats.open > 0 ? "conversation-level" : "all bot handled"}</div>
        </div>
      </div>

      <div className="inbox-body">
        <div className={`convo-panel${mobileView === 'thread' ? ' mobile-panel-hidden' : ''}`}>
          <div className="convo-header">
            <div className="convo-search">
              <Icon d={ic.search} size={12} color="var(--color-fg-3)" />
              <input
                placeholder="Search name, order #, brand, reason…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="convo-filter-tabs">
              <div className={`convo-tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All</div>
              <div className={`convo-tab${filter === "active" ? " active" : ""}`} onClick={() => setFilter("active")}>Active</div>
              <div className={`convo-tab${filter === "resolved" ? " active" : ""}`} onClick={() => setFilter("resolved")}>Resolved</div>
            </div>
            <div className="convo-secondary-filters">
              <select
                className="filter-select filter-select-sm"
                value={channelFilter}
                onChange={e => setChannelFilter(e.target.value)}
                aria-label="Filter by channel"
              >
                <option value="all">All channels</option>
                {channelOptions.map(c => (
                  <option key={c} value={c}>{CHANNEL_LABELS[c] || c}</option>
                ))}
              </select>
              {brandOptions.length > 0 && (
                <select
                  className="filter-select filter-select-sm"
                  value={brandFilter}
                  onChange={e => setBrandFilter(e.target.value)}
                  aria-label="Filter by brand"
                >
                  <option value="all">All brands</option>
                  {brandOptions.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}
              <select
                className="filter-select filter-select-sm"
                value={sort}
                onChange={e => setSort(e.target.value as SupportSort)}
                aria-label="Sort"
              >
                {SORT_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              {hasActiveInboxFilters && (
                <button className="btn btn-ghost convo-filter-clear" onClick={clearInboxFilters} aria-label="Clear filters">
                  <Icon d={ic.x} size={11} />
                </button>
              )}
            </div>
            <div className="convo-result-count">{filtered.length} of {escalations.length}</div>
          </div>
          <div className="convo-list">
            {filtered.map(e => {
              const active = isActiveStatus(e.status);
              return (
                <div
                  key={e.id}
                  className={`convo-item${selectedId === e.id ? " active" : ""}${active ? ' unread' : ''}`}
                  onClick={() => { setSelectedId(e.id); setMobileView('thread'); }}
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
                    <span className={`pill ${getSupportStatusClass(e.status)} convo-status-pill`}>
                      {getSupportStatusLabel(e.status)}
                    </span>
                    {e.orderId && (
                      <span className="convo-order-chip">
                        <Icon d={ic.link} size={9} color="currentColor" />
                        ORD-{e.orderId}
                      </span>
                    )}
                    {e.brand && <span className="convo-brand-chip">{e.brand}</span>}
                    {active && (
                      <span className="convo-wait-chip" suppressHydrationWarning>
                        <Icon d={ic.clock} size={9} color="currentColor" />
                        {formatWaitingFrom(e.createdAt)}
                      </span>
                    )}
                    {active && <span className="unread-dot" />}
                  </div>
                  <div className="convo-item-preview">
                    {e.latestCustomerMessage || e.summary || 'No message preview available.'}
                  </div>
                  <SupportQuickActions escalation={e} canReply={canReply} />
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--color-fg-3)", fontSize: 13 }}>
                No conversations found.
                {hasActiveInboxFilters && (
                  <>
                    {' '}
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", display: "inline-flex" }} onClick={clearInboxFilters}>Clear filters</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className={`thread-panel-wrap${mobileView === 'list' ? ' mobile-panel-hidden' : ''}`}>
          <button className="mobile-back-btn" onClick={() => setMobileView('list')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to inbox
          </button>
          <Thread convo={activeConvo} onConvoUpdate={updateEscalation} canReply={canReply} />
        </div>
      </div>
    </main>
  );
}
