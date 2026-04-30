'use client';

import React from 'react';

const Icon = ({ d, size = 15, color = "currentColor", strokeWidth = 1.8 }: { d: string | string[], size?: number, color?: string, strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  x: ["M18 6L6 18", "M6 6l12 12"],
  check: "M20 6L9 17l-5-5",
  truck: ["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", "M18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"],
  mapPin: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z", "M12 10a1 1 0 110-2 1 1 0 010 2z"],
  message2: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  printer: ["M6 9V2h12v7", "M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2", "M6 14h12v8H6z"],
};

const STATUS_STEPS = ["pending", "confirmed", "packing", "shipped", "delivered"];
const STATUS_LABELS: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", packing: "Packing", shipped: "Shipped", delivered: "Delivered" };

const CHANNEL_COLORS: Record<string, string> = { messenger: "#0866FF", instagram: "#C13584", direct: "#6A635A" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct" };

export interface OrderDrawerOrder {
  id: number;
  orderStatus: string;
  totalAmount: number;
  createdAt: Date | string;
  customer: { name: string; phone?: string | null };
  deliveryAddress?: string | null;
  brand?: string | null;
  channel?: string;
}

export interface OrderPipelineStats {
  pending: number;
  confirmed: number;
  packing: number;
  shipped: number;
  delivered: number;
}

export function OrderDrawer({ order, onClose }: { order: OrderDrawerOrder | null, onClose: () => void }) {
  const open = !!order;
  const status = order?.orderStatus || 'pending';
  const stepIdx = STATUS_STEPS.indexOf(status);

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drawer${open ? " open" : ""}`}>
        {order && (
          <>
            <div className="drawer-head">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--color-fg-1)" }}>#ORD-{order.id}</code>
                  <span className={`pill pill-${status}`}>{STATUS_LABELS[status] || status}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-fg-3)" }}>
                  {new Date(order.createdAt).toLocaleString()} · via <span style={{ fontWeight: 600, color: CHANNEL_COLORS[order.channel || 'direct'] }}>{CHANNEL_LABELS[order.channel || 'direct']}</span>
                </div>
              </div>
              <button className="drawer-close" onClick={onClose}>
                <Icon d={ic.x} size={13} color="var(--color-fg-2)" />
              </button>
            </div>
            <div className="drawer-body">
              <div>
                <div className="drawer-section-label">Customer</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{order.customer.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-fg-3)" }}>
                  <Icon d={ic.mapPin} size={12} color="var(--color-fg-3)" />
                  {order.deliveryAddress || 'No address provided'}
                </div>
              </div>
              
              <div>
                <div className="drawer-section-label">Order Details</div>
                <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Brand:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{order.brand || 'N/A'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Total Amount:</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>₺{order.totalAmount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="drawer-section-label">Order Timeline</div>
                <div className="timeline">
                  {STATUS_STEPS.map((step, i) => {
                    const state = i < stepIdx ? "done" : i === stepIdx ? "current" : "future";
                    return (
                      <div key={step} className="tl-step">
                        <div className={`tl-dot ${state}`}>
                          {(state === "done" || state === "current") && <Icon d={ic.check} size={11} color="white" strokeWidth={2.5} />}
                        </div>
                        <div className="tl-label">
                          <div className="tl-label-title" style={{ color: state === "future" ? "var(--color-fg-3)" : "var(--color-fg-1)" }}>{STATUS_LABELS[step]}</div>
                          <div className="tl-label-sub">{state !== "future" ? "Updated" : "—"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="drawer-actions">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn btn-primary" style={{ justifyContent: "center", fontSize: 12 }}>
                  <Icon d={ic.truck} size={12} />Update Status
                </button>
                <button className="btn btn-secondary" style={{ justifyContent: "center", fontSize: 12 }}>
                  <Icon d={ic.message2} size={12} />Contact
                </button>
              </div>
              <button className="btn btn-ghost" style={{ justifyContent: "center", fontSize: 12, color: "var(--color-fg-3)" }}>
                <Icon d={ic.printer} size={12} />Print Invoice
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function OrderPipeline({ stats }: { stats: OrderPipelineStats }) {
  const pipeline = [
    { key: "pending", label: "Pending", color: "#E8C840", count: stats.pending },
    { key: "confirmed", label: "Confirmed", color: "#4A7AA8", count: stats.confirmed },
    { key: "packing", label: "Packing", color: "#8B5CF6", count: stats.packing },
    { key: "shipped", label: "Shipped", color: "#38A169", count: stats.shipped },
    { key: "delivered", label: "Delivered", color: "#1E6B45", count: stats.delivered },
  ];

  const total = pipeline.reduce((acc, s) => acc + s.count, 0);

  return (
    <div className="pipeline-strip">
      <div className="pipe-bar">
        {pipeline.map(s => (
          <div 
            key={s.key} 
            className="pipe-seg" 
            style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, background: s.color }} 
          />
        ))}
      </div>
      <div className="pipe-legend">
        {pipeline.map(s => (
          <div key={s.key} className="pipe-leg-item">
            <div className="pipe-dot" style={{ background: s.color, width: 8, height: 8, borderRadius: '50%' }} />
            <strong>{s.count}</strong> {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
