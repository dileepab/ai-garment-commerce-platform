import prisma from '@/lib/prisma';
import { createOrderFromCatalog, OrderRequestError } from '@/lib/orders';
import { autoAssignKoombiyoWaybill } from '@/lib/koombiyo-courier';
import { ORDER_CONFIRMATION_CALL_NOTICE } from '@/lib/order-details';
import {
  buildOrderSummaryReply,
  getMissingDraftFields,
  isContactConfirmationMessage,
  isOrderSummaryMessage,
  isTerminalAssistantOrderMessage,
  ResolvedOrderDraft,
  resolveDraftFromConversation,
} from '@/lib/order-draft';
import { isClearConfirmation } from '@/lib/confirmation-intent';

export { isClearConfirmation } from '@/lib/confirmation-intent';

interface ConfirmOrderParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface ConfirmOrderResult {
  handled: boolean;
  reply?: string;
  orderId?: number;
}

function buildSuccessReply(draft: ResolvedOrderDraft, orderId: number): string {
  const specialInstructions = [
    draft.giftWrap ? 'Gift wrap: Yes' : '',
    draft.giftNote ? `Gift Note: ${draft.giftNote}` : '',
  ].filter(Boolean);

  return [
    'Thank you. Your order has been confirmed successfully ✅',
    '',
    `Order ID: #${orderId}`,
    `Product: ${draft.productName}`,
    `Quantity: ${draft.quantity}`,
    `Total: Rs ${draft.total}`,
    `Payment Method: ${draft.paymentMethod}`,
    `Name: ${draft.name}`,
    `Street Address: ${draft.streetAddress || 'Not provided'}`,
    `City/Town: ${draft.city || 'Not provided'}`,
    `District: ${draft.district || 'Not provided'}`,
    `Phone Number: ${draft.phone}`,
    ...specialInstructions,
    '',
    ...ORDER_CONFIRMATION_CALL_NOTICE,
  ].join('\n');
}

function buildFailureReply(message: string): string {
  return `Sorry, I could not confirm the order yet. ${message}`;
}

function buildMissingVariantReply(draft: ResolvedOrderDraft): string {
  const missingFields = getMissingDraftFields(draft);
  const prompts: string[] = [];

  if (missingFields.includes('size')) {
    prompts.push(`Please let me know the size you need for ${draft.productName}.`);
  }

  if (missingFields.includes('color')) {
    prompts.push(`Please let me know the color you need for ${draft.productName}.`);
  }

  return prompts.join('\n');
}

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply: string,
  brand?: string | null
) {
  await prisma.chatMessage.createMany({
    data: [
      {
        senderId,
        channel,
        brand: brand || null,
        role: 'user',
        message: userMessage,
      },
      {
        senderId,
        channel,
        brand: brand || null,
        role: 'assistant',
        message: assistantReply,
      },
    ],
  });
}

export async function tryConfirmOrderFromConversation(
  params: ConfirmOrderParams
): Promise<ConfirmOrderResult> {
  if (!isClearConfirmation(params.currentMessage)) {
    return { handled: false };
  }

  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      ...(params.brand ? { brand: params.brand } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      role: true,
      message: true,
    },
  });

  const latestAssistantMessage = recentMessages.find((message) => message.role === 'assistant');

  const { draft } = await resolveDraftFromConversation(
    params.senderId,
    params.channel,
    params.brand,
    params.currentMessage
  );

  if (!draft) {
    const reply =
      'Please send the product, size, and color once more so I can prepare the correct order summary.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply, params.brand);
    return { handled: true, reply };
  }

  if (!latestAssistantMessage) {
    return { handled: false };
  }

  if (isTerminalAssistantOrderMessage(latestAssistantMessage.message)) {
    return { handled: false };
  }

  const missingDraftFields = getMissingDraftFields(draft);

  if (missingDraftFields.length > 0) {
    const reply = buildMissingVariantReply(draft);
    await saveConversationPair(
      params.senderId,
      params.channel,
      params.currentMessage,
      reply,
      params.brand || draft.brand
    );
    return { handled: true, reply };
  }

  if (isContactConfirmationMessage(latestAssistantMessage.message)) {
    const reply = buildOrderSummaryReply(draft);
    await saveConversationPair(
      params.senderId,
      params.channel,
      params.currentMessage,
      reply,
      params.brand || draft.brand
    );
    return { handled: true, reply };
  }

  if (!isOrderSummaryMessage(latestAssistantMessage.message)) {
    return { handled: false };
  }

  const existingCustomer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
  });

  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          name: draft.name,
          phone: draft.phone,
          channel: params.channel,
          preferredBrand: params.brand || existingCustomer.preferredBrand,
        },
      })
    : await prisma.customer.create({
        data: {
          externalId: params.senderId,
          name: draft.name,
          phone: draft.phone,
          channel: params.channel,
          preferredBrand: params.brand || null,
        },
      });

  try {
    const order = await createOrderFromCatalog(prisma, {
      customerId: customer.id,
      brand: draft.brand,
      deliveryAddress: draft.address,
      deliveryStreetAddress: draft.streetAddress,
      deliveryCity: draft.city,
      deliveryDistrict: draft.district,
      paymentMethod: draft.paymentMethod,
      giftWrap: draft.giftWrap,
      giftNote: draft.giftNote,
      orderStatus: 'confirmed',
      items: [
        {
          productId: draft.productId,
          quantity: draft.quantity,
          size: draft.size,
          color: draft.color,
        },
      ],
    });
    await autoAssignKoombiyoWaybill({
      orderId: order.id,
      source: 'legacy chat order confirmation',
    });

    const reply = buildSuccessReply(draft, order.id);
    await saveConversationPair(
      params.senderId,
      params.channel,
      params.currentMessage,
      reply,
      params.brand || draft.brand
    );

    return {
      handled: true,
      reply,
      orderId: order.id,
    };
  } catch (error: unknown) {
    const message =
      error instanceof OrderRequestError
        ? error.message
        : 'Please try again in a moment or contact us directly.';
    const reply = buildFailureReply(message);

    await saveConversationPair(
      params.senderId,
      params.channel,
      params.currentMessage,
      reply,
      params.brand || draft.brand
    );
    return {
      handled: true,
      reply,
    };
  }
}
