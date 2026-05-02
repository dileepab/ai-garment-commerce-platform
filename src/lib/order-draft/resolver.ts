import prisma from '@/lib/prisma';
import { getMerchantSettings } from '@/lib/runtime-config';
import {
  collectContactDetailsFromMessages,
  getMissingContactFields,
} from '@/lib/contact-profile';
import { ResolvedOrderDraft, ConversationContext } from './types';
import { getDeliveryChargeForAddress, getDeliveryEstimateForAddress } from './pricing';
import {
  getActiveOrderWindowMessages,
  detectSameItemIntent,
  resolveProductFromMessages,
  resolveQuantityFromMessages,
  resolveSizeFromMessages,
  resolveColorFromMessages,
  detectPaymentMethod,
  detectGiftWrap,
  extractGiftNote,
} from './matchers';

export function getMissingDraftFields(draft: ResolvedOrderDraft): Array<'size' | 'color'> {
  const missingFields: Array<'size' | 'color'> = [];

  if (!draft.size) {
    missingFields.push('size');
  }

  if (!draft.color) {
    missingFields.push('color');
  }

  return missingFields;
}

export async function resolveDraftFromConversation(
  senderId: string,
  channel: string,
  brand?: string,
  currentMessage?: string
): Promise<{ draft: ResolvedOrderDraft | null; context: ConversationContext }> {
  const messages = await prisma.chatMessage.findMany({
    where: {
      senderId,
      channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      role: true,
      message: true,
    },
  });

  const chronologicalMessages = [...messages].reverse();
  const conversationMessages = currentMessage
    ? [...chronologicalMessages, { role: 'user', message: currentMessage }]
    : chronologicalMessages;

  const customer = await prisma.customer.findUnique({
    where: { externalId: senderId },
    select: {
      id: true,
      name: true,
      phone: true,
      preferredBrand: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  const latestOrder = customer?.orders[0];
  const catalogBrand = brand || customer?.preferredBrand || undefined;
  const settings = await getMerchantSettings(catalogBrand);
  const latestRelevantOrder = customer?.id
    ? await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          ...(catalogBrand ? { brand: catalogBrand } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      })
    : null;
  const products = await prisma.product.findMany({
    where: catalogBrand ? { brand: catalogBrand } : undefined,
    select: {
      id: true,
      name: true,
      brand: true,
      price: true,
      sizes: true,
      colors: true,
    },
  });

  const contacts = collectContactDetailsFromMessages(conversationMessages, {
    name: customer?.name ?? undefined,
    phone: customer?.phone ?? undefined,
    address: latestRelevantOrder?.deliveryAddress ?? latestOrder?.deliveryAddress ?? undefined,
  });
  const activeOrderMessages = getActiveOrderWindowMessages(conversationMessages);

  const deliveryCharge = getDeliveryChargeForAddress(contacts.address, settings.delivery);
  const paymentMethod = detectPaymentMethod(activeOrderMessages, settings.payment);
  const giftWrap = detectGiftWrap(activeOrderMessages);
  const giftNote = extractGiftNote(activeOrderMessages);
  const deliveryEstimate = getDeliveryEstimateForAddress(contacts.address, settings.delivery);

  if (getMissingContactFields(contacts).length > 0) {
    return {
        draft: null,
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  if (detectSameItemIntent(activeOrderMessages) && latestRelevantOrder?.orderItems[0]) {
    const latestItem = latestRelevantOrder.orderItems[0];

    return {
      draft: {
        productId: latestItem.productId,
        productName: latestItem.product.name,
        brand: latestRelevantOrder.brand || latestItem.product.brand,
        quantity: latestItem.quantity,
        size: latestItem.size || undefined,
        color: latestItem.color || undefined,
        price: latestItem.price,
        deliveryCharge,
        total: latestItem.price * latestItem.quantity + deliveryCharge,
        paymentMethod,
        giftWrap,
        giftNote,
        deliveryEstimate,
        name: contacts.name || '',
        address: contacts.address || '',
        phone: contacts.phone || '',
      },
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  const product = resolveProductFromMessages(products, activeOrderMessages);

  if (!product) {
    return {
        draft: null,
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  return {
    draft: {
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      quantity: resolveQuantityFromMessages(activeOrderMessages),
      size: resolveSizeFromMessages(activeOrderMessages, product),
      color: resolveColorFromMessages(activeOrderMessages, product),
      price: product.price,
      deliveryCharge,
      total: product.price * resolveQuantityFromMessages(activeOrderMessages) + deliveryCharge,
      paymentMethod,
      giftWrap,
      giftNote,
      deliveryEstimate,
      name: contacts.name || '',
      address: contacts.address || '',
      phone: contacts.phone || '',
    },
    context: {
      messages: conversationMessages,
      customerId: customer?.id,
    },
  };
}
