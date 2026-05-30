import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import SupportPageClient from './SupportPageClient';
import {
  formatSupportDate,
  formatSupportTime,
  serializeSupportOrder,
  serializeSupportMessage,
  SUPPORT_THREAD_MESSAGE_LIMIT,
} from './format';
import type { SupportThread, SupportThreadMessage } from './types';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const scope = await requirePagePermission('support:view');
  const escalations = await prisma.supportEscalation.findMany({
    where: getBrandScopedWhere(scope),
    include: {
      customer: true,
      order: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const messagesByConvo = new Map<string, SupportThreadMessage[]>();
  const hasOlderMessagesByConvo = new Map<string, boolean>();
  const ordersByEscalationId = new Map<number, SupportThread['recentOrders']>();

  await Promise.all(
    escalations.map(async (escalation) => {
      const key = `${escalation.channel}:${escalation.senderId}`;
      const [latestMessages, recentOrders] = await Promise.all([
        prisma.chatMessage.findMany({
          where: {
            senderId: escalation.senderId,
            channel: escalation.channel,
          },
          orderBy: { id: 'desc' },
          take: SUPPORT_THREAD_MESSAGE_LIMIT + 1,
        }),
        prisma.order.findMany({
          where: {
            ...getBrandScopedWhere(scope),
            ...(escalation.customerId
              ? { customerId: escalation.customerId }
              : escalation.orderId
                ? { id: escalation.orderId }
                : { id: -1 }),
          },
          include: {
            orderItems: {
              include: {
                product: true,
              },
            },
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
        }),
      ]);

      const visibleMessages = latestMessages
        .slice(0, SUPPORT_THREAD_MESSAGE_LIMIT)
        .reverse()
        .map(serializeSupportMessage);

      messagesByConvo.set(key, visibleMessages);
      hasOlderMessagesByConvo.set(key, latestMessages.length > SUPPORT_THREAD_MESSAGE_LIMIT);
      ordersByEscalationId.set(escalation.id, recentOrders.map(serializeSupportOrder));
    })
  );

  const processedEscalations: SupportThread[] = escalations.map(e => ({
    id: e.id,
    senderId: e.senderId,
    channel: e.channel,
    customerId: e.customerId,
    customer: e.customer
      ? {
          id: e.customer.id,
          name: e.customer.name,
        }
      : null,
    orderId: e.orderId,
    order: ordersByEscalationId.get(e.id)?.find((order) => order.id === e.orderId) ?? null,
    recentOrders: ordersByEscalationId.get(e.id) ?? [],
    brand: e.brand,
    reason: e.reason,
    status: e.status,
    contactName: e.contactName,
    contactPhone: e.contactPhone,
    latestCustomerMessage: e.latestCustomerMessage,
    summary: e.summary,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    updatedAtLabel: formatSupportTime(e.updatedAt),
    resolvedAt: e.resolvedAt?.toISOString() ?? null,
    hasOlderMessages: hasOlderMessagesByConvo.get(`${e.channel}:${e.senderId}`) ?? false,
    messages: messagesByConvo.get(`${e.channel}:${e.senderId}`) || [],
  }));

  // Stats
  const stats = {
    open: escalations.filter(e => e.status !== 'resolved').length,
    linkedOrders: escalations.filter(e => e.orderId).length,
    dateLabel: formatSupportDate(new Date()),
  };

  return (
    <SupportPageClient 
      initialEscalations={processedEscalations}
      stats={stats}
      canReply={canScope(scope, 'support:reply')}
    />
  );
}
