'use client';

import React, { useRef, useState, useTransition } from 'react';
import { createProduct, updateProduct, uploadProductImage } from './actions';
import type { VariantInput, ProductFormInput } from './actions';
import { resizeImageFile } from '@/lib/image-resize';

// ── Static option lists ──────────────────────────────────────────────────────

// Values are stored as-is in the DB. The size-chart system uses substring
// matching on these values (e.g. includes('top'), includes('dress')), so
// keep the keywords in the slug.
const STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'oversized_top', label: 'Oversized Top' },
  { value: 'crop_top', label: 'Crop Top' },
  { value: 'evening_top', label: 'Evening Top' },
  { value: 'office_shirt', label: 'Office Shirt' },
  { value: 'blouse', label: 'Blouse' },
  { value: 'tank_top', label: 'Tank Top' },
  { value: 'summer_dress', label: 'Summer Dress' },
  { value: 'cocktail_dress', label: 'Cocktail Dress' },
  { value: 'evening_gown', label: 'Evening Gown' },
  { value: 'work_dress', label: 'Work Dress' },
  { value: 'maxi_dress', label: 'Maxi Dress' },
  { value: 'midi_skirt', label: 'Midi Skirt' },
  { value: 'a_line_skirt', label: 'A-Line Skirt' },
  { value: 'mermaid_skirt', label: 'Mermaid Skirt' },
  { value: 'mini_skirt', label: 'Mini Skirt' },
  { value: 'linen_pants', label: 'Linen Pants' },
  { value: 'tailored_pants', label: 'Tailored Pants' },
  { value: 'palazzo_pants', label: 'Palazzo Pants' },
  { value: 'wide_leg_pants', label: 'Wide Leg Pants' },
  { value: 'jumpsuit', label: 'Jumpsuit' },
  { value: 'cardigan', label: 'Cardigan' },
  { value: 'bomber_jacket', label: 'Bomber Jacket' },
];

const FABRIC_OPTIONS = [
  'Cotton',
  'Ribbed Cotton',
  'Linen',
  'Linen Blend',
  'Silk',
  'Satin',
  'Satin Blend',
  'Rayon',
  'Crepe',
  'Soft Crepe',
  'Ponte',
  'Structured Knit',
  'Suiting',
  'Twill',
  'Chiffon',
  'Velvet',
  'Jersey',
  'Denim',
  'Organza',
  'Lace',
];

const PRODUCT_STATUSES = ['active', 'low-stock', 'critical', 'out-of-stock'];
const VARIANT_STATUSES = ['auto', 'active', 'out-of-stock'];
const SLEEVE_TYPE_OPTIONS = ['', 'Sleeveless', 'Cap sleeve', 'Short sleeve', 'Mid-upper-arm sleeve', 'Elbow sleeve', 'Three-quarter sleeve', 'Long sleeve'];
const FIT_TYPE_OPTIONS = ['', 'Relaxed fit', 'Regular fit', 'Slim fit', 'Bodycon fit', 'Oversized fit', 'A-line fit', 'Straight fit'];
const WORN_LENGTH_OPTIONS = ['', 'Cropped', 'Hip length', 'Tunic length', 'Mini length', 'Above knee', 'Knee length', 'Midi length', 'Maxi length'];
const PRESET_SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free Size'];

// ── Types ────────────────────────────────────────────────────────────────────

interface VariantRow extends VariantInput {
  _key: string;
}

interface ExistingVariant {
  id: number;
  size: string;
  color: string;
  sku?: string | null;
  priceOverride?: number | null;
  status: string;
  inventory?: { availableQty: number; reorderThreshold?: number | null; criticalThreshold?: number | null } | null;
}

interface ProductForEdit {
  id: number;
  name: string;
  brand: string;
  style: string;
  fabric?: string | null;
  price: number;
  status: string;
  imageUrl?: string | null;
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
  variants?: ExistingVariant[];
}

export interface ProductFormModalProps {
  product?: ProductForEdit | null;
  availableBrands: string[];
  onClose: () => void;
  onSuccess: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let _keySeq = 0;
const nextKey = () => `vr_${++_keySeq}`;

function emptyRow(): VariantRow {
  return { _key: nextKey(), size: '', color: '', availableQty: 0, reorderThreshold: null, criticalThreshold: null, sku: '', priceOverride: null, status: '' };
}

function variantKey(size: string, color: string): string {
  return `${size.trim().toLowerCase()}::${color.trim().toLowerCase()}`;
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = PRESET_SIZE_OPTIONS.findIndex((size) => size.toLowerCase() === a.toLowerCase());
    const bi = PRESET_SIZE_OPTIONS.findIndex((size) => size.toLowerCase() === b.toLowerCase());
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function rowsFromProduct(product: ProductForEdit): VariantRow[] {
  if (product.variants && product.variants.length > 0) {
    return product.variants.map((v) => ({
      _key: nextKey(),
      id: v.id,
      size: v.size,
      color: v.color,
      availableQty: v.inventory?.availableQty ?? 0,
      reorderThreshold: v.inventory?.reorderThreshold ?? null,
      criticalThreshold: v.inventory?.criticalThreshold ?? null,
      sku: v.sku ?? '',
      priceOverride: v.priceOverride ?? null,
      status: v.status,
    }));
  }
  return [emptyRow()];
}

// ── Styles ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-ui)',
  fontSize: 13,
  background: 'var(--color-bg)',
  color: 'var(--color-fg-1)',
  outline: 'none',
  boxSizing: 'border-box',
};

const inpSm: React.CSSProperties = { ...inp, fontSize: 12, padding: '6px 8px' };

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
  marginBottom: 5,
};

// ── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  brand: string;
  style: string;
  fabric: string;
  price: string;
  status: string;
  imageUrl: string;
  garmentLengthCm: string;
  sleeveLengthCm: string;
  sleeveType: string;
  fitType: string;
  neckline: string;
  closureDetails: string;
  hasSideSlit: boolean;
  sideSlitHeightCm: string;
  hemDetails: string;
  sleeveHemDetails: string;
  patternDetails: string;
  referenceModelHeightCm: string;
  wornLengthNote: string;
  aiFidelityNotes: string;
  variants: VariantRow[];
  error: string | null;
}

function numberToInput(value?: number | null): string {
  return value != null ? String(value) : '';
}

function optionalNumberFromInput(value: string): number | null {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildInitialState(product?: ProductForEdit | null): FormState {
  return {
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    style: product?.style ?? '',
    fabric: product?.fabric ?? '',
    price: product?.price != null ? String(product.price) : '',
    status: product?.status ?? 'active',
    imageUrl: product?.imageUrl ?? '',
    garmentLengthCm: numberToInput(product?.garmentLengthCm),
    sleeveLengthCm: numberToInput(product?.sleeveLengthCm),
    sleeveType: product?.sleeveType ?? '',
    fitType: product?.fitType ?? '',
    neckline: product?.neckline ?? '',
    closureDetails: product?.closureDetails ?? '',
    hasSideSlit: Boolean(product?.hasSideSlit),
    sideSlitHeightCm: numberToInput(product?.sideSlitHeightCm),
    hemDetails: product?.hemDetails ?? '',
    sleeveHemDetails: product?.sleeveHemDetails ?? '',
    patternDetails: product?.patternDetails ?? '',
    referenceModelHeightCm: numberToInput(product?.referenceModelHeightCm),
    wornLengthNote: product?.wornLengthNote ?? '',
    aiFidelityNotes: product?.aiFidelityNotes ?? '',
    variants: product ? rowsFromProduct(product) : [],
    error: null,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProductFormModal({ product, availableBrands, onClose, onSuccess }: ProductFormModalProps) {
  const isEdit = !!product;
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => buildInitialState(product));
  const [imgError, setImgError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(() =>
    sortSizes(uniqueValues(product?.variants?.map((variant) => variant.size) ?? [])),
  );
  const [selectedColors, setSelectedColors] = useState<string[]>(() =>
    uniqueValues(product?.variants?.map((variant) => variant.color) ?? []),
  );
  const [sizeDraft, setSizeDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    setImgError(false);
    setIsUploading(true);
    try {
      const resized = await resizeImageFile(file, { maxEdge: 2048, quality: 0.85 });
      const formData = new FormData();
      formData.append('file', resized);
      const res = await uploadProductImage(formData);
      if (res.success && res.url) {
        set('imageUrl', res.url);
      } else {
        setUploadError(res.error ?? 'Upload failed.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  // brand/fabric "Other" modes — initialise from product data at mount time
  const [brandIsCustom, setBrandIsCustom] = useState(
    () => !!product?.brand && !availableBrands.includes(product.brand),
  );
  const [fabricIsCustom, setFabricIsCustom] = useState(
    () => !!product?.fabric && !FABRIC_OPTIONS.includes(product.fabric),
  );

  const {
    name, brand, style, fabric, price, status, imageUrl,
    garmentLengthCm, sleeveLengthCm, sleeveType, fitType, neckline,
    closureDetails, hasSideSlit, sideSlitHeightCm, hemDetails,
    sleeveHemDetails, patternDetails, referenceModelHeightCm,
    wornLengthNote, aiFidelityNotes, variants, error,
  } = form;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ── Variant helpers ──

  function patchVariant<K extends keyof VariantRow>(key: string, field: K, value: VariantRow[K]) {
    set('variants', variants.map((v) => (v._key === key ? { ...v, [field]: value } : v)));
  }

  function syncVariantGrid(nextSizes: string[], nextColors: string[]) {
    const cleanSizes = sortSizes(uniqueValues(nextSizes));
    const cleanColors = uniqueValues(nextColors);
    const existingByKey = new Map(
      variants
        .filter((variant) => variant.size.trim() && variant.color.trim())
        .map((variant) => [variantKey(variant.size, variant.color), variant]),
    );
    const nextVariants =
      cleanSizes.length > 0 && cleanColors.length > 0
        ? cleanSizes.flatMap((size) =>
            cleanColors.map((color) => {
              const existing = existingByKey.get(variantKey(size, color));
              return existing
                ? { ...existing, size, color }
                : { ...emptyRow(), size, color };
            }),
          )
        : [];

    setSelectedSizes(cleanSizes);
    setSelectedColors(cleanColors);
    set('variants', nextVariants);
  }

  function toggleSize(size: string) {
    const exists = selectedSizes.some((selected) => selected.toLowerCase() === size.toLowerCase());
    const nextSizes = exists
      ? selectedSizes.filter((selected) => selected.toLowerCase() !== size.toLowerCase())
      : [...selectedSizes, size];
    syncVariantGrid(nextSizes, selectedColors);
  }

  function addSizesFromText(value: string) {
    const nextSizes = uniqueValues([
      ...selectedSizes,
      ...value.split(/[,;\n]/).map((part) => part.trim()),
    ]);
    syncVariantGrid(nextSizes, selectedColors);
  }

  function removeSize(size: string) {
    syncVariantGrid(
      selectedSizes.filter((selected) => selected.toLowerCase() !== size.toLowerCase()),
      selectedColors,
    );
  }

  function addColorsFromText(value: string) {
    const nextColors = uniqueValues([
      ...selectedColors,
      ...value.split(/[,;\n]/).map((part) => part.trim()),
    ]);
    syncVariantGrid(selectedSizes, nextColors);
  }

  function removeColor(color: string) {
    syncVariantGrid(
      selectedSizes,
      selectedColors.filter((selected) => selected.toLowerCase() !== color.toLowerCase()),
    );
  }

  function findVariant(size: string, color: string): VariantRow | undefined {
    return variants.find((variant) => variantKey(variant.size, variant.color) === variantKey(size, color));
  }

  // ── Submit ──

  function handleSubmit() {
    set('error', null);
    if (!name.trim()) { set('error', 'Product name is required.'); return; }
    if (!brand.trim()) { set('error', 'Brand is required.'); return; }
    if (!style.trim()) { set('error', 'Style is required.'); return; }
    const priceVal = parseFloat(price);
    if (isNaN(priceVal) || priceVal <= 0) { set('error', 'A valid price greater than 0 is required.'); return; }
    if (selectedSizes.length === 0) { set('error', 'Select at least one size.'); return; }
    if (selectedColors.length === 0) { set('error', 'Add at least one colour.'); return; }
    if (variants.length === 0) { set('error', 'At least one variant is required.'); return; }
    for (const v of variants) {
      if (!v.size.trim() || !v.color.trim()) {
        set('error', 'All variants must have a size and colour.');
        return;
      }
    }

    const input: ProductFormInput = {
      name: name.trim(),
      brand: brand.trim(),
      style: style.trim(),
      fabric: fabric.trim() || undefined,
      price: priceVal,
      status,
      imageUrl: imageUrl.trim() || null,
      garmentLengthCm: optionalNumberFromInput(garmentLengthCm),
      sleeveLengthCm: optionalNumberFromInput(sleeveLengthCm),
      sleeveType: sleeveType.trim() || null,
      fitType: fitType.trim() || null,
      neckline: neckline.trim() || null,
      closureDetails: closureDetails.trim() || null,
      hasSideSlit,
      sideSlitHeightCm: hasSideSlit ? optionalNumberFromInput(sideSlitHeightCm) : null,
      hemDetails: hemDetails.trim() || null,
      sleeveHemDetails: sleeveHemDetails.trim() || null,
      patternDetails: patternDetails.trim() || null,
      referenceModelHeightCm: optionalNumberFromInput(referenceModelHeightCm),
      wornLengthNote: wornLengthNote.trim() || null,
      aiFidelityNotes: aiFidelityNotes.trim() || null,
      variants: variants.map((v) => ({
        id: v.id,
        size: v.size.trim(),
        color: v.color.trim(),
        availableQty: Math.max(0, Number(v.availableQty) || 0),
        reorderThreshold: v.reorderThreshold != null && Number(v.reorderThreshold) > 0 ? Number(v.reorderThreshold) : null,
        criticalThreshold: v.criticalThreshold != null && Number(v.criticalThreshold) > 0 ? Number(v.criticalThreshold) : null,
        sku: v.sku?.trim() || undefined,
        priceOverride: v.priceOverride != null && Number(v.priceOverride) > 0 ? Number(v.priceOverride) : null,
        status: v.status && v.status !== 'auto' ? v.status : undefined,
      })),
    };

    startTransition(async () => {
      const result = isEdit && product
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (result.success) {
        onSuccess();
      } else {
        set('error', result.error ?? 'An unknown error occurred.');
      }
    });
  }

  const totalStock = variants.reduce((s, v) => s + Math.max(0, Number(v.availableQty) || 0), 0);

  // ── Render ──

  return (
    <>
      {/* Overlay */}
      <div aria-hidden="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(24,22,15,0.32)', zIndex: 400 }} />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit Product' : 'Add Product'}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 401,
          width: 'min(760px, calc(100vw - 32px))',
          maxHeight: '92vh',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              {isEdit ? 'Edit Product' : 'Add Product'}
            </div>
            {isEdit && product && (
              <code style={{ fontSize: 11, color: 'var(--color-fg-3)', fontFamily: 'var(--font-mono)' }}>
                SKU-{product.id.toString().padStart(4, '0')}
              </code>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-2)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── Product Info ── */}
          <section>
            <div className="drawer-section-label">Product Info</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Name */}
              <div>
                <label style={lbl}>Product Name *</label>
                <input style={inp} value={name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Oversized Casual Top" disabled={isPending} />
              </div>

              {/* Brand + Style */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Brand *</label>
                  {brandIsCustom ? (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input style={{ ...inp, flex: 1 }} value={brand} onChange={(e) => set('brand', e.target.value)} placeholder="Brand name" disabled={isPending} autoFocus />
                      <button
                        type="button"
                        style={{ ...inp, width: 'auto', padding: '7px 9px', cursor: 'pointer', flexShrink: 0, color: 'var(--color-fg-3)', fontSize: 11 }}
                        onClick={() => { setBrandIsCustom(false); set('brand', ''); }}
                        disabled={isPending}
                        title="Pick from list"
                      >
                        ↩
                      </button>
                    </div>
                  ) : (
                    <select
                      style={{ ...inp, cursor: 'pointer' }}
                      value={brand}
                      onChange={(e) => {
                        if (e.target.value === '__other__') { setBrandIsCustom(true); set('brand', ''); }
                        else { set('brand', e.target.value); }
                      }}
                      disabled={isPending}
                    >
                      <option value="">Select brand…</option>
                      {availableBrands.map((b) => <option key={b} value={b}>{b}</option>)}
                      <option value="__other__">Other…</option>
                    </select>
                  )}
                </div>

                <div>
                  <label style={lbl}>Style *</label>
                  <select style={{ ...inp, cursor: 'pointer' }} value={style} onChange={(e) => set('style', e.target.value)} disabled={isPending}>
                    <option value="">Select style…</option>
                    {STYLE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Fabric + Price */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Fabric</label>
                  {fabricIsCustom ? (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <input style={{ ...inp, flex: 1 }} value={fabric} onChange={(e) => set('fabric', e.target.value)} placeholder="Fabric type" disabled={isPending} autoFocus />
                      <button
                        type="button"
                        style={{ ...inp, width: 'auto', padding: '7px 9px', cursor: 'pointer', flexShrink: 0, color: 'var(--color-fg-3)', fontSize: 11 }}
                        onClick={() => { setFabricIsCustom(false); set('fabric', ''); }}
                        disabled={isPending}
                        title="Pick from list"
                      >
                        ↩
                      </button>
                    </div>
                  ) : (
                    <select
                      style={{ ...inp, cursor: 'pointer' }}
                      value={fabric}
                      onChange={(e) => {
                        if (e.target.value === '__other__') { setFabricIsCustom(true); set('fabric', ''); }
                        else { set('fabric', e.target.value); }
                      }}
                      disabled={isPending}
                    >
                      <option value="">None / not specified</option>
                      {FABRIC_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                      <option value="__other__">Other…</option>
                    </select>
                  )}
                </div>

                <div>
                  <label style={lbl}>Base Price *</label>
                  <input style={inp} type="number" min="0" step="0.01" value={price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" disabled={isPending} />
                </div>
              </div>

              {/* Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Status</label>
                  <select style={{ ...inp, cursor: 'pointer' }} value={status} onChange={(e) => set('status', e.target.value)} disabled={isPending}>
                    {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* ── Garment Specs ── */}
          <section>
            <div className="drawer-section-label">Garment Fit & AI Fidelity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <div>
                  <label style={lbl}>Length (cm)</label>
                  <input style={inp} type="number" min="0" step="0.1" value={garmentLengthCm} onChange={(e) => set('garmentLengthCm', e.target.value)} placeholder="e.g. 92" disabled={isPending} />
                </div>
                <div>
                  <label style={lbl}>Sleeve Length (cm)</label>
                  <input style={inp} type="number" min="0" step="0.1" value={sleeveLengthCm} onChange={(e) => set('sleeveLengthCm', e.target.value)} placeholder="e.g. 22" disabled={isPending} />
                </div>
                <div>
                  <label style={lbl}>Reference Model Height</label>
                  <input style={inp} type="number" min="0" step="0.1" value={referenceModelHeightCm} onChange={(e) => set('referenceModelHeightCm', e.target.value)} placeholder="e.g. 168" disabled={isPending} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <div>
                  <label style={lbl}>Sleeve Type</label>
                  <select style={{ ...inp, cursor: 'pointer' }} value={sleeveType} onChange={(e) => set('sleeveType', e.target.value)} disabled={isPending}>
                    {SLEEVE_TYPE_OPTIONS.map((option) => <option key={option || 'blank'} value={option}>{option || 'Not specified'}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Fit</label>
                  <select style={{ ...inp, cursor: 'pointer' }} value={fitType} onChange={(e) => set('fitType', e.target.value)} disabled={isPending}>
                    {FIT_TYPE_OPTIONS.map((option) => <option key={option || 'blank'} value={option}>{option || 'Not specified'}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Worn Length</label>
                  <select style={{ ...inp, cursor: 'pointer' }} value={wornLengthNote} onChange={(e) => set('wornLengthNote', e.target.value)} disabled={isPending}>
                    {WORN_LENGTH_OPTIONS.map((option) => <option key={option || 'blank'} value={option}>{option || 'Not specified'}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div>
                  <label style={lbl}>Neckline</label>
                  <input style={inp} value={neckline} onChange={(e) => set('neckline', e.target.value)} placeholder="e.g. round neck, scoop neck, collar" disabled={isPending} />
                </div>
                <div>
                  <label style={lbl}>Closure / Details</label>
                  <input style={inp} value={closureDetails} onChange={(e) => set('closureDetails', e.target.value)} placeholder="e.g. no buttons, front placket, back zip" disabled={isPending} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: hasSideSlit ? 'repeat(auto-fit, minmax(180px, 1fr))' : '1fr', gap: 12, alignItems: 'end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-fg-2)', minHeight: 32 }}>
                  <input
                    type="checkbox"
                    checked={hasSideSlit}
                    onChange={(e) => set('hasSideSlit', e.target.checked)}
                    disabled={isPending}
                  />
                  Has side slit
                </label>
                {hasSideSlit && (
                  <div>
                    <label style={lbl}>Side Slit Height (cm)</label>
                    <input style={inp} type="number" min="0" step="0.1" value={sideSlitHeightCm} onChange={(e) => set('sideSlitHeightCm', e.target.value)} placeholder="e.g. 18" disabled={isPending} />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div>
                  <label style={lbl}>Bottom Hem</label>
                  <input style={inp} value={hemDetails} onChange={(e) => set('hemDetails', e.target.value)} placeholder="e.g. plain red hem, no black border" disabled={isPending} />
                </div>
                <div>
                  <label style={lbl}>Sleeve Hem / Cuff</label>
                  <input style={inp} value={sleeveHemDetails} onChange={(e) => set('sleeveHemDetails', e.target.value)} placeholder="e.g. same stripe fabric, no black cuff" disabled={isPending} />
                </div>
              </div>

              <div>
                <label style={lbl}>Pattern / Print Placement</label>
                <textarea
                  style={{ ...inp, minHeight: 58, resize: 'vertical' }}
                  value={patternDetails}
                  onChange={(e) => set('patternDetails', e.target.value)}
                  placeholder="e.g. horizontal red/white stripes continue around the body; floral print stays on left-front panel"
                  disabled={isPending}
                />
              </div>

              <div>
                <label style={lbl}>AI Fidelity Notes</label>
                <textarea
                  style={{ ...inp, minHeight: 58, resize: 'vertical' }}
                  value={aiFidelityNotes}
                  onChange={(e) => set('aiFidelityNotes', e.target.value)}
                  placeholder="e.g. no side slit, no black sleeve cuff, no black bottom band, no extra back seam lines"
                  disabled={isPending}
                />
              </div>
            </div>
          </section>

          {/* ── Product Image ── */}
          <section>
            <div className="drawer-section-label">Product Image</div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              {/* Preview */}
              <div style={{ width: 72, height: 86, borderRadius: 7, overflow: 'hidden', flexShrink: 0, background: '#F2EFE9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {imageUrl && !imgError ? (
                  <img
                    src={imageUrl}
                    alt="Preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <svg viewBox="0 0 72 86" width="72" height="86">
                    <rect width="72" height="86" fill="#F2EFE9" />
                    {[-10, 5, 20, 35, 50, 65, 80].map((x, i) => <line key={i} x1={x} y1="0" x2={x + 86} y2="86" stroke="#E5E0D8" strokeWidth="7" />)}
                    <path d="M24 16L17 24L7 21L11 40L19 40L19 69L53 69L53 40L61 40L65 21L55 24L48 16Q36 25 24 16Z" fill="none" stroke="#C4BDB4" strokeWidth="2" />
                  </svg>
                )}
              </div>
              {/* Upload + URL */}
              <div style={{ flex: 1 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFilePick}
                  disabled={isPending || isUploading}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '5px 12px', height: 28 }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending || isUploading}
                  >
                    {isUploading ? 'Uploading…' : (imageUrl ? 'Replace image' : 'Upload image')}
                  </button>
                  {imageUrl && !isUploading && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '5px 12px', height: 28 }}
                      onClick={() => { set('imageUrl', ''); setImgError(false); }}
                      disabled={isPending}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <label style={lbl}>Image URL</label>
                <input
                  style={inp}
                  value={imageUrl}
                  onChange={(e) => { set('imageUrl', e.target.value); setImgError(false); }}
                  placeholder="Upload above, or paste a direct link"
                  disabled={isPending || isUploading}
                />
                <div style={{ fontSize: 10, color: 'var(--color-fg-3)', marginTop: 5, lineHeight: 1.4 }}>
                  Photos are resized to 2048 px before upload (no quality loss for AI generation).
                </div>
                {uploadError && (
                  <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 5 }}>
                    {uploadError}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Variants ── */}
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div className="drawer-section-label" style={{ marginBottom: 0 }}>Size / Colour Variants</div>
              <div style={{ fontSize: 11, color: 'var(--color-fg-3)' }}>
                {variants.length} variant{variants.length !== 1 ? 's' : ''} · {totalStock} units
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Available Sizes</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PRESET_SIZE_OPTIONS.map((size) => {
                    const active = selectedSizes.some((selected) => selected.toLowerCase() === size.toLowerCase());
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => toggleSize(size)}
                        disabled={isPending}
                        style={{
                          minWidth: 40,
                          height: 30,
                          padding: '0 10px',
                          borderRadius: 999,
                          border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                          background: active ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
                          color: active ? 'var(--color-accent)' : 'var(--color-fg-2)',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: isPending ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  <input
                    style={{ ...inp, flex: '1 1 160px' }}
                    value={sizeDraft}
                    onChange={(e) => setSizeDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSizesFromText(sizeDraft);
                        setSizeDraft('');
                      }
                    }}
                    placeholder="Custom size"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: 32, padding: '6px 12px', fontSize: 11 }}
                    onClick={() => { addSizesFromText(sizeDraft); setSizeDraft(''); }}
                    disabled={isPending || !sizeDraft.trim()}
                  >
                    Add Size
                  </button>
                </div>
                {selectedSizes.some((size) => !PRESET_SIZE_OPTIONS.some((preset) => preset.toLowerCase() === size.toLowerCase())) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {selectedSizes
                      .filter((size) => !PRESET_SIZE_OPTIONS.some((preset) => preset.toLowerCase() === size.toLowerCase()))
                      .map((size) => (
                        <span key={size} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--color-border)', borderRadius: 999, background: 'var(--color-bg)', padding: '4px 8px 4px 10px', fontSize: 12, color: 'var(--color-fg-2)' }}>
                          {size}
                          <button
                            type="button"
                            onClick={() => removeSize(size)}
                            disabled={isPending}
                            aria-label={`Remove ${size}`}
                            style={{ border: 0, background: 'transparent', color: 'var(--color-fg-3)', cursor: isPending ? 'not-allowed' : 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </div>

              <div>
                <label style={lbl}>Colours</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    style={{ ...inp, flex: '1 1 190px' }}
                    value={colorDraft}
                    onChange={(e) => setColorDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addColorsFromText(colorDraft);
                        setColorDraft('');
                      }
                    }}
                    placeholder="Type colour and press Enter"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: 32, padding: '6px 12px', fontSize: 11 }}
                    onClick={() => { addColorsFromText(colorDraft); setColorDraft(''); }}
                    disabled={isPending || !colorDraft.trim()}
                  >
                    Add Colour
                  </button>
                </div>
                {selectedColors.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {selectedColors.map((color) => (
                      <span key={color} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--color-border)', borderRadius: 999, background: 'var(--color-bg)', padding: '4px 8px 4px 10px', fontSize: 12, color: 'var(--color-fg-2)' }}>
                        {color}
                        <button
                          type="button"
                          onClick={() => removeColor(color)}
                          disabled={isPending}
                          aria-label={`Remove ${color}`}
                          style={{ border: 0, background: 'transparent', color: 'var(--color-fg-3)', cursor: isPending ? 'not-allowed' : 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {selectedSizes.length > 0 && selectedColors.length > 0 ? (
                <div>
                  <label style={lbl}>Quantity Matrix</label>
                  <div style={{ overflowX: 'auto', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <table style={{ width: '100%', minWidth: Math.max(360, 92 + selectedColors.length * 86), borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-fg-3)', fontWeight: 700 }}>Size</th>
                          {selectedColors.map((color) => (
                            <th key={color} style={{ textAlign: 'right', padding: '8px 8px', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-fg-3)', fontWeight: 700 }}>{color}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSizes.map((size) => (
                          <tr key={size}>
                            <td style={{ padding: '7px 10px', borderTop: '1px solid var(--color-border-subtle)', fontWeight: 700 }}>{size}</td>
                            {selectedColors.map((color) => {
                              const variant = findVariant(size, color);
                              return (
                                <td key={`${size}-${color}`} style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border-subtle)' }}>
                                  <input
                                    style={{ ...inpSm, textAlign: 'right', width: 70, marginLeft: 'auto' }}
                                    type="number"
                                    min="0"
                                    value={variant?.availableQty ?? 0}
                                    onChange={(e) => variant && patchVariant(variant._key, 'availableQty', parseInt(e.target.value) || 0)}
                                    disabled={isPending || !variant}
                                    aria-label={`${size} ${color} quantity`}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', color: 'var(--color-fg-3)', fontSize: 12, lineHeight: 1.45 }}>
                  Select sizes and add colours to generate the quantity grid.
                </div>
              )}

              {variants.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--color-fg-2)' }}>Advanced variant settings</summary>
                  <div style={{ marginTop: 10, overflowX: 'auto' }}>
                    <div style={{ minWidth: 690 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '70px 110px 64px 78px 78px 100px 100px 88px', gap: 5, marginBottom: 5, paddingLeft: 1 }}>
                        {['Size', 'Colour', 'Qty', 'Reorder', 'Critical', 'SKU', 'Override', 'Status'].map((h) => (
                          <div key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)' }}>{h}</div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {variants.map((v) => (
                          <div key={v._key} style={{ display: 'grid', gridTemplateColumns: '70px 110px 64px 78px 78px 100px 100px 88px', gap: 5, alignItems: 'center' }}>
                            <input style={inpSm} value={v.size} disabled aria-label="Size" />
                            <input style={inpSm} value={v.color} disabled aria-label="Colour" />
                            <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" value={v.availableQty} onChange={(e) => patchVariant(v._key, 'availableQty', parseInt(e.target.value) || 0)} disabled={isPending} aria-label="Qty" />
                            <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" value={v.reorderThreshold ?? ''} onChange={(e) => patchVariant(v._key, 'reorderThreshold', e.target.value ? parseInt(e.target.value) : null)} placeholder="—" disabled={isPending} aria-label="Reorder threshold" title="Reorder threshold: alert when stock falls to this level" />
                            <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" value={v.criticalThreshold ?? ''} onChange={(e) => patchVariant(v._key, 'criticalThreshold', e.target.value ? parseInt(e.target.value) : null)} placeholder="—" disabled={isPending} aria-label="Critical threshold" title="Critical threshold: urgent alert when stock falls to this level" />
                            <input style={inpSm} value={v.sku ?? ''} onChange={(e) => patchVariant(v._key, 'sku', e.target.value)} placeholder="optional" disabled={isPending} aria-label="SKU" />
                            <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" step="0.01" value={v.priceOverride ?? ''} onChange={(e) => patchVariant(v._key, 'priceOverride', e.target.value ? parseFloat(e.target.value) : null)} placeholder="—" disabled={isPending} aria-label="Override" />
                            <select style={{ ...inpSm, cursor: 'pointer' }} value={v.status && v.status !== '' ? v.status : 'auto'} onChange={(e) => patchVariant(v._key, 'status', e.target.value === 'auto' ? '' : e.target.value)} disabled={isPending} aria-label="Status">
                              {VARIANT_STATUSES.map((s) => <option key={s} value={s}>{s === 'auto' ? 'auto' : s.replace('-', ' ')}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              )}
            </div>
          </section>

          {error && <div className="drawer-error" role="alert">{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Product')}
          </button>
        </div>
      </div>
    </>
  );
}
