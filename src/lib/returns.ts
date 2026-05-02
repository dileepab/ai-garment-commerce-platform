// Pure helpers for the returns and exchanges workflow:
//   - canonical statuses
//   - allowed transitions (with type-awareness where needed)
//   - which transitions notify the customer
//   - which transitions release reserved stock back to inventory
//
// Side-effecting code lives in src/lib/returns-service.ts.

export type ReturnRequestType = 'return' | 'exchange';

export type ReturnRequestStatus =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'item_received'
  | 'replacement_processing'
  | 'completed';

export type ReturnRequestAction =
  | 'review'
  | 'approve'
  | 'reject'
  | 'mark_item_received'
  | 'start_replacement'
  | 'complete';

export const RETURN_REQUEST_STATUSES: readonly ReturnRequestStatus[] = [
  'requested',
  'under_review',
  'approved',
  'rejected',
  'item_received',
  'replacement_processing',
  'completed',
];

export const RETURN_REQUEST_TYPES: readonly ReturnRequestType[] = ['return', 'exchange'];

export function isReturnRequestStatus(value: unknown): value is ReturnRequestStatus {
  return (
    typeof value === 'string' &&
    (RETURN_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function isReturnRequestType(value: unknown): value is ReturnRequestType {
  return (
    typeof value === 'string' &&
    (RETURN_REQUEST_TYPES as readonly string[]).includes(value)
  );
}

const TERMINAL_STATUSES: ReadonlySet<ReturnRequestStatus> = new Set([
  'rejected',
  'completed',
]);

export function isTerminalReturnStatus(status: ReturnRequestStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Allowed transitions, independent of type. Type-dependent paths are:
// item_received -> completed (returns) vs item_received -> replacement_processing (exchanges).
// Both are listed here; the service layer enforces type-awareness for those specific moves.
const RETURN_TRANSITIONS: Readonly<
  Record<ReturnRequestStatus, ReadonlyArray<ReturnRequestStatus>>
> = {
  requested: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['item_received'],
  rejected: [],
  item_received: ['replacement_processing', 'completed'],
  replacement_processing: ['completed'],
  completed: [],
};

export function canTransitionReturn(from: ReturnRequestStatus, to: ReturnRequestStatus): boolean {
  if (from === to) return false;
  return RETURN_TRANSITIONS[from].includes(to);
}

export function getReturnTransitionError(
  from: ReturnRequestStatus,
  to: ReturnRequestStatus,
): string | null {
  if (from === to) return `Request is already ${from}.`;
  if (!RETURN_TRANSITIONS[from].includes(to)) {
    return `Cannot move from ${from} to ${to}.`;
  }
  return null;
}

export function getValidNextStatuses(
  status: ReturnRequestStatus,
  type: ReturnRequestType,
): ReturnRequestStatus[] {
  const all = [...RETURN_TRANSITIONS[status]];
  if (status === 'item_received') {
    return type === 'exchange' ? ['replacement_processing'] : ['completed'];
  }
  return all;
}

// Transitions that should send the customer a notification.
const NOTIFIABLE_RETURN_STATUSES: ReadonlySet<ReturnRequestStatus> = new Set([
  'approved',
  'rejected',
  'completed',
]);

export function shouldNotifyCustomerForReturnTransition(
  to: ReturnRequestStatus,
): boolean {
  return NOTIFIABLE_RETURN_STATUSES.has(to);
}

// Stock is released back to inventory when the item has been physically received.
export function returnTransitionReconciliesStock(to: ReturnRequestStatus): boolean {
  return to === 'item_received';
}

const STATUS_LABELS: Record<ReturnRequestStatus, string> = {
  requested: 'Requested',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  item_received: 'Item received',
  replacement_processing: 'Replacement processing',
  completed: 'Completed',
};

export function getReturnStatusLabel(status: ReturnRequestStatus | string): string {
  return STATUS_LABELS[status as ReturnRequestStatus] ?? status;
}

const TYPE_LABELS: Record<ReturnRequestType, string> = {
  return: 'Return',
  exchange: 'Exchange',
};

export function getReturnTypeLabel(type: ReturnRequestType | string): string {
  return TYPE_LABELS[type as ReturnRequestType] ?? type;
}

export interface ReturnNotificationContext {
  orderId: number;
  type: ReturnRequestType;
  reason?: string | null;
  adminNote?: string | null;
  replacementOrderId?: number | null;
}

export function buildReturnCustomerNotification(
  toStatus: ReturnRequestStatus,
  ctx: ReturnNotificationContext,
): string | null {
  const orderRef = `#${ctx.orderId}`;
  const typeLabel = ctx.type === 'exchange' ? 'exchange' : 'return';

  switch (toStatus) {
    case 'approved':
      return `Your ${typeLabel} request for order ${orderRef} has been approved. Please send the item back and we will process it as soon as we receive it.`;
    case 'rejected': {
      const note = ctx.adminNote?.trim();
      const tail = note ? ` ${note}` : ' Please contact us if you have questions.';
      return `We were unable to approve your ${typeLabel} request for order ${orderRef}.${tail}`;
    }
    case 'completed':
      if (ctx.type === 'exchange') {
        const replacementRef = ctx.replacementOrderId ? ` (order #${ctx.replacementOrderId})` : '';
        return `Your exchange for order ${orderRef} is complete. Your replacement${replacementRef} has been processed. Thank you for your patience.`;
      }
      return `Your return for order ${orderRef} is complete. Thank you for your patience.`;
    default:
      return null;
  }
}

export interface ReturnActionDescriptor {
  action: ReturnRequestAction;
  toStatus: ReturnRequestStatus;
  label: string;
  shortLabel: string;
  variant: 'primary' | 'secondary' | 'success' | 'danger';
  requiresNote?: boolean;
  requiresTracking?: boolean;
  destructive?: boolean;
}

// Actions per status, shown in the admin UI.
export function getActionsForReturnStatus(
  status: ReturnRequestStatus,
  type: ReturnRequestType,
): ReturnActionDescriptor[] {
  switch (status) {
    case 'requested':
      return [
        { action: 'review', toStatus: 'under_review', label: 'Mark Under Review', shortLabel: 'Review', variant: 'secondary' },
        { action: 'approve', toStatus: 'approved', label: 'Approve', shortLabel: 'Approve', variant: 'success' },
        { action: 'reject', toStatus: 'rejected', label: 'Reject', shortLabel: 'Reject', variant: 'danger', requiresNote: true, destructive: true },
      ];
    case 'under_review':
      return [
        { action: 'approve', toStatus: 'approved', label: 'Approve', shortLabel: 'Approve', variant: 'success' },
        { action: 'reject', toStatus: 'rejected', label: 'Reject', shortLabel: 'Reject', variant: 'danger', requiresNote: true, destructive: true },
      ];
    case 'approved':
      return [
        { action: 'mark_item_received', toStatus: 'item_received', label: 'Mark Item Received', shortLabel: 'Item Received', variant: 'primary' },
      ];
    case 'item_received':
      if (type === 'exchange') {
        return [
          { action: 'start_replacement', toStatus: 'replacement_processing', label: 'Start Replacement', shortLabel: 'Start', variant: 'primary' },
        ];
      }
      return [
        { action: 'complete', toStatus: 'completed', label: 'Complete Return', shortLabel: 'Complete', variant: 'success' },
      ];
    case 'replacement_processing':
      return [
        { action: 'complete', toStatus: 'completed', label: 'Complete Exchange', shortLabel: 'Complete', variant: 'success' },
      ];
    case 'rejected':
    case 'completed':
      return [];
  }
}
