import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import ReturnRequestsPageClient from './ReturnRequestsPageClient';
import { RETURN_REQUEST_STATUSES } from '@/lib/returns';

export const dynamic = 'force-dynamic';

export default async function ReturnsPage() {
  const scope = await requirePagePermission('returns:view');

  const returnRequests = await prisma.returnRequest.findMany({
    where: getBrandScopedWhere(scope),
    include: {
      order: {
        select: {
          id: true,
          orderStatus: true,
          totalAmount: true,
          deliveryAddress: true,
          brand: true,
          orderItems: {
            include: { product: { select: { name: true, style: true } } },
          },
        },
      },
      customer: {
        select: { id: true, name: true, phone: true, channel: true },
      },
      replacementOrder: {
        select: { id: true, orderStatus: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const statusCounts = RETURN_REQUEST_STATUSES.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s] = returnRequests.filter((r) => r.status === s).length;
      return acc;
    },
    {},
  );

  const stats = {
    total: returnRequests.length,
    open: returnRequests.filter(
      (r) => !['rejected', 'completed'].includes(r.status),
    ).length,
    pendingItemReceipt: returnRequests.filter((r) => r.status === 'approved').length,
    completed: statusCounts.completed ?? 0,
    returns: returnRequests.filter((r) => r.type === 'return').length,
    exchanges: returnRequests.filter((r) => r.type === 'exchange').length,
  };

  const serialized = returnRequests.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    type: r.type,
    reason: r.reason,
    status: r.status,
    requestedBy: r.requestedBy,
    adminNote: r.adminNote,
    stockReconciled: r.stockReconciled,
    replacementOrderId: r.replacementOrderId,
    brand: r.brand,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    customer: r.customer
      ? {
          id: r.customer.id,
          name: r.customer.name,
          phone: r.customer.phone,
          channel: r.customer.channel,
        }
      : null,
    order: {
      id: r.order.id,
      orderStatus: r.order.orderStatus,
      totalAmount: r.order.totalAmount,
      deliveryAddress: r.order.deliveryAddress,
      brand: r.order.brand,
      orderItems: r.order.orderItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        product: item.product ? { name: item.product.name, style: item.product.style } : null,
      })),
    },
    replacementOrder: r.replacementOrder
      ? { id: r.replacementOrder.id, orderStatus: r.replacementOrder.orderStatus }
      : null,
  }));

  return (
    <ReturnRequestsPageClient
      initialRequests={serialized}
      stats={stats}
      canManage={canScope(scope, 'returns:manage')}
    />
  );
}
