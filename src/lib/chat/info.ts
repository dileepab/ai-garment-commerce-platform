import {
  assistantOfferedGiftOptions,
  extractDeliveryLocationHint,
  extractGiftNoteFromText,
  mentionsRelativeOrderReference,
  messageReferencesExistingOrder,
  looksLikeGiftFollowUp,
  looksLikeGiftUpdateInstruction,
  parseRequestedDateFromMessage,
} from '@/lib/chat/message-utils';
import {
  buildDeliveryReply,
  buildGreetingReply,
  buildMissingOrderLookupReply,
} from '@/lib/chat/reply-builders';
import { getRequestedOrderId, resolveCustomerTargetOrder } from '@/lib/chat/order-flow';
import { getSriLankaDateOnly, getSriLankaToday } from '@/lib/delivery-calendar';
import { buildOrderDetailsReply, buildOrderStatusReply } from '@/lib/order-details';
import {
  buildOrderSummaryReply,
  getDeliveryEstimateForAddress,
} from '@/lib/order-draft';
import {
  buildSupportContactAcknowledgement,
  buildSupportContactLine,
  buildSupportContactReply,
} from '@/lib/customer-support';
import { updateOrderGiftInstructions } from './shared-actions';
import type { ChatContext } from './types';

export async function handle_greeting(ctx: ChatContext) {
  const { brandFilter, customer, mergedContact } = ctx;
  const { finalizeReply } = ctx.helpers;

  return finalizeReply({
    reply: buildGreetingReply(mergedContact.name || customer?.name, brandFilter),
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
    reply: buildOrderStatusReply(targetOrder.id, targetOrder.orderStatus),
    orderId: targetOrder.id,
    assistantReplyKind: 'order_status',
    nextState: {
      ...clearPendingConversationState(state),
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
    reply: buildOrderDetailsReply(targetOrder),
    orderId: targetOrder.id,
    assistantReplyKind: 'order_details',
    nextState: {
      ...clearPendingConversationState(state),
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
    state,
  } = ctx;
  const { finalizeReply } = ctx.helpers;

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
        getDeliveryEstimateForAddress,
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
        getDeliveryEstimateForAddress,
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
        getDeliveryEstimateForAddress,
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
      getDeliveryEstimateForAddress,
    }),
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_payment_question(ctx: ChatContext) {
  const { aiAction, state } = ctx;
  const { finalizeReply } = ctx.helpers;
  const paymentMethod = aiAction.paymentMethod || 'Online Transfer';

  if (state.orderDraft) {
    const nextDraft = {
      ...state.orderDraft,
      paymentMethod,
    };
    const baseReply = `Yes, ${paymentMethod === 'Online Transfer' ? 'online transfer is accepted' : `${paymentMethod} is accepted`}, and I have updated the payment method to ${paymentMethod}.`;

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

  return finalizeReply({
    reply: `Yes, online transfer is accepted. Once you are ready to order, I can note the payment method for you. If you need help with payment confirmation, ${buildSupportContactLine().toLowerCase()}`,
    nextState: {
      lastMissingOrderId: null,
    },
  });
}

export async function handle_exchange_question(ctx: ChatContext) {
  return ctx.helpers.finalizeReply({
    reply: `If there is a size issue, please message us as soon as you receive the parcel and we will help you with the exchange process, subject to stock availability. If the issue needs a person, ${buildSupportContactLine().toLowerCase()}`,
    nextState: {
      lastMissingOrderId: null,
    },
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

  let targetOrderForGift =
    explicitOrderId !== null ? await findCustomerOrderById(explicitOrderId) : null;

  if (explicitOrderId === null) {
    if (mentionsRelativeOrderReference(input.currentMessage)) {
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

  if (
    targetOrderForGift &&
    targetOrderForGift.orderStatus === 'cancelled' &&
    messageReferencesExistingOrder(input.currentMessage)
  ) {
    return finalizeReply({
      reply: `Order #${targetOrderForGift.id} is already cancelled, so I cannot add gift instructions to it. Please send an active order ID or place a new order.`,
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
    (
      messageReferencesExistingOrder(input.currentMessage) ||
      looksLikeGiftUpdateInstruction(input.currentMessage) ||
      (assistantOfferedGiftOptions(latestAssistantText) && looksLikeGiftFollowUp(input.currentMessage))
    )
  ) {
    const updatedOrder = await updateOrderGiftInstructions(targetOrderForGift.id, giftNote);

    return finalizeReply({
      reply: `I have updated order #${updatedOrder.id} with gift wrap and the note "${giftNote}".\n\n${buildOrderDetailsReply(
        updatedOrder
      )}`,
      orderId: updatedOrder.id,
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: updatedOrder.id,
        lastMissingOrderId: null,
      },
    });
  }

  if (state.orderDraft) {
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

  if (targetOrderForGift && targetOrderForGift.orderStatus !== 'cancelled') {
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
    reply: buildSupportContactReply({ orderId: targetOrderId }),
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
  return ctx.helpers.finalizeReply({ reply: "I'm sorry, I didn't quite catch that." });
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
      reply: buildSupportContactAcknowledgement({ orderId }),
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
