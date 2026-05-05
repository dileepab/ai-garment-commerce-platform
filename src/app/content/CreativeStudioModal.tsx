'use client';

import React, { useState, useTransition } from 'react';
import { PERSONA_OPTIONS, type PersonaId } from '@/lib/creative-generator';
import { generateCreativeAction, saveGeneratedCreative, discardCreativeDraft } from './actions';

// ── Icons ────────────────────────────────────────────────────────────────────

const Ic = {
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
  refresh: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  save: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  image: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
};

// ── Types ────────────────────────────────────────────────────────────────────

interface CreativeStudioModalProps {
  availableBrands: string[] | null;
  onClose: () => void;
  onSaved: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreativeStudioModal({
  availableBrands,
  onClose,
  onSaved,
}: CreativeStudioModalProps) {
  const [brand, setBrand] = useState(availableBrands?.[0] ?? '');
  const [personaId, setPersonaId] = useState<PersonaId>('young-professional');
  const [productContext, setProductContext] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [sourceImgError, setSourceImgError] = useState(false);

  const [generatedImageData, setGeneratedImageData] = useState<string | null>(null);
  const [usedPrompt, setUsedPrompt] = useState<string | null>(null);
  const [draftCreativeId, setDraftCreativeId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [isGenerating, startGenerating] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const isLoading = isGenerating || isSaving;

  function handleGenerate() {
    setFormError(null);
    if (!brand.trim()) { setFormError('Select a brand before generating.'); return; }

    startGenerating(async () => {
      // Discard any existing unsaved draft before generating a new one
      if (draftCreativeId !== null) {
        await discardCreativeDraft(draftCreativeId);
        setDraftCreativeId(null);
      }

      const result = await generateCreativeAction({
        brand: brand.trim(),
        personaId,
        productContext,
        sourceImageUrl: sourceImageUrl.trim() || undefined,
      });

      if (result.success && result.imageData) {
        setGeneratedImageData(result.imageData);
        setUsedPrompt(result.prompt ?? null);
        setDraftCreativeId(result.creativeId ?? null);
      } else {
        setFormError(result.error ?? 'Generation failed. Please retry.');
      }
    });
  }

  function handleRegenerate() {
    setGeneratedImageData(null);
    setUsedPrompt(null);
    // draftCreativeId is discarded inside handleGenerate before the next generation
    handleGenerate();
  }

  function handleSave() {
    if (!draftCreativeId) return;
    setFormError(null);
    startSaving(async () => {
      // Only the ID is sent — the image is already in the DB from generation
      const result = await saveGeneratedCreative(draftCreativeId);
      if (result.success) {
        setDraftCreativeId(null);
        onSaved();
      } else {
        setFormError(result.error ?? 'Save failed. Please retry.');
      }
    });
  }

  function handleClose() {
    // Clean up unsaved draft on dismiss
    if (draftCreativeId !== null) {
      discardCreativeDraft(draftCreativeId).catch(() => {});
    }
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={!isLoading ? handleClose : undefined}
        style={{ position: 'fixed', inset: 0, background: 'rgba(24,22,15,0.25)', zIndex: 400 }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: 680,
        maxHeight: '92vh',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-modal)',
        zIndex: 401,
        display: 'flex',
        flexDirection: 'column',
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
              AI Creative Studio
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 2 }}>
              Generate branded marketing images from product photos
            </div>
          </div>
          <button
            onClick={handleClose}
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Brand + Persona row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Brand</label>
              {availableBrands ? (
                <select className="app-input" value={brand} onChange={(e) => setBrand(e.target.value)} disabled={isLoading}>
                  {availableBrands.map((b) => <option key={b} value={b}>{b}</option>)}
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
            <div>
              <label style={labelStyle}>Model Persona</label>
              <select
                className="app-input"
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value as PersonaId)}
                disabled={isLoading}
              >
                {PERSONA_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Source image URL */}
          <div>
            <label style={labelStyle}>
              Source Product Image URL{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                (optional — provide a product photo for reference)
              </span>
            </label>
            <input
              className="app-input"
              placeholder="https://example.com/product-photo.jpg"
              value={sourceImageUrl}
              onChange={(e) => { setSourceImageUrl(e.target.value); setSourceImgError(false); }}
              disabled={isLoading}
            />
            {sourceImageUrl.trim() && !sourceImgError && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceImageUrl}
                alt="Source product"
                onError={() => setSourceImgError(true)}
                style={{
                  marginTop: 8,
                  maxHeight: 100,
                  maxWidth: '100%',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  objectFit: 'cover',
                }}
              />
            )}
            {sourceImgError && (
              <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>
                Could not load image from this URL.
              </div>
            )}
          </div>

          {/* Product context */}
          <div>
            <label style={labelStyle}>
              Product Description{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                (describe the garment — color, style, fabric, occasion)
              </span>
            </label>
            <textarea
              className="app-textarea"
              placeholder="e.g. Black floral midi dress, chiffon fabric, off-shoulder neckline, suitable for evening events"
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              disabled={isLoading}
              rows={3}
              style={{ resize: 'none', minHeight: 72 }}
            />
          </div>

          {/* Generate button */}
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '9px 18px',
                background: isGenerating ? 'var(--color-surface-muted)' : 'var(--color-accent-subtle)',
                border: '1px solid rgba(196,98,45,0.25)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-accent)',
                fontSize: 13, fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 120ms',
              }}
            >
              {Ic.sparkle}
              {isGenerating ? 'Generating creative…' : 'Generate Creative'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 6 }}>
              AI will create a branded marketing image using your brand style and persona.
            </div>
          </div>

          {/* Generated image preview */}
          {generatedImageData && (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', color: 'var(--color-fg-3)', marginBottom: 8,
              }}>
                Generated Creative
              </div>

              <div style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={generatedImageData}
                  alt="Generated marketing creative"
                  style={{ display: 'block', width: '100%', maxHeight: 400, objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isLoading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-fg-2)',
                    fontSize: 12, fontWeight: 600,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {Ic.refresh}
                  Regenerate
                </button>
              </div>

              {usedPrompt && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: 'var(--color-fg-3)', cursor: 'pointer' }}>
                    View generation prompt
                  </summary>
                  <p style={{
                    fontSize: 11, color: 'var(--color-fg-3)', marginTop: 6,
                    lineHeight: 1.5, fontStyle: 'italic',
                  }}>
                    {usedPrompt}
                  </p>
                </details>
              )}
            </div>
          )}

          {formError && (
            <div style={{
              padding: '9px 12px',
              background: 'var(--color-error-muted)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 13,
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
          <button className="btn btn-secondary" onClick={handleClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isLoading || !draftCreativeId}
          >
            {isSaving ? 'Saving…' : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {Ic.save} Save Creative
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
  marginBottom: 6,
};
