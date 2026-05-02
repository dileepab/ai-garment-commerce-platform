import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import OrdersPageClient from './OrdersPageClient';

export const dynamic = 'force-dynamic';

function isStatus(orderStatus: string, ...statuses: string[]) {
  return statuses.includes(orderStatus);
}

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
    },
    orderBy: { createdAt: 'desc' },
  });

  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.orderStatus === 'pending').length,
    confirmed: orders.filter(o => o.orderStatus === 'confirmed').length,
    packing: orders.filter(o => isStatus(o.orderStatus, 'packing', 'packed')).length,
    shipped: orders.filter(o => isStatus(o.orderStatus, 'shipped', 'dispatched')).length,
    delivered: orders.filter(o => o.orderStatus === 'delivered').length,
    cancelled: orders.filter(o => o.orderStatus === 'cancelled').length,
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
  }));

  return (
    <OrdersPageClient
      initialOrders={serialized}
      stats={stats}
      canUpdateOrders={canScope(scope, 'orders:update')}
    />
  );
}
