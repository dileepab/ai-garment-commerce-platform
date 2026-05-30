import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBrandScopedWhere } from '@/lib/access-control';
import { accessDeniedResponse, isAuthorizationError, requireApiPermission } from '@/lib/authz';
import {
  formatSupportDate,
  formatSupportTime,
  serializeSupportOrder,
} from '@/app/support/format';
import type { SupportStats, SupportThread } from '@/app/support/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scope = await requireApiPermission('support:view');
    const escalations = await prisma.supportEscalation.findMany({
      where: getBrandScopedWhere(scope),
      include: {
        customer: true,
        order: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const ordersByEscalationId = new Map<number, SupportThread['recentOrders']>();
    await Promise.all(
      escalations.map(async (escalation) => {
        const recentOrders = await prisma.order.findMany({
          where: {
            ...getBrandScopedWhere(scope),
            ...(escalation.customerId
              ? { customerId: escalation.customerId }
              : escalation.orderId
                ? { id: escalation.orderId }
                : { id: -1 }),
          },
          include: {
            orderItems: { include: { product: true } },
            returnRequests: {
              select: {
                id: true,
                type: true,
                status: true,
                reason: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        });

        ordersByEscalationId.set(escalation.id, recentOrders.map(serializeSupportOrder));
      })
    );

    const threads: SupportThread[] = escalations.map((escalation) => ({
      id: escalation.id,
      senderId: escalation.senderId,
      channel: escalation.channel,
      customerId: escalation.customerId,
      customer: escalation.customer
        ? {
            id: escalation.customer.id,
            name: escalation.customer.name,
          }
        : null,
      orderId: escalation.orderId,
      order:
        ordersByEscalationId
          .get(escalation.id)
          ?.find((order) => order.id === escalation.orderId) ?? null,
      recentOrders: ordersByEscalationId.get(escalation.id) ?? [],
      brand: escalation.brand,
      reason: escalation.reason,
      status: escalation.status,
      contactName: escalation.contactName,
      contactPhone: escalation.contactPhone,
      latestCustomerMessage: escalation.latestCustomerMessage,
      summary: escalation.summary,
      createdAt: escalation.createdAt.toISOString(),
      updatedAt: escalation.updatedAt.toISOString(),
      updatedAtLabel: formatSupportTime(escalation.updatedAt),
      resolvedAt: escalation.resolvedAt?.toISOString() ?? null,
      hasOlderMessages: false,
      messages: [],
    }));

    const stats: SupportStats = {
      open: escalations.filter((escalation) => escalation.status !== 'resolved').length,
      linkedOrders: escalations.filter((escalation) => escalation.orderId).length,
      dateLabel: formatSupportDate(new Date()),
    };

    return NextResponse.json(
      {
        success: true,
        data: {
          escalations: threads,
          stats,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    throw error;
  }
}
