'use client';

import React from 'react';
import { buildGarmentSpecsForCustomer } from '@/lib/product-garment-specs';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  x: ["M18 6L6 18", "M6 6l12 12"],
  edit: ["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7", "M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"],
};

export interface ProductVariantData {
  id: number;
  size: string;
  color: string;
  status: string;
  sku?: string | null;
  priceOverride?: number | null;
  inventory?: {
    availableQty: number;
    reservedQty: number;
    reorderThreshold?: number | null;
    criticalThreshold?: number | null;
  } | null;
}

export interface Product {
  id: number;
  name: string;
  brand: string;
  style: string;
  price: number;
  stock: number;
  status: string;
  sizes: string;
  colors: string;
  fabric?: string | null;
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
  category?: string;
  sku?: string;
  threshold?: number;
  orders?: number;
  variants?: ProductVariantData[];
}

const DEFAULT_CRITICAL_THRESH = 3;
const DEFAULT_REORDER_THRESH = 10;

function variantStockColor(qty: number, critT: number, reordT: number): string {
  if (qty === 0) return 'var(--color-fg-3)';
  if (qty <= critT) return '#8B2020';
  if (qty <= reordT) return '#9B6B00';
  return '#1E6B45';
}

function VariantStockGrid({ variants }: { variants: ProductVariantData[] }) {
  if (variants.length === 0) return null;

  const sizes = [...new Set(variants.map(v => v.size))];
  const colors = [...new Set(variants.map(v => v.color))];

  // Aggregate planning signals across all variants
  let criticalCount = 0, lowCount = 0, outCount = 0;
  for (const v of variants) {
    const qty = v.inventory?.availableQty ?? 0;
    const critT = v.inventory?.criticalThreshold ?? DEFAULT_CRITICAL_THRESH;
    const reordT = v.inventory?.reorderThreshold ?? DEFAULT_REORDER_THRESH;
    if (qty === 0) outCount++;
    else if (qty <= critT) criticalCount++;
    else if (qty <= reordT) lowCount++;
  }
  const hasRisk = criticalCount > 0 || outCount > 0;
  const hasLow = lowCount > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="drawer-section-label" style={{ marginBottom: 0 }}>Stock by Variant</div>
        {(hasRisk || hasLow) && (
          <div style={{ display: 'flex', gap: 4 }}>
            {outCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 9999, background: '#F5D8D8', color: '#701919' }}>{outCount} out</span>
            )}
            {criticalCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 9999, background: '#FCE2E2', color: '#8B2020' }}>{criticalCount} critical</span>
            )}
            {lowCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 9999, background: '#FFF0C2', color: '#7A5400' }}>{lowCount} low</span>
            )}
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--color-fg-3)', fontWeight: 500 }}>Size</th>
              {colors.map(c => (
                <th key={c} style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--color-fg-3)', fontWeight: 500 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map(size => (
              <tr key={size}>
                <td style={{ padding: '3px 8px 3px 0', fontWeight: 600, fontSize: 12 }}>{size}</td>
                {colors.map(color => {
                  const variant = variants.find(v => v.size === size && v.color === color);
                  const qty = variant?.inventory?.availableQty ?? 0;
                  const critT = variant?.inventory?.criticalThreshold ?? DEFAULT_CRITICAL_THRESH;
                  const reordT = variant?.inventory?.reorderThreshold ?? DEFAULT_REORDER_THRESH;
                  const color_ = variantStockColor(qty, critT, reordT);
                  return (
                    <td key={color} style={{ textAlign: 'right', padding: '3px 0 3px 8px', fontWeight: 700, color: color_ }}
                      title={variant ? `Reorder at ≤${reordT}, critical at ≤${critT}` : undefined}>
                      {variant ? qty : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hasRisk || hasLow) && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-fg-3)' }}>
          Colors: <span style={{ color: '#8B2020', fontWeight: 600 }}>red</span> = critical,{' '}
          <span style={{ color: '#9B6B00', fontWeight: 600 }}>amber</span> = low stock,{' '}
          <span style={{ color: '#1E6B45', fontWeight: 600 }}>green</span> = healthy
        </div>
      )}
    </div>
  );
}

export function ProductDrawer({
  product,
  onClose,
  onEdit,
  canManage = true,
}: {
  product: Product | null;
  onClose: () => void;
  onEdit?: () => void;
  canManage?: boolean;
}) {
  const open = !!product;
  const threshold = product?.threshold || 50;

  // Derive total stock from variant inventory when available
  const derivedStock = product?.variants && product.variants.length > 0
    ? product.variants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0)
    : (product?.stock ?? 0);

  const stockPct = product ? Math.min(100, (derivedStock / threshold) * 100) : 0;
  const stockColor = product?.status === "critical" ? "#8B2020" : product?.status === "low-stock" ? "#9B6B00" : "#1E6B45";

  const sizes = product?.sizes.split(',').map(s => s.trim()) || [];
  const colors = product?.colors.split(',').map(c => c.trim()) || [];
  const hasVariants = (product?.variants?.length ?? 0) > 0;
  const garmentSpecLines = product ? buildGarmentSpecsForCustomer(product).split('\n').filter(Boolean) : [];

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drawer${open ? " open" : ""}`}>
        {product && (
          <>
            <div className="drawer-head">
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.2, marginBottom: 4 }}>
                  {product.name}
                </div>
                <code style={{ fontSize: 11, color: "var(--color-fg-3)", fontFamily: "var(--font-mono)" }}>
                  SKU-{product.id.toString().padStart(4, '0')}
                </code>
                <div style={{ marginTop: 6 }}>
                  <span className={`pill pill-${product.status}`}>
                    {product.status.replace('-', ' ')}
                  </span>
                </div>
              </div>
              <button className="drawer-close" onClick={onClose}>
                <Icon d={ic.x} size={13} color="var(--color-fg-2)" />
              </button>
            </div>
            <div className="drawer-body">
              {/* Product Image */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    style={{ width: 120, height: 144, objectFit: "cover", borderRadius: 8, display: "block" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'block'; }}
                  />
                ) : null}
                <svg viewBox="0 0 120 144" width="120" height="144" style={{ borderRadius: 8, display: product.imageUrl ? "none" : "block" }}>
                  <rect width="120" height="144" fill="#F2EFE9" />
                  {[-20, 5, 30, 55, 80, 105, 130].map((x, i) => <line key={i} x1={x} y1="0" x2={x + 144} y2="144" stroke="#E5E0D8" strokeWidth="12" />)}
                  <path d="M40 26L29 40L12 35L19 67L32 67L32 116L88 116L88 67L101 67L108 35L91 40L80 26Q60 42 40 26Z" fill="none" stroke="#C4BDB4" strokeWidth="3" />
                </svg>
              </div>

              <div>
                <div className="drawer-section-label">Brand & Style</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{product.brand} — {product.style}</div>
              </div>

              <div>
                <div className="drawer-section-label">Available Sizes</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {sizes.map(s => <span key={s} className="var-chip" style={{ padding: "4px 10px", fontSize: 12 }}>{s}</span>)}
                </div>
              </div>

              <div>
                <div className="drawer-section-label">Colour Variants</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {colors.map(c => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="color-swatch" style={{ background: '#CCC' }} />
                      <span style={{ fontSize: 13, color: "var(--color-fg-2)" }}>{c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {hasVariants && product.variants ? (
                <VariantStockGrid variants={product.variants} />
              ) : (
                <div>
                  <div className="drawer-section-label">Stock Level</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.04em", color: stockColor }}>{derivedStock}</span>
                    <span style={{ fontSize: 12, color: "var(--color-fg-3)" }}>units · threshold: {threshold}</span>
                  </div>
                  <div className="stock-bar-wrap">
                    <div className="stock-bar-fill" style={{ width: `${stockPct}%`, background: stockColor }} />
                  </div>
                </div>
              )}

              {garmentSpecLines.length > 0 && (
                <div>
                  <div className="drawer-section-label">Garment Fit & Construction</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {garmentSpecLines.map((line) => (
                      <div key={line} style={{ fontSize: 12, color: 'var(--color-fg-2)', lineHeight: 1.45 }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasVariants && (
                <div>
                  <div className="drawer-section-label">Total Stock</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.04em", color: stockColor }}>{derivedStock}</span>
                    <span style={{ fontSize: 12, color: "var(--color-fg-3)" }}>units across all variants · threshold: {threshold}</span>
                  </div>
                  <div className="stock-bar-wrap">
                    <div className="stock-bar-fill" style={{ width: `${stockPct}%`, background: stockColor }} />
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                  <div className="drawer-section-label" style={{ marginBottom: 4 }}>Unit Price</div>
                  <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>₺{product.price.toLocaleString()}</div>
                </div>
                <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                  <div className="drawer-section-label" style={{ marginBottom: 4 }}>Total Orders</div>
                  <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em" }}>{product.orders || 0}</div>
                </div>
              </div>
            </div>
            {(() => {
              // Compute variant-level restock suggestion for the drawer footer
              const criticalVariants = (product.variants ?? []).filter(v => {
                const qty = v.inventory?.availableQty ?? 0;
                const critT = v.inventory?.criticalThreshold ?? DEFAULT_CRITICAL_THRESH;
                return qty <= critT;
              });
              const totalSuggestedRestock = (product.variants ?? []).reduce((sum, v) => {
                const qty = v.inventory?.availableQty ?? 0;
                const reordT = v.inventory?.reorderThreshold ?? DEFAULT_REORDER_THRESH;
                return sum + Math.max(0, reordT * 2 - qty);
              }, 0);
              const showRestockSuggestion = criticalVariants.length > 0 && totalSuggestedRestock > 0;
              return showRestockSuggestion ? (
                <div style={{ margin: '0 0 10px', padding: '10px 14px', background: '#FFF8E6', border: '1px solid #F0DFA0', borderRadius: 8, fontSize: 12, color: '#5C3A00', lineHeight: 1.5 }}>
                  <strong>{criticalVariants.length} variant{criticalVariants.length > 1 ? 's' : ''} at critical stock.</strong>
                  {' '}Suggested restock: ~{totalSuggestedRestock} units total to reach 2× reorder thresholds.
                </div>
              ) : null;
            })()}
            <div className="drawer-actions">
              {canManage ? (
                <>
                  <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={onEdit}>
                    <Icon d={ic.edit} size={13} />Edit Product
                  </button>
                  {(product.status === "critical" || product.status === "low-stock") && (
                    <button className="btn btn-secondary" style={{ justifyContent: "center" }}>
                      <Icon d={ic.refresh} size={13} />Reorder Stock
                    </button>
                  )}
                </>
              ) : (
                <div className="drawer-error" role="note">
                  Your role can view this product but cannot change catalog or stock settings.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function ProductThumb({ status, imageUrl }: { status: string; imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" className="thumb" style={{ width: 40, height: 48, objectFit: 'cover', borderRadius: '4px' }} />
    );
  }

  const bg = status === "out-of-stock" ? "#EDEAE5" : "#F2EFE9";
  const lineColor = status === "out-of-stock" ? "#DDD9D1" : "#E5E0D8";
  return (
    <svg className="thumb" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="48" fill={bg} />
      {[-8, 2, 12, 22, 32, 42].map((x, i) => <line key={i} x1={x} y1="0" x2={x + 48} y2="48" stroke={lineColor} strokeWidth="5" />)}
      <path d="M14 9L10 14L4 12L7 23L11 23L11 39L29 39L29 23L33 23L36 12L30 14L26 9Q20 14 14 9Z" fill="none" stroke={status === "out-of-stock" ? "#C4BDB4" : "#BEB8AE"} strokeWidth="1.2" />
    </svg>
  );
}
