import prisma from '@/lib/prisma';
import { extractContactDetailsFromText } from '@/lib/contact-profile';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getMissingDraftFields,
  isContactConfirmationMessage,
  isOrderSummaryMessage,
  ResolvedOrderDraft,
  resolveDraftFromConversation,
} from '@/lib/order-draft';
import { isClearConfirmation } from '@/lib/order-confirmation';

interface OrderContactUpdateParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface OrderContactUpdateResult {
  handled: boolean;
  reply?: string;
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

export async function tryHandleOrderContactUpdate(
  params: OrderContactUpdateParams
): Promise<OrderContactUpdateResult> {
  if (isClearConfirmation(params.currentMessage)) {
    return { handled: false };
  }

  const latestAssistantMessage = await prisma.chatMessage.findFirst({
    where: {
      senderId: params.senderId,
      channel: params.channel,
      role: 'assistant',
    },
    orderBy: { createdAt: 'desc' },
    select: { message: true },
  });

  const assistantText = latestAssistantMessage?.message || '';

  if (!isContactConfirmationMessage(assistantText) && !isOrderSummaryMessage(assistantText)) {
    return { handled: false };
  }

  const extractedContactDetails = extractContactDetailsFromText(params.currentMessage);

  if (
    !extractedContactDetails.name &&
    !extractedContactDetails.address &&
    !extractedContactDetails.phone
  ) {
    return { handled: false };
  }

  const { draft } = await resolveDraftFromConversation(
    params.senderId,
    params.channel,
    params.brand,
    params.currentMessage
  );

  if (!draft) {
    return { handled: false };
  }

  let reply = '';

  if (isContactConfirmationMessage(assistantText)) {
    reply = buildContactConfirmationReply(draft.name, draft.address, draft.phone);

    const variantReply = buildMissingVariantReply(draft);

    if (variantReply) {
      reply = `${reply}\n\n${variantReply}`;
    }
  } else {
    reply = buildOrderSummaryReply(draft);
  }

  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return { handled: true, reply };
}
