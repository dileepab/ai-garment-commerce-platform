import prisma from '@/lib/prisma';
import { createOrderFromCatalog, OrderRequestError } from '@/lib/orders';
import {
  buildOrderSummaryReply,
  getMissingDraftFields,
  isContactConfirmationMessage,
  isOrderSummaryMessage,
  isTerminalAssistantOrderMessage,
  ResolvedOrderDraft,
  resolveDraftFromConversation,
} from '@/lib/order-draft';

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

const ALLOWED_CONFIRMATIONS = new Set([
  'yes',
  'yes correct',
  'yes confirmed',
  'yes confirm',
  'confirm',
  'confirmed',
  'correct',
  'that is correct',
  'this is correct',
  'looks correct',
  'all correct',
  'yes please place order',
  'please place order',
  'place order',
  'place the order',
  'please place the order',
  'just place the order',
  'go ahead',
  'go ahead and place the order',
  'proceed',
  'do it',
  'please do it',
  'yes do it',
  'okay confirm',
  'ok confirm',
  'okay place the order',
  'ok place the order',
  'yes confirm the order',
  'no need please place the order',
  'no need place the order',
  'no changes needed',
  'no change needed',
  'no changes',
  'no change',
  'nothing to change',
]);

const CONFIRMATION_PATTERNS = [
  /\bdetails? (?:are|is) correct\b/i,
  /\bsummary (?:is|looks) correct\b/i,
  /\bi(?: am|'m)? confirming (?:my )?order\b/i,
  /\bi would like to proceed(?: with the order)?\b/i,
  /\bplease go ahead\b/i,
  /\bgo ahead and confirm\b/i,
  /\byes[, ]+details? (?:are|is) correct\b/i,
  /\byes\b.*\bconfirm(?: the)? order\b/i,
  /\byes\b.*\bno need to change\b/i,
  /\bno changes? needed\b/i,
  /\bnothing to change\b/i,
];

function normalizeConfirmationText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isClearConfirmation(message: string): boolean {
  const normalizedMessage = normalizeConfirmationText(message);

  return (
    ALLOWED_CONFIRMATIONS.has(normalizedMessage) ||
    CONFIRMATION_PATTERNS.some((pattern) => pattern.test(message))
  );
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
    `Address: ${draft.address}`,
    `Phone Number: ${draft.phone}`,
    ...specialInstructions,
    '',
    'We will contact you shortly with the next update.',
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

async function saveConversationPair(senderId: string, channel: string, userMessage: string, assistantReply: string) {
  await prisma.chatMessage.createMany({
    data: [
      {
        senderId,
        channel,
        role: 'user',
        message: userMessage,
      },
      {
        senderId,
        channel,
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
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
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
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  if (isContactConfirmationMessage(latestAssistantMessage.message)) {
    const reply = buildOrderSummaryReply(draft);
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
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

    const reply = buildSuccessReply(draft, order.id);
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);

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

    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
    };
  }
}
