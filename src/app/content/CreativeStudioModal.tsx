'use client';

import React, { useState, useTransition } from 'react';
import { PERSONAS_BY_BRAND, type PersonaId } from '@/lib/persona-data';
import type { CreativeAspectRatio, CreativeGenerationQuality, ViewAngle } from '@/lib/creative-generator';
import { buildGarmentSpecsForAi } from '@/lib/product-garment-specs';
import ImageLightbox from './ImageLightbox';
import ReferenceImagePicker, {
  hasAnyReference,
  inferredAngles,
  referenceSetToInputs,
  type ReferenceSet,
} from './ReferenceImagePicker';
import {
  generateCreativeBatchAction,
  regenerateCreativeAction,
  saveGeneratedCreative,
  discardCreativeDraft,
  searchProductsForContent,
  getCreativesForProduct,
  type BatchSourceImage,
} from './actions';

const VIEW_ANGLES: { id: ViewAngle; label: string }[] = [
  { id: 'front',   label: 'Front' },
  { id: 'side',    label: 'Side' },
  { id: 'back',    label: 'Back' },
  { id: 'closeup', label: 'Close-up' },
];

const ASPECT_RATIOS: { id: CreativeAspectRatio; label: string }[] = [
  { id: '4:5', label: 'Portrait 4:5' },
  { id: '1:1', label: 'Square 1:1' },
  { id: '9:16', label: 'Story 9:16' },
  { id: '4:3', label: 'Landscape 4:3' },
];

interface DraftResult {
  creativeId: number;
  imageData: string;
  prompt: string;
  viewAngle?: ViewAngle;
  sourceColor?: string;
  grounded?: boolean;
  corrections?: string[];
  saved: boolean;
}

// Product photos arrive as flat colour/angle rows; generation needs one
// reference set per colour.
function groupColorReferences(
  colorImages: Array<{ color: string; angle?: string | null; imageUrl: string }>,
): Record<string, ReferenceSet> {
  const grouped: Record<string, ReferenceSet> = {};
  for (const image of colorImages) {
    if (!image.imageUrl?.trim()) continue;
    const angle = (image.angle ?? 'front') as ViewAngle;
    grouped[image.color] = { ...grouped[image.color], [angle]: image.imageUrl };
  }
  return grouped;
}

function referenceColors(references: Record<string, ReferenceSet>): string[] {
  return Object.keys(references).filter(color => hasAnyReference(references[color])).sort();
}

interface ExistingCreative {
  id: number;
  viewAngle: string | null;
  personaStyle: string | null;
  createdAt: string | Date;
}

interface ProductSearchResult {
  id: number;
  name: string;
  brand: string;
  style: string | null;
  price: number;
  fabric: string | null;
  colors: string | null;
  sizes: string | null;
  imageUrl: string | null;
  colorImages?: Array<{ id: number; color: string; angle?: string | null; imageUrl: string }>;
  garmentLengthCm?: number | null;
  sleeveLengthCm?: number | null;
  sleeveType?: string | null;
  fitType?: string | null;
  neckline?: string | null;
  closureDetails?: string | null;
  hasSideSlit?: boolean | null;
  sideSlitHeightCm?: number | null;
  hemDetails?: string | null;
  sleeveHemDetails?: string | null;
  patternDetails?: string | null;
  referenceModelHeightCm?: number | null;
  wornLengthNote?: string | null;
  aiFidelityNotes?: string | null;
}

function productDisplayImage(product: ProductSearchResult | null): string | null {
  return product?.imageUrl || product?.colorImages?.[0]?.imageUrl || null;
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
  availableBrands: string[];
  onClose: () => void;
  onSaved: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreativeStudioModal({
  availableBrands,
  onClose,
  onSaved,
}: CreativeStudioModalProps) {
  const defaultBrands = availableBrands;
  const [brand, setBrand] = useState(defaultBrands[0] ?? '');
  const [personaId, setPersonaId] = useState<PersonaId>(PERSONAS_BY_BRAND[defaultBrands[0] ?? '']?.[0]?.id ?? 'none');
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [, startSearching] = useTransition();
  const [productContext, setProductContext] = useState('');
  const [garmentFitNotes, setGarmentFitNotes] = useState('');
  // Reference photos when no product is linked, keyed by angle.
  const [references, setReferences] = useState<ReferenceSet>({});
  const [sourceImgError, setSourceImgError] = useState(false);
  const [linkedProductId, setLinkedProductId] = useState<number | null>(null);
  const [linkedProductName, setLinkedProductName] = useState<string | null>(null);
  // Reference photos per colour once a product is linked.
  const [colorReferences, setColorReferences] = useState<Record<string, ReferenceSet>>({});
  const [expandedColor, setExpandedColor] = useState<string | null>(null);
  const [colorViewAngles, setColorViewAngles] = useState<Record<string, ViewAngle[]>>({});

  const [viewAngles, setViewAngles] = useState<ViewAngle[]>(['front']);
  const [generationQuality, setGenerationQuality] = useState<CreativeGenerationQuality>('standard');
  const [aspectRatio, setAspectRatio] = useState<CreativeAspectRatio>('4:5');

  const [drafts, setDrafts] = useState<DraftResult[]>([]);
  const [correctionTextById, setCorrectionTextById] = useState<Record<number, string>>({});
  const [regeneratingDraftId, setRegeneratingDraftId] = useState<number | null>(null);
  const [existingCreatives, setExistingCreatives] = useState<ExistingCreative[]>([]);
  const [zoomed, setZoomed] = useState<{ src: string; caption: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [isGenerating, startGenerating] = useTransition();
  const [isRegeneratingDraft, startRegeneratingDraft] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const isLoading = isGenerating || isRegeneratingDraft || isSaving;
  const hasUnsavedDrafts = drafts.some(d => !d.saved);
  const colorsWithReferences = referenceColors(colorReferences);
  const plannedGenerationCount = colorsWithReferences.length > 0
    ? colorsWithReferences.reduce((sum, color) => sum + (colorViewAngles[color] ?? viewAngles).length, 0)
    : Math.max(1, viewAngles.length);
  // Angles queued for generation that no photo covers — these get invented.
  const missingAngles = colorsWithReferences.length > 0
    ? [...new Set(colorsWithReferences.flatMap(color =>
        inferredAngles(colorReferences[color], colorViewAngles[color] ?? viewAngles)))]
    : inferredAngles(references, viewAngles);
  const previewReferenceUrl = references.front
    ?? colorReferences[colorsWithReferences[0]]?.front
    ?? '';

  async function discardAllUnsavedDrafts() {
    const unsaved = drafts.filter(d => !d.saved);
    await Promise.all(unsaved.map(d => discardCreativeDraft(d.creativeId).catch(() => {})));
  }

  function handleGenerate() {
    setFormError(null);
    if (!brand.trim()) { setFormError('Select a brand before generating.'); return; }
    if (colorsWithReferences.length === 0 && viewAngles.length === 0) { setFormError('Select at least one view angle.'); return; }
    if (colorsWithReferences.length > 0 && plannedGenerationCount === 0) {
      setFormError('Select at least one view angle for a colour variant.');
      return;
    }

    startGenerating(async () => {
      await discardAllUnsavedDrafts();
      setDrafts([]);
      setCorrectionTextById({});

      const colorSources: BatchSourceImage[] = colorsWithReferences
        .map((color) => ({
          color,
          referenceImages: referenceSetToInputs(colorReferences[color]),
          viewAngles: colorViewAngles[color] ?? viewAngles,
        }))
        .filter((source) => source.viewAngles.length > 0);
      const result = await generateCreativeBatchAction({
        brand: brand.trim(),
        personaId,
        productContext,
        garmentFitNotes,
        referenceImages: referenceSetToInputs(references),
        sourceImages: colorSources.length > 0 ? colorSources : undefined,
        productId: linkedProductId ?? undefined,
        viewAngles,
        quality: generationQuality,
        aspectRatio,
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
            sourceColor: r.sourceColor,
            grounded: r.grounded,
            corrections: r.corrections ?? [],
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
          setSearchResults(res.products as ProductSearchResult[]);
        }
      });
    } else {
      setSearchResults([]);
    }
  }

  function handleSelectProduct(product: ProductSearchResult) {
    const context = `Name: ${product.name}. Fabric: ${product.fabric || 'N/A'}. Style: ${product.style || 'N/A'}. Price: Rs ${product.price}. Colors: ${product.colors || 'N/A'}. Sizes: ${product.sizes || 'N/A'}.`;
    const garmentSpecs = buildGarmentSpecsForAi(product);
    setProductContext(context);
    setGarmentFitNotes(garmentSpecs);
    setProductSearch('');
    setSearchResults([]);
    setLinkedProductId(product.id);
    setLinkedProductName(product.name);
    const grouped = groupColorReferences(product.colorImages ?? []);
    setColorReferences(grouped);
    setExpandedColor(null);
    setColorViewAngles(Object.fromEntries(referenceColors(grouped).map(color => [color, viewAngles])));
    // Products with no colour rows still have a single main photo — use it as
    // the front reference so generation is never left with nothing.
    const mainImage = productDisplayImage(product);
    setReferences(Object.keys(grouped).length === 0 && mainImage ? { front: mainImage } : {});
    setSourceImgError(false);
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
    setColorReferences({});
    setExpandedColor(null);
    setColorViewAngles({});
    setReferences({});
    setGarmentFitNotes('');
    setExistingCreatives([]);
  }

  function updateColorReferences(color: string, next: ReferenceSet) {
    setColorReferences(prev => ({ ...prev, [color]: next }));
  }

  function toggleAngle(angle: ViewAngle) {
    setViewAngles(prev =>
      prev.includes(angle) ? prev.filter(a => a !== angle) : [...prev, angle],
    );
  }

  function toggleColorAngle(color: string, angle: ViewAngle) {
    setColorViewAngles(prev => {
      const current = prev[color] ?? viewAngles;
      return {
        ...prev,
        [color]: current.includes(angle)
          ? current.filter(a => a !== angle)
          : [...current, angle],
      };
    });
  }

  function handleCorrectionTextChange(creativeId: number, value: string) {
    setCorrectionTextById(prev => ({ ...prev, [creativeId]: value }));
  }

  function handleRegenerateDraft(creativeId: number) {
    const correctionText = correctionTextById[creativeId]?.trim();
    if (!correctionText) {
      setFormError('Add a correction note before regenerating this image.');
      return;
    }

    setFormError(null);
    setRegeneratingDraftId(creativeId);
    startRegeneratingDraft(async () => {
      const result = await regenerateCreativeAction(creativeId, correctionText, generationQuality);
      setRegeneratingDraftId(null);

      if (result.success && result.imageData) {
        setDrafts(prev => prev.map(d => (
          d.creativeId === creativeId
            ? {
                ...d,
                imageData: result.imageData!,
                prompt: result.prompt ?? d.prompt,
                viewAngle: result.viewAngle ?? d.viewAngle,
                grounded: result.grounded ?? d.grounded,
                corrections: result.corrections ?? d.corrections,
                saved: false,
              }
            : d
        )));
        setCorrectionTextById(prev => ({ ...prev, [creativeId]: '' }));
      } else {
        setFormError(result.error ?? 'Regeneration failed. Please retry.');
      }
    });
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
          <div className="grid-2-mobile1" style={{ gap: 14 }}>
            <div>
              <label style={labelStyle}>Brand</label>
              <select className="app-input" value={brand} onChange={(e) => {
                const newBrand = e.target.value;
                setBrand(newBrand);
                setPersonaId(PERSONAS_BY_BRAND[newBrand]?.[0]?.id ?? 'none');
              }} disabled={isLoading || defaultBrands.length === 0}>
                {defaultBrands.length === 0 ? (
                  <option value="">Add a brand in Settings first</option>
                ) : (
                  defaultBrands.map((b) => <option key={b} value={b}>{b}</option>)
                )}
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
                    <div key={p.id} onClick={() => handleSelectProduct(p)} style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', gap: 10, alignItems: 'center' }}>
                      {productDisplayImage(p) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={productDisplayImage(p)!} alt={p.name} style={{ width: 34, height: 40, borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid var(--color-border-subtle)' }} />
                      )}
                      <div>
                        <strong>{p.name}</strong> - Rs {p.price}
                        {(p.colorImages?.length ?? 0) > 0 && (
                          <div style={{ color: 'var(--color-fg-3)', fontSize: 10 }}>{p.colorImages!.length} colour image{p.colorImages!.length !== 1 ? 's' : ''}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Persona selector (Visual) */}
          <div>
            <label style={labelStyle}>Model Persona</label>
            <div className="grid-4-mobile2" style={{ gap: 10 }}>
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
                display: 'grid',
                gridTemplateColumns: '108px 1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: 10,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg)',
              }}>
                {previewReferenceUrl && !sourceImgError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewReferenceUrl}
                    alt={linkedProductName ?? 'Linked product'}
                    onError={() => setSourceImgError(true)}
                    style={{ width: 108, height: 128, objectFit: 'contain', borderRadius: 'var(--radius-sm)', background: 'white', border: '1px solid var(--color-border-subtle)' }}
                  />
                ) : (
                  <div style={{ width: 108, height: 128, background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-fg-3)' }}>
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
                    alignSelf: 'start',
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
          ) : null}

          {/* Reference photos — one per angle. Any angle without a photo is
              invented by the model, which is the main source of wrong output. */}
          {colorsWithReferences.length === 0 && (
            <div>
              <label style={labelStyle}>
                Garment Reference Photos{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                  (upload the angles you want generated — front is the minimum)
                </span>
              </label>
              <ReferenceImagePicker
                references={references}
                onChange={setReferences}
                disabled={isLoading}
                requestedAngles={viewAngles}
              />
            </div>
          )}

          {/* View angles */}
          <div>
            <label style={labelStyle}>
              {colorsWithReferences.length > 0 ? 'Default View Angles' : 'View Angles'}{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                {colorsWithReferences.length > 0
                  ? '(used as the starting selection for linked colour images)'
                  : '(one image per selected angle — each costs a generation)'}
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

          {colorsWithReferences.length > 0 && (
            <div>
              <label style={labelStyle}>
                Colour Variant Angles{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                  ({plannedGenerationCount} generation{plannedGenerationCount !== 1 ? 's' : ''})
                </span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colorsWithReferences.map(color => {
                  const colorRefs = colorReferences[color] ?? {};
                  const selectedAngles = colorViewAngles[color] ?? viewAngles;
                  const missing = inferredAngles(colorRefs, selectedAngles);
                  const isExpanded = expandedColor === color;
                  const thumbnail = colorRefs.front ?? Object.values(colorRefs).find(Boolean);

                  return (
                    <div
                      key={color}
                      style={{
                        padding: 8,
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)',
                      }}
                    >
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '44px minmax(80px, 1fr) 2fr',
                        gap: 10,
                        alignItems: 'center',
                      }}>
                        {thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbnail}
                            alt={color}
                            style={{ width: 44, height: 52, objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: 'white', border: '1px solid var(--color-border-subtle)' }}
                          />
                        ) : <div />}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-fg-1)' }}>
                            {color}
                          </div>
                          <button
                            type="button"
                            onClick={() => !isLoading && setExpandedColor(isExpanded ? null : color)}
                            disabled={isLoading}
                            style={{
                              marginTop: 2, padding: 0, border: 'none', background: 'none',
                              fontSize: 10, fontWeight: 600, textAlign: 'left',
                              color: missing.length > 0 ? 'var(--color-warning, #b45309)' : 'var(--color-fg-3)',
                              textDecoration: 'underline',
                              cursor: isLoading ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {missing.length > 0
                              ? `${missing.length} angle${missing.length > 1 ? 's' : ''} without a photo`
                              : 'All angles photographed'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {VIEW_ANGLES.map(angle => {
                            const active = selectedAngles.includes(angle.id);
                            const willInfer = active && missing.includes(angle.id);
                            return (
                              <button
                                key={angle.id}
                                type="button"
                                onClick={() => !isLoading && toggleColorAngle(color, angle.id)}
                                disabled={isLoading}
                                title={willInfer ? 'No reference photo — this angle will be invented.' : undefined}
                                style={{
                                  padding: '5px 9px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  border: willInfer
                                    ? '1px dashed var(--color-warning, #b45309)'
                                    : active
                                      ? '1px solid var(--color-accent)'
                                      : '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-sm)',
                                  background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                                  color: willInfer
                                    ? 'var(--color-warning, #b45309)'
                                    : active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                                  cursor: isLoading ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {angle.label}{willInfer ? ' ⚠' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)' }}>
                          <ReferenceImagePicker
                            references={colorRefs}
                            onChange={(next) => updateColorReferences(color, next)}
                            disabled={isLoading}
                            requestedAngles={selectedAngles}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output framing — Instagram crops anything narrower than 4:5 */}
          <div>
            <label style={labelStyle}>
              Image Shape{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                (4:5 fills the most feed space without being cropped)
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ASPECT_RATIOS.map(option => {
                const active = aspectRatio === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => !isLoading && setAspectRatio(option.id)}
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
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generation mode */}
          <div>
            <label style={labelStyle}>Generation Mode</label>
            <div className="grid-2-mobile1" style={{ gap: 8 }}>
              {([
                { id: 'standard', label: 'Standard', help: 'Faster and cheaper for normal posts.' },
                { id: 'high_accuracy', label: 'High accuracy', help: 'Better for exact colour, stripes, hems, slits, and print placement.' },
              ] as Array<{ id: CreativeGenerationQuality; label: string; help: string }>).map(option => {
                const active = generationQuality === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => !isLoading && setGenerationQuality(option.id)}
                    disabled={isLoading}
                    style={{
                      padding: '9px 10px',
                      border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                      color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800 }}>{option.label}</div>
                    <div style={{ fontSize: 10, lineHeight: 1.4, color: active ? 'var(--color-accent)' : 'var(--color-fg-3)', marginTop: 2 }}>
                      {option.help}
                    </div>
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
              <div className="grid-4-mobile2" style={{ gap: 8 }}>
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

          {/* Fit measurements */}
          <div>
            <label style={labelStyle}>
              Garment Fit / Length{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>
                (optional — exact dress height, target length, sleeve length)
              </span>
            </label>
            <input
              className="app-input"
              placeholder={`e.g. dress length 92cm; on a 5'6" model it ends just above the knee; no side slit`}
              value={garmentFitNotes}
              onChange={(e) => setGarmentFitNotes(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {/* Generate button */}
          <div>
            {missingAngles.length > 0 && (
              <div style={{
                marginBottom: 8, padding: '7px 9px', fontSize: 11, lineHeight: 1.5,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-subtle, rgba(180,83,9,0.08))',
                color: 'var(--color-warning, #b45309)',
              }}>
                No reference photo for{' '}
                <span style={{ textTransform: 'capitalize' }}>{missingAngles.join(', ')}</span>
                {' '}— those views will be invented. Upload the matching photos above for an exact match.
              </div>
            )}
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
                gridTemplateColumns: drafts.length === 1 && previewReferenceUrl.trim() && !sourceImgError ? 'repeat(2, 1fr)' : drafts.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                gap: 10,
              }}>
                {previewReferenceUrl.trim() && !sourceImgError && (
                  <div style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewReferenceUrl}
                      alt="Source product reference"
                      style={{ display: 'block', width: '100%', height: 320, objectFit: 'contain', background: 'white' }}
                    />
                    <div style={{
                      padding: '6px 10px',
                      fontSize: 11, fontWeight: 600,
                      color: 'var(--color-fg-2)',
                      borderTop: '1px solid var(--color-border-subtle)',
                    }}>
                      Source product
                    </div>
                  </div>
                )}
                {drafts.map(d => (
                  <div key={d.creativeId} style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                  }}>
                    <div style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.imageData}
                        alt={`Generated ${d.viewAngle ?? 'creative'}`}
                        style={{ display: 'block', width: '100%', maxHeight: 320, objectFit: 'contain' }}
                      />
                      <button
                        type="button"
                        aria-label="View larger"
                        title="View larger"
                        onClick={(e) => { e.stopPropagation(); setZoomed({ src: d.imageData, caption: `${d.sourceColor ? `${d.sourceColor} · ` : ''}${d.viewAngle ?? 'front'}` }); }}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: 6, padding: 0,
                          border: 'none', background: 'rgba(0,0,0,0.55)', color: 'white', cursor: 'zoom-in',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                          <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                      </button>
                    </div>
                    <div style={{
                      padding: '6px 10px',
                      fontSize: 11, fontWeight: 600,
                      color: 'var(--color-fg-2)',
                      borderTop: '1px solid var(--color-border-subtle)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ textTransform: 'capitalize' }}>
                        {d.sourceColor ? `${d.sourceColor} · ` : ''}{d.viewAngle ?? 'front'}
                        {d.grounded === false && (
                          <span
                            title="No reference photo for this angle — check it against the real garment."
                            style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: 'var(--color-warning, #b45309)' }}
                          >
                            ⚠ guessed
                          </span>
                        )}
                      </span>
                      {d.saved && (
                        <span style={{ color: 'var(--color-accent)', fontSize: 10 }}>✓ Saved</span>
                      )}
                    </div>
                    {!d.saved && (
                      <div style={{
                        padding: 10,
                        borderTop: '1px solid var(--color-border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}>
                        {(d.corrections?.length ?? 0) > 0 && (
                          <div style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--color-fg-3)' }}>
                            <strong style={{ color: 'var(--color-fg-2)' }}>Applied so far:</strong>
                            <ol style={{ margin: '3px 0 0', paddingLeft: 16 }}>
                              {d.corrections!.map((note, index) => <li key={index}>{note}</li>)}
                            </ol>
                          </div>
                        )}
                        <textarea
                          className="app-textarea"
                          placeholder="Correction, e.g. make sleeves shorter like source image"
                          value={correctionTextById[d.creativeId] ?? ''}
                          onChange={(e) => handleCorrectionTextChange(d.creativeId, e.target.value)}
                          disabled={isLoading}
                          rows={2}
                          style={{ resize: 'none', minHeight: 58, fontSize: 12 }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRegenerateDraft(d.creativeId)}
                          disabled={isLoading || !(correctionTextById[d.creativeId]?.trim())}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '7px 12px',
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--color-fg-2)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: isLoading || !(correctionTextById[d.creativeId]?.trim()) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {Ic.refresh}
                          {regeneratingDraftId === d.creativeId ? 'Regenerating…' : 'Regenerate this'}
                        </button>
                      </div>
                    )}
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

      {zoomed && (
        <ImageLightbox
          src={zoomed.src}
          alt={zoomed.caption}
          caption={zoomed.caption}
          onClose={() => setZoomed(null)}
        />
      )}
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
