'use client';

import React, { useState, useTransition } from 'react';
import { createProduct, updateProduct } from './actions';
import type { VariantInput, ProductFormInput } from './actions';

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
  variants: VariantRow[];
  error: string | null;
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
    variants: product ? rowsFromProduct(product) : [emptyRow()],
    error: null,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProductFormModal({ product, availableBrands, onClose, onSuccess }: ProductFormModalProps) {
  const isEdit = !!product;
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => buildInitialState(product));
  const [imgError, setImgError] = useState(false);

  // brand/fabric "Other" modes — initialise from product data at mount time
  const [brandIsCustom, setBrandIsCustom] = useState(
    () => !!product?.brand && !availableBrands.includes(product.brand),
  );
  const [fabricIsCustom, setFabricIsCustom] = useState(
    () => !!product?.fabric && !FABRIC_OPTIONS.includes(product.fabric),
  );

  const { name, brand, style, fabric, price, status, imageUrl, variants, error } = form;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ── Variant helpers ──

  function addVariant() { set('variants', [...variants, emptyRow()]); }

  function removeVariant(key: string) {
    if (variants.length > 1) set('variants', variants.filter((v) => v._key !== key));
  }

  function patchVariant<K extends keyof VariantRow>(key: string, field: K, value: VariantRow[K]) {
    set('variants', variants.map((v) => (v._key === key ? { ...v, [field]: value } : v)));
  }

  // ── Submit ──

  function handleSubmit() {
    set('error', null);
    if (!name.trim()) { set('error', 'Product name is required.'); return; }
    if (!brand.trim()) { set('error', 'Brand is required.'); return; }
    if (!style.trim()) { set('error', 'Style is required.'); return; }
    const priceVal = parseFloat(price);
    if (isNaN(priceVal) || priceVal <= 0) { set('error', 'A valid price greater than 0 is required.'); return; }
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
          width: 'min(660px, calc(100vw - 32px))',
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
              {/* URL input */}
              <div style={{ flex: 1 }}>
                <label style={lbl}>Image URL</label>
                <input
                  style={inp}
                  value={imageUrl}
                  onChange={(e) => { set('imageUrl', e.target.value); setImgError(false); }}
                  placeholder="https://example.com/product.jpg"
                  disabled={isPending}
                />
                <div style={{ fontSize: 10, color: 'var(--color-fg-3)', marginTop: 5, lineHeight: 1.4 }}>
                  Paste a direct link to a publicly accessible image. Shown in the product drawer and on chat carousels.
                </div>
              </div>
            </div>
          </section>

          {/* ── Variants ── */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="drawer-section-label" style={{ marginBottom: 0 }}>Size / Colour Variants</div>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', height: 26 }} onClick={addVariant} disabled={isPending}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
                Add Variant
              </button>
            </div>

            {variants.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 52px 60px 76px 76px 88px 28px', gap: 5, marginBottom: 5, paddingLeft: 1 }}>
                {['Size', 'Colour', 'Qty', 'Reorder', 'SKU', 'Override', 'Status', ''].map((h, i) => (
                  <div key={i} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-fg-3)' }}>{h}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {variants.map((v) => (
                <div key={v._key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 52px 60px 76px 76px 88px 28px', gap: 5, alignItems: 'center' }}>
                  <input style={inpSm} value={v.size} onChange={(e) => patchVariant(v._key, 'size', e.target.value)} placeholder="S / M / L" disabled={isPending} aria-label="Size" />
                  <input style={inpSm} value={v.color} onChange={(e) => patchVariant(v._key, 'color', e.target.value)} placeholder="Black / White" disabled={isPending} aria-label="Colour" />
                  <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" value={v.availableQty} onChange={(e) => patchVariant(v._key, 'availableQty', parseInt(e.target.value) || 0)} disabled={isPending} aria-label="Qty" />
                  <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" value={v.reorderThreshold ?? ''} onChange={(e) => patchVariant(v._key, 'reorderThreshold', e.target.value ? parseInt(e.target.value) : null)} placeholder="—" disabled={isPending} aria-label="Reorder threshold" title="Reorder threshold: alert when stock falls to this level" />
                  <input style={inpSm} value={v.sku ?? ''} onChange={(e) => patchVariant(v._key, 'sku', e.target.value)} placeholder="optional" disabled={isPending} aria-label="SKU" />
                  <input style={{ ...inpSm, textAlign: 'right' }} type="number" min="0" step="0.01" value={v.priceOverride ?? ''} onChange={(e) => patchVariant(v._key, 'priceOverride', e.target.value ? parseFloat(e.target.value) : null)} placeholder="—" disabled={isPending} aria-label="Override" />
                  <select
                    style={{ ...inpSm, cursor: 'pointer' }}
                    value={v.status && v.status !== '' ? v.status : 'auto'}
                    onChange={(e) => patchVariant(v._key, 'status', e.target.value === 'auto' ? '' : e.target.value)}
                    disabled={isPending}
                    aria-label="Status"
                  >
                    {VARIANT_STATUSES.map((s) => <option key={s} value={s}>{s === 'auto' ? 'auto' : s.replace('-', ' ')}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeVariant(v._key)}
                    disabled={isPending || variants.length <= 1}
                    aria-label="Remove"
                    style={{ width: 26, height: 26, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: variants.length <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: variants.length <= 1 ? 0.3 : 0.7, flexShrink: 0 }}
                  >
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {variants.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-fg-3)', display: 'flex', gap: 10 }}>
                <span><strong style={{ color: 'var(--color-fg-1)' }}>{variants.length}</strong> variant{variants.length !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>Total stock: <strong style={{ color: 'var(--color-fg-1)' }}>{totalStock}</strong> units</span>
              </div>
            )}
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
