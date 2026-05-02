import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import OrdersPageClient from './OrdersPageClient';
import { normalizeFulfillmentStatus } from '@/lib/fulfillment';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const scope = await requirePagePermission('orders:view');
  const orders = await prisma.order.findMany({
    where: getBrandScopedWhere(scope),
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
      supportEscalations: {
        select: {
          id: true,
          status: true,
          reason: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      },
      fulfillmentEvents: {
        orderBy: { createdAt: 'asc' },
      },
      returnRequests: {
        select: {
          id: true,
          type: true,
          status: true,
          reason: true,
          stockReconciled: true,
          replacementOrderId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const normalizedCounts = orders.reduce<Record<string, number>>((acc, o) => {
    const key = normalizeFulfillmentStatus(o.orderStatus);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const stats = {
    total: orders.length,
    pending: normalizedCounts.pending ?? 0,
    confirmed: normalizedCounts.confirmed ?? 0,
    packing: (normalizedCounts.packing ?? 0) + (normalizedCounts.packed ?? 0),
    shipped: normalizedCounts.dispatched ?? 0,
    delivered: normalizedCounts.delivered ?? 0,
    deliveryFailed: normalizedCounts.delivery_failed ?? 0,
    returned: normalizedCounts.returned ?? 0,
    cancelled: normalizedCounts.cancelled ?? 0,
    revenueToday: orders
      .filter(o => o.orderStatus !== 'cancelled' && new Date(o.createdAt).toDateString() === new Date().toDateString())
      .reduce((acc, o) => acc + o.totalAmount, 0),
  };

  const serialized = orders.map((o) => ({
    id: o.id,
    orderStatus: o.orderStatus,
    totalAmount: o.totalAmount,
    createdAt: o.createdAt.toISOString(),
    brand: o.brand,
    paymentMethod: o.paymentMethod,
    deliveryAddress: o.deliveryAddress,
    trackingNumber: o.trackingNumber,
    courier: o.courier,
    failureReason: o.failureReason,
    returnReason: o.returnReason,
    customer: {
      id: o.customer.id,
      name: o.customer.name,
      phone: o.customer.phone,
      channel: o.customer.channel,
    },
    orderItems: o.orderItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      price: item.price,
      product: item.product
        ? { name: item.product.name, style: item.product.style }
        : null,
    })),
    supportEscalations: o.supportEscalations.map((support) => ({
      id: support.id,
      status: support.status,
      reason: support.reason,
      updatedAt: support.updatedAt.toISOString(),
    })),
    returnRequests: o.returnRequests.map((rr) => ({
      id: rr.id,
      type: rr.type,
      status: rr.status,
      reason: rr.reason,
      stockReconciled: rr.stockReconciled,
      replacementOrderId: rr.replacementOrderId,
      createdAt: rr.createdAt.toISOString(),
      updatedAt: rr.updatedAt.toISOString(),
    })),
    fulfillmentEvents: o.fulfillmentEvents.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      trackingNumber: event.trackingNumber,
      courier: event.courier,
      actorEmail: event.actorEmail,
      actorName: event.actorName,
      customerNotified: event.customerNotified,
      createdAt: event.createdAt.toISOString(),
    })),
  }));

  return (
    <OrdersPageClient
      initialOrders={serialized}
      stats={stats}
      canUpdateOrders={canScope(scope, 'orders:update')}
    />
  );
}
