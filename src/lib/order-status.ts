import prisma from '@/lib/prisma';

interface OrderStatusParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

interface RecentConversationMessage {
  role: string;
  message: string;
}

export interface OrderStatusResult {
  handled: boolean;
  reply?: string;
  orderId?: number;
}

const STATUS_PATTERNS = [
  /\border status\b/i,
  /\bstatus of order\b/i,
  /\bstatus of #\d+\b/i,
  /\bstatus of (?:my|last|previous) order\b/i,
  /\bcheck\b.*\border\b.*\bstatus\b/i,
  /\bcheck\b.*\border\s*#?\d+\b/i,
  /\bcheck again\b.*\border\s*#?\d+\b/i,
  /\bwhat(?:'s| is)\b.*\border\b.*\bstatus\b/i,
  /\bwhat(?:'s| is)\b.*\bstatus\b.*\border\b/i,
  /\bcheck order\s*#?\d+\b/i,
  /\border\s*#?\d+\b.*\bstatus\b/i,
  /\bwhat(?:'s| is)\b.*\b(?:last|previous|my)\s+order\b/i,
];

function looksLikeOrderStatusRequest(message: string): boolean {
  return STATUS_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrderId(message: string): number | null {
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

function extractBareOrderId(message: string): number | null {
  const normalizedMessage = normalizeMessage(message);
  const match = normalizedMessage.match(/^(?:check(?: order)?\s*)?#?(\d+)$/i);

  if (!match?.[1]) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function isStatusFollowUpPrompt(message?: string): boolean {
  return /order id|order status|checking the system|could not find any orders|could not find order|i have checked|reviewed our system|associated with id/i.test(
    message ?? ''
  );
}

function isStatusRetryMessage(message: string): boolean {
  return /\bcheck again\b|\btry again\b|\bdid you get it\b|\bstatus again\b/i.test(message);
}

function looksLikeExplicitOrderStatusLookup(message: string): boolean {
  return /\bcheck\b|\bstatus\b|\btrack\b|\bwhere is\b/i.test(message);
}

function findRecentReferencedOrderId(messages: RecentConversationMessage[]): number | null {
  for (const entry of messages) {
    const directOrderId = extractOrderId(entry.message);

    if (directOrderId) {
      return directOrderId;
    }

    const bareOrderId = extractBareOrderId(entry.message);

    if (bareOrderId) {
      return bareOrderId;
    }
  }

  return null;
}

function buildOrderStatusReply(orderId: number, status: string): string {
  return `Order #${orderId} is currently ${status}.`;
}

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply: string
) {
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

export async function tryHandleOrderStatusRequest(
  params: OrderStatusParams
): Promise<OrderStatusResult> {
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: params.senderId,
      channel: params.channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      role: true,
      message: true,
    },
  });

  const latestAssistantMessage = recentMessages.find((message) => message.role === 'assistant');
  const currentOrderId = extractOrderId(params.currentMessage) ?? extractBareOrderId(params.currentMessage);
  const recentReferencedOrderId = findRecentReferencedOrderId(recentMessages);
  const followUpOrderId =
    isStatusFollowUpPrompt(latestAssistantMessage?.message) ? currentOrderId ?? recentReferencedOrderId : null;
  const retryStatusRequest = isStatusRetryMessage(params.currentMessage);
  const statusRequestDetected =
    looksLikeOrderStatusRequest(params.currentMessage) ||
    Boolean(followUpOrderId) ||
    (Boolean(currentOrderId) && looksLikeExplicitOrderStatusLookup(params.currentMessage)) ||
    (retryStatusRequest && Boolean(recentReferencedOrderId));

  if (!statusRequestDetected) {
    return { handled: false };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: { id: true },
  });

  if (!customer) {
    const reply = 'I could not find any orders for this conversation yet.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const requestedOrderId = currentOrderId ?? followUpOrderId ?? (retryStatusRequest ? recentReferencedOrderId : null);

  const order = await prisma.order.findFirst({
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

  if (!order) {
    const reply = requestedOrderId
      ? `I could not find order #${requestedOrderId} for this conversation.`
      : 'I could not find any orders for this conversation yet.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const reply = buildOrderStatusReply(order.id, order.orderStatus);
  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return {
    handled: true,
    reply,
    orderId: order.id,
  };
}
