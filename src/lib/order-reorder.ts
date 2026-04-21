import prisma from '@/lib/prisma';
import { buildOrderSummaryReply, resolveDraftFromConversation } from '@/lib/order-draft';

interface ReorderParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface ReorderResult {
  handled: boolean;
  reply?: string;
}

const DIRECT_REORDER_PATTERNS = [
  /\bre[\s-]?order\b/i,
  /\bre[\s-]?open\b/i,
  /\brestore (?:my |the )?order\b/i,
  /\bopen (?:my |the )?(?:previous|last) order\b/i,
  /\border again\b/i,
  /\breplace it\b/i,
  /\breplace the order\b/i,
  /\badd this order\b/i,
  /\bsame item\b/i,
  /\bsame top\b/i,
  /\bsame size\b/i,
  /\bsame one\b/i,
];

const AFFIRMATIVE_REPLY_PATTERNS = [
  /\byes\b/i,
  /\bow\b/i,
  /\bok\b/i,
  /\bokay\b/i,
  /\bekamai\b/i,
  /\bsame\b/i,
];

function looksLikeReorderRequest(message: string): boolean {
  return DIRECT_REORDER_PATTERNS.some((pattern) => pattern.test(message));
}

function looksLikeAffirmativeReply(message: string): boolean {
  return AFFIRMATIVE_REPLY_PATTERNS.some((pattern) => pattern.test(message));
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

export async function tryHandleReorderFromConversation(
  params: ReorderParams
): Promise<ReorderResult> {
  const latestAssistantMessage = await prisma.chatMessage.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      message: true,
    },
  });

  const assistantPromptedSameItem = latestAssistantMessage?.message
    ? /same item|same top|same size|cancelled order|new order/i.test(latestAssistantMessage.message)
    : false;

  if (!looksLikeReorderRequest(params.currentMessage) && !(assistantPromptedSameItem && looksLikeAffirmativeReply(params.currentMessage))) {
    return { handled: false };
  }

  const { draft } = await resolveDraftFromConversation(
    params.senderId,
    params.channel,
    params.brand,
    params.currentMessage
  );

  if (!draft) {
    const reply =
      'Please send the product name, size, and color you want, and I will prepare the order summary right away.';
    await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
    return { handled: true, reply };
  }

  const reply = buildOrderSummaryReply(draft);
  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return { handled: true, reply };
}
