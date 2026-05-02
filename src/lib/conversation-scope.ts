import { getBrandScopeValues, type UserScope } from '@/lib/access-control';
import prisma from '@/lib/prisma';

export async function getScopedConversationSenderIds(scope: UserScope): Promise<string[] | null> {
  const brands = getBrandScopeValues(scope);
  if (!brands) return null;

  const [supportSenders, customers] = await Promise.all([
    prisma.supportEscalation.findMany({
      where: { brand: { in: brands } },
      select: { senderId: true },
    }),
    prisma.customer.findMany({
      where: {
        externalId: { not: null },
        OR: [
          { preferredBrand: { in: brands } },
          { orders: { some: { brand: { in: brands } } } },
          { supportEscalations: { some: { brand: { in: brands } } } },
        ],
      },
      select: { externalId: true },
    }),
  ]);

  return Array.from(new Set([
    ...supportSenders.map((sender) => sender.senderId),
    ...customers.map((customer) => customer.externalId).filter((id): id is string => Boolean(id)),
  ]));
}
