'use client';

import React, { useMemo, useState } from 'react';
import type { BotInsightConversation, BotInsightsReport } from '@/lib/bot-insights';

const toneStyle: Record<string, { background: string; color: string; border: string }> = {
  good: { background: '#E8F5EE', color: '#1E6B45', border: '#B8DDC8' },
  warn: { background: '#FFF4E5', color: '#9A5A16', border: '#F0D2A6' },
  bad: { background: '#FCECEC', color: '#A23B3B', border: '#E7B7B7' },
  neutral: { background: '#EEF2F7', color: '#43546A', border: '#D8E0EA' },
};

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getIssueTone(label: string): keyof typeof toneStyle {
  if (label.includes('failed') || label.includes('Language') || label.includes('No bot')) {
    return 'bad';
  }
  if (label.includes('Fallback') || label.includes('Repeated')) {
    return 'warn';
  }
  return 'neutral';
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: keyof typeof toneStyle;
}) {
  const style = toneStyle[tone];

  return (
    <div
      style={{
        border: `1px solid ${style.border}`,
        background: style.background,
        borderRadius: 8,
        padding: 14,
        display: 'grid',
        gap: 5,
        minHeight: 118,
      }}
    >
      <span className="app-section-label" style={{ color: style.color }}>{label}</span>
      <strong style={{ fontSize: 28, color: style.color, lineHeight: 1 }}>{value}</strong>
      <span style={{ fontSize: 12, color: 'var(--color-fg-2)', lineHeight: 1.4 }}>{note}</span>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? value / total : 0;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
        <span style={{ fontWeight: 800, color: 'var(--color-fg-1)' }}>{label}</span>
        <span style={{ color: 'var(--color-fg-3)' }}>{value} · {formatPct(pct)}</span>
      </div>
      <div style={{ height: 8, background: 'var(--color-bg)', borderRadius: 99, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.max(3, Math.round(pct * 100))}%`,
            height: '100%',
            background: 'var(--color-accent)',
            borderRadius: 99,
          }}
        />
      </div>
    </div>
  );
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: keyof typeof toneStyle }) {
  const style = toneStyle[tone];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        borderRadius: 999,
        padding: '3px 7px',
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function ConversationListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: BotInsightConversation;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
        background: active ? 'rgba(196, 98, 45, 0.08)' : 'var(--color-surface)',
        borderRadius: 8,
        padding: 12,
        display: 'grid',
        gap: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--color-fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.customerName || conversation.senderId}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 2 }}>
            {conversation.channel} {conversation.brand ? `· ${conversation.brand}` : ''} · {conversation.latestAtLabel}
          </div>
        </div>
        <Chip tone={conversation.score >= 80 ? 'warn' : 'bad'}>{conversation.score}</Chip>
      </div>

      {conversation.lastCustomerMessage && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-fg-2)', lineHeight: 1.45 }}>
          {conversation.lastCustomerMessage}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {conversation.issueLabels.map((label) => (
          <Chip key={label} tone={getIssueTone(label)}>{label}</Chip>
        ))}
      </div>
    </button>
  );
}

function TranscriptBubble({ message }: { message: BotInsightConversation['messages'][number] }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'grid', gap: 4 }}>
      <div
        style={{
          borderRadius: 8,
          padding: '9px 11px',
          background: isUser ? 'var(--color-navy)' : isAssistant ? 'var(--color-bg)' : 'var(--color-error-muted)',
          color: isUser ? 'white' : 'var(--color-fg-1)',
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.text}
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-fg-3)', textAlign: isUser ? 'right' : 'left' }}>
        {message.createdAtLabel} · {message.language} · {message.replyKind}
      </div>
    </div>
  );
}

function ConversationReplay({ conversation }: { conversation: BotInsightConversation | null }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyRegression() {
    if (!conversation) return;

    try {
      await navigator.clipboard.writeText(conversation.regressionSnippet);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  }

  if (!conversation) {
    return (
      <section className="app-panel" style={{ padding: 24, display: 'grid', placeItems: 'center', color: 'var(--color-fg-3)', minHeight: 520 }}>
        No problem conversations in this range.
      </section>
    );
  }

  return (
    <section className="app-panel" style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(260px, 1fr) auto', minHeight: 620 }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p className="app-section-label">Conversation Replay</p>
          <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>
            {conversation.customerName || conversation.senderId}
          </h2>
          <p className="app-muted" style={{ marginTop: 3 }}>
            {conversation.channel} {conversation.brand ? `· ${conversation.brand}` : ''} · {conversation.latestAtLabel}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={copyRegression}>
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy test case'}
        </button>
      </div>

      <div style={{ padding: 16, borderBottom: '1px solid var(--color-border-subtle)', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {conversation.issueLabels.map((label) => (
            <Chip key={label} tone={getIssueTone(label)}>{label}</Chip>
          ))}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-fg-2)' }}>
          {conversation.recommendation}
        </div>
        {conversation.diagnosticSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <div className="app-chip app-chip-neutral">AI: {conversation.diagnosticSummary.aiAction || 'unknown'}</div>
            <div className="app-chip app-chip-neutral">Effective: {conversation.diagnosticSummary.effectiveAction || 'unknown'}</div>
            <div className="app-chip app-chip-neutral">
              Confidence: {conversation.diagnosticSummary.confidence === null ? 'unknown' : Math.round(conversation.diagnosticSummary.confidence * 100)}
            </div>
            <div className="app-chip app-chip-neutral">Mode: {conversation.diagnosticSummary.supportMode || 'unknown'}</div>
          </div>
        )}
      </div>

      <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {conversation.messages.map((message) => (
          <TranscriptBubble key={message.id} message={message} />
        ))}
      </div>

      <details style={{ borderTop: '1px solid var(--color-border-subtle)', padding: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 900, color: 'var(--color-fg-2)' }}>
          Regression snippet
        </summary>
        <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.45, color: 'var(--color-fg-2)', background: 'var(--color-bg)', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
          {conversation.regressionSnippet}
        </pre>
      </details>
    </section>
  );
}

export function BotInsightsClient({ report }: { report: BotInsightsReport }) {
  const [selectedKey, setSelectedKey] = useState(report.problemConversations[0]?.key ?? null);
  const selectedConversation = useMemo(
    () => report.problemConversations.find((conversation) => conversation.key === selectedKey) ?? report.problemConversations[0] ?? null,
    [report.problemConversations, selectedKey]
  );

  return (
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {report.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            note={metric.note}
            tone={metric.tone}
          />
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.2fr) minmax(260px, 0.8fr)', gap: 16 }}>
        <div className="app-panel" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div>
            <p className="app-section-label">Conversation Funnel</p>
            <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>{report.funnel.conversations} conversations</h2>
          </div>
          <FunnelBar label="Catalog shown" value={report.funnel.catalogShown} total={report.funnel.conversations} />
          <FunnelBar label="Order started" value={report.funnel.orderStarted} total={report.funnel.conversations} />
          <FunnelBar label="Order confirmed" value={report.funnel.orderConfirmed} total={report.funnel.conversations} />
          <FunnelBar label="Support handoff" value={report.funnel.supportHandoff} total={report.funnel.conversations} />
        </div>

        <div className="app-panel" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div>
            <p className="app-section-label">Mix</p>
            <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>Language and channel</h2>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {report.languageSplit.map((row) => (
              <FunnelBar key={row.label} label={row.label} value={row.count} total={Math.max(1, row.count / Math.max(row.pct, 0.0001))} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {report.channelSplit.map((row) => (
              <Chip key={row.label}>{row.label}: {row.count} · {formatPct(row.pct)}</Chip>
            ))}
          </div>
        </div>
      </section>

      <section className="app-panel" style={{ padding: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div>
            <p className="app-section-label">Top Customer Questions</p>
            <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>Repeated demand signals</h2>
          </div>
          <span className="app-chip app-chip-neutral">Last {report.windowDays}d</span>
        </div>
        {report.topQuestions.length === 0 ? (
          <div style={{ padding: 30, color: 'var(--color-fg-3)', textAlign: 'center', fontSize: 13 }}>
            No repeated questions found in this range.
          </div>
        ) : (
          <table className="data-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Question</th>
                <th>Language</th>
                <th>Channel</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {report.topQuestions.map((question) => (
                <tr key={`${question.channel}:${question.language}:${question.text}`}>
                  <td style={{ maxWidth: 520 }}>{question.text}</td>
                  <td>{question.language}</td>
                  <td>{question.channel}</td>
                  <td>{question.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 0.9fr) minmax(360px, 1.1fr)', gap: 16 }}>
        <div className="app-panel" style={{ padding: 16, display: 'grid', gap: 12, alignSelf: 'start' }}>
          <div>
            <p className="app-section-label">Problem Queue</p>
            <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>
              {report.problemConversations.length} conversations to review
            </h2>
          </div>
          {report.problemConversations.length === 0 ? (
            <div style={{ padding: 26, color: 'var(--color-fg-3)', textAlign: 'center', fontSize: 13 }}>
              No high-signal bot issues found in this range.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxHeight: 620, overflowY: 'auto', paddingRight: 4 }}>
              {report.problemConversations.map((conversation) => (
                <ConversationListItem
                  key={conversation.key}
                  conversation={conversation}
                  active={conversation.key === selectedConversation?.key}
                  onSelect={() => setSelectedKey(conversation.key)}
                />
              ))}
            </div>
          )}
        </div>

        <ConversationReplay conversation={selectedConversation} />
      </section>

      <section className="app-panel" style={{ padding: 16, overflowX: 'auto' }}>
        <div style={{ marginBottom: 12 }}>
          <p className="app-section-label">Delivery And Token Failures</p>
          <h2 style={{ margin: '3px 0 0', fontSize: 18, color: 'var(--color-fg-1)' }}>Recent webhook failures</h2>
        </div>
        {report.recentFailures.length === 0 ? (
          <div style={{ padding: 26, color: 'var(--color-fg-3)', textAlign: 'center', fontSize: 13 }}>
            No failed webhook or delivery events found in this range.
          </div>
        ) : (
          <table className="data-table" style={{ minWidth: 840 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>Brand</th>
                <th>Event</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {report.recentFailures.map((failure) => (
                <tr key={failure.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{failure.receivedAtLabel}</td>
                  <td>{failure.channel}</td>
                  <td>{failure.brand || 'Unknown'}</td>
                  <td>{failure.eventType}</td>
                  <td style={{ maxWidth: 460 }}>{failure.error || 'No error message saved'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
