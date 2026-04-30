import prisma from '@/lib/prisma';
import OrdersPageClient from './OrdersPageClient';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate KPIs
  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.orderStatus === 'pending').length,
    confirmed: orders.filter(o => o.orderStatus === 'confirmed').length,
    packing: orders.filter(o => o.orderStatus === 'packing').length,
    shipped: orders.filter(o => o.orderStatus === 'shipped').length,
    delivered: orders.filter(o => o.orderStatus === 'delivered').length,
    revenueToday: orders
      .filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString())
      .reduce((acc, o) => acc + o.totalAmount, 0),
  };

  return (
    <OrdersPageClient 
      initialOrders={orders}
      stats={stats}
    />
  );
}
