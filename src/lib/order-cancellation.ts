import prisma from '@/lib/prisma';
import { cancelOrderById, OrderRequestError } from '@/lib/orders';

interface CancelOrderParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface CancelOrderResult {
  handled: boolean;
  reply?: string;
  orderId?: number;
}

const CANCELLATION_PATTERNS = [
  /\bcancel my order\b/i,
  /\bcancel the order\b/i,
  /\bcancel order\b/i,
  /\bcancel it\b/i,
  /\bcancel this order\b/i,
  /\bi want to cancel\b/i,
  /\bplease cancel\b/i,
  /\bi need to cancel\b/i,
  /\bdelete my order\b/i,
  /\bdelete the order\b/i,
];

function isCancellationRequest(message: string): boolean {
  return CANCELLATION_PATTERNS.some((pattern) => pattern.test(message));
}

function extractRequestedOrderId(message: string): number | null {
  const hashMatch = message.match(/#(\d+)/);

  if (hashMatch?.[1]) {
    return Number.parseInt(hashMatch[1], 10);
  }

  const orderMatch = message.match(/\border\s+(\d+)\b/i);

  if (orderMatch?.[1]) {
    return Number.parseInt(orderMatch[1], 10);
  }

  return null;
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

function buildSuccessReply(orderId: number): string {
  return [
    'Your order has been cancelled successfully.',
    '',
    `Cancelled Order ID: #${orderId}`,
    'The reserved stock has been returned to inventory.',
  ].join('\n');
}

export async function tryCancelLatestOrderFromConversation(
  params: CancelOrderParams
): Promise<CancelOrderResult> {
  if (!isCancellationRequest(params.currentMessage)) {
    return { handled: false };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: { id: true },
  });

  const latestAssistantMessage = await prisma.chatMessage.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
    },
    orderBy: { createdAt: 'desc' },
    select: { message: true },
  });
  const requestedOrderId = extractRequestedOrderId(params.currentMessage);

  if (!customer) {
    const reply = latestAssistantMessage?.message.toLowerCase().includes('order summary')
      ? 'Understood. No order has been placed yet, so nothing was processed. If you want to continue later, just send the details again.'
      : 'I could not find an active order to cancel for this conversation.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  if (!requestedOrderId && latestAssistantMessage?.message.includes('Cancelled Order ID: #')) {
    const cancelledOrderId = extractRequestedOrderId(latestAssistantMessage.message);
    const reply = cancelledOrderId
      ? `Order #${cancelledOrderId} is already cancelled. If you want to cancel a different order, please send the order ID.`
      : 'The latest order in this conversation is already cancelled. If you want to cancel a different order, please send the order ID.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply, orderId: cancelledOrderId ?? undefined };
  }

  const latestOrder = await prisma.order.findFirst({
    where: {
      customerId: customer.id,
      ...(requestedOrderId ? { id: requestedOrderId } : {}),
      ...(params.brand ? { brand: params.brand } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderStatus: true,
    },
  });

  if (!latestOrder) {
    const reply = requestedOrderId
      ? `I could not find order #${requestedOrderId} for this conversation.`
      : latestAssistantMessage?.message.toLowerCase().includes('order summary')
        ? 'Understood. No order has been placed yet, so nothing was processed. If you want to continue later, just send the details again.'
        : 'I could not find an active order to cancel for this conversation.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  if (latestOrder.orderStatus === 'cancelled') {
    const reply = `Order #${latestOrder.id} is already cancelled.`;
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply, orderId: latestOrder.id };
  }

  try {
    const cancelledOrder = await cancelOrderById(prisma, latestOrder.id);
    const reply = buildSuccessReply(cancelledOrder.id);

    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);

    return {
      handled: true,
      reply,
      orderId: cancelledOrder.id,
    };
  } catch (error: unknown) {
    const message =
      error instanceof OrderRequestError
        ? error.message
        : 'Please contact us directly so we can help cancel it manually.';
    const reply = `Sorry, I could not cancel the order automatically. ${message}`;

    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return {
      handled: true,
      reply,
    };
  }
}
