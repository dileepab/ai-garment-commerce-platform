import { transitionFulfillment } from './fulfillment-service.ts';
import { type FulfillmentStatus } from './fulfillment.ts';
import { logInfo, logWarn } from './app-log.ts';

export interface CourierWebhookPayload {
  orderId: number;
  provider: 'koombiyo' | 'prompt';
  trackingNumber: string;
  status: string; // Proprietary courier status
  notes?: string | null;
  failureReason?: string | null;
}

/**
 * Normalizes Koombiyo's proprietary status strings to GarmentOS FulfillmentStatus.
 */
function mapKoombiyoStatus(status: string): FulfillmentStatus {
  const s = status.toLowerCase().trim();
  switch (s) {
    case 'pickup_complete':
    case 'in_transit':
    case 'out_for_delivery':
      return 'dispatched';
    case 'delivered':
    case 'delivered_success':
      return 'delivered';
    case 'failed':
    case 'delivery_failed':
    case 'returned_to_hub':
    case 'rejected_by_customer':
      return 'delivery_failed';
    default:
      return 'dispatched';
  }
}

/**
 * Normalizes Prompt Express's proprietary status strings to GarmentOS FulfillmentStatus.
 */
function mapPromptStatus(status: string): FulfillmentStatus {
  const s = status.toLowerCase().trim();
  switch (s) {
    case 'dispatched':
    case 'on_the_way':
    case 'at_delivery_hub':
      return 'dispatched';
    case 'success':
    case 'completed':
    case 'delivered':
      return 'delivered';
    case 'failed':
    case 'unclaimed':
    case 'returned':
      return 'delivery_failed';
    default:
      return 'dispatched';
  }
}

/**
 * Normalizes and processes incoming courier tracking webhook updates.
 */
export async function processCourierWebhookUpdate(payload: CourierWebhookPayload) {
  const providerName = payload.provider === 'koombiyo' ? 'Koombiyo Delivery' : 'Prompt Express';
  
  // 1. Resolve normalized status
  let mappedStatus: FulfillmentStatus = 'dispatched';
  if (payload.provider === 'koombiyo') {
    mappedStatus = mapKoombiyoStatus(payload.status);
  } else if (payload.provider === 'prompt') {
    mappedStatus = mapPromptStatus(payload.status);
  } else {
    logWarn('Courier Service', `Unsupported courier provider: ${payload.provider}`);
    throw new Error(`Unsupported courier provider: ${payload.provider}`);
  }

  logInfo('Courier Service', `Processing automated courier status update for Order #${payload.orderId}.`, {
    provider: payload.provider,
    courierStatus: payload.status,
    mappedStatus,
    trackingNumber: payload.trackingNumber,
  });

  // 2. Execute fulfillment transition
  const result = await transitionFulfillment({
    orderId: payload.orderId,
    toStatus: mappedStatus,
    trackingNumber: payload.trackingNumber,
    courier: providerName,
    note: payload.notes || `Courier automated status: ${payload.status}`,
    failureReason: mappedStatus === 'delivery_failed' ? payload.failureReason || 'Failed to deliver via courier.' : null,
    actor: {
      name: 'Courier Webhook integration',
      email: 'webhooks@courier.lk',
    },
  });

  return result;
}
