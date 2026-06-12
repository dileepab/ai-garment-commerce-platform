import {
  assistantOfferedGiftOptions,
  extractDeliveryLocationHint,
  extractGiftNoteFromText,
  inferSupportIssueReason,
  looksLikeDeliveryChargeQuestion,
  looksLikeCasualWellbeingQuestion,
  looksLikeCourierProviderQuestion,
  mentionsCurrentOrderReference,
  mentionsLatestOrderReference,
  mentionsOwnedOrderReference,
  mentionsRelativeOrderReference,
  messageReferencesExistingOrder,
  looksLikePreOrderIssuePolicyQuestion,
  looksLikeGiftFollowUp,
  looksLikeGiftUpdateInstruction,
  parseRequestedDateFromMessage,
} from '@/lib/chat/message-utils';
import prisma from '@/lib/prisma';
import { brandsMatch } from '@/lib/brand-aliases';
import {
  buildClarificationReply,
  buildDeliveryReply,
  buildGreetingReply,
  buildMissingOrderLookupReply,
} from '@/lib/chat/reply-builders';
import { getRequestedOrderId, resolveCustomerTargetOrder } from '@/lib/chat/order-flow';
import { getSriLankaDateOnly, getSriLankaToday } from '@/lib/delivery-calendar';
import { buildOrderDetailsReply, buildSelfServiceOrderStatusReply } from '@/lib/order-details';
import {
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
} from '@/lib/order-draft';
import {
  buildSupportContactAcknowledgement,
  buildSupportContactLineFromConfig,
  buildSupportContactReply,
} from '@/lib/customer-support';
import { describeDeliveryEstimates, resolvePaymentMethod } from '@/lib/runtime-config';
import { isOrderMutableStatus } from '@/lib/orders';
import { updateOrderGiftInstructions } from './shared-actions';
import type { ChatContext } from './types';

const COURIER_PROVIDER_LABELS: Record<string, string> = {
  koombiyo: 'Koombiyo Delivery',
  koombio: 'Koombiyo Delivery',
  royalexpress: 'RoyalExpress',
  'royal express': 'RoyalExpress',
  pronto: 'Pronto',
  domex: 'Domex',
  prompt: 'Prompt Express',
};

function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] || '';
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function getCourierProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return COURIER_PROVIDER_LABELS[normalized] ||
    normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRequestedCourierProviderLabels(message: string): string[] {
  const normalized = message.toLowerCase();
  const requested: string[] = [];

  for (const [provider, label] of Object.entries(COURIER_PROVIDER_LABELS)) {
    if (normalized.includes(provider) && !requested.includes(label)) {
      requested.push(label);
    }
  }

  return requested;
}

async function getActiveCourierProviderLabels(brand?: string | null): Promise<string[]> {
  const records = await prisma.courierIntegrationSetting.findMany({
    where: { isActive: true },
    select: { brand: true, provider: true },
    orderBy: [{ brand: 'asc' }, { provider: 'asc' }],
  });
  const matchingRecords = brand
    ? records.filter((record) => brandsMatch(record.brand, brand))
    : records;

  return Array.from(
    new Set(matchingRecords.map((record) => getCourierProviderLabel(record.provider)))
  );
}

export async function handle_greeting(ctx: ChatContext) {
  const { customer, input, mergedContact, settings } = ctx;
  const { finalizeReply } = ctx.helpers;

  if (looksLikeCasualWellbeingQuestion(input.currentMessage)) {
    return finalizeReply({
      reply: 'I am doing well, thank you. I can help with available items, sizes, COD, delivery, or an order.',
      assistantReplyKind: 'greeting',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: buildGreetingReply(mergedContact.name || customer?.name, settings.displayName),
    assistantReplyKind: 'greeting',
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_order_status(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
    input,
    latestOrder,
    state,
  } = ctx;
  const { clearPendingConversationState, finalizeReply, findCustomerOrderById } = ctx.helpers;

  if (!customer) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
    });

    return finalizeReply({
      reply: buildMissingOrderLookupReply(requestedOrderId, 'status'),
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  const targetOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    preferLatestOrderReference:
      mentionsLatestOrderReference(input.currentMessage) ||
      mentionsOwnedOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!targetOrder) {
    return finalizeReply({
      reply: explicitOrderId || followUpMissingOrderId || aiAction.orderId
        ? `I could not find order #${explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId} for this conversation.`
        : 'I could not find any orders for this conversation yet.',
      nextState: {
        lastMissingOrderId: explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId ?? null,
      },
    });
  }

  return finalizeReply({
    reply: buildSelfServiceOrderStatusReply(targetOrder),
    orderId: targetOrder.id,
    assistantReplyKind: 'order_status',
    nextState: {
      ...(state.orderDraft ? {} : clearPendingConversationState(state)),
      lastReferencedOrderId: targetOrder.id,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_order_details(ctx: ChatContext) {
  const {
    aiAction,
    customer,
    explicitOrderId,
    followUpMissingOrderId,
    input,
    latestOrder,
    state,
  } = ctx;
  const { clearPendingConversationState, finalizeReply, findCustomerOrderById } = ctx.helpers;

  if (!customer) {
    const requestedOrderId = getRequestedOrderId({
      explicitOrderId,
      followUpMissingOrderId,
      aiOrderId: aiAction.orderId,
      lastReferencedOrderId: state.lastReferencedOrderId,
    });

    return finalizeReply({
      reply: buildMissingOrderLookupReply(requestedOrderId, 'details'),
      nextState: {
        lastMissingOrderId: requestedOrderId,
      },
    });
  }

  const targetOrder = await resolveCustomerTargetOrder({
    explicitOrderId,
    followUpMissingOrderId,
    aiOrderId: aiAction.orderId,
    lastReferencedOrderId: state.lastReferencedOrderId,
    latestOrder,
    preferLatestOrderReference:
      mentionsLatestOrderReference(input.currentMessage) ||
      mentionsOwnedOrderReference(input.currentMessage),
    findCustomerOrderById,
  });

  if (!targetOrder) {
    return finalizeReply({
      reply: explicitOrderId || followUpMissingOrderId || aiAction.orderId
        ? `I could not find order #${explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId} for this conversation.`
        : 'I could not find any orders for this conversation yet.',
      nextState: {
        lastMissingOrderId: explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId ?? null,
      },
    });
  }

  return finalizeReply({
    reply: buildOrderDetailsReply(targetOrder, ctx.settings.delivery),
    orderId: targetOrder.id,
    assistantReplyKind: 'order_details',
    nextState: {
      ...(state.orderDraft ? {} : clearPendingConversationState(state)),
      lastReferencedOrderId: targetOrder.id,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_delivery_question(ctx: ChatContext) {
  const {
    aiAction,
    input,
    latestActiveOrder,
    mergedContact,
    settings,
    state,
  } = ctx;
  const { finalizeReply } = ctx.helpers;
  const deliveryEstimateForAddress = (address: string) =>
    getDeliveryEstimateForAddress(address, settings.delivery);
  const deliveryChargeForAddress = (address: string) =>
    getDeliveryChargeForAddress(address, settings.delivery);
  const includeCharge = looksLikeDeliveryChargeQuestion(input.currentMessage);

  if (looksLikeCourierProviderQuestion(input.currentMessage)) {
    const activeProviderLabels = await getActiveCourierProviderLabels(input.brand || ctx.brandFilter);
    const requestedProviderLabels = getRequestedCourierProviderLabels(input.currentMessage);
    const unavailableRequestedProviders = requestedProviderLabels.filter(
      (provider) => !activeProviderLabels.includes(provider)
    );
    const brandLabel = input.brand || ctx.brandFilter || settings.displayName || 'this brand';

    if (activeProviderLabels.length > 0) {
      const availableText = formatList(activeProviderLabels);
      const unavailableText = unavailableRequestedProviders.length > 0
        ? ` ${formatList(unavailableRequestedProviders)} ${unavailableRequestedProviders.length === 1 ? 'is' : 'are'} not available for ${brandLabel} right now.`
        : '';

      return finalizeReply({
        reply: `For ${brandLabel}, the available courier service is ${availableText}.${unavailableText}`,
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: `Courier service is not active for ${brandLabel} yet. Once a courier account is enabled for this brand, I can confirm the available courier before you place the order.`,
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  const locationHint = aiAction.deliveryLocation || extractDeliveryLocationHint(input.currentMessage);
  const requestedDate =
    parseRequestedDateFromMessage(input.currentMessage, getSriLankaToday()) ||
    (aiAction.requestedDate ? new Date(aiAction.requestedDate) : null);

  if (state.orderDraft) {
    return finalizeReply({
      reply: buildDeliveryReply({
        address: locationHint || state.orderDraft.address,
        referenceDate: getSriLankaToday(),
        requestedDate,
        isDraft: true,
        getDeliveryEstimateForAddress: deliveryEstimateForAddress,
        getDeliveryChargeForAddress: deliveryChargeForAddress,
        includeCharge,
        defaultDeliveryText: describeDeliveryEstimates(settings),
      }),
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (locationHint && !messageReferencesExistingOrder(input.currentMessage)) {
    return finalizeReply({
      reply: buildDeliveryReply({
        address: locationHint,
        referenceDate: getSriLankaToday(),
        requestedDate,
        isDraft: true,
        getDeliveryEstimateForAddress: deliveryEstimateForAddress,
        getDeliveryChargeForAddress: deliveryChargeForAddress,
        includeCharge,
        defaultDeliveryText: describeDeliveryEstimates(settings),
      }),
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (latestActiveOrder) {
    return finalizeReply({
      reply: buildDeliveryReply({
        address: locationHint || latestActiveOrder.deliveryAddress,
        referenceDate: getSriLankaDateOnly(latestActiveOrder.createdAt),
        requestedDate,
        isDraft: false,
        existingOrderStatus: latestActiveOrder.orderStatus,
        getDeliveryEstimateForAddress: deliveryEstimateForAddress,
        getDeliveryChargeForAddress: deliveryChargeForAddress,
        includeCharge,
        defaultDeliveryText: describeDeliveryEstimates(settings),
      }),
      orderId: latestActiveOrder.id,
      nextState: {
        lastReferencedOrderId: latestActiveOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: buildDeliveryReply({
      address: locationHint || mergedContact.address,
      referenceDate: getSriLankaToday(),
      requestedDate,
      isDraft: true,
      getDeliveryEstimateForAddress: deliveryEstimateForAddress,
      getDeliveryChargeForAddress: deliveryChargeForAddress,
      includeCharge,
      defaultDeliveryText: describeDeliveryEstimates(settings),
    }),
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_payment_question(ctx: ChatContext) {
  const { aiAction, input, settings, state } = ctx;
  const { finalizeReply } = ctx.helpers;
  const paymentMethod = resolvePaymentMethod(
    aiAction.paymentMethod,
    input.currentMessage,
    settings
  );
  const paymentWorksText = paymentMethod.toLowerCase().includes('transfer')
    ? 'online transfer works'
    : `${paymentMethod} works`;

  if (state.orderDraft) {
    const nextDraft = {
      ...state.orderDraft,
      paymentMethod,
    };
    const baseReply = `Yes, ${paymentWorksText} for us. I've set the payment method to ${paymentMethod}.`;

    if (state.pendingStep === 'order_confirmation') {
      return finalizeReply({
        reply: `${baseReply}\n\n${buildOrderSummaryReply(nextDraft)}`,
        nextState: {
          pendingStep: 'order_confirmation',
          orderDraft: nextDraft,
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: baseReply,
      nextState: {
        orderDraft: nextDraft,
        lastMissingOrderId: null,
      },
    });
  }

  const supportLine = buildSupportContactLineFromConfig(settings.support).toLowerCase();

  return finalizeReply({
    reply: `Yes, ${paymentWorksText} for us. I'll note the payment method when you're ready to place the order. If you need help with a payment confirmation, ${supportLine}`,
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_exchange_question(ctx: ChatContext) {
  const { aiAction, customer, explicitOrderId, input, latestOrder, latestActiveOrder, state } = ctx;
  const { escalateToSupport, finalizeReply } = ctx.helpers;
  const detectedIssueReason = inferSupportIssueReason(input.currentMessage);
  const isPolicyQuestion = looksLikePreOrderIssuePolicyQuestion(
    input.currentMessage,
    detectedIssueReason
  );

  // If the customer has a delivered order they are likely referencing, treat
  // this as an actionable exchange request and escalate to the support team so
  // an admin can create a formal ReturnRequest. Otherwise give a policy reply.
  const relatedOrderId =
    explicitOrderId ??
    aiAction.orderId ??
    state.lastReferencedOrderId ??
    latestOrder?.id ??
    latestActiveOrder?.id ??
    null;

  if (customer && relatedOrderId && !isPolicyQuestion) {
    return escalateToSupport('exchange_request', relatedOrderId);
  }

  // No order context — give a policy reply and let the customer follow up
  // with their order details. The next message with an order reference will
  // re-trigger escalation via inferSupportIssueReason if needed.
  const isSinhala = /[\u0D80-\u0DFF]/.test(input.currentMessage);

  if (detectedIssueReason === 'refund_or_damage') {
    return finalizeReply({
      reply: isSinhala
        ? 'භාණ්ඩය ලැබුණු විට හානි වී තිබුණොත්, කරුණාකර පැකේජය සහ භාණ්ඩය එම තත්ත්වයෙන්ම තබාගෙන පැහැදිලි ඡායාරූප කිහිපයක් ගන්න. ඉන්පසු order number එකත් සමඟ අපට එවන්න. අපි තත්ත්වය පරීක්ෂා කර replacement, exchange, හෝ refund option එකක් arrange කරන්නම්.'
        : 'If an item arrives damaged, please keep the package and item as they are, take clear photos of the item and packaging, and send them with your order number after delivery. We will check it and arrange the right replacement, exchange, or refund option.',
      nextState: {
        lastMissingOrderId: null,
      },
      skipLocalization: isSinhala,
    });
  }

  return finalizeReply({
    reply: isSinhala
      ? 'ඔව්, size/fit එක නොගැලපුණොත් exchange එකක් බලන්න පුළුවන්. Item එක භාවිතා නොකර, tags/packaging එක්ක තබාගන්න. Delivery එක ලැබුණාට පස්සේ order number එක සහ ඔබට අවශ්‍ය size/item එක එවන්න. Stock availability සහ item condition අනුව අපි option එක confirm කරන්නම්.'
      : "Yes, exchange is possible if the size or fit is not right after delivery, subject to item condition and stock availability. Please keep the item unused with its tags/packaging, then send your order number and the size or item you want instead.",
    nextState: {
      lastMissingOrderId: null,
    },
    skipLocalization: isSinhala,
  });
}

export async function handle_gift_request(ctx: ChatContext) {
  const {
    aiAction,
    explicitOrderId,
    input,
    latestActiveOrder,
    latestAssistantText,
    latestOrder,
    state,
  } = ctx;
  const {
    clearPendingConversationState,
    finalizeReply,
    findCustomerOrderById,
  } = ctx.helpers;

  const giftNote =
    aiAction.giftNote ||
    extractGiftNoteFromText(input.currentMessage) ||
    extractGiftNoteFromText(latestAssistantText) ||
    'your requested note';
  const baseReply = `Yes, we can pack it as a gift and include the note "${giftNote}".`;
  const referencesSpecificStoredOrder =
    explicitOrderId !== null ||
    mentionsLatestOrderReference(input.currentMessage) ||
    mentionsCurrentOrderReference(input.currentMessage);

  if (state.orderDraft && !referencesSpecificStoredOrder) {
    const nextDraft = {
      ...state.orderDraft,
      giftWrap: true,
      giftNote,
    };

    if (state.pendingStep === 'order_confirmation') {
      return finalizeReply({
        reply: `${baseReply}\n\n${buildOrderSummaryReply(nextDraft)}`,
        nextState: {
          pendingStep: 'order_confirmation',
          orderDraft: nextDraft,
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: baseReply,
      nextState: {
        orderDraft: nextDraft,
        lastMissingOrderId: null,
      },
    });
  }

  let targetOrderForGift =
    explicitOrderId !== null ? await findCustomerOrderById(explicitOrderId) : null;

  if (explicitOrderId === null) {
    if (mentionsLatestOrderReference(input.currentMessage)) {
      targetOrderForGift = latestOrder || latestActiveOrder;
    } else if (mentionsCurrentOrderReference(input.currentMessage) && state.lastReferencedOrderId) {
      targetOrderForGift = await findCustomerOrderById(state.lastReferencedOrderId);
    } else if (mentionsRelativeOrderReference(input.currentMessage)) {
      targetOrderForGift = latestActiveOrder || latestOrder;
    } else if (state.lastReferencedOrderId) {
      const referencedOrder = await findCustomerOrderById(state.lastReferencedOrderId);
      targetOrderForGift =
        referencedOrder && referencedOrder.orderStatus !== 'cancelled'
          ? referencedOrder
          : latestActiveOrder || latestOrder;
    } else {
      targetOrderForGift = latestActiveOrder || latestOrder;
    }
  }

  if (explicitOrderId !== null && !targetOrderForGift) {
    return finalizeReply({
      reply: buildMissingOrderLookupReply(explicitOrderId, 'details'),
      nextState: {
        lastMissingOrderId: explicitOrderId,
      },
    });
  }

  const shouldApplyGiftUpdate = Boolean(
    targetOrderForGift &&
      (
        messageReferencesExistingOrder(input.currentMessage) ||
        looksLikeGiftUpdateInstruction(input.currentMessage) ||
        (assistantOfferedGiftOptions(latestAssistantText) && looksLikeGiftFollowUp(input.currentMessage))
      )
  );

  if (
    targetOrderForGift &&
    !isOrderMutableStatus(targetOrderForGift.orderStatus) &&
    shouldApplyGiftUpdate
  ) {
    return finalizeReply({
      reply: `Order #${targetOrderForGift.id} is already ${targetOrderForGift.orderStatus}, so I cannot add gift instructions to it. Please send an active order ID or place a new order.`,
      orderId: targetOrderForGift.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrderForGift.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (
    targetOrderForGift &&
    shouldApplyGiftUpdate
  ) {
    const updatedOrder = await updateOrderGiftInstructions(targetOrderForGift.id, giftNote);

    return finalizeReply({
      reply: `I have updated order #${updatedOrder.id} with gift wrap and the note "${giftNote}".\n\n${buildOrderDetailsReply(
        updatedOrder,
        ctx.settings.delivery
      )}`,
      orderId: updatedOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: updatedOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (targetOrderForGift && isOrderMutableStatus(targetOrderForGift.orderStatus)) {
    return finalizeReply({
      reply:
        giftNote !== 'your requested note'
          ? `Yes, we can pack order #${targetOrderForGift.id} as a gift and include the note "${giftNote}". If you want me to apply it to this order, please say "add it to my last order".`
          : `Yes, we can pack order #${targetOrderForGift.id} as a gift. If you want me to apply it to this order, please say "add gift wrap to my last order" and include the note you want.`,
      orderId: targetOrderForGift.id,
      nextState: {
        lastReferencedOrderId: targetOrderForGift.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (targetOrderForGift) {
    return finalizeReply({
      reply: `Order #${targetOrderForGift.id} is already ${targetOrderForGift.orderStatus}, so I cannot add gift instructions to it. Please send an active order ID or place a new order.`,
      orderId: targetOrderForGift.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: targetOrderForGift.id,
        lastMissingOrderId: null,
      },
    });
  }

  return finalizeReply({
    reply: `${baseReply} Please send the item details whenever you are ready to place the order.`,
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_support_contact_request(ctx: ChatContext) {
  const {
    aiAction,
    explicitOrderId,
    latestActiveOrder,
    latestOrder,
    state,
  } = ctx;
  const { clearPendingConversationState, finalizeReply } = ctx.helpers;

  const targetOrderId =
    explicitOrderId ??
    aiAction.orderId ??
    state.lastReferencedOrderId ??
    latestActiveOrder?.id ??
    latestOrder?.id ??
    null;

  return finalizeReply({
    reply: buildSupportContactReply({
      orderId: targetOrderId,
      supportConfig: ctx.settings.support,
    }),
    orderId: targetOrderId,
    assistantReplyKind: 'support_contact',
    nextState: {
      ...clearPendingConversationState(state),
      lastReferencedOrderId: targetOrderId,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_fallback(ctx: ChatContext) {
  const { latestActiveOrder, latestOrder, state } = ctx;
  const { escalateToSupport, finalizeReply } = ctx.helpers;
  const unclearMessageCount =
    state.lastAssistantReplyKind === 'fallback' ? state.unclearMessageCount + 1 : 1;

  if (unclearMessageCount >= 2) {
    return escalateToSupport(
      'unclear_request',
      state.lastReferencedOrderId ?? latestActiveOrder?.id ?? latestOrder?.id ?? null
    );
  }

  return finalizeReply({
    reply: buildClarificationReply(state, ctx.settings.support),
    assistantReplyKind: 'fallback',
    nextState: {
      unclearMessageCount,
      lastMissingOrderId: null,
    },
  });
}

export async function handle_thanks_acknowledgement(ctx: ChatContext) {
  const { latestActiveOrder, latestOrder, state } = ctx;

  if (state.lastAssistantReplyKind === 'support_contact') {
    const orderId =
      state.lastReferencedOrderId ??
      latestActiveOrder?.id ??
      latestOrder?.id ??
      null;

    return ctx.helpers.finalizeReply({
      reply: buildSupportContactAcknowledgement({
        orderId,
        supportConfig: ctx.settings.support,
      }),
      assistantReplyKind: 'support_contact',
      nextState: {
        lastReferencedOrderId: orderId,
        lastMissingOrderId: null,
      },
    });
  }

  return ctx.helpers.finalizeReply({
    reply: "You're welcome! Let me know if there's anything else I can help with.",
    nextState: {
      lastMissingOrderId: null,
    },
  });
}
