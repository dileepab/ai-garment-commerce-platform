'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  confirmOrder,
  markPacking,
  markShipped,
  deliverOrder,
  cancelOrder,
  type OrderActionResult,
} from '@/app/orders/actions';

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
  card: ["M2 5h20v14H2z", "M2 10h20"],
  ban: ["M12 22a10 10 0 100-20 10 10 0 000 20", "M5 5l14 14"],
  box: ["M21 8l-9 4-9-4 9-4 9 4z", "M3 8v8l9 4 9-4V8", "M12 12v8"],
};

const STATUS_STEPS = ["pending", "confirmed", "packing", "shipped", "delivered"];
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  packing: "Packing",
  packed: "Packed",
  shipped: "Shipped",
  dispatched: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const CHANNEL_COLORS: Record<string, string> = { messenger: "#0866FF", instagram: "#C13584", direct: "#6A635A", whatsapp: "#128C7E" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct", whatsapp: "WhatsApp" };
const ACTIVE_SUPPORT_STATUSES = new Set(["escalated", "open", "pending", "in_progress"]);

function normalizeOrderStatus(status: string): string {
  return status === 'dispatched' ? 'shipped' : status === 'packed' ? 'packing' : status;
}

export interface OrderDrawerOrderItem {
  id: number;
  quantity: number;
  size?: string | null;
  color?: string | null;
  price: number;
  product?: {
    name?: string | null;
    style?: string | null;
  } | null;
}

export interface OrderDrawerOrder {
  id: number;
  orderStatus: string;
  totalAmount: number;
  createdAt: Date | string;
  customer: { name: string; phone?: string | null; channel?: string | null };
  deliveryAddress?: string | null;
  brand?: string | null;
  channel?: string;
  paymentMethod?: string | null;
  orderItems?: OrderDrawerOrderItem[];
  supportEscalations?: {
    id: number;
    status: string;
    reason: string;
    updatedAt: string;
  }[];
}

export interface OrderPipelineStats {
  pending: number;
  confirmed: number;
  packing: number;
  shipped: number;
  delivered: number;
}

interface NextActionConfig {
  label: string;
  shortLabel: string;
  variant: 'primary' | 'secondary' | 'success';
  run: (orderId: number) => Promise<OrderActionResult>;
  iconPath?: string | string[];
}

function getPrimaryAction(status: string): NextActionConfig | null {
  switch (status) {
    case 'pending':
      return { label: 'Confirm Order', shortLabel: 'Confirm', variant: 'primary', run: confirmOrder, iconPath: ic.check };
    case 'confirmed':
      return { label: 'Mark Packing', shortLabel: 'Packing', variant: 'primary', run: markPacking, iconPath: ic.box };
    case 'packing':
    case 'packed':
      return { label: 'Mark Shipped', shortLabel: 'Ship', variant: 'primary', run: markShipped, iconPath: ic.truck };
    case 'shipped':
    case 'dispatched':
      return { label: 'Mark Delivered', shortLabel: 'Deliver', variant: 'success', run: deliverOrder, iconPath: ic.check };
    default:
      return null;
  }
}

function canCancel(status: string): boolean {
  return ['pending', 'confirmed', 'processing', 'packing', 'packed'].includes(status);
}

export function OrderDrawer({
  order,
  onClose,
  canUpdate = true,
}: {
  order: OrderDrawerOrder | null;
  onClose: () => void;
  canUpdate?: boolean;
}) {
  const router = useRouter();
  const open = !!order;
  const status = order?.orderStatus || 'pending';
  const displayStatus = normalizeOrderStatus(status);
  const stepIdx = STATUS_STEPS.indexOf(displayStatus);
  const isCancelled = displayStatus === 'cancelled';
  const channelKey = order?.channel || order?.customer.channel || 'direct';

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const primaryAction = canUpdate && !isCancelled && order ? getPrimaryAction(status) : null;
  const showCancel = canUpdate && !!order && canCancel(status);
  const activeSupport = order?.supportEscalations?.filter((support) => ACTIVE_SUPPORT_STATUSES.has(support.status)) || [];

  const runAction = (action: (id: number) => Promise<OrderActionResult>) => {
    if (!order) return;
    setError(null);
    startTransition(async () => {
      const result = await action(order.id);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleCancel = () => {
    if (!order) return;
    const ok = window.confirm(`Cancel order #${order.id}? This will release reserved stock.`);
    if (!ok) return;
    runAction(cancelOrder);
  };

  const totalUnits = order?.orderItems?.reduce((acc, i) => acc + i.quantity, 0) ?? 0;

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
                  <span className={`pill pill-${displayStatus}`}>{STATUS_LABELS[status] || STATUS_LABELS[displayStatus] || displayStatus}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-fg-3)" }}>
                  {new Date(order.createdAt).toLocaleString()} · via <span style={{ fontWeight: 600, color: CHANNEL_COLORS[channelKey] || CHANNEL_COLORS.direct }}>{CHANNEL_LABELS[channelKey] || channelKey}</span>
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
                {order.customer.phone && (
                  <div style={{ fontSize: 12, color: "var(--color-fg-3)", marginTop: 4 }}>{order.customer.phone}</div>
                )}
              </div>

              <div>
                <div className="drawer-section-label">Order Details</div>
                <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Brand:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{order.brand || 'N/A'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon d={ic.card} size={11} color="var(--color-fg-3)" />Payment:
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{order.paymentMethod || '—'}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Units:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{totalUnits}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Support:</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {activeSupport.length > 0 ? `${activeSupport.length} active` : order.supportEscalations?.length ? 'resolved' : 'clear'}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Total Amount:</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>₺{order.totalAmount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {order.supportEscalations && order.supportEscalations.length > 0 && (
                <div>
                  <div className="drawer-section-label">Support State</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {order.supportEscalations.slice(0, 3).map((support) => {
                      const active = ACTIVE_SUPPORT_STATUSES.has(support.status);
                      return (
                        <div key={support.id} className="support-state-row">
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-fg-1)" }}>
                              Case #{support.id} · {support.reason}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-fg-3)", marginTop: 2 }} suppressHydrationWarning>
                              Updated {new Date(support.updatedAt).toLocaleString()}
                            </div>
                          </div>
                          <span className={`support-state-chip${active ? ' active' : ''}`}>{support.status}</span>
                        </div>
                      );
                    })}
                    {order.supportEscalations.length > 3 && (
                      <div style={{ fontSize: 11, color: "var(--color-fg-3)" }}>
                        +{order.supportEscalations.length - 3} older support case{order.supportEscalations.length - 3 === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {order.orderItems && order.orderItems.length > 0 && (
                <div>
                  <div className="drawer-section-label">Items</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {order.orderItems.map((item) => (
                      <div key={item.id} className="order-item-row">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.product?.name || item.product?.style || `Product`}
                          </div>
                          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                            {item.size && <span className="var-chip">Size {item.size}</span>}
                            {item.color && <span className="var-chip">{item.color}</span>}
                            <span className="var-chip">×{item.quantity}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                          ₺{(item.price * item.quantity).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="drawer-section-label">Order Timeline</div>
                <div className="timeline">
                  {STATUS_STEPS.map((step, i) => {
                    const state = isCancelled ? "future" : i < stepIdx ? "done" : i === stepIdx ? "current" : "future";
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

              {error && (
                <div className="drawer-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="drawer-actions">
              {primaryAction && (
                <button
                  className={`btn ${primaryAction.variant === 'success' ? 'btn-success' : 'btn-primary'}`}
                  style={{ justifyContent: "center", fontSize: 12 }}
                  disabled={isPending}
                  onClick={() => runAction(primaryAction.run)}
                >
                  {primaryAction.iconPath && <Icon d={primaryAction.iconPath} size={12} />}
                  {isPending ? 'Updating…' : primaryAction.label}
                </button>
              )}
              <div style={{ display: "grid", gridTemplateColumns: showCancel ? "1fr 1fr" : "1fr", gap: 8 }}>
                <button className="btn btn-secondary" style={{ justifyContent: "center", fontSize: 12 }}>
                  <Icon d={ic.message2} size={12} />Contact
                </button>
                {showCancel && (
                  <button
                    className="btn btn-danger"
                    style={{ justifyContent: "center", fontSize: 12 }}
                    onClick={handleCancel}
                    disabled={isPending}
                  >
                    <Icon d={ic.ban} size={12} />Cancel Order
                  </button>
                )}
              </div>
              {!canUpdate && (
                <div className="drawer-error" role="note">
                  Your role can view this order but cannot change its lifecycle.
                </div>
              )}
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

export function OrderRowQuickActions({ orderId, status }: { orderId: number, status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const action = getPrimaryAction(status);
  const showCancel = canCancel(status);

  if (!action && !showCancel) return null;

  const runRowAction = (nextAction: (id: number) => Promise<OrderActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await nextAction(orderId);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handlePrimaryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (action) runRowAction(action.run);
  };

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = window.confirm(`Cancel order #${orderId}? This will release reserved stock.`);
    if (ok) runRowAction(cancelOrder);
  };

  return (
    <div className="row-actions" title={error || undefined} data-error={error ? 'true' : undefined}>
      {action && (
        <button
          className="row-action-btn"
          onClick={handlePrimaryClick}
          disabled={isPending}
          title={action.label}
        >
          {isPending ? '...' : action.shortLabel}
        </button>
      )}
      {showCancel && (
        <button
          className="row-action-btn row-action-danger"
          onClick={handleCancelClick}
          disabled={isPending}
          title="Cancel order"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
