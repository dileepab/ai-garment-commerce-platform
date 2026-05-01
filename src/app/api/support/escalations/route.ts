import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { formatSupportDate, formatSupportTime } from '@/app/support/format';
import type { SupportStats, SupportThread } from '@/app/support/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const escalations = await prisma.supportEscalation.findMany({
    include: {
      customer: true,
      order: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

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
    order: escalation.order
      ? {
          id: escalation.order.id,
        }
      : null,
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
}
