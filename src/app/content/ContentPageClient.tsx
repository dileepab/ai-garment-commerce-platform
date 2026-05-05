'use client';

import React, { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import {
  createSocialPost,
  updateSocialPost,
  generatePostCaptions,
} from './actions';
import CreativeStudioModal from './CreativeStudioModal';
import PublishHistoryModal, { type PublishLogEntry } from './PublishHistoryModal';
import CreativeDetailModal from './CreativeDetailModal';
import { PERSONA_OPTIONS } from '@/lib/creative-generator';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreativeRecord {
  id: number;
  brand: string;
  generatedImageData: string;
  prompt: string;
  personaStyle: string | null;
  productContext: string | null;
  sourceImageUrl: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface PostRecord {
  id: number;
  brand: string;
  channels: string;
  caption: string;
  generatedCaptions: string | null;
  productContext: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishStatus: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  publishLogs: PublishLogEntry[];
}

interface Stats {
  total: number;
  totalDrafts: number;
  totalReady: number;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const Ic = {
  plus: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  search: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  edit: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  close: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  sparkle: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  image: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  fb: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
    </svg>
  ),
  ig: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  ),
  send: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  history: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    </svg>
  ),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseChannels(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseGeneratedCaptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
    return [];
  } catch {
    return [];
  }
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function ChannelBadge({ channel }: { channel: string }) {
  const isIg = channel === 'instagram';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: isIg ? '#FBE7F2' : '#E8F0FF',
        color: isIg ? '#A8276E' : '#0866FF',
        marginRight: 4,
      }}
    >
      {isIg ? Ic.ig : Ic.fb}
      {isIg ? 'Instagram' : 'Facebook'}
    </span>
  );
}

function StatusPill({ status, publishStatus }: { status: string; publishStatus?: string | null }) {
  // Publish status takes visual precedence when set
  const effective = publishStatus ?? status;
  const map: Record<string, { label: string; bg: string; color: string }> = {
    draft:     { label: 'Draft',     bg: 'var(--color-surface-muted)', color: 'var(--color-fg-2)' },
    ready:     { label: 'Ready',     bg: 'var(--color-success-muted)', color: '#1A5C3C' },
    published: { label: 'Published', bg: '#E6F4EA',                    color: '#1A5C3C' },
    partial:   { label: 'Partial',   bg: '#FFF3CD',                    color: '#7A5200' },
    failed:    { label: 'Failed',    bg: 'var(--color-error-muted)',    color: 'var(--color-error)' },
  };
  const style = map[effective] ?? map.draft;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

// ── Post Form Modal ──────────────────────────────────────────────────────────

interface PostFormProps {
  post: PostRecord | null;
  availableBrands: string[] | null;
  onClose: () => void;
  onSuccess: () => void;
}

function PostFormModal({ post, availableBrands, onClose, onSuccess }: PostFormProps) {
  const [brand, setBrand] = useState(post?.brand ?? (availableBrands?.[0] ?? ''));
  const [channels, setChannels] = useState<string[]>(
    post ? parseChannels(post.channels) : ['facebook', 'instagram'],
  );
  const [productContext, setProductContext] = useState(post?.productContext ?? '');
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [postStatus, setPostStatus] = useState<'draft' | 'ready'>(
    (post?.status as 'draft' | 'ready') ?? 'draft',
  );
  const [generatedCaptions, setGeneratedCaptions] = useState<string[]>(
    parseGeneratedCaptions(post?.generatedCaptions ?? null),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const [isGenerating, startGenerating] = useTransition();
  const [isSaving, startSaving] = useTransition();

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function handleSelectCaption(c: string) {
    setCaption(c);
  }

  function handleGenerate() {
    if (!brand.trim()) {
      setFormError('Select a brand before generating captions.');
      return;
    }
    if (channels.length === 0) {
      setFormError('Select at least one channel before generating.');
      return;
    }
    setFormError(null);
    startGenerating(async () => {
      const result = await generatePostCaptions({
        brand: brand.trim(),
        channels,
        productContext: productContext.trim() || undefined,
      });
      if (result.success && result.captions) {
        setGeneratedCaptions(result.captions);
        if (!caption.trim() && result.captions.length > 0) {
          setCaption(result.captions[0]);
        }
      } else {
        setFormError(result.error ?? 'Caption generation failed.');
      }
    });
  }

  function handleSave() {
    setFormError(null);
    if (!brand.trim()) { setFormError('Brand is required.'); return; }
    if (channels.length === 0) { setFormError('Select at least one channel.'); return; }
    if (!caption.trim()) { setFormError('Caption cannot be empty.'); return; }

    const input = {
      brand: brand.trim(),
      channels,
      caption: caption.trim(),
      generatedCaptions: generatedCaptions.length > 0 ? generatedCaptions : undefined,
      productContext: productContext.trim() || undefined,
      status: postStatus,
    };

    startSaving(async () => {
      const result = post
        ? await updateSocialPost(post.id, input)
        : await createSocialPost(input);

      if (result.success) {
        onSuccess();
      } else {
        setFormError(result.error ?? 'Save failed. Please retry.');
      }
    });
  }

  const isLoading = isGenerating || isSaving;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isLoading ? onClose : undefined}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(24,22,15,0.25)',
          zIndex: 400,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100%', maxWidth: 600,
          maxHeight: '90vh',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-modal)',
          zIndex: 401,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-fg-1)' }}>
              {post ? 'Edit Draft' : 'New Content Draft'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 2 }}>
              Generate AI captions and save your social post draft
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
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

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>

          {/* Brand + Channels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            {/* Brand */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 6 }}>
                Brand
              </label>
              {availableBrands ? (
                <select
                  className="app-input"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={isLoading}
                >
                  {availableBrands.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="app-input"
                  placeholder="e.g. Nisha Collections"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={isLoading}
                />
              )}
            </div>

            {/* Status */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 6 }}>
                Status
              </label>
              <select
                className="app-input"
                value={postStatus}
                onChange={(e) => setPostStatus(e.target.value as 'draft' | 'ready')}
                disabled={isLoading}
              >
                <option value="draft">Draft</option>
                <option value="ready">Ready to Publish</option>
              </select>
            </div>
          </div>

          {/* Channels */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 8 }}>
              Channels
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['facebook', 'instagram'] as const).map((ch) => {
                const checked = channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    disabled={isLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: checked
                        ? ch === 'instagram' ? '1.5px solid #C13584' : '1.5px solid #0866FF'
                        : '1.5px solid var(--color-border)',
                      background: checked
                        ? ch === 'instagram' ? '#FBE7F2' : '#E8F0FF'
                        : 'var(--color-bg)',
                      color: checked
                        ? ch === 'instagram' ? '#A8276E' : '#0866FF'
                        : 'var(--color-fg-2)',
                      fontSize: 12, fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 120ms',
                    }}
                  >
                    {ch === 'instagram' ? Ic.ig : Ic.fb}
                    {ch === 'instagram' ? 'Instagram' : 'Facebook'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product context */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 6 }}>
              Post Context <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>(optional — describe the product or promotion)</span>
            </label>
            <textarea
              className="app-textarea"
              placeholder="e.g. New arrival: Black floral midi dress, Rs 3,200. Perfect for evening events. Limited stock."
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              disabled={isLoading}
              rows={3}
              style={{ resize: 'none', minHeight: 72 }}
            />
          </div>

          {/* Generate button */}
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px',
                background: isGenerating ? 'var(--color-surface-muted)' : 'var(--color-accent-subtle)',
                border: '1px solid rgba(196,98,45,0.25)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-accent)',
                fontSize: 12, fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 120ms',
              }}
            >
              {Ic.sparkle}
              {isGenerating ? 'Generating captions…' : 'Generate AI Captions'}
            </button>
          </div>

          {/* Generated caption suggestions */}
          {generatedCaptions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 8 }}>
                AI Suggestions — click to use
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {generatedCaptions.map((c, i) => {
                  const isSelected = caption === c;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectCaption(c)}
                      disabled={isLoading}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: isSelected
                          ? '1.5px solid var(--color-accent)'
                          : '1px solid var(--color-border)',
                        background: isSelected ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
                        color: 'var(--color-fg-1)',
                        fontSize: 13,
                        lineHeight: 1.5,
                        cursor: 'pointer',
                        transition: 'all 120ms',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, color: isSelected ? 'var(--color-accent)' : 'var(--color-fg-3)', display: 'block', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Option {i + 1}
                      </span>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Caption editor */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 6 }}>
              Caption
            </label>
            <textarea
              className="app-textarea"
              placeholder="Write your caption here, or generate one above…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={isLoading}
              rows={5}
              style={{ minHeight: 120 }}
            />
            <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 4, textAlign: 'right' }}>
              {caption.length} characters
            </div>
          </div>

          {/* Preview */}
          {caption.trim() && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 8 }}>
                Preview
              </div>
              <div style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--color-accent)', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)' }}>{brand || 'Brand Name'}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      {channels.map((ch) => <ChannelBadge key={ch} channel={ch} />)}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-fg-1)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {caption}
                </p>
              </div>
            </div>
          )}

          {formError && (
            <div style={{
              padding: '9px 12px',
              background: 'var(--color-error-muted)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 13,
              marginBottom: 8,
            }}>
              {formError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          padding: '14px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isLoading || !caption.trim()}
          >
            {isSaving ? 'Saving…' : post ? 'Update Draft' : 'Save Draft'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Page Client ─────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'draft',     label: 'Draft' },
  { key: 'ready',     label: 'Ready' },
  { key: 'published', label: 'Published' },
  { key: 'failed',    label: 'Failed' },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]['key'];

type ViewMode = 'posts' | 'creatives';

export default function ContentPageClient({
  initialPosts,
  initialCreatives,
  stats,
  canWrite,
  availableBrands,
}: {
  initialPosts: PostRecord[];
  initialCreatives: CreativeRecord[];
  stats: Stats;
  canWrite: boolean;
  availableBrands: string[] | null;
}) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('posts');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingPost, setEditingPost] = useState<PostRecord | null>(null);
  const [showCreativeStudio, setShowCreativeStudio] = useState(false);
  const [historyPost, setHistoryPost] = useState<PostRecord | null>(null);
  const [viewingCreative, setViewingCreative] = useState<CreativeRecord | null>(null);

  const totalPublished = useMemo(
    () => initialPosts.filter((p) => p.publishStatus === 'published' || p.publishStatus === 'partial').length,
    [initialPosts],
  );

  const filtered = useMemo(() => {
    return initialPosts.filter((p) => {
      if (statusFilter === 'published') {
        if (p.publishStatus !== 'published' && p.publishStatus !== 'partial') return false;
      } else if (statusFilter === 'failed') {
        if (p.publishStatus !== 'failed') return false;
      } else if (statusFilter !== 'all') {
        if (p.status !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.brand.toLowerCase().includes(q) &&
          !p.caption.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [initialPosts, search, statusFilter]);

  const counts: Record<string, number> = useMemo(() => ({
    all:       initialPosts.length,
    draft:     initialPosts.filter((p) => p.status === 'draft').length,
    ready:     initialPosts.filter((p) => p.status === 'ready').length,
    published: initialPosts.filter((p) => p.publishStatus === 'published' || p.publishStatus === 'partial').length,
    failed:    initialPosts.filter((p) => p.publishStatus === 'failed').length,
  }), [initialPosts]);

  function openNew() {
    setEditingPost(null);
    setShowForm(true);
  }

  function openEdit(post: PostRecord) {
    setEditingPost(post);
    setShowForm(true);
  }

  function handleSuccess() {
    setShowForm(false);
    setEditingPost(null);
    router.refresh();
  }

  function handleClose() {
    setShowForm(false);
    setEditingPost(null);
  }

  function handleCreativeSaved() {
    setShowCreativeStudio(false);
    router.refresh();
  }

  function openHistory(post: PostRecord) {
    setHistoryPost(post);
  }

  function handleHistoryClose() {
    setHistoryPost(null);
  }

  function handleHistoryRetried() {
    router.refresh();
  }

  const creativeCountLabel = `${initialCreatives.length} creative${initialCreatives.length !== 1 ? 's' : ''}`;
  const postCountLabel = `${stats.total} post${stats.total !== 1 ? 's' : ''}`;

  return (
    <main className="main">
      <PageHeader
        title="Content Studio"
        subtitle={`${postCountLabel} · ${creativeCountLabel}`}
        actions={
          canWrite ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {viewMode === 'creatives' ? (
                <button className="btn btn-primary" onClick={() => setShowCreativeStudio(true)}>
                  {Ic.image} New Creative
                </button>
              ) : (
                <button className="btn btn-primary" onClick={openNew}>
                  {Ic.plus} New Draft
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* KPI strip */}
      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Total Posts</div>
          <div className="kpi-strip-val">{stats.total}</div>
          <div className="kpi-strip-note">all statuses</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Drafts</div>
          <div className="kpi-strip-val" style={{ color: 'var(--color-fg-2)' }}>{stats.totalDrafts}</div>
          <div className="kpi-strip-note">in progress</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Ready to Publish</div>
          <div className="kpi-strip-val" style={{ color: 'var(--color-success)' }}>{stats.totalReady}</div>
          <div className="kpi-strip-note">awaiting publish</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Published</div>
          <div className="kpi-strip-val" style={{ color: '#1A5C3C' }}>{totalPublished}</div>
          <div className="kpi-strip-note">live on social</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Creatives</div>
          <div className="kpi-strip-val" style={{ color: 'var(--color-accent)' }}>{initialCreatives.length}</div>
          <div className="kpi-strip-note">generated images</div>
        </div>
      </div>

      {/* View-mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {(['posts', 'creatives'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: '7px 16px',
              borderRadius: 'var(--radius-md)',
              border: viewMode === mode ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
              background: viewMode === mode ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
              color: viewMode === mode ? 'var(--color-accent)' : 'var(--color-fg-2)',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {mode === 'posts' ? Ic.edit : Ic.image}
            {mode === 'posts' ? 'Caption Drafts' : 'AI Creatives'}
          </button>
        ))}
      </div>

      {/* ── Posts view ─────────────────────────────────────────────────── */}
      {viewMode === 'posts' && (
        <>
          <div className="filter-bar">
            <div className="search-wrap">
              {Ic.search}
              <input
                className="search-input"
                placeholder="Search brand or caption…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="status-tabs">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`status-tab${statusFilter === t.key ? ' active' : ''}`}
                  onClick={() => setStatusFilter(t.key)}
                >
                  {t.label}
                  <span className="tab-count">{counts[t.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="content">
            {filtered.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 12, padding: '60px 20px',
                color: 'var(--color-fg-3)', textAlign: 'center',
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-fg-1)', marginBottom: 4 }}>
                    {search || statusFilter !== 'all' ? 'No posts match your filters' : 'No content drafts yet'}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {canWrite && !search && statusFilter === 'all'
                      ? 'Create your first draft to get started.'
                      : 'Try adjusting your search or filter.'}
                  </div>
                </div>
                {canWrite && !search && statusFilter === 'all' && (
                  <button className="btn btn-primary" onClick={openNew} style={{ marginTop: 4 }}>
                    {Ic.plus} New Draft
                  </button>
                )}
              </div>
            ) : (
              <div className="card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Brand · Channels</th>
                      <th>Caption</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th style={{ width: 120 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((post) => {
                      const chs = parseChannels(post.channels);
                      const hasPublishHistory = post.publishLogs.length > 0 || post.publishStatus != null;
                      return (
                        <tr key={post.id}>
                          <td style={{ minWidth: 160 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{post.brand}</div>
                            <div>
                              {chs.map((ch) => <ChannelBadge key={ch} channel={ch} />)}
                            </div>
                          </td>
                          <td style={{ maxWidth: 340 }}>
                            <div style={{
                              fontSize: 13, color: 'var(--color-fg-1)',
                              overflow: 'hidden', display: '-webkit-box',
                              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              lineHeight: 1.5,
                            }}>
                              {post.caption}
                            </div>
                            {post.productContext && (
                              <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 3 }}>
                                Context: {post.productContext.slice(0, 60)}{post.productContext.length > 60 ? '…' : ''}
                              </div>
                            )}
                          </td>
                          <td>
                            <StatusPill status={post.status} publishStatus={post.publishStatus} />
                          </td>
                          <td className="cell-muted">{formatDate(post.createdAt)}</td>
                          <td>
                            <div className="row-actions">
                              {canWrite && post.status === 'ready' && !post.publishStatus && (
                                <button
                                  className="row-action-btn"
                                  onClick={() => openHistory(post)}
                                  title="Publish post"
                                  style={{ color: 'var(--color-success)' }}
                                >
                                  {Ic.send} Publish
                                </button>
                              )}
                              {hasPublishHistory && (
                                <button
                                  className="row-action-btn"
                                  onClick={() => openHistory(post)}
                                  title="View publish history"
                                >
                                  {Ic.history} History
                                </button>
                              )}
                              {canWrite && (
                                <button className="row-action-btn" onClick={() => openEdit(post)} title="Edit draft">
                                  {Ic.edit} Edit
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Creatives view ──────────────────────────────────────────────── */}
      {viewMode === 'creatives' && (
        <div className="content">
          {initialCreatives.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 12, padding: '60px 20px',
              color: 'var(--color-fg-3)', textAlign: 'center',
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-fg-1)', marginBottom: 4 }}>
                  No creatives yet
                </div>
                <div style={{ fontSize: 13 }}>
                  {canWrite
                    ? 'Generate your first branded marketing image.'
                    : 'No generated creatives available yet.'}
                </div>
              </div>
              {canWrite && (
                <button className="btn btn-primary" onClick={() => setShowCreativeStudio(true)} style={{ marginTop: 4 }}>
                  {Ic.sparkle} Generate Creative
                </button>
              )}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 16,
            }}>
              {initialCreatives.map((c) => (
                <div key={c.id} className="card" style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
                  {/* Clickable thumbnail */}
                  <button
                    onClick={() => setViewingCreative(c)}
                    title="View creative"
                    style={{
                      display: 'block', width: '100%', padding: 0, border: 'none',
                      background: 'none', cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.generatedImageData}
                      alt={`Creative for ${c.brand}`}
                      style={{ display: 'block', width: '100%', aspectRatio: '4/3', objectFit: 'cover' }}
                    />
                    {/* Hover overlay hint */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'rgba(0,0,0,0.0)',
                      transition: 'background 150ms',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }} className="creative-thumb-overlay" />
                  </button>

                  {/* Metadata */}
                  <div style={{ padding: '10px 12px', flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)', marginBottom: 2 }}>
                      {c.brand}
                    </div>
                    {c.personaStyle && (
                      <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginBottom: 2 }}>
                        {PERSONA_OPTIONS.find((p) => p.id === c.personaStyle)?.label ?? c.personaStyle}
                      </div>
                    )}
                    {c.productContext && (
                      <div style={{
                        fontSize: 11, color: 'var(--color-fg-3)',
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {c.productContext}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--color-fg-3)', marginTop: 4 }}>
                      {formatDate(c.createdAt)}
                    </div>
                  </div>

                  {/* Action row */}
                  <div style={{
                    padding: '8px 12px',
                    borderTop: '1px solid var(--color-border-subtle)',
                    display: 'flex', gap: 6,
                  }}>
                    <button
                      className="row-action-btn"
                      onClick={() => setViewingCreative(c)}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      {Ic.image} View
                    </button>
                    <button
                      className="row-action-btn"
                      onClick={() => setViewingCreative(c)}
                      title="Download"
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      {Ic.sparkle} Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Draft form modal */}
      {showForm && (
        <PostFormModal
          post={editingPost}
          availableBrands={availableBrands}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}

      {/* Creative studio modal */}
      {showCreativeStudio && (
        <CreativeStudioModal
          availableBrands={availableBrands}
          onClose={() => setShowCreativeStudio(false)}
          onSaved={handleCreativeSaved}
        />
      )}

      {/* Publish history / publish modal */}
      {historyPost && (
        <PublishHistoryModal
          postId={historyPost.id}
          brand={historyPost.brand}
          caption={historyPost.caption}
          channels={parseChannels(historyPost.channels)}
          publishStatus={historyPost.publishStatus}
          publishLogs={historyPost.publishLogs}
          onClose={handleHistoryClose}
          onRetried={handleHistoryRetried}
        />
      )}

      {/* Creative detail / download / delete modal */}
      {viewingCreative && (
        <CreativeDetailModal
          creative={viewingCreative}
          canWrite={canWrite}
          onClose={() => setViewingCreative(null)}
          onDeleted={() => {
            setViewingCreative(null);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}
