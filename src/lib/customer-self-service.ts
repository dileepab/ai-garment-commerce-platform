import {
  canTransitionFulfillment,
  getFulfillmentLabel,
  normalizeFulfillmentStatus,
  type FulfillmentStatus,
} from '@/lib/fulfillment';

const CUSTOMER_PRE_DISPATCH_STATUSES: ReadonlySet<FulfillmentStatus> = new Set([
  'pending',
  'confirmed',
  'packing',
  'packed',
]);

export function isCustomerSelfServiceContactUpdateAllowed(status?: string | null): boolean {
  return CUSTOMER_PRE_DISPATCH_STATUSES.has(normalizeFulfillmentStatus(status));
}

export function isCustomerSelfServiceCancellationAllowed(status?: string | null): boolean {
  const normalized = normalizeFulfillmentStatus(status);
  return (
    CUSTOMER_PRE_DISPATCH_STATUSES.has(normalized) &&
    canTransitionFulfillment(status, 'cancelled')
  );
}

export function buildSelfServiceEscalationReply(params: {
  action: 'cancel' | 'update_contact';
  orderId: number;
  status?: string | null;
  supportLine: string;
}): string {
  const stage = getFulfillmentLabel(params.status).toLowerCase();
  const actionText =
    params.action === 'cancel'
      ? 'cancel it automatically'
      : 'update delivery details automatically';

  return `Order #${params.orderId} is already at the ${stage} stage, so I cannot ${actionText} in chat. ${params.supportLine} I have also flagged this conversation for a team follow-up.`;
}
