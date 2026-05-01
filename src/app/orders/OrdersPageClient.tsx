'use client';

import React, { useState, useMemo } from 'react';
import {
  OrderDrawer,
  OrderPipeline,
  OrderRowQuickActions,
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
  x: ["M18 6L6 18", "M6 6l12 12"],
};

const STATUS_TABS = [
  { key: "all", label: "All", dot: null },
  { key: "pending", label: "Pending", dot: "#E8C840" },
  { key: "confirmed", label: "Confirmed", dot: "#4A7AA8" },
  { key: "packing", label: "Packing", dot: "#8B5CF6" },
  { key: "shipped", label: "Shipped", dot: "#38A169" },
  { key: "delivered", label: "Delivered", dot: "#1E6B45" },
  { key: "cancelled", label: "Cancelled", dot: "#8B2020" },
] as const;

interface OrdersPageOrderItem {
  id: number;
  quantity: number;
  size: string | null;
  color: string | null;
  price: number;
  product: { name: string | null; style: string | null } | null;
}

interface OrdersPageOrder extends Omit<OrderDrawerOrder, 'createdAt' | 'orderItems'> {
  createdAt: string;
  customer: { id: number; name: string; phone: string | null; channel: string | null };
  orderItems: OrdersPageOrderItem[];
  supportEscalations: {
    id: number;
    status: string;
    reason: string;
    updatedAt: string;
  }[];
}

interface OrdersPageStats extends OrderPipelineStats {
  total: number;
  cancelled: number;
  revenueToday: number;
}

type OrderStatusFilter = (typeof STATUS_TABS)[number]['key'];
type OrderSort = "urgency" | "newest" | "waiting" | "value-desc";

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: "urgency", label: "Urgency" },
  { value: "newest", label: "Newest first" },
  { value: "waiting", label: "Waiting longest" },
  { value: "value-desc", label: "Highest value" },
];

const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct", whatsapp: "WhatsApp" };
const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "processing", "packing", "packed", "shipped", "dispatched"]);
const ACTIVE_SUPPORT_STATUSES = new Set(["escalated", "open", "pending", "in_progress"]);
const STATUS_LABELS: Record<string, string> = {
  pending: "pending",
  confirmed: "confirmed",
  processing: "processing",
  packing: "packing",
  packed: "packing",
  shipped: "shipped",
  dispatched: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
};

function normalizeOrderStatus(status: string): string {
  return status === "dispatched" ? "shipped" : status === "packed" ? "packing" : status;
}

function matchesStatusFilter(orderStatus: string, filter: OrderStatusFilter): boolean {
  return filter === "all" || normalizeOrderStatus(orderStatus) === filter;
}

function getOrderUrgency(status: string): number {
  switch (normalizeOrderStatus(status)) {
    case "pending":
      return 0;
    case "confirmed":
    case "processing":
      return 1;
    case "packing":
      return 2;
    case "shipped":
      return 3;
    case "delivered":
      return 8;
    case "cancelled":
      return 9;
    default:
      return 4;
  }
}

function getOrderAgeLabel(createdAt: string, status: string): string {
  if (!ACTIVE_ORDER_STATUSES.has(status)) return new Date(createdAt).toLocaleDateString();

  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function OrdersPageClient({ initialOrders, stats }: { initialOrders: OrdersPageOrder[], stats: OrdersPageStats }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [sort, setSort] = useState<OrderSort>("urgency");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const selectedOrder = useMemo(
    () => initialOrders.find((order) => order.id === selectedOrderId) || null,
    [initialOrders, selectedOrderId]
  );

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    initialOrders.forEach(o => set.add(o.customer.channel || 'direct'));
    return Array.from(set).sort();
  }, [initialOrders]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    initialOrders.forEach(o => { if (o.brand) set.add(o.brand); });
    return Array.from(set).sort();
  }, [initialOrders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = initialOrders.filter(o => {
      if (!matchesStatusFilter(o.orderStatus, statusFilter)) return false;
      if (channelFilter !== "all" && (o.customer.channel || '') !== channelFilter) return false;
      if (brandFilter !== "all" && (o.brand || '') !== brandFilter) return false;
      if (q) {
        const haystack = [
          o.customer.name,
          o.customer.phone || '',
          `ord-${o.id}`,
          `${o.id}`,
          o.brand || '',
          o.paymentMethod || '',
          o.orderStatus,
          normalizeOrderStatus(o.orderStatus),
          ...o.orderItems.flatMap((item) => [
            item.product?.name || '',
            item.product?.style || '',
            item.size || '',
            item.color || '',
          ]),
          ...o.supportEscalations.flatMap((support) => [
            support.status,
            support.reason,
            `case-${support.id}`,
          ]),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();

      switch (sort) {
        case "urgency": {
          const urgencyDiff = getOrderUrgency(a.orderStatus) - getOrderUrgency(b.orderStatus);
          return urgencyDiff || aCreated - bCreated;
        }
        case "waiting": {
          const aActive = ACTIVE_ORDER_STATUSES.has(a.orderStatus);
          const bActive = ACTIVE_ORDER_STATUSES.has(b.orderStatus);
          if (aActive !== bActive) return aActive ? -1 : 1;
          return aCreated - bCreated;
        }
        case "value-desc":
          return b.totalAmount - a.totalAmount;
        case "newest":
        default:
          return bCreated - aCreated;
      }
    });
    return sorted;
  }, [initialOrders, search, statusFilter, channelFilter, brandFilter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: initialOrders.length };
    STATUS_TABS.slice(1).forEach(t => {
      c[t.key] = initialOrders.filter(o => matchesStatusFilter(o.orderStatus, t.key)).length;
    });
    return c;
  }, [initialOrders]);

  const hasActiveFilters = statusFilter !== "all" || channelFilter !== "all" || brandFilter !== "all" || sort !== "urgency" || !!search.trim();

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setChannelFilter("all");
    setBrandFilter("all");
    setSort("urgency");
  };

  return (
    <main className="main">
      <div className="topbar">
        <div className="topbar-title-group">
          <div className="topbar-title">Orders</div>
          <div className="topbar-subtitle">{stats.total} total orders · Today&apos;s Revenue: ₺{stats.revenueToday.toLocaleString()}</div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-secondary"><Icon d={ic.download} size={13} />Export</button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Open Orders</div>
          <div className="kpi-strip-val">{stats.total - stats.delivered - stats.cancelled}</div>
          <div className="kpi-strip-note">in flight</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Pending Action</div>
          <div className="kpi-strip-val" style={{ color: "#9B6B00" }}>{stats.pending}</div>
          <div className="kpi-strip-note">awaiting confirmation</div>
        </div>
        <div className="kpi-strip-card">
          <div className="kpi-strip-label">Shipped</div>
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
            placeholder="Search order #, customer, item, support…"
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
              <span style={{ fontSize: 10, color: "var(--color-fg-3)", marginLeft: 2 }}>{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="filter-group">
          <select
            className="filter-select"
            value={channelFilter}
            onChange={e => setChannelFilter(e.target.value)}
            aria-label="Filter by channel"
          >
            <option value="all">All channels</option>
            {channelOptions.map(c => (
              <option key={c} value={c}>{CHANNEL_LABELS[c] || c}</option>
            ))}
          </select>

          {brandOptions.length > 0 && (
            <select
              className="filter-select"
              value={brandFilter}
              onChange={e => setBrandFilter(e.target.value)}
              aria-label="Filter by brand"
            >
              <option value="all">All brands</option>
              {brandOptions.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}

          <select
            className="filter-select"
            value={sort}
            onChange={e => setSort(e.target.value as OrderSort)}
            aria-label="Sort orders"
          >
            {SORT_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {hasActiveFilters && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px" }} onClick={clearFilters}>
              <Icon d={ic.x} size={11} />Clear
            </button>
          )}
        </div>

        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-fg-3)", whiteSpace: "nowrap" }}>
          {filteredOrders.length} of {initialOrders.length}
        </div>
      </div>

      <div className="content" style={{ flex: 1 }}>
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Brand</th>
                <th>Items</th>
                <th>Payment</th>
                <th>Support</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Status</th>
                <th>Waiting</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(o => {
                const units = o.orderItems.reduce((acc, item) => acc + item.quantity, 0);
                const lines = o.orderItems.length;
                const channel = o.customer.channel || 'direct';
                const displayStatus = normalizeOrderStatus(o.orderStatus);
                const firstItem = o.orderItems[0];
                const activeSupport = o.supportEscalations.filter((support) => ACTIVE_SUPPORT_STATUSES.has(support.status));
                const supportLabel = activeSupport.length > 0
                  ? `${activeSupport.length} active`
                  : o.supportEscalations.length > 0
                    ? "resolved"
                    : "clear";
                return (
                  <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} className="cursor-pointer">
                    <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-3)" }}>#ORD-{o.id}</code></td>
                    <td><span style={{ fontWeight: 600 }}>{o.customer.name}</span></td>
                    <td><span className="channel-chip" data-channel={channel}>{CHANNEL_LABELS[channel] || channel}</span></td>
                    <td><span style={{ fontSize: 12 }}>{o.brand || '—'}</span></td>
                    <td>
                      <div className="order-items-cell">
                        <span className="order-item-summary">{firstItem?.product?.name || firstItem?.product?.style || `${lines} item${lines === 1 ? '' : 's'}`}</span>
                        <span className="order-item-meta">
                          {units} {units === 1 ? 'unit' : 'units'}
                          {firstItem?.size ? ` · ${firstItem.size}` : ''}
                          {firstItem?.color ? ` · ${firstItem.color}` : ''}
                          {lines > 1 ? ` · +${lines - 1}` : ''}
                        </span>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>{o.paymentMethod || '—'}</span></td>
                    <td>
                      <span className={`support-state-chip${activeSupport.length > 0 ? ' active' : ''}`}>{supportLabel}</span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>₺{o.totalAmount.toLocaleString()}</td>
                    <td>
                      <span className={`pill pill-${displayStatus}`}>
                        {STATUS_LABELS[o.orderStatus] || displayStatus}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--color-fg-3)", whiteSpace: "nowrap" }} suppressHydrationWarning>
                      {getOrderAgeLabel(o.createdAt, o.orderStatus)}
                    </td>
                    <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                      <OrderRowQuickActions orderId={o.id} status={o.orderStatus} />
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: "40px 0", color: "var(--color-fg-3)" }}>
                    No orders match your filters.
                    {hasActiveFilters && (
                      <>
                        {' '}
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", display: "inline-flex" }} onClick={clearFilters}>Clear filters</button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrderDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
      />
    </main>
  );
}
