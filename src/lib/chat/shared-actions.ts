import prisma from '@/lib/prisma';
import {
  cleanStoredContactValue,
  type ContactDetails,
} from '@/lib/contact-profile';

export async function updateOrderGiftInstructions(orderId: number, giftNote: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      giftWrap: true,
      giftNote,
    },
    include: {
      customer: true,
      orderItems: {
        include: {
          product: {
            include: {
              inventory: true,
            },
          },
        },
      },
    },
  });
}

export async function upsertCustomerContact(params: {
  senderId: string;
  channel: string;
  preferredBrand?: string;
  currentCustomerId?: number;
  currentName?: string | null;
  currentPhone?: string | null;
  contact: ContactDetails;
}) {
  const nextName = params.contact.name || cleanStoredContactValue(params.currentName);
  const nextPhone = params.contact.phone || cleanStoredContactValue(params.currentPhone);

  if (!nextName && !nextPhone && !params.currentCustomerId) {
    return null;
  }

  if (params.currentCustomerId) {
    return prisma.customer.update({
      where: { id: params.currentCustomerId },
      data: {
        name: nextName || cleanStoredContactValue(params.currentName) || '',
        phone: nextPhone || null,
        channel: params.channel,
        preferredBrand: params.preferredBrand || undefined,
      },
    });
  }

  return prisma.customer.create({
    data: {
      externalId: params.senderId,
      name: nextName || '',
      phone: nextPhone || null,
      channel: params.channel,
      preferredBrand: params.preferredBrand || null,
    },
  });
}
