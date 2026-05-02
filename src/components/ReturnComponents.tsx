'use client';

import React, { useState, useTransition } from 'react';
import {
  updateReturnStatusAction,
  markItemReceivedAction,
  completeReturnRequestAction,
  createReturnRequestAction,
  type ReturnActionResult,
} from '@/app/returns/actions';
import {
  getActionsForReturnStatus,
  getReturnStatusLabel,
  getReturnTypeLabel,
  type ReturnRequestStatus,
  type ReturnRequestType,
  type ReturnActionDescriptor,
} from '@/lib/returns';

export interface SerializedReturnRequest {
  id: number;
  orderId: number;
  type: string;
  reason: string;
  status: string;
  requestedBy: string;
  adminNote: string | null;
  stockReconciled: boolean;
  replacementOrderId: number | null;
  brand: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer: {
    id: number;
    name: string;
    phone: string | null;
    channel: string | null;
  } | null;
  order: {
    id: number;
    orderStatus: string;
    totalAmount: number;
    deliveryAddress: string | null;
    brand: string | null;
    orderItems: {
      id: number;
      quantity: number;
      product: { name: string; style: string } | null;
    }[];
  };
  replacementOrder: { id: number; orderStatus: string } | null;
}

const Icon = ({ d, size = 14 }: { d: string | string[]; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ic = {
  x: ['M18 6L6 18', 'M6 6l12 12'],
  check: 'M20 6L9 17l-5-5',
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
};

const STATUS_COLORS: Record<string, string> = {
  requested: '#E8C840',
  under_review: '#4A7AA8',
  approved: '#38A169',
  rejected: '#C04A4A',
  item_received: '#8B5CF6',
  replacement_processing: '#DD6B20',
  completed: '#1E6B45',
};

function runReturnAction(
  descriptor: ReturnActionDescriptor,
  requestId: number,
  note: string,
): Promise<ReturnActionResult> {
  switch (descriptor.toStatus) {
    case 'item_received':
      return markItemReceivedAction(requestId, note || undefined);
    case 'completed':
      return completeReturnRequestAction(requestId, note || undefined);
    default:
      return updateReturnStatusAction(requestId, descriptor.toStatus, note || undefined);
  }
}

export function ReturnRequestDrawer({
  request,
  onClose,
  canManage = true,
}: {
  request: SerializedReturnRequest | null;
  onClose: () => void;
  canManage?: boolean;
}) {
  const open = !!request;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingAction, setPendingAction] = useState<ReturnActionDescriptor | null>(null);

  React.useEffect(() => {
    setError(null);
    setNoteDraft('');
    setPendingAction(null);
  }, [request?.id]);

  const status = (request?.status ?? 'requested') as ReturnRequestStatus;
  const type = (request?.type ?? 'return') as ReturnRequestType;
  const actions = canManage && request ? getActionsForReturnStatus(status, type) : [];

  const handleAction = (descriptor: ReturnActionDescriptor) => {
    if (descriptor.requiresNote && !pendingAction) {
      setPendingAction(descriptor);
      return;
    }
    if (descriptor.destructive) {
      const ok = window.confirm(
        `${descriptor.label} return request #${request?.id}? This cannot be undone.`,
      );
      if (!ok) return;
    }

    if (!request) return;
    setError(null);
    startTransition(async () => {
      const result = await runReturnAction(descriptor, request.id, noteDraft);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      setPendingAction(null);
      setNoteDraft('');
      onClose();
    });
  };

  const submitPendingAction = () => {
    if (!pendingAction || !request) return;
    setError(null);
    startTransition(async () => {
      const result = await runReturnAction(pendingAction, request.id, noteDraft);
      if (!result.success && result.error) {
        setError(result.error);
        return;
      }
      setPendingAction(null);
      setNoteDraft('');
      onClose();
    });
  };

  return (
    <>
      <div className={`drawer-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`drawer${open ? ' open' : ''}`}>
        {request && (
          <>
            <div className="drawer-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--color-fg-1)' }}>
                    #{request.id}
                  </code>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: (STATUS_COLORS[request.status] ?? '#888') + '22',
                      color: STATUS_COLORS[request.status] ?? '#888',
                    }}
                  >
                    {getReturnStatusLabel(request.status)}
                  </span>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: 'var(--color-bg)',
                      color: 'var(--color-fg-2)',
                    }}
                  >
                    {getReturnTypeLabel(request.type)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-fg-3)' }} suppressHydrationWarning>
                  Created {new Date(request.createdAt).toLocaleString()} · Order{' '}
                  <code style={{ fontSize: 11 }}>ORD-{request.orderId}</code>
                </div>
              </div>
              <button className="drawer-close" onClick={onClose}>
                <Icon d={ic.x} size={13} />
              </button>
            </div>

            <div className="drawer-body">
              {/* Customer */}
              <div>
                <div className="drawer-section-label">Customer</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                  {request.customer?.name ?? '—'}
                </div>
                {request.customer?.phone && (
                  <div style={{ fontSize: 12, color: 'var(--color-fg-3)' }}>{request.customer.phone}</div>
                )}
                {request.order.deliveryAddress && (
                  <div style={{ fontSize: 12, color: 'var(--color-fg-3)', marginTop: 2 }}>
                    {request.order.deliveryAddress}
                  </div>
                )}
              </div>

              {/* Reason */}
              <div>
                <div className="drawer-section-label">Reason</div>
                <div
                  style={{
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    fontSize: 13,
                    color: 'var(--color-fg-1)',
                  }}
                >
                  {request.reason}
                </div>
              </div>

              {/* Admin note */}
              {request.adminNote && (
                <div>
                  <div className="drawer-section-label">Admin Note</div>
                  <div
                    style={{
                      background: 'var(--color-bg)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      fontSize: 13,
                      color: 'var(--color-fg-2)',
                    }}
                  >
                    {request.adminNote}
                  </div>
                </div>
              )}

              {/* Order items */}
              {request.order.orderItems.length > 0 && (
                <div>
                  <div className="drawer-section-label">Original Order Items</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {request.order.orderItems.map((item) => (
                      <div key={item.id} className="order-item-row">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {item.product?.name ?? item.product?.style ?? 'Product'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 2 }}>
                            ×{item.quantity}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stock */}
              <div>
                <div className="drawer-section-label">Stock Reconciliation</div>
                <div
                  style={{
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    fontSize: 13,
                  }}
                >
                  {request.stockReconciled ? (
                    <span style={{ color: '#38A169', fontWeight: 600 }}>
                      <Icon d={ic.check} size={12} /> Stock returned to inventory
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-fg-3)' }}>
                      Pending — stock will be reconciled when the item is marked as received.
                    </span>
                  )}
                </div>
              </div>

              {/* Replacement order */}
              {request.replacementOrder && (
                <div>
                  <div className="drawer-section-label">Replacement Order</div>
                  <div
                    style={{
                      background: 'var(--color-bg)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      fontSize: 13,
                    }}
                  >
                    <code>ORD-{request.replacementOrder.id}</code>{' '}
                    <span style={{ color: 'var(--color-fg-3)' }}>({request.replacementOrder.orderStatus})</span>
                  </div>
                </div>
              )}

              {/* Pending action form */}
              {pendingAction && (
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
                  <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600 }}>
                    Note for customer (optional)
                  </label>
                  <input
                    autoFocus
                    type="text"
                    className="search-input"
                    placeholder={
                      pendingAction.toStatus === 'rejected'
                        ? 'e.g. outside return window, item worn'
                        : 'Internal or customer-facing note'
                    }
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => { setPendingAction(null); setNoteDraft(''); }}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className={`btn btn-${pendingAction.variant === 'danger' ? 'danger' : 'primary'}`}
                      style={{ fontSize: 12 }}
                      onClick={submitPendingAction}
                      disabled={isPending}
                      type="button"
                    >
                      {isPending ? 'Saving…' : `Confirm ${pendingAction.shortLabel}`}
                    </button>
                  </div>
                </div>
              )}

              {/* Note input for non-requiring actions */}
              {!pendingAction && canManage && actions.length > 0 && (
                <div>
                  <div className="drawer-section-label">Internal note (optional)</div>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Saved to the audit trail"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                </div>
              )}

              {error && (
                <div className="drawer-error" role="alert">
                  {error}
                </div>
              )}
            </div>

            <div className="drawer-actions">
              {actions.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-fg-3)', textAlign: 'center' }}>
                  No further actions available.
                </div>
              )}
              {actions.map((descriptor) => {
                const buttonClass =
                  descriptor.variant === 'success'
                    ? 'btn btn-success'
                    : descriptor.variant === 'danger'
                      ? 'btn btn-danger'
                      : descriptor.variant === 'secondary'
                        ? 'btn btn-secondary'
                        : 'btn btn-primary';

                return (
                  <button
                    key={descriptor.action}
                    className={buttonClass}
                    style={{ justifyContent: 'center', fontSize: 12 }}
                    disabled={isPending}
                    onClick={() => handleAction(descriptor)}
                    type="button"
                  >
                    {isPending && pendingAction?.action === descriptor.action ? 'Saving…' : descriptor.label}
                  </button>
                );
              })}
              {!canManage && (
                <div className="drawer-error" role="note">
                  Your role can view but cannot update return requests.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function CreateReturnRequestForm({
  orderId,
  onSuccess,
  onCancel,
}: {
  orderId: number;
  onSuccess: (returnRequestId: number) => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createReturnRequestAction(orderId, type, reason, adminNote || undefined);
      if (!result.success) {
        setError(result.error ?? 'Failed to create request.');
        return;
      }
      onSuccess(result.returnRequestId!);
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Request type
        </label>
        <select
          className="search-input"
          value={type}
          onChange={(e) => setType(e.target.value as 'return' | 'exchange')}
          style={{ width: '100%' }}
        >
          <option value="return">Return</option>
          <option value="exchange">Exchange</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Reason <span style={{ color: 'var(--color-error)' }}>*</span>
        </label>
        <input
          autoFocus
          type="text"
          className="search-input"
          placeholder="e.g. wrong size, damaged item, changed mind"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%' }}
          required
        />
      </div>
      <div>
        <label style={{ fontSize: 11, color: 'var(--color-fg-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Admin note (optional)
        </label>
        <input
          type="text"
          className="search-input"
          placeholder="Internal notes for the team"
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      {error && (
        <div className="drawer-error" role="alert">{error}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={isPending} type="submit">
          {isPending ? 'Creating…' : 'Create Request'}
        </button>
      </div>
    </form>
  );
}
