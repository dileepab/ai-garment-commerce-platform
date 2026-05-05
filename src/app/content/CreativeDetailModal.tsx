'use client';

import React, { useState, useTransition } from 'react';
import { PERSONA_OPTIONS } from '@/lib/creative-generator';
import { deleteGeneratedCreative } from './actions';
import type { CreativeRecord } from './ContentPageClient';

interface Props {
  creative: CreativeRecord;
  canWrite: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const Ic = {
  close: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  download: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
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

function personaLabel(id: string | null): string | null {
  if (!id) return null;
  return PERSONA_OPTIONS.find((p) => p.id === id)?.label ?? id;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreativeDetailModal({ creative, canWrite, onClose, onDeleted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function handleDelete() {
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteGeneratedCreative(creative.id);
      if (result.success) {
        onDeleted();
      } else {
        setDeleteError(result.error ?? 'Delete failed.');
        setConfirmDelete(false);
      }
    });
  }

  // Derive a download filename from brand + date
  const filename = `${creative.brand.replace(/\s+/g, '-').toLowerCase()}-creative-${creative.id}.jpg`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isDeleting ? onClose : undefined}
        style={{ position: 'fixed', inset: 0, background: 'rgba(24,22,15,0.32)', zIndex: 400 }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: 720,
        maxHeight: '92vh',
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
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-fg-1)' }}>
              {creative.brand}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 1 }}>
              {formatDateTime(creative.createdAt)}
              {creative.createdBy ? ` · by ${creative.createdBy}` : ''}
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
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {Ic.close}
          </button>
        </div>

        {/* Body — two-column on wide screens */}
        <div style={{
          flex: 1, overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)',
          gap: 0,
        }}>

          {/* Image panel */}
          <div style={{
            background: '#111',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 300,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={creative.generatedImageData}
              alt={`Creative for ${creative.brand}`}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', maxHeight: '80vh' }}
            />
          </div>

          {/* Metadata + actions panel */}
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Persona */}
            {creative.personaStyle && (
              <div>
                <div style={labelStyle}>Model Persona</div>
                <div style={{ fontSize: 13, color: 'var(--color-fg-1)' }}>
                  {personaLabel(creative.personaStyle)}
                </div>
              </div>
            )}

            {/* Product context */}
            {creative.productContext && (
              <div>
                <div style={labelStyle}>Product Description</div>
                <div style={{
                  fontSize: 12, color: 'var(--color-fg-2)', lineHeight: 1.55,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {creative.productContext}
                </div>
              </div>
            )}

            {/* Source image */}
            {creative.sourceImageUrl && (
              <div>
                <div style={labelStyle}>Source Image</div>
                <a
                  href={creative.sourceImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--color-accent)', wordBreak: 'break-all' }}
                >
                  {creative.sourceImageUrl.length > 60
                    ? `${creative.sourceImageUrl.slice(0, 57)}…`
                    : creative.sourceImageUrl}
                </a>
              </div>
            )}

            {/* Generation prompt — collapsible */}
            <details>
              <summary style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-fg-3)',
                cursor: 'pointer', userSelect: 'none',
              }}>
                Generation Prompt
              </summary>
              <div style={{
                marginTop: 6, fontSize: 11, color: 'var(--color-fg-3)',
                lineHeight: 1.55, fontStyle: 'italic',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {creative.prompt}
              </div>
            </details>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Download */}
              <a
                href={creative.generatedImageData}
                download={filename}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-fg-1)',
                  fontSize: 13, fontWeight: 600,
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
              >
                {Ic.download} Download Image
              </a>

              {/* Delete — requires canWrite + confirmation */}
              {canWrite && (
                <>
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      disabled={isDeleting}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-error-muted)',
                        background: 'transparent',
                        color: 'var(--color-error)',
                        fontSize: 13, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {Ic.trash} Delete Creative
                    </button>
                  ) : (
                    <div style={{
                      padding: '10px 12px',
                      background: 'var(--color-error-muted)',
                      borderRadius: 'var(--radius-md)',
                    }}>
                      <div style={{ fontSize: 12, color: 'var(--color-error)', fontWeight: 600, marginBottom: 8 }}>
                        Delete this creative permanently?
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleDelete}
                          disabled={isDeleting}
                          style={{
                            flex: 1, padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: 'var(--color-error)',
                            color: '#fff',
                            fontSize: 12, fontWeight: 700,
                            cursor: isDeleting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isDeleting ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          disabled={isDeleting}
                          style={{
                            flex: 1, padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)',
                            color: 'var(--color-fg-2)',
                            fontSize: 12, fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {deleteError && (
                <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{deleteError}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
  marginBottom: 4,
};
