import prisma from '@/lib/prisma';
import {
  extractExplicitOrderIdFromMessage,
  extractMaximumQuantityFromAssistantMessage,
  extractStandaloneQuantityFromMessage,
  extractRequestedProductTypes,
  inferSupportIssueReason,
  isGreetingMessage,
  isLowerQuantityPrompt,
  isNeutralAcknowledgement,
  isUnambiguousCancellationMessage,
  looksLikeGiftRequest,
  looksLikeHumanEscalationRequest,
  looksLikeMissingOrderFollowUp,
  looksLikeOrderDetailsRequest,
  looksLikeOrderStatusRequest,
  looksLikeSameItemMessage,
  looksLikeTotalQuestion,
  mentionsRelativeOrderReference,
  messageReferencesExistingOrder,
  normalizeText,
  normalizeColor,
  normalizeSize,
  scoreProductMatch,
  splitCsv,
} from '@/lib/chat/message-utils';
import {
  buildAcknowledgementReply,
  buildGreetingReply,
  buildMissingContactPrompt,
  buildSizeChartReply,
} from '@/lib/chat/reply-builders';
import { routeCustomerMessageWithAi } from '@/lib/ai-action-router';
import {
  clearPendingConversationState,
  loadConversationState,
  saveConversationState,
  type AssistantReplyKind,
  type ConversationStateData,
  type SupportWorkflowMode,
} from '@/lib/conversation-state';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  type ResolvedOrderDraft,
} from '@/lib/order-draft';
import {
  extractContactDetailsFromText,
  getMissingContactFields,
  mergeContactDetails,
} from '@/lib/contact-profile';
import { isClearConfirmation } from '@/lib/order-confirmation';
import {
  buildHumanSupportReply,
  buildSupportConversationSummary,
  upsertSupportEscalation,
  type SupportIssueReason,
} from '@/lib/customer-support';
import { isActiveOrderStatus } from '@/lib/order-status-display';
import type { ChatContext } from './chat/types';
import type {
  CustomerMessageInput,
  CustomerMessageResult,
} from './chat/contracts';
import { upsertCustomerContact } from './chat/shared-actions';
import * as CatalogHandlers from './chat/catalog';
import * as OrderingHandlers from './chat/orders';
import * as InfoHandlers from './chat/info';
import { logInfo, logWarn } from '@/lib/app-log';

const LOW_CONFIDENCE_ACTION_THRESHOLD = 0.55;
const ACTIONS_REQUIRING_HIGH_CONFIDENCE = new Set([
  'place_order',
  'confirm_pending',
  'cancel_order',
  'reorder_last',
  'update_order_quantity',
  'gift_request',
]);

function isBotPausedForSupport(mode: SupportWorkflowMode): boolean {
  return mode === 'handoff_requested' || mode === 'human_active';
}

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply?: string | null
) {
  const messages = [
    {
      senderId,
      channel,
      role: 'user',
      message: userMessage,
    },
  ];

  if (assistantReply) {
    messages.push({
      senderId,
      channel,
      role: 'assistant',
      message: assistantReply,
    });
  }

  await prisma.chatMessage.createMany({
    data: messages,
  });
}

export async function routeCustomerMessage(
  input: CustomerMessageInput
): Promise<CustomerMessageResult> {
  logInfo('Chat Orchestrator', 'Routing customer message.', {
    senderId: input.senderId,
    channel: input.channel,
    brand: input.brand || null,
    hasImage: Boolean(input.imageUrl),
  });

  const state = await loadConversationState(input.senderId, input.channel);

  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: input.senderId,
      channel: input.channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      role: true,
      message: true,
    },
  });

  const customer = await prisma.customer.findUnique({
    where: { externalId: input.senderId },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 6,
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
      },
    },
  });

  const brandFilter = input.brand || customer?.preferredBrand || undefined;
  const globalProducts = await prisma.product.findMany({
    where: { status: 'active' },
    include: {
      inventory: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  
  const products = brandFilter 
    ? globalProducts.filter(product => product.brand === brandFilter)
    : globalProducts;

  const latestOrder = customer?.orders[0] || null;
  const latestActiveOrder =
    customer?.orders.find((order) => isActiveOrderStatus(order.orderStatus)) || null;
  const latestAssistantMessage = recentMessages.find((message) => message.role === 'assistant');
  const latestAssistantText = latestAssistantMessage?.message || '';
  const explicitOrderId = extractExplicitOrderIdFromMessage(input.currentMessage);
  const requestedProductTypes = extractRequestedProductTypes(input.currentMessage);
  const followUpMissingOrderId =
    explicitOrderId === null &&
    state.lastMissingOrderId &&
    looksLikeMissingOrderFollowUp(input.currentMessage) &&
    !mentionsRelativeOrderReference(input.currentMessage)
      ? state.lastMissingOrderId
      : null;
  const baseContact = mergeContactDetails(
    {
      name: state.orderDraft?.name || customer?.name || input.customerName || '',
      address:
        state.orderDraft?.address ||
        latestActiveOrder?.deliveryAddress ||
        latestOrder?.deliveryAddress ||
        '',
      phone: state.orderDraft?.phone || customer?.phone || '',
    },
    {}
  );

  const aiAction =
    (await routeCustomerMessageWithAi({
      brand: brandFilter,
      currentMessage: input.currentMessage,
      pendingStep: state.pendingStep,
      knownContact: baseContact,
      lastReferencedOrderId: state.lastReferencedOrderId,
      latestOrderId: latestOrder?.id ?? null,
      latestActiveOrderId: latestActiveOrder?.id ?? null,
      recentMessages: [...recentMessages].reverse(),
      products: products.map((product) => ({
        name: product.name,
        style: product.style,
        price: product.price,
        sizes: product.sizes,
        colors: product.colors,
        availableQty: product.inventory?.availableQty ?? product.stock,
      })),
      imageUrl: input.imageUrl,
    })) || {
      action: 'fallback',
      confidence: 0,
      orderId: null,
      productName: null,
      productType: null,
      questionType: null,
      quantity: null,
      size: null,
      color: null,
      paymentMethod: null,
      giftWrap: null,
      giftNote: null,
      requestedDate: null,
      deliveryLocation: null,
      contact: {
        name: null,
        address: null,
        phone: null,
      },
    };

  const singleMissingField =
    state.pendingStep === 'contact_collection' && state.orderDraft
      ? getMissingContactFields({
          name: state.orderDraft.name,
          address: state.orderDraft.address,
          phone: state.orderDraft.phone,
        })[0]
      : undefined;

  const extractedContact = extractContactDetailsFromText(input.currentMessage, singleMissingField);
  const mergedContact = mergeContactDetails(baseContact, {
    ...extractedContact,
    name: aiAction.contact.name || extractedContact.name,
    address: aiAction.contact.address || extractedContact.address,
    phone: aiAction.contact.phone || extractedContact.phone,
  });
  const persistedSupportMode = state.supportMode;
  const conversationSupportMode =
    persistedSupportMode === 'resolved' ? 'bot_active' : persistedSupportMode;
  const activeSupportEscalation = await prisma.supportEscalation.findFirst({
    where: {
      senderId: input.senderId,
      channel: input.channel,
      status: {
        not: 'resolved',
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  const currentSupportMode: SupportWorkflowMode =
    activeSupportEscalation?.status === 'in_progress'
      ? 'human_active'
      : conversationSupportMode;

  function findProductByName(productName?: string | null) {
    if (!productName) {
      return null;
    }

    let bestMatch: (typeof products)[number] | null = null;
    let bestScore = 0;

    for (const product of products) {
      const score = scoreProductMatch(product, productName);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  async function findCustomerOrderById(orderId?: number | null) {
    if (!customer || !orderId) {
      return null;
    }

    return prisma.order.findFirst({
      where: {
        customerId: customer.id,
        id: orderId,
        ...(brandFilter ? { brand: brandFilter } : {}),
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

  function buildDraftFromSource(
    product: (typeof products)[number],
    previousDraft?: ResolvedOrderDraft | null
  ): ResolvedOrderDraft {
    const sizes = splitCsv(product.sizes).map((size) => size.toUpperCase());
    const colors = splitCsv(product.colors);
    const size = normalizeSize(aiAction.size, sizes) || previousDraft?.size;
    const color = normalizeColor(aiAction.color, colors) || previousDraft?.color;
    const quantity = aiAction.quantity || previousDraft?.quantity || 1;
    const paymentMethod =
      aiAction.paymentMethod ||
      previousDraft?.paymentMethod ||
      (normalizeText(input.currentMessage).includes('online transfer') ? 'Online Transfer' : 'COD');
    const giftWrap =
      aiAction.giftWrap ?? previousDraft?.giftWrap ?? looksLikeGiftRequest(input.currentMessage);
    const giftNote =
      aiAction.giftNote ||
      previousDraft?.giftNote ||
      (/happy birthday/i.test(input.currentMessage) ? 'Happy Birthday' : undefined);
    const address = mergedContact.address || previousDraft?.address || '';
    const deliveryCharge = getDeliveryChargeForAddress(address);

    return {
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      quantity,
      size,
      color,
      price: product.price,
      deliveryCharge,
      total: product.price * quantity + deliveryCharge,
      paymentMethod,
      giftWrap,
      giftNote,
      deliveryEstimate: getDeliveryEstimateForAddress(address),
      name: mergedContact.name || previousDraft?.name || '',
      address,
      phone: mergedContact.phone || previousDraft?.phone || '',
    };
  }

  async function finalizeReply(params: {
    reply: string | null;
    nextState?: Partial<ConversationStateData>;
    imagePath?: string;
    imagePaths?: string[];
    carouselProducts?: Array<{
      id: number;
      name: string;
      price: number;
      sizes: string;
      colors: string;
      imageUrl?: string;
    }>;
    orderId?: number | null;
    assistantReplyKind?: AssistantReplyKind;
  }): Promise<CustomerMessageResult> {
    const assistantReplyKind = params.assistantReplyKind || 'generic';
    const shouldPersistState =
      Boolean(params.nextState) || Boolean(params.assistantReplyKind);
    const nextState = shouldPersistState
      ? await saveConversationState(input.senderId, input.channel, {
          ...state,
          ...params.nextState,
          lastAssistantReplyKind: assistantReplyKind,
          unclearMessageCount:
            assistantReplyKind === 'fallback'
              ? params.nextState?.unclearMessageCount ?? state.unclearMessageCount
              : 0,
        })
      : state;

    await saveConversationPair(input.senderId, input.channel, input.currentMessage, params.reply);

    if (nextState.orderDraft || mergedContact.name || mergedContact.phone) {
      await upsertCustomerContact({
        senderId: input.senderId,
        channel: input.channel,
        preferredBrand: brandFilter,
        currentCustomerId: customer?.id,
        currentName: customer?.name,
        currentPhone: customer?.phone,
        contact: mergedContact,
      });
    }

    logInfo('Chat Orchestrator', 'Finalized customer reply.', {
      senderId: input.senderId,
      channel: input.channel,
      assistantReplyKind,
      pendingStep: nextState.pendingStep,
      supportMode: nextState.supportMode,
      hasReply: Boolean(params.reply),
      hasMedia: Boolean(params.imagePath || params.imagePaths?.length || params.carouselProducts?.length),
      orderId: params.orderId ?? null,
    });

    return {
      reply: params.reply,
      imagePath: params.imagePath ?? params.imagePaths?.[0],
      imagePaths: params.imagePaths ?? (params.imagePath ? [params.imagePath] : undefined),
      carouselProducts: params.carouselProducts,
      orderId: params.orderId ?? null,
    };
  }

  async function escalateToSupport(reason: SupportIssueReason, orderId?: number | null) {
    logWarn('Chat Orchestrator', 'Escalating conversation to support.', {
      senderId: input.senderId,
      channel: input.channel,
      reason,
      orderId: orderId || null,
      brand: brandFilter || null,
    });

    await upsertSupportEscalation({
      senderId: input.senderId,
      channel: input.channel,
      customerId: customer?.id,
      orderId: orderId || null,
      brand: brandFilter || null,
      contactName: mergedContact.name || customer?.name || input.customerName || null,
      contactPhone: mergedContact.phone || customer?.phone || null,
      latestCustomerMessage: input.currentMessage,
      reason,
      summary: buildSupportConversationSummary({
        reason,
        currentMessage: input.currentMessage,
        recentMessages: [...recentMessages].reverse(),
        orderId: orderId || null,
      }),
    });

    return finalizeReply({
      reply: buildHumanSupportReply({
        reason,
        orderId,
      }),
      orderId: orderId || null,
      assistantReplyKind: 'support_handoff',
      nextState: {
        ...clearPendingConversationState(state),
        supportMode: 'handoff_requested',
        lastReferencedOrderId: orderId ?? state.lastReferencedOrderId ?? null,
        lastMissingOrderId: null,
      },
    });
  }

  async function syncActiveSupportEscalation(params: {
    orderId?: number | null;
    mode: 'handoff_requested' | 'human_active';
  }) {
    if (!activeSupportEscalation) {
      return;
    }

    await prisma.supportEscalation.update({
      where: {
        id: activeSupportEscalation.id,
      },
      data: {
        orderId: params.orderId ?? activeSupportEscalation.orderId ?? null,
        latestCustomerMessage: input.currentMessage,
        summary: buildSupportConversationSummary({
          reason: activeSupportEscalation.reason as SupportIssueReason,
          currentMessage: input.currentMessage,
          recentMessages: [...recentMessages].reverse(),
          orderId: params.orderId ?? activeSupportEscalation.orderId ?? null,
        }),
        status: params.mode === 'human_active' ? 'in_progress' : activeSupportEscalation.status,
      },
    });
  }

  async function finalizeSupportSilentHold(mode: 'handoff_requested' | 'human_active') {
    const targetOrderId =
      activeSupportEscalation?.orderId ??
      state.lastReferencedOrderId ??
      latestActiveOrder?.id ??
      latestOrder?.id ??
      null;

    await syncActiveSupportEscalation({
      orderId: targetOrderId,
      mode,
    });

    return finalizeReply({
      reply: null,
      orderId: targetOrderId,
      assistantReplyKind: 'support_waiting',
      nextState: {
        ...clearPendingConversationState(state),
        supportMode: mode,
        lastReferencedOrderId: targetOrderId,
        lastMissingOrderId: null,
      },
    });
  }

  if (isBotPausedForSupport(currentSupportMode)) {
    const pausedSupportMode =
      currentSupportMode === 'human_active' ? 'human_active' : 'handoff_requested';

    return finalizeSupportSilentHold(pausedSupportMode);
  }

  if (isGreetingMessage(input.currentMessage) && state.pendingStep === 'none') {
    return finalizeReply({
      reply: buildGreetingReply(mergedContact.name || customer?.name, brandFilter),
      assistantReplyKind: 'greeting',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (isNeutralAcknowledgement(input.currentMessage)) {
    const maxQuantity = extractMaximumQuantityFromAssistantMessage(latestAssistantText);

    if (isLowerQuantityPrompt(latestAssistantText) && state.lastReferencedOrderId) {
      return finalizeReply({
        reply: maxQuantity
          ? `Please send the quantity you want for order #${state.lastReferencedOrderId}, up to ${maxQuantity} item(s).`
          : `Please send the quantity you want for order #${state.lastReferencedOrderId}.`,
      });
    }

    if (state.pendingStep === 'contact_confirmation' && state.orderDraft) {
      return finalizeReply({
        reply: 'Please confirm the delivery details or send the correction you need.',
      });
    }

    if (state.pendingStep === 'order_confirmation' && state.orderDraft) {
      return finalizeReply({
        reply: 'Please confirm the order summary when you are ready, or tell me what should be changed.',
      });
    }

    if (state.pendingStep === 'quantity_update_confirmation' && state.quantityUpdate) {
      return finalizeReply({
        reply: 'Please confirm the order update summary when you are ready, or tell me what should be changed.',
      });
    }

    if (
      state.pendingStep === 'none' &&
      ['support_contact', 'support_handoff', 'order_confirmed', 'order_status', 'order_details'].includes(
        state.lastAssistantReplyKind
      )
    ) {
      return finalizeReply({
        reply: buildAcknowledgementReply(state),
        assistantReplyKind: 'generic',
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }
  }

  if (looksLikeSameItemMessage(input.currentMessage) && state.orderDraft) {
    if (state.pendingStep === 'contact_confirmation') {
      return finalizeReply({
        reply: buildContactConfirmationReply(
          state.orderDraft.name,
          state.orderDraft.address,
          state.orderDraft.phone
        ),
      });
    }

    if (state.pendingStep === 'order_confirmation') {
      return finalizeReply({
        reply: buildOrderSummaryReply(state.orderDraft),
      });
    }
  }

  if (state.pendingStep === 'size_chart_selection' && requestedProductTypes.length > 0) {
    const payload = buildSizeChartReply(requestedProductTypes);
    return finalizeReply({
      reply: payload.reply,
      imagePaths: payload.imagePaths,
      nextState: {
        pendingStep: 'none',
        lastMissingOrderId: null,
        lastSizeChartCategory: requestedProductTypes[requestedProductTypes.length - 1],
      },
    });
  }

  if (
    state.orderDraft &&
    ['contact_collection', 'contact_confirmation', 'order_confirmation'].includes(state.pendingStep) &&
    Boolean(extractedContact.name || extractedContact.address || extractedContact.phone) &&
    !isUnambiguousCancellationMessage(input.currentMessage)
  ) {
    const nextDraft: ResolvedOrderDraft = {
      ...state.orderDraft,
      name: mergedContact.name || state.orderDraft.name,
      address: mergedContact.address || state.orderDraft.address,
      phone: mergedContact.phone || state.orderDraft.phone,
      deliveryCharge: getDeliveryChargeForAddress(
        mergedContact.address || state.orderDraft.address || ''
      ),
      deliveryEstimate: getDeliveryEstimateForAddress(
        mergedContact.address || state.orderDraft.address || ''
      ),
      total:
        state.orderDraft.price * state.orderDraft.quantity +
        getDeliveryChargeForAddress(mergedContact.address || state.orderDraft.address || ''),
    };

    const missingFields = getMissingContactFields({
      name: nextDraft.name,
      address: nextDraft.address,
      phone: nextDraft.phone,
    });

    if (missingFields.length > 0) {
      return finalizeReply({
        reply: buildMissingContactPrompt(missingFields),
        nextState: {
          pendingStep: 'contact_collection',
          orderDraft: nextDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }

    return finalizeReply({
      reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone),
      assistantReplyKind: 'contact_confirmation',
      nextState: {
        pendingStep: 'contact_confirmation',
        orderDraft: nextDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  if (state.orderDraft && looksLikeTotalQuestion(input.currentMessage)) {
    const nextState: Partial<ConversationStateData> = {
      lastMissingOrderId: null,
    };

    if (state.pendingStep === 'contact_confirmation' || state.pendingStep === 'order_confirmation') {
      nextState.pendingStep = 'order_confirmation';
      nextState.orderDraft = state.orderDraft;
    }

    return finalizeReply({
      reply: `The total for your order is Rs ${state.orderDraft.total}, including Rs ${state.orderDraft.deliveryCharge} delivery.\n\n${buildOrderSummaryReply(
        state.orderDraft
      )}`,
      assistantReplyKind: 'order_summary',
      nextState,
    });
  }

  if (!state.orderDraft && looksLikeTotalQuestion(input.currentMessage) && !messageReferencesExistingOrder(input.currentMessage)) {
    return finalizeReply({
      reply: 'Please send the item details for the order, and I will calculate the total with delivery charges.',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  // Never bypass the escalation path when the customer is explicitly asking to
  // speak with a human agent, even if the AI labelled it as support_contact_request.
  const supportIssueReason =
    (aiAction.action === 'support_contact_request' && !looksLikeHumanEscalationRequest(input.currentMessage)) ||
    aiAction.action === 'thanks_acknowledgement'
      ? null
      : inferSupportIssueReason(input.currentMessage);
  if (supportIssueReason) {
    const relatedOrderId =
      explicitOrderId ??
      aiAction.orderId ??
      state.lastReferencedOrderId ??
      (supportIssueReason !== 'unclear_request' || messageReferencesExistingOrder(input.currentMessage)
        ? latestActiveOrder?.id ?? latestOrder?.id ?? null
        : null) ??
      null;

    return escalateToSupport(supportIssueReason, relatedOrderId);
  }

  let effectiveAction = aiAction.action;
  let effectiveAiAction = aiAction;

  if (
    ACTIONS_REQUIRING_HIGH_CONFIDENCE.has(effectiveAction) &&
    aiAction.confidence < LOW_CONFIDENCE_ACTION_THRESHOLD
  ) {
    logWarn('Chat Orchestrator', 'Low-confidence route forced to clarification fallback.', {
      senderId: input.senderId,
      channel: input.channel,
      action: aiAction.action,
      confidence: aiAction.confidence,
    });
    effectiveAction = 'fallback';
    effectiveAiAction = {
      ...aiAction,
      action: 'fallback',
      confidence: aiAction.confidence,
    };
  }

  if (effectiveAction === 'confirm_pending' && !isClearConfirmation(input.currentMessage)) {
    effectiveAction = 'fallback';
  }

  const standaloneQuantity = extractStandaloneQuantityFromMessage(input.currentMessage);

  if (
    effectiveAction === 'fallback' &&
    standaloneQuantity &&
    state.lastReferencedOrderId &&
    (isLowerQuantityPrompt(latestAssistantText) ||
      state.lastAssistantReplyKind === 'quantity_prompt')
  ) {
    effectiveAction = 'update_order_quantity';
    effectiveAiAction = {
      ...aiAction,
      action: 'update_order_quantity',
      quantity: standaloneQuantity,
      orderId: state.lastReferencedOrderId,
    };
  }

  // If the message is clearly a cancellation while a draft is in progress but
  // the AI did not classify it as cancel_order (e.g. classified as fallback),
  // force the cancel_order path so the draft is cleared cleanly.
  if (
    effectiveAction !== 'cancel_order' &&
    state.orderDraft &&
    ['order_draft', 'contact_collection', 'contact_confirmation', 'order_confirmation'].includes(
      state.pendingStep
    ) &&
    isUnambiguousCancellationMessage(input.currentMessage)
  ) {
    effectiveAction = 'cancel_order';
  }

  if (effectiveAction === 'fallback' && followUpMissingOrderId) {
    if (looksLikeOrderDetailsRequest(input.currentMessage)) {
      effectiveAction = 'order_details';
    } else if (
      looksLikeOrderStatusRequest(input.currentMessage) ||
      looksLikeMissingOrderFollowUp(input.currentMessage)
    ) {
      effectiveAction = 'order_status';
    }
  }

  const ctx: ChatContext = {
    input, state, customer, brandFilter, globalProducts, products,
    latestOrder, latestActiveOrder, latestAssistantText, explicitOrderId,
    requestedProductTypes, followUpMissingOrderId, mergedContact, aiAction: effectiveAiAction,
    helpers: {
      findProductByName, findCustomerOrderById, buildDraftFromSource,
      finalizeReply, escalateToSupport, clearPendingConversationState
    }
  };

  switch (effectiveAction) {
    case 'greeting': return InfoHandlers.handle_greeting(ctx);
    case 'catalog_list': return CatalogHandlers.handle_catalog_list(ctx);
    case 'product_question': return CatalogHandlers.handle_product_question(ctx);
    case 'size_chart': return CatalogHandlers.handle_size_chart(ctx);
    case 'place_order': return OrderingHandlers.handle_place_order(ctx);
    case 'confirm_pending': return OrderingHandlers.handle_confirm_pending(ctx);
    case 'cancel_order': return OrderingHandlers.handle_cancel_order(ctx);
    case 'reorder_last': return OrderingHandlers.handle_reorder_last(ctx);
    case 'order_status': return InfoHandlers.handle_order_status(ctx);
    case 'order_details': return InfoHandlers.handle_order_details(ctx);
    case 'update_order_quantity': return OrderingHandlers.handle_update_order_quantity(ctx);
    case 'delivery_question': return InfoHandlers.handle_delivery_question(ctx);
    case 'payment_question': return InfoHandlers.handle_payment_question(ctx);
    case 'exchange_question': return InfoHandlers.handle_exchange_question(ctx);
    case 'gift_request': return InfoHandlers.handle_gift_request(ctx);
    case 'support_contact_request': return InfoHandlers.handle_support_contact_request(ctx);
    case 'thanks_acknowledgement': return InfoHandlers.handle_thanks_acknowledgement(ctx);
    case 'fallback': return InfoHandlers.handle_fallback(ctx);
  }
}
