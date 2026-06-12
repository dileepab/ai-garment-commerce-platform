import prisma from './prisma.ts';
import { transitionFulfillment } from './fulfillment-service.ts';
import {
  normalizeFulfillmentStatus,
  type FulfillmentStatus,
} from './fulfillment.ts';
import { logInfo } from './app-log.ts';

export interface CourierWebhookPayload {
  orderId: number;
  provider: 'koombiyo' | 'prompt' | 'royalexpress';
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
    case 'pending':
    case 'created':
    case 'order_created':
    case 'picked up':
    case 'picked_up':
    case 'pickup_complete':
    case 'pickup complete':
    case 'in transit':
    case 'in_transit':
    case 'out for delivery':
    case 'out_for_delivery':
      return 'dispatched';
    case 'delivered':
    case 'delivery complete':
    case 'delivered_success':
      return 'delivered';
    case 'failed':
    case 'delivery failed':
    case 'delivery_failed':
    case 'returned':
    case 'return':
    case 'return to hub':
    case 'returned_to_hub':
    case 'rejected by customer':
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

function mapRoyalExpressStatus(status: string): FulfillmentStatus {
  const s = status.toLowerCase().trim();
  switch (s) {
    case 'pending':
    case 'created':
    case 'order_created':
    case 'submitted':
    case 'accepted':
    case 'processing':
    case 'pickup':
    case 'picked up':
    case 'picked_up':
    case 'in transit':
    case 'in_transit':
    case 'out for delivery':
    case 'out_for_delivery':
      return 'dispatched';
    case 'success':
    case 'completed':
    case 'complete':
    case 'delivered':
      return 'delivered';
    case 'failed':
    case 'delivery failed':
    case 'delivery_failed':
    case 'returned':
    case 'return':
    case 'return to origin':
    case 'return_to_origin':
    case 'cancelled':
    case 'rejected':
      return 'delivery_failed';
    default:
      return 'dispatched';
  }
}

export function mapCourierStatus(
  provider: CourierWebhookPayload['provider'],
  status: string,
): FulfillmentStatus {
  if (provider === 'koombiyo') return mapKoombiyoStatus(status);
  if (provider === 'royalexpress') return mapRoyalExpressStatus(status);
  return mapPromptStatus(status);
}

/**
 * Normalizes and processes incoming courier tracking webhook updates.
 */
export async function processCourierWebhookUpdate(payload: CourierWebhookPayload) {
  const providerName =
    payload.provider === 'koombiyo'
      ? 'Koombiyo Delivery'
      : payload.provider === 'royalexpress'
        ? 'RoyalExpress'
        : 'Prompt Express';
  
  // 1. Resolve normalized status
  const mappedStatus = mapCourierStatus(payload.provider, payload.status);

  logInfo('Courier Service', `Processing automated courier status update for Order #${payload.orderId}.`, {
    provider: payload.provider,
    courierStatus: payload.status,
    mappedStatus,
    trackingNumber: payload.trackingNumber,
  });

  const existingOrder = await prisma.order.findUnique({
    where: { id: payload.orderId },
    select: { orderStatus: true },
  });

  if (existingOrder && normalizeFulfillmentStatus(existingOrder.orderStatus) === mappedStatus) {
    await prisma.order.update({
      where: { id: payload.orderId },
      data: {
        trackingNumber: payload.trackingNumber.trim(),
        courier: providerName,
      },
    });

    return {
      orderId: payload.orderId,
      fromStatus: mappedStatus,
      toStatus: mappedStatus,
      customerNotified: false,
      notificationDeduped: true,
    };
  }

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
