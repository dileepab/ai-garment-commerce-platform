// Pure helpers describing the fulfillment workflow:
//   - canonical statuses
//   - allowed transitions
//   - which transitions notify the customer
//   - which transitions release reserved stock
//
// Side-effecting code (db writes, Messenger sends, audit logging) lives in
// `src/lib/fulfillment-service.ts` and the order server actions. Keeping the
// state machine pure makes it cheap to unit test the transitions, the
// notification policy, and the stock-release policy without a database.

export type FulfillmentStatus =
  | 'pending'
  | 'confirmed'
  | 'packing'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'delivery_failed'
  | 'returned'
  | 'cancelled';

export type FulfillmentAction =
  | 'confirm'
  | 'mark_packing'
  | 'mark_packed'
  | 'dispatch'
  | 'mark_delivered'
  | 'mark_delivery_failed'
  | 'retry_dispatch'
  | 'mark_returned'
  | 'cancel';

export const FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  'pending',
  'confirmed',
  'packing',
  'packed',
  'dispatched',
  'delivered',
  'delivery_failed',
  'returned',
  'cancelled',
];

const STATUS_ALIASES: Record<string, FulfillmentStatus> = {
  shipped: 'dispatched',
};

export function normalizeFulfillmentStatus(status?: string | null): FulfillmentStatus {
  const raw = status?.trim().toLowerCase() || 'pending';
  const aliased = STATUS_ALIASES[raw];
  if (aliased) return aliased;
  if ((FULFILLMENT_STATUSES as readonly string[]).includes(raw)) {
    return raw as FulfillmentStatus;
  }
  return 'pending';
}

export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === 'string' && (FULFILLMENT_STATUSES as readonly string[]).includes(value);
}

const TERMINAL_STATUSES: ReadonlySet<FulfillmentStatus> = new Set([
  'delivered',
  'returned',
  'cancelled',
]);

export function isTerminalFulfillmentStatus(status: FulfillmentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Allowed direct transitions. `shipped` is normalized to `dispatched`.
export const FULFILLMENT_TRANSITIONS: Readonly<
  Record<FulfillmentStatus, ReadonlyArray<FulfillmentStatus>>
> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packing', 'cancelled'],
  packing: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'delivery_failed'],
  delivered: ['returned'],
  delivery_failed: ['dispatched', 'returned', 'cancelled'],
  returned: [],
  cancelled: [],
};

export function canTransitionFulfillment(
  from: string | null | undefined,
  to: string,
): boolean {
  const normalizedFrom = normalizeFulfillmentStatus(from);
  const normalizedTo = normalizeFulfillmentStatus(to);
  if (normalizedFrom === normalizedTo) return false;
  return FULFILLMENT_TRANSITIONS[normalizedFrom].includes(normalizedTo);
}

export function getFulfillmentTransitionError(
  from: string | null | undefined,
  to: string,
): string | null {
  const normalizedFrom = normalizeFulfillmentStatus(from);
  const normalizedTo = normalizeFulfillmentStatus(to);
  if (normalizedFrom === normalizedTo) {
    return `Order is already ${normalizedFrom}.`;
  }
  if (!FULFILLMENT_TRANSITIONS[normalizedFrom].includes(normalizedTo)) {
    return `Cannot move from ${normalizedFrom} to ${normalizedTo}.`;
  }
  return null;
}

// Which fulfillment changes should notify the customer by default. Cancellation
// keeps its own messaging in `order-cancellation.ts` / order actions, so we
// don't double-notify here.
const NOTIFIABLE_TRANSITIONS: ReadonlySet<FulfillmentStatus> = new Set([
  'confirmed',
  'dispatched',
  'delivered',
  'delivery_failed',
  'returned',
]);

export function shouldNotifyCustomerForTransition(
  from: string | null | undefined,
  to: string,
): boolean {
  const normalizedTo = normalizeFulfillmentStatus(to);
  if (!NOTIFIABLE_TRANSITIONS.has(normalizedTo)) return false;
  return canTransitionFulfillment(from, to);
}

// Statuses where "stock left the building" — dispatched, delivered. We must
// only restore inventory if it had not already been restored (e.g. cancellation
// already releases reserved stock; we never want to release twice).
export function transitionRestoresStock(
  from: string | null | undefined,
  to: string,
): boolean {
  return normalizeFulfillmentStatus(to) === 'returned';
}

const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  packing: 'Packing',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export function getFulfillmentLabel(status?: string | null): string {
  return FULFILLMENT_LABELS[normalizeFulfillmentStatus(status)];
}

const FULFILLMENT_NOTES: Record<FulfillmentStatus, string> = {
  pending: 'Your order is waiting for confirmation.',
  confirmed: 'Your order is confirmed and queued for packing.',
  packing: 'Our team is preparing your order.',
  packed: 'Your parcel is packed and ready for the courier.',
  dispatched: 'Your parcel has been handed to the courier.',
  delivered: 'Your order has been marked as delivered.',
  delivery_failed:
    'The courier reported a delivery issue. We are reaching out to arrange the next attempt.',
  returned: 'Your order has been marked as returned.',
  cancelled: 'This order has been cancelled.',
};

export function getFulfillmentNote(status?: string | null): string {
  return FULFILLMENT_NOTES[normalizeFulfillmentStatus(status)];
}

export interface FulfillmentActionDescriptor {
  action: FulfillmentAction;
  toStatus: FulfillmentStatus;
  label: string;
  shortLabel: string;
  variant: 'primary' | 'secondary' | 'success' | 'danger';
  requiresReason?: boolean;
  requiresTracking?: boolean;
  destructive?: boolean;
}

const ACTIONS_FOR_STATUS: Record<FulfillmentStatus, FulfillmentActionDescriptor[]> = {
  pending: [
    {
      action: 'confirm',
      toStatus: 'confirmed',
      label: 'Confirm Order',
      shortLabel: 'Confirm',
      variant: 'primary',
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      label: 'Cancel Order',
      shortLabel: 'Cancel',
      variant: 'danger',
      destructive: true,
    },
  ],
  confirmed: [
    {
      action: 'mark_packing',
      toStatus: 'packing',
      label: 'Start Packing',
      shortLabel: 'Pack',
      variant: 'primary',
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      label: 'Cancel Order',
      shortLabel: 'Cancel',
      variant: 'danger',
      destructive: true,
    },
  ],
  packing: [
    {
      action: 'mark_packed',
      toStatus: 'packed',
      label: 'Mark Packed',
      shortLabel: 'Packed',
      variant: 'primary',
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      label: 'Cancel Order',
      shortLabel: 'Cancel',
      variant: 'danger',
      destructive: true,
    },
  ],
  packed: [
    {
      action: 'dispatch',
      toStatus: 'dispatched',
      label: 'Dispatch to Courier',
      shortLabel: 'Dispatch',
      variant: 'primary',
      requiresTracking: true,
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      label: 'Cancel Order',
      shortLabel: 'Cancel',
      variant: 'danger',
      destructive: true,
    },
  ],
  dispatched: [
    {
      action: 'mark_delivered',
      toStatus: 'delivered',
      label: 'Mark Delivered',
      shortLabel: 'Delivered',
      variant: 'success',
    },
    {
      action: 'mark_delivery_failed',
      toStatus: 'delivery_failed',
      label: 'Report Delivery Failure',
      shortLabel: 'Failed',
      variant: 'danger',
      requiresReason: true,
    },
  ],
  delivery_failed: [
    {
      action: 'retry_dispatch',
      toStatus: 'dispatched',
      label: 'Retry Dispatch',
      shortLabel: 'Retry',
      variant: 'primary',
    },
    {
      action: 'mark_returned',
      toStatus: 'returned',
      label: 'Mark Returned',
      shortLabel: 'Returned',
      variant: 'secondary',
      requiresReason: true,
    },
    {
      action: 'cancel',
      toStatus: 'cancelled',
      label: 'Cancel Order',
      shortLabel: 'Cancel',
      variant: 'danger',
      destructive: true,
    },
  ],
  delivered: [
    {
      action: 'mark_returned',
      toStatus: 'returned',
      label: 'Mark Returned',
      shortLabel: 'Returned',
      variant: 'secondary',
      requiresReason: true,
    },
  ],
  returned: [],
  cancelled: [],
};

export function getActionsForStatus(status?: string | null): FulfillmentActionDescriptor[] {
  return ACTIONS_FOR_STATUS[normalizeFulfillmentStatus(status)];
}

export function getPrimaryActionForStatus(
  status?: string | null,
): FulfillmentActionDescriptor | null {
  const actions = getActionsForStatus(status);
  return actions.find((a) => !a.destructive) || null;
}

export function getActionByName(
  status: string | null | undefined,
  action: FulfillmentAction,
): FulfillmentActionDescriptor | null {
  return getActionsForStatus(status).find((a) => a.action === action) || null;
}

// Conversation-friendly messages used by the customer Messenger notifications
// and chat reply builders. Kept here so the chat layer and the admin actions
// stay aligned on tone.
export interface CustomerMessageContext {
  orderId: number;
  trackingNumber?: string | null;
  courier?: string | null;
  failureReason?: string | null;
  returnReason?: string | null;
}

export function buildCustomerNotificationMessage(
  toStatus: string,
  ctx: CustomerMessageContext,
): string | null {
  const status = normalizeFulfillmentStatus(toStatus);
  const orderRef = `#${ctx.orderId}`;

  switch (status) {
    case 'confirmed':
      return `Your order ${orderRef} has been confirmed and is being prepared.`;
    case 'dispatched': {
      const tracking = ctx.trackingNumber?.trim();
      const courier = ctx.courier?.trim();
      if (tracking && courier) {
        return `Great news! Your order ${orderRef} has been dispatched via ${courier} (tracking ${tracking}).`;
      }
      if (tracking) {
        return `Great news! Your order ${orderRef} has been dispatched. Tracking number: ${tracking}.`;
      }
      if (courier) {
        return `Great news! Your order ${orderRef} has been dispatched via ${courier}.`;
      }
      return `Great news! Your order ${orderRef} has been dispatched and is on its way.`;
    }
    case 'delivered':
      return `Delivery confirmed! Your order ${orderRef} has been marked as delivered. We hope you love your garments.`;
    case 'delivery_failed': {
      const reason = ctx.failureReason?.trim();
      const tail = reason ? ` Reason noted: ${reason}.` : '';
      return `We're sorry — the courier reported a delivery issue with your order ${orderRef}.${tail} Our team will reach out to arrange the next step.`;
    }
    case 'returned': {
      const reason = ctx.returnReason?.trim();
      const tail = reason ? ` Reason: ${reason}.` : '';
      return `Your order ${orderRef} has been recorded as returned.${tail} If this is unexpected, please reply and we will help.`;
    }
    default:
      return null;
  }
}
