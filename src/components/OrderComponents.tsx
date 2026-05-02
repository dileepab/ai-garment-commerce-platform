'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  dispatchOrder,
  markPacked,
  markPacking,
  markReturned,
  reportDeliveryFailure,
  retryDispatch,
  type OrderActionResult,
} from '@/app/orders/actions';
import {
  getActionsForStatus,
  getFulfillmentLabel,
  normalizeFulfillmentStatus,
  type FulfillmentAction,
} from '@/lib/fulfillment';
import { getReturnStatusLabel, getReturnTypeLabel } from '@/lib/returns';
import { CreateReturnRequestForm } from '@/components/ReturnComponents';

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
  alert: ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z", "M12 9v4", "M12 17h.01"],
  rotate: ["M1 4v6h6", "M3.51 15a9 9 0 102.13-9.36L1 10"],
  arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
};

const TIMELINE_STEPS = ["pending", "confirmed", "packing", "packed", "dispatched", "delivered"] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  packing: "Packing",
  packed: "Packed",
  shipped: "Dispatched",
  dispatched: "Dispatched",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
  returned: "Returned",
  cancelled: "Cancelled",
};

const ACTION_ICON: Record<FulfillmentAction, string | string[]> = {
  confirm: ic.check,
  mark_packing: ic.box,
  mark_packed: ic.box,
  dispatch: ic.truck,
  mark_delivered: ic.check,
  mark_delivery_failed: ic.alert,
  retry_dispatch: ic.rotate,
  mark_returned: ic.arrowLeft,
  cancel: ic.ban,
};

interface ActionDispatchInput {
  trackingNumber?: string;
  courier?: string;
  reason?: string;
  note?: string;
}

function runFulfillmentAction(
  action: FulfillmentAction,
  orderId: number,
  input: ActionDispatchInput,
): Promise<OrderActionResult> {
  switch (action) {
    case 'confirm':
      return confirmOrder(orderId);
    case 'mark_packing':
      return markPacking(orderId);
    case 'mark_packed':
      return markPacked(orderId, input.note);
    case 'dispatch':
      return dispatchOrder(orderId, {
        trackingNumber: input.trackingNumber,
        courier: input.courier,
        note: input.note,
      });
    case 'mark_delivered':
      return deliverOrder(orderId);
    case 'mark_delivery_failed':
      return reportDeliveryFailure(orderId, {
        reason: input.reason ?? '',
        note: input.note,
      });
    case 'retry_dispatch':
      return retryDispatch(orderId, {
        trackingNumber: input.trackingNumber,
        courier: input.courier,
        note: input.note,
      });
    case 'mark_returned':
      return markReturned(orderId, {
        reason: input.reason ?? '',
        note: input.note,
      });
    case 'cancel':
      return cancelOrder(orderId);
  }
}

const CHANNEL_COLORS: Record<string, string> = { messenger: "#0866FF", instagram: "#C13584", direct: "#6A635A", whatsapp: "#128C7E" };
const CHANNEL_LABELS: Record<string, string> = { messenger: "Messenger", instagram: "Instagram", direct: "Direct", whatsapp: "WhatsApp" };
const ACTIVE_SUPPORT_STATUSES = new Set(["escalated", "open", "pending", "in_progress"]);

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

export interface OrderFulfillmentEventLike {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  trackingNumber: string | null;
  courier: string | null;
  actorEmail: string | null;
  actorName: string | null;
  customerNotified: boolean;
  createdAt: string;
}

export interface OrderReturnRequestLike {
  id: number;
  type: string;
  status: string;
  reason: string;
  stockReconciled: boolean;
  replacementOrderId: number | null;
  createdAt: string;
  updatedAt: string;
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
  trackingNumber?: string | null;
  courier?: string | null;
  failureReason?: string | null;
  returnReason?: string | null;
  orderItems?: OrderDrawerOrderItem[];
  supportEscalations?: {
    id: number;
    status: string;
    reason: string;
    updatedAt: string;
  }[];
  fulfillmentEvents?: OrderFulfillmentEventLike[];
  returnRequests?: OrderReturnRequestLike[];
}

export interface OrderPipelineStats {
  pending: number;
  confirmed: number;
  packing: number;
  shipped: number;
  delivered: number;
  deliveryFailed: number;
  returned: number;
}

export function OrderDrawer({
  order,
  onClose,
  canUpdate = true,
  initialAction = null,
}: {
  order: OrderDrawerOrder | null;
  onClose: () => void;
  canUpdate?: boolean;
  // When the parent opens the drawer specifically to fill a form (e.g. a row
  // click on "Dispatch"), pass that action here and the drawer will pre-open
  // the matching input panel.
  initialAction?: FulfillmentAction | null;
}) {
  const router = useRouter();
  const open = !!order;
  const status = order?.orderStatus || 'pending';
  const normalized = normalizeFulfillmentStatus(status);
  const isCancelled = normalized === 'cancelled';
  const channelKey = order?.channel || order?.customer.channel || 'direct';
  const stepIdx = TIMELINE_STEPS.indexOf(normalized as typeof TIMELINE_STEPS[number]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingActionForm, setPendingActionForm] = useState<FulfillmentAction | null>(initialAction);
  const [trackingDraft, setTrackingDraft] = useState(order?.trackingNumber ?? '');
  const [courierDraft, setCourierDraft] = useState(order?.courier ?? '');
  const [reasonDraft, setReasonDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [showCreateReturn, setShowCreateReturn] = useState(false);

  React.useEffect(() => {
    setTrackingDraft(order?.trackingNumber ?? '');
    setCourierDraft(order?.courier ?? '');
    setReasonDraft('');
    setNoteDraft('');
    setPendingActionForm(initialAction);
    setShowCreateReturn(false);
    setError(null);
  }, [order?.id, order?.trackingNumber, order?.courier, initialAction]);

  const actions = canUpdate && order ? getActionsForStatus(status) : [];
  const activeSupport = order?.supportEscalations?.filter((support) => ACTIVE_SUPPORT_STATUSES.has(support.status)) || [];

  const runAction = (action: FulfillmentAction, input: ActionDispatchInput = {}) => {
    if (!order) return;
    setError(null);
    startTransition(async () => {
      const result = await runFulfillmentAction(action, order.id, input);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      setPendingActionForm(null);
      setReasonDraft('');
      setNoteDraft('');
      router.refresh();
    });
  };

  const submitPendingForm = (action: FulfillmentAction) => {
    runAction(action, {
      trackingNumber: trackingDraft || undefined,
      courier: courierDraft || undefined,
      reason: reasonDraft || undefined,
      note: noteDraft || undefined,
    });
  };

  const handleActionClick = (action: FulfillmentAction, requiresInput: boolean) => {
    if (action === 'cancel') {
      const ok = window.confirm(`Cancel order #${order?.id}? This will release reserved stock.`);
      if (ok) runAction('cancel');
      return;
    }

    if (requiresInput) {
      // If the form for this action is already open, treat the bottom button
      // as a submit so admins don't have to hunt for the in-form save.
      if (pendingActionForm === action) {
        submitPendingForm(action);
      } else {
        setPendingActionForm(action);
      }
      return;
    }

    runAction(action);
  };

  const totalUnits = order?.orderItems?.reduce((acc, i) => acc + i.quantity, 0) ?? 0;

  const sortedEvents = useMemo(() => {
    return [...(order?.fulfillmentEvents ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [order?.fulfillmentEvents]);

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
                  <span className={`pill pill-${normalized}`}>{STATUS_LABELS[status] || STATUS_LABELS[normalized] || normalized}</span>
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

              {(order.trackingNumber || order.courier || order.failureReason || order.returnReason) && (
                <div>
                  <div className="drawer-section-label">Shipment</div>
                  <div style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {order.courier && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Courier</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{order.courier}</span>
                      </div>
                    )}
                    {order.trackingNumber && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Tracking</span>
                        <code style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{order.trackingNumber}</code>
                      </div>
                    )}
                    {order.failureReason && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Failure</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#8B2020", textAlign: "right" }}>{order.failureReason}</span>
                      </div>
                    )}
                    {order.returnReason && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--color-fg-2)" }}>Return reason</span>
                        <span style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>{order.returnReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

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

              {order.returnRequests && order.returnRequests.length > 0 && (
                <div>
                  <div className="drawer-section-label">Return / Exchange Requests</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {order.returnRequests.map((rr) => (
                      <div key={rr.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>
                            #{rr.id} · {getReturnTypeLabel(rr.type)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-fg-3)' }}>
                            {getReturnStatusLabel(rr.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-fg-2)' }}>{rr.reason}</div>
                        {rr.stockReconciled && (
                          <div style={{ fontSize: 11, color: '#38A169', marginTop: 4 }}>Stock reconciled</div>
                        )}
                        {rr.replacementOrderId && (
                          <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 2 }}>
                            Replacement: ORD-{rr.replacementOrderId}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canUpdate && !showCreateReturn && normalized === 'delivered' && (
                <div>
                  <button
                    className="btn btn-secondary"
                    style={{ justifyContent: 'center', fontSize: 12, width: '100%' }}
                    onClick={() => setShowCreateReturn(true)}
                    type="button"
                  >
                    <Icon d={ic.arrowLeft} size={12} />
                    Create Return / Exchange Request
                  </button>
                </div>
              )}

              {showCreateReturn && order && (
                <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                  <div className="drawer-section-label" style={{ marginBottom: 8 }}>New Return / Exchange</div>
                  <CreateReturnRequestForm
                    orderId={order.id}
                    onSuccess={() => {
                      setShowCreateReturn(false);
                      router.refresh();
                    }}
                    onCancel={() => setShowCreateReturn(false)}
                  />
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
                  {TIMELINE_STEPS.map((step, i) => {
                    const state = isCancelled || normalized === 'returned'
                      ? 'future'
                      : i < stepIdx
                        ? 'done'
                        : i === stepIdx
                          ? 'current'
                          : 'future';
                    return (
                      <div key={step} className="tl-step">
                        <div className={`tl-dot ${state}`}>
                          {(state === 'done' || state === 'current') && <Icon d={ic.check} size={11} color="white" strokeWidth={2.5} />}
                        </div>
                        <div className="tl-label">
                          <div className="tl-label-title" style={{ color: state === 'future' ? 'var(--color-fg-3)' : 'var(--color-fg-1)' }}>{getFulfillmentLabel(step)}</div>
                          <div className="tl-label-sub">{state !== 'future' ? 'Updated' : '—'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {sortedEvents.length > 0 && (
                <div>
                  <div className="drawer-section-label">History</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sortedEvents.map((event) => (
                      <li
                        key={event.id}
                        style={{
                          background: 'var(--color-bg)',
                          borderRadius: 'var(--radius-md)',
                          padding: '8px 12px',
                          fontSize: 12,
                          color: 'var(--color-fg-2)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <strong style={{ color: 'var(--color-fg-1)' }}>
                            {event.fromStatus ? `${getFulfillmentLabel(event.fromStatus)} → ` : ''}
                            {getFulfillmentLabel(event.toStatus)}
                          </strong>
                          <span style={{ fontSize: 11, color: 'var(--color-fg-3)' }} suppressHydrationWarning>
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {event.actorName || event.actorEmail ? (
                            <span>By {event.actorName || event.actorEmail}</span>
                          ) : null}
                          {event.courier ? <span>Courier: {event.courier}</span> : null}
                          {event.trackingNumber ? <span>Tracking: {event.trackingNumber}</span> : null}
                          {event.customerNotified ? <span style={{ color: 'var(--color-fg-3)' }}>· customer notified</span> : null}
                        </div>
                        {event.note && (
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-fg-2)' }}>{event.note}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="drawer-error" role="alert">
                  {error}
                </div>
              )}

              {pendingActionForm && (
                <FulfillmentActionForm
                  action={pendingActionForm}
                  trackingDraft={trackingDraft}
                  courierDraft={courierDraft}
                  reasonDraft={reasonDraft}
                  noteDraft={noteDraft}
                  onTrackingChange={setTrackingDraft}
                  onCourierChange={setCourierDraft}
                  onReasonChange={setReasonDraft}
                  onNoteChange={setNoteDraft}
                  onCancel={() => setPendingActionForm(null)}
                />
              )}
            </div>
            <div className="drawer-actions">
              {actions.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-fg-3)', textAlign: 'center' }}>
                  No further fulfillment actions available for this order.
                </div>
              )}
              {actions.map((descriptor) => {
                const requiresInput = Boolean(descriptor.requiresTracking || descriptor.requiresReason);
                const isThisFormOpen = pendingActionForm === descriptor.action;
                const reasonMissing =
                  descriptor.requiresReason && isThisFormOpen && !reasonDraft.trim();
                const buttonClass =
                  descriptor.variant === 'success'
                    ? 'btn btn-success'
                    : descriptor.variant === 'danger'
                      ? 'btn btn-danger'
                      : descriptor.variant === 'secondary'
                        ? 'btn btn-secondary'
                        : 'btn btn-primary';
                const submitLabel = `Save & ${descriptor.shortLabel}`;
                return (
                  <button
                    key={descriptor.action}
                    className={buttonClass}
                    style={{ justifyContent: 'center', fontSize: 12 }}
                    disabled={isPending || reasonMissing}
                    title={reasonMissing ? 'Enter a reason in the form above to enable this action.' : undefined}
                    onClick={() => handleActionClick(descriptor.action, requiresInput)}
                  >
                    {ACTION_ICON[descriptor.action] && <Icon d={ACTION_ICON[descriptor.action]} size={12} />}
                    {isPending && isThisFormOpen
                      ? 'Saving…'
                      : isThisFormOpen
                        ? submitLabel
                        : descriptor.label}
                  </button>
                );
              })}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <button className="btn btn-secondary" style={{ justifyContent: 'center', fontSize: 12 }}>
                  <Icon d={ic.message2} size={12} />Contact
                </button>
              </div>
              {!canUpdate && (
                <div className="drawer-error" role="note">
                  Your role can view this order but cannot change its lifecycle.
                </div>
              )}
              <button className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: 12, color: 'var(--color-fg-3)' }}>
                <Icon d={ic.printer} size={12} />Print Invoice
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function FulfillmentActionForm({
  action,
  trackingDraft,
  courierDraft,
  reasonDraft,
  noteDraft,
  onTrackingChange,
  onCourierChange,
  onReasonChange,
  onNoteChange,
  onCancel,
}: {
  action: FulfillmentAction;
  trackingDraft: string;
  courierDraft: string;
  reasonDraft: string;
  noteDraft: string;
  onTrackingChange: (value: string) => void;
  onCourierChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
}) {
  const showTracking = action === 'dispatch' || action === 'retry_dispatch';
  const showReason = action === 'mark_delivery_failed' || action === 'mark_returned';
  const reasonLabel = action === 'mark_delivery_failed' ? 'Failure reason' : 'Return reason';
  const reasonInputRef = React.useRef<HTMLInputElement>(null);
  const trackingInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (showReason) {
      reasonInputRef.current?.focus();
    } else if (showTracking) {
      trackingInputRef.current?.focus();
    }
  }, [action, showReason, showTracking]);

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-md)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {showTracking && (
        <>
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Courier</label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. Domex, Pronto, Fardar Express"
            value={courierDraft}
            onChange={(e) => onCourierChange(e.target.value)}
          />
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Tracking number</label>
          <input
            ref={trackingInputRef}
            type="text"
            className="search-input"
            placeholder="Enter courier tracking reference"
            value={trackingDraft}
            onChange={(e) => onTrackingChange(e.target.value)}
          />
        </>
      )}
      {showReason && (
        <>
          <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>
            {reasonLabel} <span style={{ color: 'var(--color-error)' }}>*</span>
          </label>
          <input
            ref={reasonInputRef}
            type="text"
            className="search-input"
            placeholder={action === 'mark_delivery_failed' ? 'e.g. recipient not available' : 'e.g. wrong size, damaged'}
            value={reasonDraft}
            onChange={(e) => onReasonChange(e.target.value)}
            required
          />
        </>
      )}
      <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>Internal note (optional)</label>
      <input
        type="text"
        className="search-input"
        placeholder="Notes saved to the audit trail"
        value={noteDraft}
        onChange={(e) => onNoteChange(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 11,
            color: showReason && !reasonDraft.trim() ? 'var(--color-error)' : 'var(--color-fg-3)',
            fontWeight: showReason && !reasonDraft.trim() ? 600 : 400,
          }}
        >
          {showReason && !reasonDraft.trim()
            ? `Enter a ${reasonLabel.toLowerCase()} to enable the action button below.`
            : 'Use the action button below to save and continue.'}
        </span>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel} type="button">
          Discard
        </button>
      </div>
    </div>
  );
}

export function OrderPipeline({ stats }: { stats: OrderPipelineStats }) {
  const pipeline = [
    { key: "pending", label: "Pending", color: "#E8C840", count: stats.pending },
    { key: "confirmed", label: "Confirmed", color: "#4A7AA8", count: stats.confirmed },
    { key: "packing", label: "Packing", color: "#8B5CF6", count: stats.packing },
    { key: "dispatched", label: "Dispatched", color: "#38A169", count: stats.shipped },
    { key: "delivered", label: "Delivered", color: "#1E6B45", count: stats.delivered },
    { key: "delivery_failed", label: "Failed", color: "#C04A4A", count: stats.deliveryFailed },
    { key: "returned", label: "Returned", color: "#A07050", count: stats.returned },
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

export function OrderRowQuickActions({
  orderId,
  status,
  onRequireForm,
}: {
  orderId: number;
  status: string;
  // Called for actions that need extra input (tracking, reason). The parent
  // opens the drawer for this order with the form pre-opened — keeping the
  // row useful even at stages whose only forward move is dispatch/return/fail.
  onRequireForm?: (orderId: number, action: FulfillmentAction) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = getActionsForStatus(status);

  if (actions.length === 0) return null;

  const runRowAction = (action: FulfillmentAction) => {
    setError(null);
    startTransition(async () => {
      const result = await runFulfillmentAction(action, orderId, {});
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleClick = (descriptor: typeof actions[number]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (descriptor.action === 'cancel') {
      const ok = window.confirm(`Cancel order #${orderId}? This will release reserved stock.`);
      if (ok) runRowAction(descriptor.action);
      return;
    }
    if (descriptor.requiresTracking || descriptor.requiresReason) {
      onRequireForm?.(orderId, descriptor.action);
      return;
    }
    runRowAction(descriptor.action);
  };

  return (
    <div className="row-actions" title={error || undefined} data-error={error ? 'true' : undefined}>
      {actions.map((descriptor) => (
        <button
          key={descriptor.action}
          className={descriptor.destructive ? 'row-action-btn row-action-danger' : 'row-action-btn'}
          onClick={handleClick(descriptor)}
          disabled={isPending}
          title={descriptor.label}
        >
          {isPending ? '...' : descriptor.shortLabel}
        </button>
      ))}
    </div>
  );
}
