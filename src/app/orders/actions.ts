'use server';

import prisma from '@/lib/prisma';
import { sendMessengerMessage } from '@/lib/meta';
import { revalidatePath } from 'next/cache';

export async function dispatchOrder(orderId: number) {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { orderStatus: 'dispatched' },
    include: { customer: true }
  });

  if (order.customer.externalId && order.customer.channel === 'messenger') {
    const msg = `Great news! Your order #${order.id} has just been dispatched and is on its way to you.`;
    await sendMessengerMessage(order.customer.externalId, msg);
  }

  revalidatePath('/orders');
  return order;
}

export async function deliverOrder(orderId: number) {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { orderStatus: 'delivered' },
    include: { customer: true }
  });

  if (order.customer.externalId && order.customer.channel === 'messenger') {
    const msg = `Delivery Confirmed! Your order #${order.id} has been marked as delivered. We hope you love your garments!`;
    await sendMessengerMessage(order.customer.externalId, msg);
  }

  revalidatePath('/orders');
  return order;
}
