'use client';

import React, { useState, useTransition } from 'react';
import { PERSONAS_BY_BRAND, type PersonaId } from '@/lib/persona-data';
import type { ViewAngle } from '@/lib/creative-generator';
import {
  generateCreativeBatchAction,
  saveGeneratedCreative,
  discardCreativeDraft,
  searchProductsForContent,
  getCreativesForProduct,
} from './actions';

const VIEW_ANGLES: { id: ViewAngle; label: string }[] = [
  { id: 'front',   label: 'Front' },
  { id: 'side',    label: 'Side' },
  { id: 'back',    label: 'Back' },
  { id: 'closeup', label: 'Close-up' },
];

interface DraftResult {
  creativeId: number;
  imageData: string;
  prompt: string;
  viewAngle?: ViewAngle;
  saved: boolean;
}

interface ExistingCreative {
  id: number;
  viewAngle: string | null;
  personaStyle: string | null;
  createdAt: string | Date;
}

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
  const defaultBrands = availableBrands ?? ['Happyby', 'Cleopatra', 'Modabella'];
  const [brand, setBrand] = useState(defaultBrands[0]);
  const [personaId, setPersonaId] = useState<PersonaId>(PERSONAS_BY_BRAND[defaultBrands[0]]?.[0]?.id ?? 'none');
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [, startSearching] = useTransition();
  const [productContext, setProductContext] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [sourceImgError, setSourceImgError] = useState(false);
  const [linkedProductId, setLinkedProductId] = useState<number | null>(null);
  const [linkedProductName, setLinkedProductName] = useState<string | null>(null);

  const [viewAngles, setViewAngles] = useState<ViewAngle[]>(['front']);

  const [drafts, setDrafts] = useState<DraftResult[]>([]);
  const [existingCreatives, setExistingCreatives] = useState<ExistingCreative[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [isGenerating, startGenerating] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const isLoading = isGenerating || isSaving;
  const hasUnsavedDrafts = drafts.some(d => !d.saved);

  async function discardAllUnsavedDrafts() {
    const unsaved = drafts.filter(d => !d.saved);
    await Promise.all(unsaved.map(d => discardCreativeDraft(d.creativeId).catch(() => {})));
  }

  function handleGenerate() {
    setFormError(null);
    if (!brand.trim()) { setFormError('Select a brand before generating.'); return; }
    if (viewAngles.length === 0) { setFormError('Select at least one view angle.'); return; }

    startGenerating(async () => {
      await discardAllUnsavedDrafts();
      setDrafts([]);

      const result = await generateCreativeBatchAction({
        brand: brand.trim(),
        personaId,
        productContext,
        sourceImageUrl: sourceImageUrl.trim() || undefined,
        productId: linkedProductId ?? undefined,
        viewAngles,
      });

      const newDrafts: DraftResult[] = [];
      const errors: string[] = [];
      for (const r of result.results) {
        if (r.success && r.imageData && r.creativeId) {
          newDrafts.push({
            creativeId: r.creativeId,
            imageData: r.imageData,
            prompt: r.prompt ?? '',
            viewAngle: r.viewAngle,
            saved: false,
          });
        } else if (r.error) {
          errors.push(r.error);
        }
      }
      setDrafts(newDrafts);
      if (errors.length > 0 && newDrafts.length === 0) {
        setFormError(errors[0]);
      } else if (errors.length > 0) {
        setFormError(`${errors.length} of ${result.results.length} generations failed.`);
      }
    });
  }

  function handleSearchProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setProductSearch(q);
    if (q.length > 2) {
      startSearching(async () => {
        const res = await searchProductsForContent(q, brand);
        if (res.success && 'products' in res && res.products) {
          setSearchResults(res.products);
        }
      });
    } else {
      setSearchResults([]);
    }
  }

  function handleSelectProduct(product: any) {
    const context = `Name: ${product.name}. Fabric: ${product.fabric || 'N/A'}. Style: ${product.style || 'N/A'}. Price: Rs ${product.price}. Colors: ${product.colors || 'N/A'}. Sizes: ${product.sizes || 'N/A'}.`;
    setProductContext(context);
    setProductSearch('');
    setSearchResults([]);
    setLinkedProductId(product.id);
    setLinkedProductName(product.name);
    if (product.imageUrl) {
      setSourceImageUrl(product.imageUrl);
      setSourceImgError(false);
    }
    // Load existing saved generations for this product so the user can reuse them.
    getCreativesForProduct(product.id).then(res => {
      if (res.success && 'creatives' in res && res.creatives) {
        setExistingCreatives(res.creatives as unknown as ExistingCreative[]);
      } else {
        setExistingCreatives([]);
      }
    }).catch(() => setExistingCreatives([]));
  }

  function handleClearProduct() {
    setLinkedProductId(null);
    setLinkedProductName(null);
    setSourceImageUrl('');
    setExistingCreatives([]);
  }

  function toggleAngle(angle: ViewAngle) {
    setViewAngles(prev =>
      prev.includes(angle) ? prev.filter(a => a !== angle) : [...prev, angle],
    );
  }

  function handleSaveAll() {
    const unsaved = drafts.filter(d => !d.saved);
    if (unsaved.length === 0) return;
    setFormError(null);
    startSaving(async () => {
      const updated = [...drafts];
      for (const d of unsaved) {
        const result = await saveGeneratedCreative(d.creativeId);
        if (result.success) {
          const idx = updated.findIndex(x => x.creativeId === d.creativeId);
          if (idx >= 0) updated[idx] = { ...updated[idx], saved: true };
        } else if (!formError) {
          setFormError(result.error ?? 'Save failed. Please retry.');
        }
      }
      setDrafts(updated);
      if (updated.every(d => d.saved)) onSaved();
    });
  }

  function handleClose() {
    discardAllUnsavedDrafts().catch(() => {});
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
              <select className="app-input" value={brand} onChange={(e) => {
                const newBrand = e.target.value;
                setBrand(newBrand);
                setPersonaId(PERSONAS_BY_BRAND[newBrand]?.[0]?.id ?? 'none');
              }} disabled={isLoading}>
                {defaultBrands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <label style={labelStyle}>Link Product <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>(auto-fills description)</span></label>
              <input
                className="app-input"
                placeholder="Search products..."
                value={productSearch}
                onChange={handleSearchProduct}
                disabled={isLoading}
              />
              {searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', zIndex: 10, maxHeight: 150, overflowY: 'auto', boxShadow: 'var(--shadow-sm)' }}>
                  {searchResults.map(p => (
                    <div key={p.id} onClick={() => handleSelectProduct(p)} style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <strong>{p.name}</strong> - Rs {p.price}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Persona selector (Visual) */}
          <div>
            <label style={labelStyle}>Model Persona</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[{ id: 'none', label: 'Product only', imageUrl: null, height: '', bodyShape: '', skinTone: '' }, ...(PERSONAS_BY_BRAND[brand] || [])].map((p) => (
                <div
                  key={p.id}
                  onClick={() => !isLoading && setPersonaId(p.id)}
                  style={{
                    border: personaId === p.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    cursor: isLoading ? 'default' : 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                    position: 'relative',
                  }}
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.label} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1/1', background: 'var(--color-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-fg-3)', textAlign: 'center', padding: 8 }}>
                      No Model
                    </div>
                  )}
                  <div style={{ padding: '6px', fontSize: 10, fontWeight: 600, textAlign: 'center', background: personaId === p.id ? 'var(--color-accent-subtle)' : 'var(--color-bg)', color: personaId === p.id ? 'var(--color-accent)' : 'var(--color-fg-2)' }}>
                    {p.label.split(' (')[0]}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Source image — auto-filled when a product is linked; URL input shown only when no product */}
          {linkedProductId !== null ? (
            <div>
              <label style={labelStyle}>Source Product Image</label>
              <div style={{
                display: 'flex', gap: 12, alignItems: 'center',
                padding: 10,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg)',
              }}>
                {sourceImageUrl && !sourceImgError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sourceImageUrl}
                    alt={linkedProductName ?? 'Linked product'}
                    onError={() => setSourceImgError(true)}
                    style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                ) : (
                  <div style={{ width: 60, height: 60, background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-fg-3)' }}>
                    {Ic.image}
                  </div>
                )}
                <div style={{ flex: 1, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-fg-1)' }}>{linkedProductName}</div>
                  <div style={{ color: 'var(--color-fg-3)', fontSize: 11, marginTop: 2 }}>
                    Using stored product image — generations will be linked to this product.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearProduct}
                  disabled={isLoading}
                  style={{
                    padding: '5px 10px', fontSize: 11, fontWeight: 600,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--color-fg-2)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Unlink
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label style={labelStyle}>
                Source Product Image URL{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                  (optional — or link a product above to auto-fill)
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
          )}

          {/* View angles */}
          <div>
            <label style={labelStyle}>
              View Angles{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                (one image per selected angle — each costs a generation)
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VIEW_ANGLES.map(a => {
                const active = viewAngles.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => !isLoading && toggleAngle(a.id)}
                    disabled={isLoading}
                    style={{
                      padding: '7px 14px', fontSize: 12, fontWeight: 600,
                      border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                      color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Existing creatives for this product — reuse instead of regenerate */}
          {linkedProductId !== null && existingCreatives.length > 0 && (
            <div>
              <label style={labelStyle}>
                Existing Generations{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                  ({existingCreatives.length} saved for this product)
                </span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {existingCreatives.slice(0, 8).map(c => (
                  <div key={c.id} style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: 'var(--color-bg)',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/content/creatives/${c.id}/image`}
                      alt={`Creative ${c.id}`}
                      style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: 4, fontSize: 10, textAlign: 'center', color: 'var(--color-fg-3)' }}>
                      {c.viewAngle ?? 'front'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {/* Generated drafts — one tile per angle */}
          {drafts.length > 0 && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: 'var(--color-fg-3)',
                }}>
                  Generated Creatives ({drafts.length})
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isLoading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-fg-2)',
                    fontSize: 11, fontWeight: 600,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {Ic.refresh} Regenerate all
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: drafts.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                gap: 10,
              }}>
                {drafts.map(d => (
                  <div key={d.creativeId} style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.imageData}
                      alt={`Generated ${d.viewAngle ?? 'creative'}`}
                      style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }}
                    />
                    <div style={{
                      padding: '6px 10px',
                      fontSize: 11, fontWeight: 600,
                      color: 'var(--color-fg-2)',
                      borderTop: '1px solid var(--color-border-subtle)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ textTransform: 'capitalize' }}>{d.viewAngle ?? 'front'}</span>
                      {d.saved && (
                        <span style={{ color: 'var(--color-accent)', fontSize: 10 }}>✓ Saved</span>
                      )}
                    </div>
                  </div>
                ))}
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
            onClick={handleSaveAll}
            disabled={isLoading || !hasUnsavedDrafts}
          >
            {isSaving ? 'Saving…' : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {Ic.save} {drafts.filter(d => !d.saved).length > 1
                  ? `Save ${drafts.filter(d => !d.saved).length} Creatives`
                  : 'Save Creative'}
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
