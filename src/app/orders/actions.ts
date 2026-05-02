'use server';

import prisma from '@/lib/prisma';
import { sendMessengerMessage } from '@/lib/meta';
import { cancelOrderById, OrderRequestError, isOrderMutableStatus } from '@/lib/orders';
import { revalidatePath } from 'next/cache';
import { logInfo, logWarn } from '@/lib/app-log';

export interface OrderActionResult {
  success: boolean;
  error?: string;
}

async function setStatusOrFail(orderId: number, fromAllowed: string[], next: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderStatus: true },
  });

  if (!order) {
    throw new OrderRequestError(`Order #${orderId} was not found.`, 404);
  }

  if (!fromAllowed.includes(order.orderStatus)) {
    throw new OrderRequestError(
      `Order #${orderId} is ${order.orderStatus} and cannot move to ${next}.`,
      409
    );
  }

  return prisma.order.update({
    where: { id: orderId },
    data: { orderStatus: next },
    include: { customer: true },
  });
}

async function notifyCustomer(order: { id: number; customer: { externalId: string | null; channel: string | null } }, message: string) {
  if (order.customer.externalId && order.customer.channel === 'messenger') {
    const result = await sendMessengerMessage(order.customer.externalId, message);

    if (!result.ok) {
      logWarn('Order Actions', 'Order status changed, but Messenger notification failed.', {
        orderId: order.id,
        senderId: order.customer.externalId,
        error: result.error || result.status || 'unknown',
      });
      return;
    }

    logInfo('Order Actions', 'Sent customer order notification.', {
      orderId: order.id,
      senderId: order.customer.externalId,
    });
  }
}

function toResult(error: unknown): OrderActionResult {
  if (error instanceof OrderRequestError) {
    return { success: false, error: error.message };
  }
  return { success: false, error: 'Failed to update order. Please retry.' };
}

export async function confirmOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const order = await setStatusOrFail(orderId, ['pending'], 'confirmed');
    await notifyCustomer(order, `Your order #${order.id} has been confirmed and is being prepared.`);
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markPacking(orderId: number): Promise<OrderActionResult> {
  try {
    await setStatusOrFail(orderId, ['confirmed'], 'packing');
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function markShipped(orderId: number): Promise<OrderActionResult> {
  try {
    const order = await setStatusOrFail(orderId, ['confirmed', 'packing', 'packed'], 'shipped');
    await notifyCustomer(order, `Great news! Your order #${order.id} has been shipped and is on its way.`);
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function dispatchOrder(orderId: number): Promise<OrderActionResult> {
  return markShipped(orderId);
}

export async function deliverOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const order = await setStatusOrFail(orderId, ['shipped', 'dispatched'], 'delivered');
    await notifyCustomer(order, `Delivery confirmed! Your order #${order.id} has been marked as delivered. We hope you love your garments!`);
    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function cancelOrder(orderId: number): Promise<OrderActionResult> {
  try {
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true },
    });

    if (!existing) {
      return { success: false, error: `Order #${orderId} was not found.` };
    }

    if (!isOrderMutableStatus(existing.orderStatus)) {
      return {
        success: false,
        error: `Order #${orderId} cannot be cancelled (status: ${existing.orderStatus}).`,
      };
    }

    const cancelled = await cancelOrderById(prisma, orderId);
    const customer = await prisma.customer.findUnique({
      where: { id: cancelled.customerId },
      select: { externalId: true, channel: true },
    });

    if (customer) {
      await notifyCustomer(
        { id: cancelled.id, customer },
        `Your order #${cancelled.id} has been cancelled. If this was unexpected, please reply and we will help.`
      );
    }

    revalidatePath('/orders');
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}
