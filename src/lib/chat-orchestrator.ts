import prisma from '@/lib/prisma';
import { brandsMatch } from '@/lib/brand-aliases';
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
  looksLikeCatalogQuestion,
  looksLikeCasualWellbeingQuestion,
  looksLikeDeliveryQuestion,
  looksLikeGiftRequest,
  looksLikeHumanEscalationRequest,
  looksLikeMissingOrderFollowUp,
  looksLikeOrderContactUpdateRequest,
  looksLikeOrderDetailsRequest,
  looksLikeOrderStatusRequest,
  looksLikePaymentQuestion,
  looksLikeSameItemMessage,
  looksLikeStoreLocationQuestion,
  looksLikeSupportContactProblem,
  looksLikeTotalQuestion,
  mentionsRelativeOrderReference,
  messageReferencesExistingOrder,
  normalizeColor,
  normalizeSize,
  scoreProductMatch,
  splitCsv,
} from '@/lib/chat/message-utils';
import {
  buildAcknowledgementReply,
  buildGreetingReply,
  buildMissingContactPrompt,
  buildStoreLocationReply,
  buildSizeChartReply,
} from '@/lib/chat/reply-builders';
import {
  detectCustomerLanguage,
  buildLanguagePreferenceAcknowledgement,
  isLanguagePreferenceOnlyMessage,
  localizeReplyWithGemini,
  generateConversationalReplyWithGemini,
  resolveCustomerLanguage,
} from '@/lib/chat/language';
import { buildGarmentSpecsForCustomer } from '@/lib/product-garment-specs';
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
  isNonContactOnlyMessage,
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
import { getMerchantSettings, resolvePaymentMethod } from '@/lib/runtime-config';
import {
  findMatchingBotTrainingRule,
  recordBotTrainingRuleMatch,
} from '@/lib/bot-training';
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
  'update_order_contact',
  'update_order_quantity',
  'gift_request',
]);

const CONVERSATIONAL_REWRITE_REPLY_KINDS = new Set<AssistantReplyKind>([
  'greeting',
  'support_contact',
  'support_handoff',
  'fallback',
  'trained_reply',
]);

const STRUCTURED_REPLY_LABEL_PATTERN =
  /^(?:Name|Street Address|City\/Town|District|Phone Number|Order Summary|Product|Quantity|Size|Color|Price|Order ID|Current Stage|Tracking|Delivery Address):/im;
const MIN_PRODUCT_MATCH_SCORE = 2;
const DRAFT_PENDING_STEPS = new Set([
  'order_draft',
  'contact_collection',
  'contact_confirmation',
  'order_confirmation',
  'quantity_update_confirmation',
]);

function isShortOperationalFollowUp(message: string): boolean {
  const normalized = message.trim();
  const comparable = normalized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/:,+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!comparable) {
    return false;
  }

  if (/^(yes|yes correct|correct|confirm|confirmed|ok|okay|sure|no)$/i.test(comparable)) {
    return true;
  }

  if (/^(xs|s|m|l|xl|xxl|2xl|3xl|4xl|small|medium|large)(?:\s+size)?$/i.test(comparable)) {
    return true;
  }

  if (/^(black|white|grey|gray|beige|pink|coral|sage|cream|blue|red|green|brown)$/i.test(comparable)) {
    return true;
  }

  if (/^(name|street address|address|city\/town|city|town|district|phone|phone number)\s*[: -]/i.test(normalized)) {
    return true;
  }

  if (/^\+?\d[\d\s()+/-]{7,}$/.test(normalized)) {
    return true;
  }

  return normalized.includes(',') && /[\d/]|road|rd|street|st|lane|mawatha|city|town/i.test(normalized);
}

function shouldPreservePreviousLanguage(params: {
  pendingStep: ConversationStateData['pendingStep'];
  previousLanguage: ConversationStateData['preferredLanguage'];
  detectedLanguage: ConversationStateData['preferredLanguage'] | null;
  isExplicitPreferenceRequest: boolean;
  message: string;
}): boolean {
  return Boolean(
    params.previousLanguage !== 'english' &&
      params.detectedLanguage === 'english' &&
      !params.isExplicitPreferenceRequest &&
      DRAFT_PENDING_STEPS.has(params.pendingStep) &&
      isShortOperationalFollowUp(params.message)
  );
}

function messageMentionsProductType(message: string): boolean {
  return /\b(?:t\s*shirt|tee|top|shirt|dress|gown|pant|pants|trouser|trousers|skirt|crop|linen|casual|vacation|summer)\b/i.test(
    message
  );
}

function canUseConversationalRewrite(params: {
  reply: string | null;
  assistantReplyKind: AssistantReplyKind;
  hasInteractivePayload: boolean;
}): params is { reply: string; assistantReplyKind: AssistantReplyKind; hasInteractivePayload: boolean } {
  if (!params.reply || params.hasInteractivePayload) {
    return false;
  }

  if (!CONVERSATIONAL_REWRITE_REPLY_KINDS.has(params.assistantReplyKind)) {
    return false;
  }

  return !STRUCTURED_REPLY_LABEL_PATTERN.test(params.reply);
}

function isBotPausedForSupport(mode: SupportWorkflowMode): boolean {
  return mode === 'handoff_requested' || mode === 'human_active';
}

function truncateDiagnosticText(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function shouldUseGreetingShortcut(message: string): boolean {
  if (!isGreetingMessage(message)) {
    return false;
  }

  return !(
    looksLikeCatalogQuestion(message) ||
    looksLikeStoreLocationQuestion(message) ||
    looksLikePaymentQuestion(message) ||
    looksLikeDeliveryQuestion(message) ||
    looksLikeHumanEscalationRequest(message) ||
    looksLikeOrderStatusRequest(message) ||
    looksLikeOrderDetailsRequest(message) ||
    looksLikeSupportContactProblem(message)
  );
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
  const languageResolution = resolveCustomerLanguage(input.currentMessage, state.preferredLanguage);
  const replyLanguage = shouldPreservePreviousLanguage({
    pendingStep: state.pendingStep,
    previousLanguage: state.preferredLanguage,
    detectedLanguage: languageResolution.detectedLanguage,
    isExplicitPreferenceRequest: languageResolution.isExplicitPreferenceRequest,
    message: input.currentMessage,
  })
    ? state.preferredLanguage
    : languageResolution.language;

  if (
    languageResolution.isExplicitPreferenceRequest &&
    isLanguagePreferenceOnlyMessage(input.currentMessage)
  ) {
    const reply = buildLanguagePreferenceAcknowledgement(replyLanguage);

    await saveConversationState(input.senderId, input.channel, {
      ...state,
      preferredLanguage: replyLanguage,
      lastAssistantReplyKind: 'generic',
      unclearMessageCount: 0,
    });
    await saveConversationPair(input.senderId, input.channel, input.currentMessage, reply);

    return {
      reply,
      language: replyLanguage,
    };
  }

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
                  variants: { include: { inventory: true } },
                  colorImages: { orderBy: { color: 'asc' } },
                  creatives: {
                    where: { status: 'saved' },
                    select: {
                      id: true,
                      status: true,
                      viewAngle: true,
                      sourceImageUrl: true,
                      createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const brandFilter = input.brand || customer?.preferredBrand || undefined;
  const settings = await getMerchantSettings(brandFilter);
  const globalProducts = await prisma.product.findMany({
    where: { status: 'active' },
    include: {
      inventory: true,
      variants: { include: { inventory: true } },
      colorImages: { orderBy: { color: 'asc' } },
      creatives: {
        where: { status: 'saved' },
        select: {
          id: true,
          status: true,
          viewAngle: true,
          sourceImageUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  
  const products = brandFilter
    ? globalProducts.filter((product) => brandsMatch(product.brand, brandFilter))
    : globalProducts;

  const scopedOrders = brandFilter
    ? customer?.orders.filter((order) => brandsMatch(order.brand, brandFilter)) ?? []
    : customer?.orders ?? [];
  const latestOrder = scopedOrders[0] || null;
  const latestActiveOrder =
    scopedOrders.find((order) => isActiveOrderStatus(order.orderStatus)) || null;
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
      streetAddress:
        state.orderDraft?.streetAddress ||
        latestActiveOrder?.deliveryStreetAddress ||
        latestOrder?.deliveryStreetAddress ||
        '',
      city:
        state.orderDraft?.city ||
        latestActiveOrder?.deliveryCity ||
        latestOrder?.deliveryCity ||
        '',
      district:
        state.orderDraft?.district ||
        latestActiveOrder?.deliveryDistrict ||
        latestOrder?.deliveryDistrict ||
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
      products: products.map((product) => {
        // Build a variant-aware available quantity: sum of all active variant inventory
        const variantTotal =
          product.variants && product.variants.length > 0
            ? product.variants.reduce(
                (sum, v) => sum + (v.inventory?.availableQty ?? 0),
                0
              )
            : null;
        return {
          name: product.name,
          style: product.style,
          price: product.price,
          sizes: product.sizes,
          colors: product.colors,
          availableQty: variantTotal ?? product.inventory?.availableQty ?? product.stock,
          garmentSpecs: buildGarmentSpecsForCustomer(product).replace(/\n/g, '; '),
        };
      }),
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
          streetAddress: state.orderDraft.streetAddress,
          city: state.orderDraft.city,
          district: state.orderDraft.district,
          phone: state.orderDraft.phone,
        })[0]
      : undefined;

  const shouldIgnoreContactPayload = isNonContactOnlyMessage(input.currentMessage);
  const extractedContact = shouldIgnoreContactPayload
    ? {}
    : extractContactDetailsFromText(input.currentMessage, singleMissingField);
  const aiContact = shouldIgnoreContactPayload
    ? { name: null, address: null, phone: null }
    : aiAction.contact;
  const mergedContact = mergeContactDetails(baseContact, {
    ...extractedContact,
    name: extractedContact.name || aiContact.name,
    address: extractedContact.address || aiContact.address,
    phone: extractedContact.phone || aiContact.phone,
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
  let diagnosticEffectiveAction: string | null = aiAction.action;
  let diagnosticConfidence: number | null = aiAction.confidence;

  function setDiagnosticEffectiveAction(action: string, confidence = diagnosticConfidence) {
    diagnosticEffectiveAction = action;
    diagnosticConfidence = confidence;
  }

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

    if (!bestMatch || bestScore < MIN_PRODUCT_MATCH_SCORE) {
      return null;
    }

    const messageScore = scoreProductMatch(bestMatch, input.currentMessage);
    if (
      messageMentionsProductType(input.currentMessage) &&
      messageScore < MIN_PRODUCT_MATCH_SCORE &&
      !state.orderDraft
    ) {
      return null;
    }

    return bestMatch;
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
                variants: { include: { inventory: true } },
                colorImages: { orderBy: { color: 'asc' } },
                creatives: {
                  where: { status: 'saved' },
                  select: {
                    id: true,
                    status: true,
                    viewAngle: true,
                    sourceImageUrl: true,
                    createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
                },
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
    const availableVariants = (product.variants ?? []).filter(
      (variant) => (variant.inventory?.availableQty ?? 0) > 0
    );
    const colors =
      availableVariants.length > 0
        ? Array.from(new Set(availableVariants.map((variant) => variant.color)))
        : splitCsv(product.colors);
    const size = normalizeSize(aiAction.size, sizes) || previousDraft?.size;
    const colorsForSelectedSize =
      size && availableVariants.length > 0
        ? Array.from(new Set(
            availableVariants
              .filter((variant) => variant.size === size)
              .map((variant) => variant.color)
          ))
        : colors;
    const allProductColors = splitCsv(product.colors);
    const colorOptionsForSelection =
      colorsForSelectedSize.length > 0 ? colorsForSelectedSize : splitCsv(product.colors);
    const requiresExplicitVariantChoice =
      Boolean(previousDraft?.requiresExplicitVariantChoice) && !aiAction.size && !aiAction.color;
    const requestedColor = aiAction.color
      ? normalizeColor(aiAction.color, colorOptionsForSelection) ||
        normalizeColor(aiAction.color, allProductColors)
      : undefined;
    const preservedColor =
      !aiAction.color && previousDraft?.color
        ? normalizeColor(previousDraft.color, colorOptionsForSelection)
        : undefined;
    const color =
      requestedColor ||
      preservedColor ||
      (!aiAction.color && !requiresExplicitVariantChoice && colorsForSelectedSize.length === 1
        ? colorsForSelectedSize[0]
        : undefined);
    const quantity = aiAction.quantity || previousDraft?.quantity || 1;
    const paymentMethod =
      aiAction.paymentMethod ||
      previousDraft?.paymentMethod ||
      resolvePaymentMethod(null, input.currentMessage, settings);
    const giftWrap =
      aiAction.giftWrap ?? previousDraft?.giftWrap ?? looksLikeGiftRequest(input.currentMessage);
    const giftNote =
      aiAction.giftNote ||
      previousDraft?.giftNote ||
      (/happy birthday/i.test(input.currentMessage) ? 'Happy Birthday' : undefined);
    const streetAddress = mergedContact.streetAddress || previousDraft?.streetAddress || '';
    const city = mergedContact.city || previousDraft?.city || '';
    const district = mergedContact.district || previousDraft?.district || '';
    const address = mergedContact.address || previousDraft?.address || '';
    const deliveryCharge = getDeliveryChargeForAddress(address, settings.delivery);

    // Resolve the matching variant so order creation can reserve at variant level
    const resolvedVariant =
      size && color
        ? (product.variants ?? []).find((v) => v.size === size && v.color === color) || null
        : null;
    const canReusePreviousVariant =
      Boolean(previousDraft?.variantId) &&
      previousDraft?.productId === product.id &&
      previousDraft?.size === size &&
      previousDraft?.color === color;

    return {
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      variantId: resolvedVariant?.id ?? (canReusePreviousVariant ? previousDraft?.variantId : undefined),
      requiresExplicitVariantChoice,
      quantity,
      size,
      color,
      price: product.price,
      deliveryCharge,
      total: product.price * quantity + deliveryCharge,
      paymentMethod,
      giftWrap,
      giftNote,
      deliveryEstimate: getDeliveryEstimateForAddress(address, settings.delivery),
      name: mergedContact.name || previousDraft?.name || '',
      address,
      streetAddress,
      city,
      district,
      phone: mergedContact.phone || previousDraft?.phone || '',
    };
  }

  async function finalizeReply(params: {
    reply: string | null;
    nextState?: Partial<ConversationStateData>;
    imagePath?: string;
    imagePaths?: string[];
    quickReplies?: CustomerMessageResult['quickReplies'];
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
    silentReason?: CustomerMessageResult['silentReason'];
    skipLocalization?: boolean;
  }): Promise<CustomerMessageResult> {
    const assistantReplyKind = params.assistantReplyKind || 'generic';
    let localizedReply: string | null = null;
    const hasInteractivePayload = Boolean(
      params.imagePath ||
        params.imagePaths?.length ||
        params.quickReplies?.length ||
        params.carouselProducts?.length
    );

    if (params.skipLocalization) {
      localizedReply = params.reply;
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      const isChatTestMode = process.env.CHAT_TEST_MODE === '1';

      if (
        apiKey &&
        !isChatTestMode &&
        canUseConversationalRewrite({
          reply: params.reply,
          assistantReplyKind,
          hasInteractivePayload,
        })
      ) {
        localizedReply = await generateConversationalReplyWithGemini(
          params.reply,
          replyLanguage,
          input.currentMessage,
          recentMessages,
          brandFilter,
          customer?.name || input.customerName
        );
      }

      if (!localizedReply) {
        localizedReply = await localizeReplyWithGemini(params.reply, replyLanguage);
      }
    }
    const shouldPersistState =
      Boolean(params.nextState) ||
      Boolean(params.assistantReplyKind) ||
      Boolean(languageResolution.detectedLanguage) ||
      replyLanguage !== state.preferredLanguage;
    const nextState = shouldPersistState
      ? await saveConversationState(input.senderId, input.channel, {
          ...state,
          ...params.nextState,
          preferredLanguage: replyLanguage,
          lastAssistantReplyKind: assistantReplyKind,
          unclearMessageCount:
            assistantReplyKind === 'fallback'
              ? params.nextState?.unclearMessageCount ?? state.unclearMessageCount
              : 0,
        })
      : state;

    await saveConversationPair(input.senderId, input.channel, input.currentMessage, localizedReply);

    const hasMedia = hasInteractivePayload;
    const issueFlags = new Set<string>();
    const assistantDetectedLanguage = localizedReply
      ? detectCustomerLanguage(localizedReply)
      : null;

    if (!localizedReply && assistantReplyKind !== 'support_waiting') {
      issueFlags.add('no_automated_reply');
    }
    if (params.silentReason) {
      issueFlags.add(params.silentReason);
    }
    if (assistantReplyKind === 'fallback') {
      issueFlags.add('fallback_reply');
    }
    if (assistantReplyKind === 'support_handoff') {
      issueFlags.add('support_handoff');
    }
    if (diagnosticConfidence !== null && diagnosticConfidence < LOW_CONFIDENCE_ACTION_THRESHOLD) {
      issueFlags.add('low_confidence_route');
    }
    if (
      languageResolution.detectedLanguage &&
      assistantDetectedLanguage &&
      languageResolution.detectedLanguage !== assistantDetectedLanguage
    ) {
      issueFlags.add('language_mismatch');
    }
    if (
      localizedReply &&
      latestAssistantText &&
      truncateDiagnosticText(localizedReply, 180) === truncateDiagnosticText(latestAssistantText, 180)
    ) {
      issueFlags.add('repeated_reply');
    }

    try {
      await prisma.botMessageDiagnostic.create({
        data: {
          senderId: input.senderId,
          channel: input.channel,
          brand: brandFilter || null,
          messagePreview: truncateDiagnosticText(input.currentMessage),
          detectedLanguage: languageResolution.detectedLanguage,
          replyLanguage,
          aiAction: aiAction.action,
          effectiveAction: diagnosticEffectiveAction,
          aiConfidence: diagnosticConfidence,
          assistantReplyKind,
          supportMode: nextState.supportMode,
          pendingStep: nextState.pendingStep,
          hasReply: Boolean(localizedReply),
          hasMedia,
          orderId: params.orderId ?? null,
          issueFlags: issueFlags.size > 0 ? JSON.stringify(Array.from(issueFlags)) : null,
        },
      });
    } catch (error) {
      logWarn('Chat Orchestrator', 'Could not persist bot message diagnostic.', {
        senderId: input.senderId,
        channel: input.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }

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
      hasMedia,
      orderId: params.orderId ?? null,
      language: replyLanguage,
    });

    return {
      reply: localizedReply,
      imagePath: params.imagePath ?? params.imagePaths?.[0],
      imagePaths: params.imagePaths ?? (params.imagePath ? [params.imagePath] : undefined),
      quickReplies: params.quickReplies,
      carouselProducts: params.carouselProducts,
      orderId: params.orderId ?? null,
      language: replyLanguage,
      silentReason: params.silentReason,
    };
  }

  async function escalateToSupport(
    reason: SupportIssueReason,
    orderId?: number | null,
    replyOverride?: string
  ) {
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

    setDiagnosticEffectiveAction(`support_${reason}`);

    return finalizeReply({
      reply:
        replyOverride ||
        buildHumanSupportReply({
          reason,
          orderId,
          supportConfig: settings.support,
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
      silentReason: mode === 'human_active' ? 'human_active' : 'support_handoff',
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

    setDiagnosticEffectiveAction('support_silent_hold');
    return finalizeSupportSilentHold(pausedSupportMode);
  }

  if (state.pendingStep === 'none') {
    const trainingRule = await findMatchingBotTrainingRule({
      brand: brandFilter,
      language: replyLanguage,
      message: input.currentMessage,
    });

    if (trainingRule) {
      try {
        await recordBotTrainingRuleMatch(trainingRule.id);
      } catch (error) {
        logWarn('Chat Orchestrator', 'Could not record bot training rule hit.', {
          ruleId: trainingRule.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      setDiagnosticEffectiveAction(`trained_reply:${trainingRule.intent}`, 1);

      return finalizeReply({
        reply: trainingRule.response,
        assistantReplyKind: 'trained_reply',
        skipLocalization: trainingRule.language === replyLanguage,
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }
  }

  if (shouldUseGreetingShortcut(input.currentMessage) && state.pendingStep === 'none') {
    setDiagnosticEffectiveAction('greeting');
    return finalizeReply({
      reply: buildGreetingReply(mergedContact.name || customer?.name, settings.displayName),
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
        reply: 'Whenever you are ready, reply "yes" to confirm the delivery details — or send the change you need.',
      });
    }

    if (state.pendingStep === 'order_confirmation' && state.orderDraft) {
      return finalizeReply({
        reply: 'Whenever you are ready, reply "yes" to confirm the order summary — or tell me what to change.',
      });
    }

    if (state.pendingStep === 'quantity_update_confirmation' && state.quantityUpdate) {
      return finalizeReply({
        reply: 'Whenever you are ready, reply "yes" to apply the order update — or tell me what to change.',
      });
    }

    if (
      state.pendingStep === 'none' &&
      ['support_contact', 'support_handoff', 'order_confirmed', 'order_status', 'order_details'].includes(
        state.lastAssistantReplyKind
      )
    ) {
      return finalizeReply({
        reply: buildAcknowledgementReply(state, settings.support),
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
          state.orderDraft.phone,
          state.orderDraft
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
    const payload = buildSizeChartReply(requestedProductTypes, null, brandFilter);
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
    Boolean(
      extractedContact.name ||
      extractedContact.address ||
      extractedContact.streetAddress ||
      extractedContact.city ||
      extractedContact.district ||
      extractedContact.phone
    ) &&
    !isUnambiguousCancellationMessage(input.currentMessage)
  ) {
    const nextDraft: ResolvedOrderDraft = {
      ...state.orderDraft,
      name: mergedContact.name || state.orderDraft.name,
      address: mergedContact.address || state.orderDraft.address,
      streetAddress: mergedContact.streetAddress || state.orderDraft.streetAddress,
      city: mergedContact.city || state.orderDraft.city,
      district: mergedContact.district || state.orderDraft.district,
      phone: mergedContact.phone || state.orderDraft.phone,
      deliveryCharge: getDeliveryChargeForAddress(
        mergedContact.address || state.orderDraft.address || '',
        settings.delivery
      ),
      deliveryEstimate: getDeliveryEstimateForAddress(
        mergedContact.address || state.orderDraft.address || '',
        settings.delivery
      ),
      total:
        state.orderDraft.price * state.orderDraft.quantity +
        getDeliveryChargeForAddress(
          mergedContact.address || state.orderDraft.address || '',
          settings.delivery
        ),
    };

    const missingFields = getMissingContactFields({
      name: nextDraft.name,
      address: nextDraft.address,
      streetAddress: nextDraft.streetAddress,
      city: nextDraft.city,
      district: nextDraft.district,
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

    const prevDraft = state.orderDraft;
    const hasAddressChange =
      Boolean(prevDraft.streetAddress && prevDraft.streetAddress !== nextDraft.streetAddress) ||
      Boolean(prevDraft.city && prevDraft.city !== nextDraft.city) ||
      Boolean(prevDraft.district && prevDraft.district !== nextDraft.district);

    const changedFields: string[] = [];
    if (prevDraft.name && prevDraft.name !== nextDraft.name) {
      changedFields.push('name');
    }
    if (hasAddressChange) {
      changedFields.push('address');
    }
    if (prevDraft.phone && prevDraft.phone !== nextDraft.phone) {
      changedFields.push('phone');
    }

    const FIELD_LABELS: Record<string, string> = {
      name: 'name',
      address: 'address',
      phone: 'phone number',
    };
    const acknowledgement =
      changedFields.length > 0 && changedFields.length <= 2
        ? `Got it — I've updated the ${changedFields.map((field) => FIELD_LABELS[field]).join(' and ')}.\n\n`
        : '';

    return finalizeReply({
      reply: `${acknowledgement}${buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone, nextDraft)}`,
      assistantReplyKind: 'contact_confirmation',
      nextState: {
        pendingStep: 'contact_confirmation',
        orderDraft: nextDraft,
        quantityUpdate: null,
        lastMissingOrderId: null,
      },
    });
  }

  if (
    state.orderDraft &&
    ['contact_collection', 'contact_confirmation', 'order_confirmation'].includes(state.pendingStep) &&
    shouldIgnoreContactPayload &&
    !isClearConfirmation(input.currentMessage) &&
    !isUnambiguousCancellationMessage(input.currentMessage)
  ) {
    const missingFields = getMissingContactFields({
      name: state.orderDraft.name,
      address: state.orderDraft.address,
      streetAddress: state.orderDraft.streetAddress,
      city: state.orderDraft.city,
      district: state.orderDraft.district,
      phone: state.orderDraft.phone,
    });

    if (missingFields.length > 0) {
      return finalizeReply({
        reply: buildMissingContactPrompt(missingFields),
        nextState: {
          pendingStep: 'contact_collection',
          orderDraft: state.orderDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }

    if (state.pendingStep === 'contact_confirmation') {
      return finalizeReply({
        reply: 'Whenever you are ready, reply "yes" to confirm the delivery details — or send the change you need.',
      });
    }

    if (state.pendingStep === 'order_confirmation') {
      return finalizeReply({
        reply: 'Whenever you are ready, reply "yes" to confirm the order summary — or tell me what to change.',
      });
    }
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
      reply: "Sure — share the item details for the order and I'll work out the total with delivery charges.",
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  // Never bypass the escalation path when the customer is explicitly asking to
  // speak with a human agent, even if the AI labelled it as support_contact_request.
  const hasSupportContactProblem = looksLikeSupportContactProblem(input.currentMessage);
  const detectedSupportIssueReason = inferSupportIssueReason(input.currentMessage);
  const isSimpleSupportContactRequest =
    aiAction.action === 'support_contact_request' &&
    !looksLikeHumanEscalationRequest(input.currentMessage) &&
    detectedSupportIssueReason === 'human_request' &&
    !hasSupportContactProblem;
  const supportIssueReason =
    isSimpleSupportContactRequest ||
    aiAction.action === 'thanks_acknowledgement' ||
    (looksLikeOrderContactUpdateRequest(input.currentMessage) &&
      !looksLikeHumanEscalationRequest(input.currentMessage))
      ? null
      : detectedSupportIssueReason;
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

  if (
    effectiveAction !== 'update_order_contact' &&
    !state.orderDraft &&
    latestActiveOrder &&
    looksLikeOrderContactUpdateRequest(input.currentMessage)
  ) {
    effectiveAction = 'update_order_contact';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'update_order_contact',
    };
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

  // If the customer is modifying size or color during an active draft but the AI
  // classified the message as fallback (because no product name was mentioned),
  // reclassify to place_order so the draft is actually updated with the new values.
  if (
    effectiveAction === 'fallback' &&
    state.orderDraft &&
    ['order_draft', 'contact_collection', 'contact_confirmation', 'order_confirmation'].includes(
      state.pendingStep
    ) &&
    (effectiveAiAction.size || effectiveAiAction.color)
  ) {
    effectiveAction = 'place_order';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'place_order',
      productName: effectiveAiAction.productName || state.orderDraft.productName,
      confidence: Math.max(effectiveAiAction.confidence, 0.85),
    };
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

  if (
    state.pendingStep === 'none' &&
    looksLikeStoreLocationQuestion(input.currentMessage) &&
    !messageReferencesExistingOrder(input.currentMessage)
  ) {
    setDiagnosticEffectiveAction('store_location_question');
    return finalizeReply({
      reply: buildStoreLocationReply(settings.support),
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (
    state.pendingStep === 'none' &&
    ['fallback', 'support_contact_request', 'greeting'].includes(effectiveAction) &&
    looksLikeCatalogQuestion(input.currentMessage)
  ) {
    effectiveAction = 'catalog_list';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'catalog_list',
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
    };
  }

  if (
    ['fallback', 'support_contact_request'].includes(effectiveAction) &&
    looksLikeCasualWellbeingQuestion(input.currentMessage)
  ) {
    effectiveAction = 'greeting';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'greeting',
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
    };
  }

  if (
    ['fallback', 'support_contact_request', 'greeting'].includes(effectiveAction) &&
    looksLikePaymentQuestion(input.currentMessage)
  ) {
    const normalizedPaymentMessage = input.currentMessage.toLowerCase();
    const requestedPaymentMethod =
      /\bcod\b|cash on delivery/i.test(normalizedPaymentMessage)
        ? 'COD'
        : /\bonline transfer\b|\bbank transfer\b|\btransfer\b/i.test(normalizedPaymentMessage)
          ? 'Online Transfer'
          : effectiveAiAction.paymentMethod;

    effectiveAction = 'payment_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'payment_question',
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
      paymentMethod: requestedPaymentMethod,
    };
  }

  setDiagnosticEffectiveAction(effectiveAction, effectiveAiAction.confidence);

  const ctx: ChatContext = {
    input, state, customer, brandFilter, globalProducts, products,
    latestOrder, latestActiveOrder, latestAssistantText, explicitOrderId,
    requestedProductTypes, followUpMissingOrderId, mergedContact, aiAction: effectiveAiAction,
    settings,
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
    case 'update_order_contact': return OrderingHandlers.handle_update_order_contact(ctx);
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
