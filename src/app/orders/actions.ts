'use server';

import prisma from '@/lib/prisma';
import { sendMessengerMessage } from '@/lib/meta';
import { cancelOrderById, OrderRequestError, isOrderMutableStatus } from '@/lib/orders';
import { revalidatePath } from 'next/cache';
import { logInfo, logWarn } from '@/lib/app-log';
import {
  accessDeniedResult,
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import type { UserScope } from '@/lib/access-control';
import { transitionFulfillment } from '@/lib/fulfillment-service';
import {
  assignKoombiyoWaybill,
  KOOMBIYO_COURIER_DISPLAY_NAME,
  refreshKoombiyoShipmentStatus,
  submitKoombiyoDeliveryForDispatch,
} from '@/lib/koombiyo-courier';
import {
  refreshRoyalExpressShipmentStatus,
  ROYALEXPRESS_COURIER_DISPLAY_NAME,
  submitRoyalExpressDeliveryForDispatch,
} from '@/lib/royal-express-courier';
import { normalizeFulfillmentStatus } from '@/lib/fulfillment';

export interface OrderActionResult {
  success: boolean;
  error?: string;
}

export interface DispatchOrderInput {
  trackingNumber?: string;
  courier?: string;
  note?: string;
}

export interface DeliveryFailureInput {
  reason: string;
  note?: string;
}

export interface ReturnOrderInput {
  reason: string;
  note?: string;
}

export interface AssignKoombiyoWaybillActionInput {
  receiverDistrictId?: string;
  receiverCityId?: string;
  description?: string;
  specialNote?: string;
  force?: boolean;
}

async function assertOrderAccess(scope: UserScope, orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, brand: true, orderStatus: true },
  });
  if (!order) {
    throw new OrderRequestError(`Order #${orderId} was not found.`, 404);
  }
  assertBrandAccess(scope, order.brand, 'order');
  return order;
}

function actorFromScope(scope: UserScope) {
  return { email: scope.email ?? null, name: scope.name ?? null };
}

function notifyCancellation(
  order: { id: number; customer: { externalId: string | null; channel: string | null } },
  message: string,
) {
  if (order.customer.externalId && order.customer.channel === 'messenger') {
    return sendMessengerMessage(order.customer.externalId, message).then((result) => {
      if (!result.ok) {
        logWarn('Order Actions', 'Order cancelled, but Messenger notification failed.', {
          orderId: order.id,
          senderId: order.customer.externalId,
          error: result.error || result.status || 'unknown',
        });
        return;
      }
      logInfo('Order Actions', 'Sent customer cancellation notification.', {
        orderId: order.id,
        senderId: order.customer.externalId,
      });
    });
  }
  return undefined;
}

function toResult(error: unknown): OrderActionResult {
  if (isAuthorizationError(error)) {
    return accessDeniedResult(error);
  }
  if (error instanceof OrderRequestError) {
    return { success: false, error: error.message };
  }
  logWarn('Order Actions', 'Unexpected order action failure.', {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode:
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null,
  });
  return { success: false, error: 'Failed to update order. Please retry.' };
}

export async function confirmOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    await transitionFulfillment({
      orderId,
      toStatus: 'confirmed',
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markPacking(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    await transitionFulfillment({
      orderId,
      toStatus: 'packing',
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markPacked(orderId: number, note?: string): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    await transitionFulfillment({
      orderId,
      toStatus: 'packed',
      note,
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function dispatchOrder(
  orderId: number,
  input: DispatchOrderInput = {},
): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    const order = await assertOrderAccess(scope, orderId);
    const actor = actorFromScope(scope);
    const currentStatus = normalizeFulfillmentStatus(order.orderStatus);
    const royalExpressShipment =
      currentStatus === 'packed'
        ? await submitRoyalExpressDeliveryForDispatch({ orderId, actor })
        : null;
    const koombiyoShipment =
      !royalExpressShipment && currentStatus === 'packed'
        ? await submitKoombiyoDeliveryForDispatch({ orderId, actor })
        : null;
    const courierShipment = royalExpressShipment || koombiyoShipment;
    const courierName = royalExpressShipment
      ? ROYALEXPRESS_COURIER_DISPLAY_NAME
      : koombiyoShipment
        ? KOOMBIYO_COURIER_DISPLAY_NAME
        : undefined;
    const courierNote = royalExpressShipment
      ? `Sent packed order to RoyalExpress with waybill ${royalExpressShipment.waybillId}.`
      : koombiyoShipment
        ? `Sent packed order to Koombiyo with waybill ${koombiyoShipment.waybillId}.`
        : undefined;

    await transitionFulfillment({
      orderId,
      toStatus: 'dispatched',
      trackingNumber: courierShipment?.waybillId ?? input.trackingNumber,
      courier: courierName ?? input.courier,
      note: input.note || courierNote,
      actor,
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function deliverOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    await transitionFulfillment({
      orderId,
      toStatus: 'delivered',
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function reportDeliveryFailure(
  orderId: number,
  input: DeliveryFailureInput,
): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    if (!input.reason?.trim()) {
      return {
        success: false,
        error: 'Please provide a delivery failure reason so we can follow up with the customer.',
      };
    }
    await transitionFulfillment({
      orderId,
      toStatus: 'delivery_failed',
      failureReason: input.reason,
      note: input.note,
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function retryDispatch(
  orderId: number,
  input: DispatchOrderInput = {},
): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    const actor = actorFromScope(scope);
    const royalExpressShipment = await submitRoyalExpressDeliveryForDispatch({ orderId, actor });
    const koombiyoShipment = royalExpressShipment
      ? null
      : await submitKoombiyoDeliveryForDispatch({ orderId, actor });
    const courierShipment = royalExpressShipment || koombiyoShipment;
    const courierName = royalExpressShipment
      ? ROYALEXPRESS_COURIER_DISPLAY_NAME
      : koombiyoShipment
        ? KOOMBIYO_COURIER_DISPLAY_NAME
        : undefined;
    const courierNote = royalExpressShipment
      ? `Retried RoyalExpress dispatch with waybill ${royalExpressShipment.waybillId}.`
      : koombiyoShipment
        ? `Retried Koombiyo dispatch with waybill ${koombiyoShipment.waybillId}.`
        : undefined;

    await transitionFulfillment({
      orderId,
      toStatus: 'dispatched',
      trackingNumber: courierShipment?.waybillId ?? input.trackingNumber,
      courier: courierName ?? input.courier,
      note: input.note || courierNote,
      actor,
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markReturned(
  orderId: number,
  input: ReturnOrderInput,
): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    if (!input.reason?.trim()) {
      return {
        success: false,
        error: 'Please provide a return reason so the audit trail is clear.',
      };
    }
    await transitionFulfillment({
      orderId,
      toStatus: 'returned',
      returnReason: input.reason,
      note: input.note,
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function cancelOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, brand: true },
    });

    if (!existing) {
      return { success: false, error: `Order #${orderId} was not found.` };
    }

    assertBrandAccess(scope, existing.brand, 'order');

    if (!isOrderMutableStatus(existing.orderStatus)) {
      return {
        success: false,
        error: `Order #${orderId} cannot be cancelled (status: ${existing.orderStatus}).`,
      };
    }

    const cancelled = await cancelOrderById(prisma, orderId);
    await prisma.orderFulfillmentEvent.create({
      data: {
        orderId: cancelled.id,
        fromStatus: existing.orderStatus,
        toStatus: 'cancelled',
        actorEmail: scope.email ?? null,
        actorName: scope.name ?? null,
        customerNotified: cancelled.customerId != null,
      },
    });
    const customer = await prisma.customer.findUnique({
      where: { id: cancelled.customerId },
      select: { externalId: true, channel: true },
    });

    if (customer) {
      await notifyCancellation(
        { id: cancelled.id, customer },
        `Your order #${cancelled.id} has been cancelled. If this was unexpected, please reply and we will help.`,
      );
    }

    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function assignKoombiyoWaybillAction(
  orderId: number,
  input: AssignKoombiyoWaybillActionInput,
): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    await assertOrderAccess(scope, orderId);
    await assignKoombiyoWaybill({
      orderId,
      receiverDistrictId: input.receiverDistrictId,
      receiverCityId: input.receiverCityId,
      description: input.description,
      specialNote: input.specialNote,
      force: input.force,
      actor: actorFromScope(scope),
    });
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function sendKoombiyoDeliveryAction(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    const order = await assertOrderAccess(scope, orderId);
    const currentStatus = normalizeFulfillmentStatus(order.orderStatus);

    if (currentStatus !== 'packed' && currentStatus !== 'dispatched') {
      return {
        success: false,
        error: 'Pack the order before sending it to Koombiyo.',
      };
    }

    const actor = actorFromScope(scope);
    const shipment = await submitKoombiyoDeliveryForDispatch({ orderId, actor });

    if (!shipment) {
      return {
        success: false,
        error: `Koombiyo is not active for ${order.brand || 'this order'}. Enable it in Settings before sending.`,
      };
    }

    if (currentStatus === 'packed') {
      await transitionFulfillment({
        orderId,
        toStatus: 'dispatched',
        trackingNumber: shipment.waybillId,
        courier: KOOMBIYO_COURIER_DISPLAY_NAME,
        note: `Sent packed order to Koombiyo with waybill ${shipment.waybillId}.`,
        actor,
      });
    }

    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function refreshKoombiyoStatusAction(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    const order = await assertOrderAccess(scope, orderId);
    const shipment = await refreshKoombiyoShipmentStatus({
      orderId,
      actor: actorFromScope(scope),
    });
    const currentStatus = normalizeFulfillmentStatus(order.orderStatus);
    const nextStatus = normalizeFulfillmentStatus(shipment.mappedStatus);

    if (
      nextStatus !== currentStatus &&
      (nextStatus === 'delivered' || nextStatus === 'delivery_failed') &&
      currentStatus === 'dispatched'
    ) {
      await transitionFulfillment({
        orderId,
        toStatus: nextStatus,
        trackingNumber: shipment.waybillId,
        courier: 'Koombiyo Delivery',
        note: `Koombiyo status refresh: ${shipment.courierStatus}.`,
        failureReason: nextStatus === 'delivery_failed' ? 'Koombiyo reported a delivery issue.' : null,
        actor: actorFromScope(scope),
      });
    }

    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function refreshRoyalExpressStatusAction(orderId: number): Promise<OrderActionResult> {
  try {
    const scope = await requireActionPermission('orders:update');
    const order = await assertOrderAccess(scope, orderId);
    const shipment = await refreshRoyalExpressShipmentStatus({
      orderId,
      actor: actorFromScope(scope),
    });
    const currentStatus = normalizeFulfillmentStatus(order.orderStatus);
    const nextStatus = normalizeFulfillmentStatus(shipment.mappedStatus);

    if (
      nextStatus !== currentStatus &&
      (nextStatus === 'delivered' || nextStatus === 'delivery_failed') &&
      currentStatus === 'dispatched'
    ) {
      await transitionFulfillment({
        orderId,
        toStatus: nextStatus,
        trackingNumber: shipment.waybillId,
        courier: ROYALEXPRESS_COURIER_DISPLAY_NAME,
        note: `RoyalExpress status refresh: ${shipment.courierStatus}.`,
        failureReason: nextStatus === 'delivery_failed' ? 'RoyalExpress reported a delivery issue.' : null,
        actor: actorFromScope(scope),
      });
    }

    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}
