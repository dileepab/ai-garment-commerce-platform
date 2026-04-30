'use client';

import React, { useState, useMemo } from 'react';
import {
  OrderDrawer,
  OrderPipeline,
  type OrderDrawerOrder,
  type OrderPipelineStats,
} from '@/components/OrderComponents';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
};

const STATUS_TABS = [
  { key: "all", label: "All", dot: null },
  { key: "pending", label: "Pending", dot: "#E8C840" },
  { key: "confirmed", label: "Confirmed", dot: "#4A7AA8" },
  { key: "packing", label: "Packing", dot: "#8B5CF6" },
  { key: "shipped", label: "Shipped", dot: "#38A169" },
  { key: "delivered", label: "Delivered", dot: "#1E6B45" },
];

interface OrdersPageOrderItem {
  quantity: number;
}

interface OrdersPageOrder extends OrderDrawerOrder {
  orderItems: OrdersPageOrderItem[];
}

interface OrdersPageStats extends OrderPipelineStats {
  total: number;
  revenueToday: number;
}

type OrderStatusFilter = (typeof STATUS_TABS)[number]['key'];

export default function OrdersPageClient({ initialOrders, stats }: { initialOrders: OrdersPageOrder[], stats: OrdersPageStats }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [selectedOrder, setSelectedOrder] = useState<OrderDrawerOrder | null>(null);

  const filteredOrders = useMemo(() => initialOrders.filter(o => {
    if (statusFilter !== "all" && o.orderStatus !== statusFilter) return false;
    if (search && !o.customer.name.toLowerCase().includes(search.toLowerCase()) && !o.id.toString().includes(search)) return false;
    return true;
  }), [initialOrders, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<OrderStatusFilter, number> = { all: initialOrders.length };
    STATUS_TABS.slice(1).forEach(t => {
      c[t.key] = initialOrders.filter(o => o.orderStatus === t.key).length;
    });
    return c;
  }, [initialOrders]);

  return (
    <main className="main">
      <div className="topbar">
        <div className="topbar-title-group">
          <div className="topbar-title">Orders</div>
          <div className="topbar-subtitle">{stats.total} open orders · Today&apos;s Revenue: ₺{stats.revenueToday.toLocaleString()}</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-secondary"><Icon d={ic.download} size={13} />Export</button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Open Orders</div>
          <div className="kpi-strip-val">{stats.total}</div>
          <div className="kpi-strip-note">Total active</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Pending Action</div>
          <div className="kpi-strip-val" style={{ color: "#9B6B00" }}>{stats.pending}</div>
          <div className="kpi-strip-note">awaiting confirmation</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Shipped Today</div>
          <div className="kpi-strip-val" style={{ color: "#1E6B45" }}>{stats.shipped}</div>
          <div className="kpi-strip-note">via courier</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Revenue Today</div>
          <div className="kpi-strip-val">₺{Math.round(stats.revenueToday / 1000)}k</div>
          <div className="kpi-strip-note">confirmed</div>
        </div>
      </div>

      <OrderPipeline stats={stats} />

      <div className="filter-bar">
        <div className="search-wrap">
          <Icon d={ic.search} size={13} color="var(--color-fg-3)" />
          <input 
            className="search-input" 
            placeholder="Search order or customer…" 
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
              {t.dot && <span className="tab-dot" style={{ background: t.dot }} />}
              {t.label}
              <span style={{ fontSize: 10, color: "var(--color-fg-3)", marginLeft: 2 }}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="content" style={{ flex: 1 }}>
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Brand</th>
                <th>Items</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(o => (
                <tr key={o.id} onClick={() => setSelectedOrder(o)} className="cursor-pointer">
                  <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-3)" }}>#ORD-{o.id}</code></td>
                  <td><span style={{ fontWeight: 600 }}>{o.customer.name}</span></td>
                  <td><span style={{ fontSize: 12 }}>{o.brand || 'N/A'}</span></td>
                  <td>
                    <span className="var-chip" style={{ fontSize: 11 }}>
                      {o.orderItems.reduce((acc, item) => acc + item.quantity, 0)} units
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>₺{o.totalAmount.toLocaleString()}</td>
                  <td>
                    <span className={`pill pill-${o.orderStatus}`}>
                      {o.orderStatus}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--color-fg-3)", whiteSpace: "nowrap" }}>
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 0", color: "var(--color-fg-3)" }}>
                    No orders match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrderDrawer 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
      />
    </main>
  );
}
