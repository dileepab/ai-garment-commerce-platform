'use client';

import React, { useState, useTransition } from 'react';
import { publishSocialPost, type ChannelPublishOutcome } from './actions';

export interface PublishLogEntry {
  id: number;
  channel: string;
  status: string;
  externalPostId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  publishedBy: string | null;
  createdAt: Date;
}

interface Props {
  postId: number;
  brand: string;
  caption: string;
  channels: string[];
  publishStatus: string | null;
  publishLogs: PublishLogEntry[];
  onClose: () => void;
  onRetried: () => void;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const Ic = {
  close: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  x: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  retry: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  ),
  fb: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
    </svg>
  ),
  ig: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  ),
  external: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ChannelIcon({ channel }: { channel: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%',
      background: channel === 'instagram' ? '#FBE7F2' : '#E8F0FF',
      color: channel === 'instagram' ? '#A8276E' : '#0866FF',
      flexShrink: 0,
    }}>
      {channel === 'instagram' ? Ic.ig : Ic.fb}
    </span>
  );
}

function OutcomeBadge({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: ok ? 'var(--color-success-muted)' : 'var(--color-error-muted)',
      color: ok ? '#1A5C3C' : 'var(--color-error)',
    }}>
      {ok ? Ic.check : Ic.x}
      {ok ? 'Published' : 'Failed'}
    </span>
  );
}

// ── Publish confirmation panel ────────────────────────────────────────────────

interface ConfirmPublishProps {
  postId: number;
  channels: string[];
  onOutcomes: (outcomes: ChannelPublishOutcome[], publishStatus: string) => void;
  onError: (msg: string) => void;
}

function ConfirmPublishPanel({ postId, channels, onOutcomes, onError }: ConfirmPublishProps) {
  const [imageUrl, setImageUrl] = useState('');
  const [publishing, startPublish] = useTransition();

  const needsImage = channels.includes('instagram');

  function handlePublish() {
    startPublish(async () => {
      const result = await publishSocialPost(postId, imageUrl.trim() || undefined);
      if (result.outcomes && result.publishStatus) {
        onOutcomes(result.outcomes, result.publishStatus);
      } else {
        onError(result.error ?? 'Publish failed. Please retry.');
      }
    });
  }

  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-fg-1)', marginBottom: 8 }}>
        Confirm publish
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-fg-2)', marginBottom: 10, lineHeight: 1.5 }}>
        This will post to:&nbsp;
        {channels.map((ch) => (
          <span key={ch} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
            <ChannelIcon channel={ch} />
            <span style={{ fontWeight: 600 }}>{ch === 'instagram' ? 'Instagram' : 'Facebook'}</span>
          </span>
        ))}
        {' '}using the saved caption. This action cannot be undone.
      </div>

      {needsImage && (
        <div style={{ marginBottom: 12 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.07em', textTransform: 'uppercase',
            color: 'var(--color-fg-3)', marginBottom: 5,
          }}>
            Image URL for Instagram <span style={{ fontWeight: 400, textTransform: 'none' }}>(required for Instagram feed posts)</span>
          </label>
          <input
            className="app-input"
            type="url"
            placeholder="https://example.com/image.jpg"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            disabled={publishing}
          />
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handlePublish}
        disabled={publishing || (needsImage && !imageUrl.trim())}
        style={{ width: '100%' }}
      >
        {publishing ? 'Publishing…' : 'Publish Now'}
      </button>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function PublishHistoryModal({
  postId,
  brand,
  caption,
  channels,
  publishStatus,
  publishLogs: initialLogs,
  onClose,
  onRetried,
}: Props) {
  const [logs, setLogs] = useState<PublishLogEntry[]>(initialLogs);
  const [currentPublishStatus, setCurrentPublishStatus] = useState<string | null>(publishStatus);
  const [showConfirm, setShowConfirm] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const failedChannels = channels.filter((ch) => {
    if (!currentPublishStatus) return true; // never published
    if (currentPublishStatus === 'published') return false;
    const lastAttempt = [...logs].reverse().find((l) => l.channel === ch);
    return !lastAttempt || lastAttempt.status === 'failed';
  });

  function handleOutcomes(outcomes: ChannelPublishOutcome[], ps: string) {
    const now = new Date();
    const newEntries: PublishLogEntry[] = outcomes.map((o, i) => ({
      id: Date.now() + i,
      channel: o.channel,
      status: o.ok ? 'published' : 'failed',
      externalPostId: o.externalPostId ?? null,
      errorCode: o.errorCode ?? null,
      errorMessage: o.errorMessage ?? null,
      publishedBy: null,
      createdAt: now,
    }));
    setLogs((prev) => [...prev, ...newEntries]);
    setCurrentPublishStatus(ps);
    setShowConfirm(false);
    setPublishError(null);
    onRetried();
  }

  // Group logs by attempt (most recent first based on createdAt)
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const neverPublished = !currentPublishStatus && logs.length === 0;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(24,22,15,0.25)', zIndex: 400 }}
      />
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: 560,
        maxHeight: '88vh',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-modal)',
        zIndex: 401,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-fg-1)' }}>
              Publish History
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 2 }}>
              {brand} · {channels.map((c) => c === 'instagram' ? 'Instagram' : 'Facebook').join(', ')}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              color: 'var(--color-fg-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {Ic.close}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {/* Caption preview */}
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-fg-3)', marginBottom: 5 }}>
              Caption
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-fg-1)', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {caption.length > 200 ? `${caption.slice(0, 200)}…` : caption}
            </p>
          </div>

          {/* Publish / retry button */}
          {(neverPublished || (currentPublishStatus !== 'published' && failedChannels.length > 0)) && !showConfirm && (
            <div style={{ marginBottom: 16 }}>
              <button
                className="btn btn-primary"
                onClick={() => { setShowConfirm(true); setPublishError(null); }}
                style={{ width: '100%' }}
              >
                {Ic.retry}
                {neverPublished ? 'Publish Post' : `Retry Failed Channel${failedChannels.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {showConfirm && (
            <ConfirmPublishPanel
              postId={postId}
              channels={neverPublished ? channels : failedChannels}
              onOutcomes={handleOutcomes}
              onError={(msg) => { setPublishError(msg); setShowConfirm(false); }}
            />
          )}

          {publishError && (
            <div style={{
              padding: '9px 12px',
              background: 'var(--color-error-muted)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 13,
              marginBottom: 16,
            }}>
              {publishError}
            </div>
          )}

          {/* Publish log */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 8 }}>
            Publish log
          </div>

          {sortedLogs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-fg-3)', textAlign: 'center', padding: '20px 0' }}>
              No publish attempts yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: 'var(--color-bg)',
                    border: `1px solid ${log.status === 'published' ? 'var(--color-success-muted)' : 'var(--color-error-muted)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ChannelIcon channel={log.channel} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)' }}>
                        {log.channel === 'instagram' ? 'Instagram' : 'Facebook'}
                      </span>
                    </div>
                    <OutcomeBadge ok={log.status === 'published'} />
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginBottom: log.externalPostId || log.errorMessage ? 6 : 0 }}>
                    {formatDateTime(log.createdAt)}
                    {log.publishedBy && ` · by ${log.publishedBy}`}
                  </div>

                  {log.externalPostId && (
                    <div style={{ fontSize: 11, color: 'var(--color-fg-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {Ic.external}
                      Post ID: <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{log.externalPostId}</code>
                    </div>
                  )}

                  {log.errorMessage && (
                    <div style={{
                      marginTop: 6,
                      padding: '6px 10px',
                      background: 'var(--color-error-muted)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 11,
                      color: 'var(--color-error)',
                      lineHeight: 1.5,
                    }}>
                      {log.errorCode && (
                        <span style={{ fontWeight: 700, marginRight: 5 }}>[{log.errorCode}]</span>
                      )}
                      {log.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          padding: '14px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}
