import prisma from '@/lib/prisma';
import SupportPageClient from './SupportPageClient';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const escalations = await prisma.supportEscalation.findMany({
    include: {
      customer: true,
      order: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const senderFilters = escalations.map((e) => ({ senderId: e.senderId, channel: e.channel }));

  const relatedMessages = senderFilters.length
    ? await prisma.chatMessage.findMany({
        where: { OR: senderFilters },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  // Group messages by conversation
  const messagesByConvo = new Map<string, any[]>();
  relatedMessages.forEach(msg => {
    const key = `${msg.channel}:${msg.senderId}`;
    if (!messagesByConvo.has(key)) messagesByConvo.set(key, []);
    messagesByConvo.get(key)!.push(msg);
  });

  const processedEscalations = escalations.map(e => ({
    ...e,
    messages: messagesByConvo.get(`${e.channel}:${e.senderId}`) || [],
  }));

  // Stats
  const stats = {
    open: escalations.filter(e => e.status !== 'resolved').length,
    linkedOrders: escalations.filter(e => e.orderId).length,
  };

  return (
    <SupportPageClient 
      initialEscalations={processedEscalations}
      stats={stats}
    />
  );
}
