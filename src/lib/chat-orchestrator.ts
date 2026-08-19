import prisma from '@/lib/prisma';
import { brandsMatch } from '@/lib/brand-aliases';
import { resolveCartLines } from '@/lib/whatsapp-cart';
import { extractItemCodes, messageMentionsItemCode, productItemCode } from '@/lib/product-item-code';
import {
  extractExplicitOrderIdFromMessage,
  extractDeliveryLocationHint,
  extractMaximumQuantityFromAssistantMessage,
  extractStandaloneQuantityFromMessage,
  extractRequestedProductTypes,
  inferSupportIssueReason,
  isGreetingMessage,
  isLowerQuantityPrompt,
  isNeutralAcknowledgement,
  isThanksMessage,
  isUnambiguousCancellationMessage,
  looksLikeCatalogQuestion,
  looksLikeCallbackRequest,
  looksLikeCasualWellbeingQuestion,
  looksLikeCourierProviderQuestion,
  looksLikeDeliveryQuestion,
  looksLikeDeliveryChargeQuestion,
  shouldIncludeDeliveryCharge,
  looksLikeGiftRequest,
  looksLikeHumanEscalationRequest,
  looksLikeMissingOrderFollowUp,
  looksLikeOrderContactUpdateRequest,
  looksLikeOrderDetailsRequest,
  looksLikeOrderStatusRequest,
  looksLikePaymentQuestion,
  looksLikePrivateDataExtractionRequest,
  looksLikePreOrderIssuePolicyQuestion,
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
  buildIntroGreetingReply,
  buildMissingContactPrompt,
  buildStoreLocationReply,
  buildSizeChartReply,
} from '@/lib/chat/reply-builders';
import { buildMultiCodeReply } from '@/lib/chat/multi-code-reply';
import {
  appendRepeatHandover,
  isUnhelpfulRepeat,
  REPEAT_HANDOVER_MESSAGE,
} from '@/lib/chat/repeat-guard';
import {
  detectCustomerLanguage,
  detectCustomerScriptStyle,
  buildLanguagePreferenceAcknowledgement,
  isLanguagePreferenceOnlyMessage,
  localizeReplyWithGemini,
  generateConversationalReplyWithGemini,
  resolveCustomerLanguage,
} from '@/lib/chat/language';
import { buildGarmentSpecsForCustomer } from '@/lib/product-garment-specs';
import {
  routeCustomerMessageWithAi,
  type AiRoutedAction,
} from '@/lib/ai-action-router';
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
  describeDraftItem,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  withDraftTotal,
  type ResolvedOrderDraft,
} from '@/lib/order-draft';
import {
  extractContactDetailsFromText,
  getMissingContactFields,
  isNonContactOnlyMessage,
  mergeContactDetails,
} from '@/lib/contact-profile';
import { preferStoredMetaProfileName } from '@/lib/meta-profile';
import {
  buildEmojiAcknowledgementReply,
  isEmojiOnlyMessage,
} from '@/lib/chat/acknowledgement';
import {
  buildAdArrivalReply,
  resolveProductFromAdReferral,
} from '@/lib/chat/ad-referral-product';
import { findRecentAdReferralHint } from '@/lib/ad-referral';
import { sortSizes } from '@/lib/size-order';
import { notifyInboundCustomerMessage } from '@/lib/push-notifications';
import { isClearConfirmation } from '@/lib/order-confirmation';
import {
  buildHumanSupportReply,
  buildSupportContactReply,
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
import {
  findMentionedCatalogProducts,
  looksLikeProductComparison,
  looksLikeRecommendationRequest,
  looksLikeShortlistFollowUp,
} from './chat/catalog-guidance';
import * as OrderingHandlers from './chat/orders';
import * as InfoHandlers from './chat/info';
import { logInfo, logWarn } from '@/lib/app-log';
import { encodeMessageImages } from '@/lib/chat/message-media';

/** How long a customer is remembered as already introduced to. */
const ASSISTANT_INTRO_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    // A quoted item code is the clearest statement of intent a customer can
    // open with — it is what the click-to-WhatsApp links in our post captions
    // prefill. Answering it with a bare "Hello, how can I help?" throws away
    // the one thing they told us, and which product they were looking at.
    extractItemCodes(message).length > 0 ||
    messageMentionsProductType(message) ||
    looksLikeRecommendationRequest(message) ||
    looksLikeCatalogQuestion(message) ||
    looksLikeStoreLocationQuestion(message) ||
    looksLikePaymentQuestion(message) ||
    looksLikeDeliveryQuestion(message) ||
    looksLikeDeliveryChargeQuestion(message) ||
    looksLikeHumanEscalationRequest(message) ||
    looksLikeOrderStatusRequest(message) ||
    looksLikeOrderDetailsRequest(message) ||
    looksLikeSupportContactProblem(message)
  );
}

function looksLikeCapabilityQuestion(message: string): boolean {
  return /\b(?:what|how) (?:can|could|do) you (?:help|assist|do)|\bwhat can i ask\b|\bwhat do you help with\b/i.test(
    message
  );
}

function buildEmptyRoutedAction(
  action: AiRoutedAction['action'],
  confidence: number
): AiRoutedAction {
  return {
    action,
    confidence,
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
}

function looksLikeProductAvailabilityQuestion(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /\b(?:do (?:you|u)(?: guys)? have|have you got|is (?:it|this|that)?\s*available|available|in stock|how many|left)\b/.test(
    normalized
  );
}

function looksLikeProductInformationQuestion(message: string): boolean {
  return /\b(?:price|prce|prise|cost|how much|size|sizes|sizing|sze|szes|colou?rs?|available|availability|stock|fabric|material|pockets?|zip|zipper|slit|fit|length|sleeve|neckline|hem|pattern)\b|මිල|ගාන|ප්‍රමාණ|පාට|රෙද්ද|අමුද්‍රව්‍ය|තියෙනවද|துணி|பொருள்|விலை|அளவு|நிறம்|கிடைக்குமா/i.test(
    message
  );
}

function looksLikeReferencedProductFollowUp(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    looksLikeProductAvailabilityQuestion(message) ||
    /\b(?:it|this|that|same one|eka)\b.*\b(?:available|stock|price|size|color|colour|black|white|beige|pink|coral|sage|cream|fabric|material|pocket|zip|slit|fit)\b/i.test(
      normalized
    ) ||
    /(එක|එකක්|ඒක|එය).*(කළු|සුදු|පාට|size|ප්‍රමාණ|තියෙනවද|තිබෙනවද|මිල)/i.test(message) ||
    /(அது|இது).*(கருப்பு|வெள்ளை|நிறம்|size|அளவு|கிடைக்குமா|இருக்கிறதா|விலை)/i.test(message) ||
    /^(?:xs|s|m|l|xl|xxl|small|medium|large)(?:\s+size)?$/i.test(normalized) ||
    /^(?:black|white|grey|gray|beige|pink|coral|sage|cream|blue|red|green|brown)(?:\s+(?:color|colour))?$/i.test(
      normalized
    )
  );
}

async function saveConversationPair(
  senderId: string,
  channel: string,
  userMessage: string,
  assistantReply?: string | null,
  brand?: string | null,
  // Kept on the customer's own turn, so the inbox shows the photo beside the
  // words it came with rather than floating loose in the thread.
  userImageUrls?: Array<string | null | undefined>,
  // What the bot showed back — size charts, product photos. Without them the
  // agent reads "here is the size chart" and cannot see which one was sent.
  assistantImageUrls?: Array<string | null | undefined>
) {
  const messages = [
    {
      senderId,
      channel,
      brand: brand || null,
      role: 'user',
      message: userMessage,
      imageUrl: (userImageUrls ?? []).find(Boolean) || null,
      imageUrls: encodeMessageImages(userImageUrls ?? []),
    },
  ];

  if (assistantReply) {
    messages.push({
      senderId,
      channel,
      brand: brand || null,
      role: 'assistant',
      message: assistantReply,
      imageUrl: (assistantImageUrls ?? []).find(Boolean) || null,
      imageUrls: encodeMessageImages(assistantImageUrls ?? []),
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

  // Sent before the reply is composed rather than after, so an operator who
  // asked to see every message still hears about one the bot then failed on.
  // Only devices with that switch on are targeted, so this is a single indexed
  // query returning nothing for everyone else.
  try {
    await notifyInboundCustomerMessage({
      senderId: input.senderId,
      channel: input.channel,
      brand: input.brand,
      contactName: input.customerName,
    });
  } catch {
    // Notifying is never worth failing a customer's message over.
  }

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
  const detectedScriptStyle = detectCustomerScriptStyle(
    input.currentMessage,
    languageResolution.detectedLanguage || replyLanguage
  );
  const replyScriptStyle =
    replyLanguage === 'english'
      ? 'native'
      : detectedScriptStyle ||
        (state.preferredLanguage === replyLanguage ? state.preferredScriptStyle : 'native');

  if (
    languageResolution.isExplicitPreferenceRequest &&
    isLanguagePreferenceOnlyMessage(input.currentMessage)
  ) {
    const reply = buildLanguagePreferenceAcknowledgement(replyLanguage, replyScriptStyle);

    await saveConversationState(input.senderId, input.channel, {
      ...state,
      preferredLanguage: replyLanguage,
      preferredScriptStyle: replyScriptStyle,
      lastAssistantReplyKind: 'generic',
      unclearMessageCount: 0,
    });
    await saveConversationPair(
      input.senderId,
      input.channel,
      input.transcriptMessage ?? input.currentMessage,
      reply,
      input.brand,
      [input.storedImageUrl]
    );

    return {
      reply,
      language: replyLanguage,
    };
  }

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
                      publishedAt: true,
                      viewAngle: true,
                      sourceImageUrl: true,
                      imageUrl: true,
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
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: input.senderId,
      channel: input.channel,
      ...(brandFilter ? { brand: brandFilter } : {}),
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: 12,
    select: {
      role: true,
      message: true,
      // Used to tell whether the ad click has already been answered.
      createdAt: true,
    },
  });
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
          publishedAt: true,
          viewAngle: true,
          sourceImageUrl: true,
          imageUrl: true,
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
  const recentCustomerTexts = recentMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.message);
  const latestCustomerText = recentCustomerTexts[0] || '';
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
      name:
        state.orderDraft?.name ||
        preferStoredMetaProfileName(customer?.name, input.customerName) ||
        '',
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

  // Resolve the product the shopper is viewing on the storefront (sent as
  // pageContext) to a catalog entry. Storefront slugs are `${slugify(name)}-${id}`,
  // so the trailing id is the most reliable key; fall back to the title.
  const viewedSlug = input.pageContext?.product?.slug ?? null;
  const viewedSlugId = viewedSlug ? Number(viewedSlug.match(/-(\d+)$/)?.[1]) : NaN;
  const viewedTitle = input.pageContext?.product?.title ?? null;
  const currentProductName =
    (Number.isFinite(viewedSlugId)
      ? products.find((product) => product.id === viewedSlugId)?.name
      : undefined) ??
    (viewedTitle
      ? products.find(
          (product) => product.name.toLowerCase() === viewedTitle.toLowerCase()
        )?.name
      : undefined) ??
    null;

  const useGreetingShortcut =
    state.pendingStep === 'none' && shouldUseGreetingShortcut(input.currentMessage);
  const aiAction = useGreetingShortcut
    ? buildEmptyRoutedAction('greeting', 1)
    : (await routeCustomerMessageWithAi({
        brand: brandFilter,
        currentMessage: input.currentMessage,
        currentProductName,
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
            itemCode: productItemCode(product),
            style: product.style,
            price: product.price,
            sizes: product.sizes,
            colors: product.colors,
            availableQty: variantTotal ?? product.inventory?.availableQty ?? product.stock,
            garmentSpecs: buildGarmentSpecsForCustomer(product).replace(/\n/g, '; '),
          };
        }),
        imageUrl: input.imageUrl,
      })) || buildEmptyRoutedAction('fallback', 0);

  // A cart names exact catalog rows, so it settles product, size and colour
  // outright. Without this the classifier had only the customer's covering note
  // to work with and would infer a product from earlier conversation — which is
  // how a shopper who added Blue Grey in size S could be quoted something else.
  // A quoted item code names exactly one product, so it is settled here rather
  // than left to the model. Our post captions prefill "Order HAP-0001", and a
  // customer who taps that must not be answered with "I couldn't match that
  // item" because the router happened not to connect the code to a name.
  //
  // Only the product is filled in; the action stays whatever was routed, since
  // "Order HAP-0001" and "what sizes for HAP-0001?" are different requests. A
  // message that routed nowhere becomes an order, because that is what the link
  // the customer tapped said it would do.
  const codedProducts = extractItemCodes(input.currentMessage).length > 0
    ? products.filter((product) => messageMentionsItemCode(input.currentMessage, product))
    : [];

  if (codedProducts.length === 1) {
    const codedProduct = codedProducts[0];

    // The quoted code wins outright. It used to apply only when the model had
    // failed to name a product, which sounds cautious and is the wrong way
    // round: the model draws the name from conversation context, so after a few
    // messages about one item it keeps naming that item. A customer who typed
    // "I want Photo of HAP-0005" was answered about HAP-0004, three times,
    // because the model's guess outranked the code they had spelled correctly.
    //
    // Nothing else is inferred from the code — "Order HAP-0001" and "what sizes
    // for HAP-0001?" stay different requests.
    aiAction.productName = codedProduct.name;
    aiAction.confidence = Math.max(aiAction.confidence, 0.95);

    if (aiAction.action === 'fallback') {
      aiAction.action = 'place_order';
      aiAction.confidence = Math.max(aiAction.confidence, 0.95);
    }

    state.lastReferencedProductId = codedProduct.id;
    state.lastReferencedProductName = codedProduct.name;
  }

  const resolvedCart = resolveCartLines(products, input.cart);

  // Stock is checked here rather than at confirmation so the summary never
  // quotes something that cannot ship. A line the customer cannot have is said
  // out loud, not dropped.
  const cartLinesInStock: typeof resolvedCart.lines = [];
  const soldOutCartItems: string[] = [];

  for (const line of resolvedCart.lines) {
    const variant = line.product.variants?.find((candidate) => candidate.id === line.variant.id);
    const availableQty = Math.max(0, variant?.inventory?.availableQty ?? 0);

    if (availableQty <= 0) {
      soldOutCartItems.push(
        describeDraftItem({
          productId: line.product.id,
          productName: line.product.name,
          brand: line.product.brand,
          quantity: line.quantity,
          size: line.variant.size,
          color: line.variant.color,
          price: line.product.price,
        })
      );
      continue;
    }

    cartLinesInStock.push({
      ...line,
      // Never draft more than is on the shelf. The alternative fails at order
      // creation, after the customer has already said yes.
      quantity: Math.min(line.quantity, availableQty),
    });
  }

  // The last line becomes the item the draft is currently specifying; the ones
  // before it are already settled. That ordering keeps the summary reading in
  // the order the customer added things.
  const currentCartLine = cartLinesInStock[cartLinesInStock.length - 1];
  const cartPreviousItems = cartLinesInStock.slice(0, -1).map((line) => ({
    productId: line.product.id,
    productName: line.product.name,
    brand: line.product.brand,
    variantId: line.variant.id,
    quantity: line.quantity,
    size: line.variant.size,
    color: line.variant.color,
    price: line.product.price,
  }));

  if (currentCartLine) {
    aiAction.action = 'place_order';
    aiAction.confidence = 1;
    aiAction.productName = currentCartLine.product.name;
    aiAction.size = currentCartLine.variant.size;
    aiAction.color = currentCartLine.variant.color;
    aiAction.quantity = currentCartLine.quantity;
  }

  // Said once, on the message the cart arrives in. Repeating it every turn of
  // the order flow would read like nagging.
  const cartNote =
    soldOutCartItems.length > 0
      ? `${
          soldOutCartItems.length === 1
            ? 'One item in your cart is out of stock now, so I left it off'
            : 'Some items in your cart are out of stock now, so I left them off'
        }: ${soldOutCartItems.join(', ')}.`
      : null;

  if (resolvedCart.unresolvedRetailerIds.length > 0) {
    logWarn('Chat Orchestrator', 'Cart contained items no product claimed.', {
      senderId: input.senderId,
      channel: input.channel,
      retailerIds: resolvedCart.unresolvedRetailerIds,
    });
  }

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
      ...(brandFilter ? { brand: brandFilter } : {}),
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
      : activeSupportEscalation
        ? 'handoff_requested'
      : conversationSupportMode;
  let diagnosticEffectiveAction: string | null = aiAction.action;
  let diagnosticConfidence: number | null = aiAction.confidence;

  function setDiagnosticEffectiveAction(action: string, confidence = diagnosticConfidence) {
    diagnosticEffectiveAction = action;
    diagnosticConfidence = confidence;
  }

  function findProductByName(productName?: string | null) {
    if (!productName) {
      if (state.lastReferencedProductId) {
        return products.find((product) => product.id === state.lastReferencedProductId) || null;
      }

      if (state.lastReferencedProductName) {
        return (
          products.find(
            (product) =>
              product.name.toLowerCase() === state.lastReferencedProductName?.toLowerCase()
          ) || null
        );
      }

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
                    publishedAt: true,
                    viewAngle: true,
                    sourceImageUrl: true,
                    imageUrl: true,
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

    return withDraftTotal({
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      variantId: resolvedVariant?.id ?? (canReusePreviousVariant ? previousDraft?.variantId : undefined),
      requiresExplicitVariantChoice,
      // Items settled before this one ride along, so changing the item under
      // discussion never quietly drops the rest of the order. A cart states the
      // whole order at once, so it replaces the list rather than adding to it.
      previousItems: currentCartLine ? cartPreviousItems : previousDraft?.previousItems,
      quantity,
      size,
      color,
      price: product.price,
      deliveryCharge,
      total: 0,
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
    });
  }

  async function finalizeReply(params: {
    reply: string | null;
    nextState?: Partial<ConversationStateData>;
    imagePath?: string;
    imagePaths?: string[];
    /** Aligned by index with imagePaths. See CustomerMessageResult. */
    imageCaptions?: string[];
    quickReplies?: CustomerMessageResult['quickReplies'];
    carouselProducts?: Array<{
      id: number;
      name: string;
      price: number;
      sizes: string;
      colors: string;
      imageUrl?: string;
      // Catalog retailer id, when the product has a sellable variant. Lets
      // WhatsApp render a real product card instead of a text list.
      retailerId?: string;
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

    // Appended before localization so the customer reads it in their own
    // language, whatever the rest of this reply turned out to be.
    const composedReply =
      params.reply && cartNote ? `${params.reply}\n\n${cartNote}` : params.reply;

    const reply = composedReply;

    if (params.skipLocalization) {
      localizedReply = reply;
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      const isChatTestMode = process.env.CHAT_TEST_MODE === '1';

      if (
        apiKey &&
        !isChatTestMode &&
        canUseConversationalRewrite({
          reply,
          assistantReplyKind,
          hasInteractivePayload,
        })
      ) {
        localizedReply = await generateConversationalReplyWithGemini(
          reply,
          replyLanguage,
          input.currentMessage,
          recentMessages,
          brandFilter,
          customer?.name || input.customerName,
          replyScriptStyle
        );
      }

      if (!localizedReply) {
        localizedReply = await localizeReplyWithGemini(
          reply,
          replyLanguage,
          replyScriptStyle
        );
      }
    }

    // Sending the identical reply twice is what the bot does when it did not
    // understand and fell back to its previous answer. The answer is kept — it
    // may well be right — but the loop is named and something more useful is
    // asked for.
    //
    // Compared after localization because the stored previous reply is the
    // localized one, so this is the only point where both sides are the same
    // form. Appending earlier would also break localizeKnownReply, which
    // matches on the reply's exact English text.
    const repeatedItself = isUnhelpfulRepeat({
      reply: localizedReply,
      previousReply: latestAssistantText,
      assistantReplyKind,
    });

    if (repeatedItself) {
      logWarn('Chat Orchestrator', 'Bot repeated itself; handing to support.', {
        senderId: input.senderId,
        channel: input.channel,
        brand: brandFilter || null,
        assistantReplyKind,
      });

      const localizedHandover =
        (await localizeReplyWithGemini(
          REPEAT_HANDOVER_MESSAGE,
          replyLanguage,
          replyScriptStyle
        )) ?? REPEAT_HANDOVER_MESSAGE;
      localizedReply = appendRepeatHandover(localizedReply!, localizedHandover);

      // Same record any other escalation writes, so the case surfaces in the
      // support inbox exactly like one the customer asked for.
      await upsertSupportEscalation({
        senderId: input.senderId,
        channel: input.channel,
        customerId: customer?.id,
        orderId: params.orderId || null,
        brand: brandFilter || null,
        contactName: mergedContact.name || customer?.name || input.customerName || null,
        contactPhone: mergedContact.phone || customer?.phone || null,
        latestCustomerMessage: input.currentMessage,
        reason: 'unclear_request',
        summary: buildSupportConversationSummary({
          reason: 'unclear_request',
          currentMessage: input.currentMessage,
          recentMessages: [...recentMessages].reverse(),
          orderId: params.orderId || null,
        }),
      });
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
          // Set after the handler's own state so a repeat always wins: the bot
          // has just proved it has nothing to add, and it stays quiet until a
          // human resolves the case.
          ...(repeatedItself ? { supportMode: 'handoff_requested' as const } : {}),
          preferredLanguage: replyLanguage,
          preferredScriptStyle: replyScriptStyle,
          lastAssistantReplyKind: assistantReplyKind,
          unclearMessageCount:
            assistantReplyKind === 'fallback'
              ? params.nextState?.unclearMessageCount ?? state.unclearMessageCount
              : 0,
        })
      : state;

    await saveConversationPair(
      input.senderId,
      input.channel,
      input.transcriptMessage ?? input.currentMessage,
      localizedReply,
      brandFilter,
      [input.storedImageUrl],
      params.imagePaths ?? (params.imagePath ? [params.imagePath] : [])
    );

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
      imageCaptions: params.imageCaptions,
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
        contactName:
          mergedContact.name || customer?.name || activeSupportEscalation.contactName || null,
        contactPhone:
          mergedContact.phone || customer?.phone || activeSupportEscalation.contactPhone || null,
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

    // Asking how to reach a human is the one question a handoff must never
    // answer with silence — it is the whole point of the handoff. Telling them
    // the number takes nothing away from the agent who is picking this up.
    // Someone reporting that the number does not work is excluded: repeating it
    // back would be useless, and they are already in the queue.
    if (
      aiAction.action === 'support_contact_request' &&
      !looksLikeSupportContactProblem(input.currentMessage)
    ) {
      setDiagnosticEffectiveAction('support_contact_request');
      return finalizeReply({
        reply: buildSupportContactReply({
          orderId: state.lastReferencedOrderId,
          supportConfig: settings.support,
        }),
        assistantReplyKind: 'support_contact',
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    setDiagnosticEffectiveAction('support_silent_hold');
    return finalizeSupportSilentHold(pausedSupportMode);
  }

  // A bare emoji carries no question. Left alone it reached the catch-all and
  // answered a thumbs-up with a support phone number. Pending steps are left
  // untouched: mid-confirmation a "👍" plausibly means yes, and that branch
  // already asks them to confirm in words.
  if (state.pendingStep === 'none' && isEmojiOnlyMessage(input.currentMessage)) {
    setDiagnosticEffectiveAction('acknowledgement', 1);
    return finalizeReply({
      reply: buildEmojiAcknowledgementReply(),
      assistantReplyKind: 'generic',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (isThanksMessage(input.currentMessage)) {
    setDiagnosticEffectiveAction('acknowledgement', 1);
    return finalizeReply({
      reply: buildAcknowledgementReply(state),
      assistantReplyKind: 'generic',
      nextState: {
        lastMissingOrderId: null,
      },
    });
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

  // Someone arriving from a Click-to-WhatsApp ad sends Meta's own prefill,
  // "Hello! Can I get more info on this?", and "this" never travels with it.
  // The ad was recorded moments ago by the webhook, so the item it advertised
  // can be named instead of asking a customer to describe what they just
  // tapped. Only reached on a greeting-shaped opener, so it costs one lookup
  // on a first message rather than one per message.
  // Said once a day, not once ever and not on every message. A conversation
  // here is one number on one channel for as long as that number exists, so
  // "first contact" has to mean a gap rather than a beginning — otherwise a
  // customer returning three months later is never told what they are talking
  // to, and a customer mid-order is told twice in an hour.
  const lastAssistantAt = recentMessages.find((entry) => entry.role === 'assistant')?.createdAt;
  const shouldIntroduceAssistant =
    !lastAssistantAt || Date.now() - lastAssistantAt.getTime() > ASSISTANT_INTRO_WINDOW_MS;

  if (useGreetingShortcut) {
    const referralHint = await findRecentAdReferralHint(prisma, input.channel, input.senderId);
    // Say it once. The referral stays warm for a day, so without this a plain
    // "Hi" a minute later was answered with the same four lines about the same
    // skort — which is what one customer got. The repeat guard does not catch
    // it: that one only fires on a repeated fallback, and this is an answer.
    const alreadyAnswered = referralHint
      ? recentMessages.some(
          (entry) =>
            entry.role === 'assistant' &&
            entry.createdAt.getTime() >= referralHint.capturedAt.getTime()
        )
      : false;
    const advertisedProduct = referralHint && !alreadyAnswered
      ? resolveProductFromAdReferral(
          referralHint,
          products.map((product) => ({
            id: product.id,
            name: product.name,
            itemCode: productItemCode(product),
          }))
        )
      : null;
    const advertised = advertisedProduct
      ? products.find((product) => product.id === advertisedProduct.id)
      : null;

    if (advertised) {
      setDiagnosticEffectiveAction('ad_arrival', 1);
      return finalizeReply({
        reply: buildAdArrivalReply({
          customerName: mergedContact.name || customer?.name,
          brandName: settings.displayName,
          productName: advertised.name,
          itemCode: productItemCode(advertised),
          price: `Rs ${advertised.price}`,
          sizes: sortSizes(splitCsv(advertised.sizes)).join(', '),
          introduce: shouldIntroduceAssistant,
        }),
        assistantReplyKind: 'generic',
        nextState: {
          lastMissingOrderId: null,
          lastReferencedProductId: advertised.id,
          lastReferencedProductName: advertised.name,
          lastReferencedProductIds: [advertised.id],
        },
      });
    }
  }

  if (useGreetingShortcut) {
    setDiagnosticEffectiveAction('greeting');
    return finalizeReply({
      reply: looksLikeCapabilityQuestion(input.currentMessage)
        ? 'I can help you browse available items, compare products, check sizes and colors, confirm stock, calculate delivery charges and timing, explain COD or payment options, place an order, and connect you with support when needed.'
        : shouldIntroduceAssistant
          ? buildIntroGreetingReply(mergedContact.name || customer?.name, settings.displayName)
          : buildGreetingReply(mergedContact.name || customer?.name, settings.displayName),
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
    const nextDraft: ResolvedOrderDraft = withDraftTotal({
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
    });

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
        reply: buildMissingContactPrompt(missingFields, { city: nextDraft.city }),
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
        reply: buildMissingContactPrompt(missingFields, { city: state.orderDraft.city }),
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
    const referencedProduct =
      (state.lastReferencedProductId
        ? products.find((product) => product.id === state.lastReferencedProductId)
        : null) ||
      (state.lastReferencedProductName
        ? products.find(
            (product) =>
              product.name.toLowerCase() === state.lastReferencedProductName?.toLowerCase()
          )
        : null);

    if (referencedProduct) {
      const deliveryAddress =
        aiAction.deliveryLocation ||
        extractDeliveryLocationHint(input.currentMessage) ||
        mergedContact.address;

      if (!deliveryAddress) {
        return finalizeReply({
          reply: `For 1 ${referencedProduct.name}, the item total is Rs ${referencedProduct.price}. Which city or town should I use to add the exact delivery charge?`,
          nextState: {
            lastMissingOrderId: null,
            lastReferencedProductId: referencedProduct.id,
            lastReferencedProductName: referencedProduct.name,
          },
        });
      }

      const quantity = aiAction.quantity || 1;
      const deliveryCharge = getDeliveryChargeForAddress(deliveryAddress, settings.delivery);
      const itemTotal = referencedProduct.price * quantity;
      const total = itemTotal + deliveryCharge;

      return finalizeReply({
        reply: `For ${quantity} ${referencedProduct.name}, the total to ${deliveryAddress} is Rs ${total} (Rs ${itemTotal} for the item${quantity > 1 ? 's' : ''} + Rs ${deliveryCharge} delivery).`,
        nextState: {
          lastMissingOrderId: null,
          lastReferencedProductId: referencedProduct.id,
          lastReferencedProductName: referencedProduct.name,
        },
      });
    }

    return finalizeReply({
      reply: "Sure — share the item details for the order and I'll work out the total with delivery charges.",
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (looksLikePrivateDataExtractionRequest(input.currentMessage)) {
    setDiagnosticEffectiveAction('privacy_refusal', 1);
    return finalizeReply({
      reply:
        "I can't share private customer information or database records. I can only help with your own order, products, delivery, or payments, and I can connect you with support if needed.",
      nextState: {
        unclearMessageCount: 0,
        lastMissingOrderId: null,
      },
    });
  }

  // Never bypass the escalation path when the customer is explicitly asking to
  // speak with a human agent, even if the AI labelled it as support_contact_request.
  const hasSupportContactProblem = looksLikeSupportContactProblem(input.currentMessage);
  const detectedSupportIssueReason = inferSupportIssueReason(input.currentMessage);
  const isCourierProviderQuestion = looksLikeCourierProviderQuestion(input.currentMessage);
  const shouldAnswerSupportPolicy =
    Boolean(detectedSupportIssueReason) &&
    !looksLikeHumanEscalationRequest(input.currentMessage) &&
    !hasSupportContactProblem &&
    looksLikePreOrderIssuePolicyQuestion(input.currentMessage, detectedSupportIssueReason);
  const isSimpleSupportContactRequest =
    aiAction.action === 'support_contact_request' &&
    !looksLikeHumanEscalationRequest(input.currentMessage) &&
    detectedSupportIssueReason === 'human_request' &&
    !hasSupportContactProblem;
  const supportIssueReason =
    isSimpleSupportContactRequest ||
    isCourierProviderQuestion ||
    shouldAnswerSupportPolicy ||
    (aiAction.action === 'thanks_acknowledgement' && isThanksMessage(input.currentMessage)) ||
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

    if (supportIssueReason === 'human_request' && looksLikeCallbackRequest(input.currentMessage)) {
      const callbackReply = mergedContact.phone || customer?.phone
        ? 'Sure — I’ve asked our team to call you. If you prefer a different number, send it here.'
        : 'Sure — I’ve passed this to our team. What number should they call?';

      return escalateToSupport(supportIssueReason, relatedOrderId, callbackReply);
    }

    return escalateToSupport(supportIssueReason, relatedOrderId);
  }

  // Several codes in one message. Our multi-item post captions prefill
  // "Details HAP-0001 HAP-0002 HAP-0003", and the router settles on one of
  // them — the customer who tapped a three-dress carousel got a write-up of
  // the first and nothing about the other two. All of them are answered.
  //
  // Only when nothing is pending: mid-order, the codes are far more likely to
  // be the customer correcting an item than browsing a set.
  if (codedProducts.length > 1 && state.pendingStep === 'none') {
    setDiagnosticEffectiveAction('multi_code_lookup', 1);
    return finalizeReply({
      reply: buildMultiCodeReply(
        codedProducts.map((product) => {
          const variantTotal =
            product.variants && product.variants.length > 0
              ? product.variants.reduce((sum, v) => sum + (v.inventory?.availableQty ?? 0), 0)
              : null;

          return {
            name: product.name,
            itemCode: productItemCode(product),
            price: product.price,
            sizes: product.sizes,
            availableQty: variantTotal ?? product.inventory?.availableQty ?? product.stock,
          };
        })
      ),
      assistantReplyKind: 'generic',
      nextState: {
        lastRecommendedProductIds: codedProducts.map((product) => product.id),
        lastMissingOrderId: null,
      },
    });
  }

  let effectiveAction = aiAction.action;
  let effectiveAiAction = aiAction;

  if (
    effectiveAction === 'thanks_acknowledgement' &&
    !isThanksMessage(input.currentMessage) &&
    !isNeutralAcknowledgement(input.currentMessage)
  ) {
    effectiveAction = 'fallback';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'fallback',
      confidence: Math.min(effectiveAiAction.confidence, 0.5),
    };
  }

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

  const hasExplicitPendingConfirmation =
    ['contact_confirmation', 'order_confirmation', 'quantity_update_confirmation'].includes(
      state.pendingStep
    ) && isClearConfirmation(input.currentMessage);

  // A "yes" straight after an order was placed is the customer acknowledging
  // it, not a new confirmation. Without this it fell through to fallback and
  // escalated them to support, which reads as if something had gone wrong with
  // an order that is perfectly fine.
  const isPostConfirmationEcho =
    state.pendingStep === 'none' &&
    state.lastAssistantReplyKind === 'order_confirmed' &&
    isClearConfirmation(input.currentMessage);

  if (hasExplicitPendingConfirmation || isPostConfirmationEcho) {
    effectiveAction = 'confirm_pending';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'confirm_pending',
      confidence: Math.max(effectiveAiAction.confidence, 0.99),
    };
  } else if (effectiveAction === 'confirm_pending') {
    effectiveAction = 'fallback';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'fallback',
      confidence: Math.min(effectiveAiAction.confidence, 0.5),
    };
  }

  if (
    shouldAnswerSupportPolicy &&
    ['fallback', 'support_contact_request', 'delivery_question', 'greeting'].includes(effectiveAction)
  ) {
    effectiveAction = 'exchange_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'exchange_question',
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
    };
  }

  if (
    isCourierProviderQuestion &&
    ['fallback', 'support_contact_request', 'greeting', 'delivery_question'].includes(effectiveAction)
  ) {
    effectiveAction = 'delivery_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'delivery_question',
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
    };
  }

  const currentDeliveryLocation =
    effectiveAiAction.deliveryLocation || extractDeliveryLocationHint(input.currentMessage);
  const shouldQuoteDeliveryCharge = shouldIncludeDeliveryCharge({
    currentMessage: input.currentMessage,
    previousCustomerMessage: latestCustomerText,
    currentLocation: currentDeliveryLocation,
  });

  if (
    shouldQuoteDeliveryCharge &&
    ['fallback', 'support_contact_request', 'greeting', 'delivery_question', 'payment_question'].includes(
      effectiveAction
    )
  ) {
    effectiveAction = 'delivery_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'delivery_question',
      confidence: Math.max(effectiveAiAction.confidence, 0.95),
      deliveryLocation: currentDeliveryLocation,
    };
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

  const explicitlyMentionedCatalogProducts = findMentionedCatalogProducts(
    input.currentMessage,
    products
  );
  const isRecommendationRequest = looksLikeRecommendationRequest(input.currentMessage);
  const isShortlistFollowUp =
    state.lastRecommendedProductIds.length > 1 &&
    looksLikeShortlistFollowUp(input.currentMessage);
  const canUseRecommendationRouting = ['fallback', 'greeting', 'catalog_list'].includes(
    effectiveAction
  );

  if (state.pendingStep === 'none' && isShortlistFollowUp && canUseRecommendationRouting) {
    effectiveAction = 'catalog_list';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'catalog_list',
      confidence: Math.max(effectiveAiAction.confidence, 0.96),
    };
  } else if (
    state.pendingStep === 'none' &&
    isRecommendationRequest &&
    explicitlyMentionedCatalogProducts.length === 0 &&
    canUseRecommendationRouting
  ) {
    effectiveAction = 'catalog_list';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'catalog_list',
      productName: null,
      confidence: Math.max(effectiveAiAction.confidence, 0.96),
    };
  }

  const mentionedProductForAvailability =
    state.pendingStep === 'none' && looksLikeProductAvailabilityQuestion(input.currentMessage)
      ? products.find((product) => scoreProductMatch(product, input.currentMessage) >= 100) || null
      : null;
  const mentionedProductForQuestion =
    state.pendingStep === 'none' && looksLikeProductInformationQuestion(input.currentMessage)
      ? products.find((product) => scoreProductMatch(product, input.currentMessage) >= 100) || null
      : null;

  const referencedProductForFollowUp =
    state.pendingStep === 'none' && looksLikeReferencedProductFollowUp(input.currentMessage)
      ? (state.lastReferencedProductId
          ? products.find((product) => product.id === state.lastReferencedProductId)
          : null) ||
        (state.lastReferencedProductName
          ? products.find(
              (product) =>
                product.name.toLowerCase() === state.lastReferencedProductName?.toLowerCase()
            )
          : null)
      : null;

  if (
    referencedProductForFollowUp &&
    ['fallback', 'support_contact_request', 'greeting', 'catalog_list'].includes(effectiveAction)
  ) {
    effectiveAction = 'product_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'product_question',
      productName: referencedProductForFollowUp.name,
      confidence: Math.max(effectiveAiAction.confidence, 0.9),
    };
  }

  if (
    mentionedProductForAvailability &&
    ['fallback', 'support_contact_request', 'greeting', 'catalog_list'].includes(effectiveAction)
  ) {
    effectiveAction = 'product_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'product_question',
      productName: mentionedProductForAvailability.name,
      questionType: effectiveAiAction.questionType || 'availability',
      confidence: Math.max(effectiveAiAction.confidence, 0.92),
    };
  }

  if (
    mentionedProductForQuestion &&
    ['fallback', 'support_contact_request', 'greeting', 'catalog_list'].includes(effectiveAction)
  ) {
    effectiveAction = 'product_question';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'product_question',
      productName: mentionedProductForQuestion.name,
      questionType:
        effectiveAiAction.questionType ||
        (/\b(?:fabric|material|pockets?|zip|zipper|slit|fit|length|sleeve|neckline|hem|pattern)\b/i.test(
          input.currentMessage
        )
          ? 'fit'
          : null),
      confidence: Math.max(effectiveAiAction.confidence, 0.92),
    };
  }

  if (
    state.pendingStep === 'none' &&
    ['fallback', 'support_contact_request', 'greeting'].includes(effectiveAction) &&
    (looksLikeRecommendationRequest(input.currentMessage) ||
      looksLikeProductComparison(input.currentMessage))
  ) {
    effectiveAction = 'catalog_list';
    effectiveAiAction = {
      ...effectiveAiAction,
      action: 'catalog_list',
      confidence: Math.max(effectiveAiAction.confidence, 0.92),
    };
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
    latestOrder, latestActiveOrder, latestAssistantText, latestCustomerText, recentCustomerTexts,
    explicitOrderId,
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
