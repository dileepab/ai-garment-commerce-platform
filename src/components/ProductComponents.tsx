'use client';

import React from 'react';

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
  inventory?: { availableQty: number; reservedQty: number } | null;
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
  category?: string;
  sku?: string;
  threshold?: number;
  orders?: number;
  variants?: ProductVariantData[];
}

function VariantStockGrid({ variants }: { variants: ProductVariantData[] }) {
  if (variants.length === 0) return null;

  // Group variants by size for a compact grid
  const sizes = [...new Set(variants.map(v => v.size))];
  const colors = [...new Set(variants.map(v => v.color))];

  return (
    <div>
      <div className="drawer-section-label">Stock by Variant</div>
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
                  const stockColor = qty === 0 ? 'var(--color-fg-3)' : qty <= 2 ? '#8B2020' : qty <= 5 ? '#9B6B00' : '#1E6B45';
                  return (
                    <td key={color} style={{ textAlign: 'right', padding: '3px 0 3px 8px', fontWeight: 700, color: stockColor }}>
                      {variant ? qty : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProductDrawer({
  product,
  onClose,
  canManage = true,
}: {
  product: Product | null;
  onClose: () => void;
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
              {/* Thumbnail Placeholder */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg viewBox="0 0 120 144" width="120" height="144" style={{ borderRadius: 8, display: "block" }}>
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
            <div className="drawer-actions">
              {canManage ? (
                <>
                  <button className="btn btn-primary" style={{ justifyContent: "center" }}>
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

export function ProductThumb({ status }: { status: string }) {
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
