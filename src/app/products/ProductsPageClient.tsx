'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ProductThumb, ProductDrawer, type Product, type ProductVariantData } from '@/components/ProductComponents';
import { ProductFormModal } from './ProductFormModal';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  plus: ["M12 5v14", "M5 12h14"],
};

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "low-stock", label: "Low Stock" },
  { key: "critical", label: "Critical" },
  { key: "out-of-stock", label: "Out of Stock" },
];

interface ProductsPageStats {
  totalProducts: number;
  inventoryValue: number;
  lowStock: number;
  criticalStock: number;
}

type ProductStatusFilter = (typeof STATUS_TABS)[number]['key'];

type ProductWithVariants = Product & { variants?: ProductVariantData[] };

export default function ProductsPageClient({
  initialProducts,
  stats,
  canManageProducts,
}: {
  initialProducts: ProductWithVariants[];
  stats: ProductsPageStats;
  canManageProducts: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>("all");
  const [selectedProduct, setSelectedProduct] = useState<ProductWithVariants | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithVariants | null>(null);

  const filteredProducts = useMemo(() => initialProducts.filter(p => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [initialProducts, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<ProductStatusFilter, number> = { all: initialProducts.length };
    STATUS_TABS.slice(1).forEach(t => {
      c[t.key] = initialProducts.filter(p => p.status === t.key).length;
    });
    return c;
  }, [initialProducts]);

  const availableBrands = useMemo(
    () => [...new Set(initialProducts.map(p => p.brand))].sort(),
    [initialProducts],
  );

  function openAddForm() {
    setEditingProduct(null);
    setShowForm(true);
  }

  function openEditForm(product: ProductWithVariants) {
    setEditingProduct(product);
    setSelectedProduct(null);
    setShowForm(true);
  }

  function handleFormSuccess() {
    setShowForm(false);
    setEditingProduct(null);
    router.refresh();
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingProduct(null);
  }

  return (
    <main className="main">
      <div className="topbar">
        <div className="topbar-title-group">
          <div className="topbar-title">Products</div>
          <div className="topbar-subtitle">{initialProducts.length} SKUs across all categories</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-secondary"><Icon d={ic.download} size={13} />Export CSV</button>
          {canManageProducts && (
            <button className="btn btn-primary" onClick={openAddForm}><Icon d={ic.plus} size={13} />Add Product</button>
          )}
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Total Products</div>
          <div className="kpi-strip-val">{stats.totalProducts}</div>
          <div className="kpi-strip-note">Active SKUs</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Inventory Value</div>
          <div className="kpi-strip-val">₺{Math.round(stats.inventoryValue / 1000)}k</div>
          <div className="kpi-strip-note">estimated</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Low Stock</div>
          <div className="kpi-strip-val" style={{ color: "var(--color-warning)" }}>{stats.lowStock}</div>
          <div className="kpi-strip-note">needs reorder</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Critical Stock</div>
          <div className="kpi-strip-val" style={{ color: "var(--color-error)" }}>{stats.criticalStock}</div>
          <div className="kpi-strip-note">immediate action</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-wrap">
          <Icon d={ic.search} size={13} color="var(--color-fg-3)" />
          <input
            className="search-input"
            placeholder="Search products or brand…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="status-tabs">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              className={`status-tab${statusFilter === t.key ? " active" : ""}`}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label}<span className="tab-count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="content">
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}></th>
                <th>Product</th>
                <th>Brand</th>
                <th>Sizes</th>
                <th style={{ textAlign: "right" }}>Stock</th>
                <th style={{ textAlign: "right" }}>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(p => (
                <tr key={p.id} onClick={() => setSelectedProduct(p)} className="cursor-pointer">
                  <td style={{ paddingRight: 4 }}>
                    <ProductThumb status={p.status} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <code style={{ fontSize: 10, color: "var(--color-fg-3)", fontFamily: "var(--font-mono)" }}>
                      SKU-{p.id.toString().padStart(4, '0')}
                    </code>
                  </td>
                  <td><span style={{ fontSize: 12 }}>{p.brand}</span></td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {p.sizes.split(',').map((s: string) => (
                        <span key={s} className="var-chip" style={{ fontSize: 10 }}>{s.trim()}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {p.variants && p.variants.length > 0
                      ? p.variants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0)
                      : p.stock}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>₺{p.price.toLocaleString()}</td>
                  <td>
                    <span className={`pill pill-${p.status}`}>
                      {p.status.replace('-', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--color-fg-3)" }}>
                    No products match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProductDrawer
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        canManage={canManageProducts}
        onEdit={canManageProducts && selectedProduct ? () => openEditForm(selectedProduct) : undefined}
      />

      {canManageProducts && showForm && (
        <ProductFormModal
          product={editingProduct}
          availableBrands={availableBrands}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </main>
  );
}
