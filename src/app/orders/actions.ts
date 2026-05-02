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
    await assertOrderAccess(scope, orderId);
    await transitionFulfillment({
      orderId,
      toStatus: 'dispatched',
      trackingNumber: input.trackingNumber,
      courier: input.courier,
      note: input.note,
      actor: actorFromScope(scope),
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
    await transitionFulfillment({
      orderId,
      toStatus: 'dispatched',
      trackingNumber: input.trackingNumber,
      courier: input.courier,
      note: input.note,
      actor: actorFromScope(scope),
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
