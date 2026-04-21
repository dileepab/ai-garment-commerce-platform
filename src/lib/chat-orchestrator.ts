import prisma from '@/lib/prisma';
import { getAiStockReply } from '@/lib/ai';
import {
  routeCustomerMessageWithAi,
  type AiRoutedAction,
} from '@/lib/ai-action-router';
import {
  clearPendingConversationState,
  loadConversationState,
  saveConversationState,
  type ConversationStateData,
} from '@/lib/conversation-state';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  type ResolvedOrderDraft,
} from '@/lib/order-draft';
import {
  buildCancellationSuccessReply,
  buildOrderAlreadyCancelledReply,
  buildOrderDetailsReply,
  buildOrderPlacedReply,
  buildOrderStatusReply,
  buildQuantityUpdateSuccessReply,
  buildQuantityUpdateSummaryReply,
  calculateOrderDeliveryCharge,
  type QuantityUpdateSummary,
} from '@/lib/order-details';
import {
  createOrderFromCatalog,
  cancelOrderById,
  OrderRequestError,
  updateSingleItemOrderQuantityById,
} from '@/lib/orders';
import {
  cleanStoredContactValue,
  extractContactDetailsFromText,
  getMissingContactFields,
  mergeContactDetails,
  type ContactField,
  type ContactDetails,
} from '@/lib/contact-profile';
import {
  addSriLankaWorkingDays,
  formatSriLankaDisplayDate,
  getSriLankaDateOnly,
  getSriLankaToday,
} from '@/lib/delivery-calendar';
import { isClearConfirmation } from '@/lib/order-confirmation';
import {
  getSizeChartCategoryFromStyle,
  getSizeChartCategoryFromText,
  getSizeChartDefinition,
  type SizeChartCategory,
} from '@/lib/size-charts';
import {
  buildHumanSupportReply,
  buildSupportContactLine,
  buildSupportConversationSummary,
  upsertSupportEscalation,
  type SupportIssueReason,
} from '@/lib/customer-support';
import { getOrderStageLabel, isActiveOrderStatus } from '@/lib/order-status-display';

interface CustomerMessageInput {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
  customerName?: string;
  customerGender?: string;
}

export interface CustomerMessageResult {
  reply: string;
  imagePath?: string;
  imagePaths?: string[];
  orderId?: number | null;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCsv(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstNameOf(value?: string | null): string {
  return cleanStoredContactValue(value).split(' ')[0] || '';
}

function scoreProductMatch(
  product: { name: string; style?: string | null },
  text: string
): number {
  const normalizedText = normalizeText(text);
  const candidates = [product.name, product.style || '']
    .map(normalizeText)
    .filter(Boolean);

  let bestScore = 0;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (normalizedText.includes(candidate) || candidate.includes(normalizedText)) {
      return 100;
    }

    const score = candidate
      .split(' ')
      .filter((token) => token.length > 2)
      .reduce((sum, token) => (normalizedText.includes(token) ? sum + 1 : sum), 0);

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function normalizeSize(value?: string | null, allowedSizes?: string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value);
  const sizeMap: Record<string, string> = {
    'extra small': 'XS',
    xs: 'XS',
    small: 'S',
    s: 'S',
    medium: 'M',
    m: 'M',
    large: 'L',
    l: 'L',
    'extra large': 'XL',
    xl: 'XL',
    xxl: 'XXL',
    'double extra large': 'XXL',
  };

  const mapped = sizeMap[normalized] || value.trim().toUpperCase();

  if (!allowedSizes || allowedSizes.length === 0) {
    return mapped;
  }

  return allowedSizes.includes(mapped) ? mapped : undefined;
}

function normalizeColor(value?: string | null, allowedColors?: string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!allowedColors || allowedColors.length === 0) {
    return value.trim();
  }

  const normalized = normalizeText(value);
  return allowedColors.find((color) => normalizeText(color) === normalized);
}

function buildMissingFieldLabels(missingFields: ContactField[]): string {
  return missingFields
    .map((field) => {
      if (field === 'name') {
        return 'Name:';
      }

      if (field === 'address') {
        return 'Address:';
      }

      return 'Phone Number:';
    })
    .join('\n');
}

function buildMissingContactPrompt(missingFields: ContactField[]): string {
  return [
    'To proceed with the order, please share:',
    buildMissingFieldLabels(missingFields),
  ].join('\n');
}

function buildVariantPrompt(productName: string, size?: string, color?: string, product?: {
  sizes: string;
  colors: string;
} | null): string {
  const prompts: string[] = [];

  if (!size) {
    const sizeOptions = splitCsv(product?.sizes);
    prompts.push(
      sizeOptions.length > 0
        ? `Please let me know the size you need for ${productName}. Available sizes: ${sizeOptions.join(', ')}.`
        : `Please let me know the size you need for ${productName}.`
    );
  }

  if (!color) {
    const colorOptions = splitCsv(product?.colors);
    prompts.push(
      colorOptions.length > 0
        ? `Please let me know the color you need for ${productName}. Available colors: ${colorOptions.join(', ')}.`
        : `Please let me know the color you need for ${productName}.`
    );
  }

  return prompts.join('\n');
}

function formatCatalogListReply(
  products: Array<{
    name: string;
    price: number;
    sizes: string;
    colors: string;
    inventory?: { availableQty: number } | null;
  }>
): string {
  const availableProducts = products.filter(
    (product) => (product.inventory?.availableQty ?? 0) > 0
  );
  const lines = (availableProducts.length > 0 ? availableProducts : products).map(
    (product) =>
      `${product.name}: Rs ${product.price} (Sizes ${product.sizes || '-'} / Colors: ${
        product.colors || '-'
      })`
  );

  return [
    'We currently have the following items available:',
    '',
    ...lines,
  ].join('\n');
}

function buildProductQuestionReply(
  product: {
    name: string;
    price: number;
    sizes: string;
    colors: string;
    inventory?: { availableQty: number } | null;
  },
  questionType: AiRoutedAction['questionType']
): string {
  const sizeList = splitCsv(product.sizes);
  const colorList = splitCsv(product.colors);
  const availableQty = product.inventory?.availableQty ?? 0;

  if (questionType === 'colors') {
    return `${product.name} is currently available in ${colorList.join(', ')}.`;
  }

  if (questionType === 'sizes') {
    return `${product.name} is currently available in sizes ${sizeList.join(', ')}.`;
  }

  if (questionType === 'price') {
    return `${product.name} is priced at Rs ${product.price}.`;
  }

  return `${product.name} is currently available for Rs ${product.price}. Sizes: ${sizeList.join(
    ', '
  )}. Colors: ${colorList.join(', ')}. Available stock: ${availableQty}.`;
}

function parseRequestedDateFromMessage(message: string, referenceDate: Date): Date | null {
  const explicitMatch = message.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );

  if (explicitMatch?.[1] && explicitMatch[2]) {
    const day = Number.parseInt(explicitMatch[1], 10);
    const month = MONTH_MAP[explicitMatch[2].toLowerCase()];

    if (Number.isInteger(day) && month !== undefined) {
      const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), month, day));
      return candidate < referenceDate
        ? new Date(Date.UTC(referenceDate.getUTCFullYear() + 1, month, day))
        : candidate;
    }
  }

  const dayOnlyMatch = message.match(/\bbefore\b.*\b(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (dayOnlyMatch?.[1]) {
    const day = Number.parseInt(dayOnlyMatch[1], 10);

    if (Number.isInteger(day)) {
      const candidate = new Date(
        Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), day)
      );

      return candidate < referenceDate
        ? new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, day))
        : candidate;
    }
  }

  return null;
}

function extractDeliveryLocationHint(message: string): string | null {
  const patterns = [
    /\b(?:delivery(?:\s+\w+){0,3}\s+to|deliver(?:y)?\s+to)\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bhow long does delivery take to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bdelivery time to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function buildDeliveryReply(params: {
  address?: string | null;
  referenceDate: Date;
  requestedDate: Date | null;
  isDraft: boolean;
  existingOrderStatus?: string | null;
}): string {
  const address = params.address?.trim();

  if (!address) {
    return 'Delivery usually takes 1-2 business days within Colombo and 2-3 business days outside Colombo, excluding weekends and Sri Lankan public holidays.';
  }

  const estimate = getDeliveryEstimateForAddress(address);
  const businessDays = estimate === '1-2 business days' ? [1, 2] : [2, 3];
  const earliestDate = addSriLankaWorkingDays(params.referenceDate, businessDays[0]);
  const latestDate = addSriLankaWorkingDays(params.referenceDate, businessDays[1]);
  const intro = params.existingOrderStatus
    ? `Order is currently at the ${getOrderStageLabel(
        params.existingOrderStatus
      )} stage. Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`
    : `Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

  if (!params.requestedDate) {
    if (params.isDraft) {
      return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
        params.referenceDate
      )}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(
        latestDate
      )}.`;
    }

    return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
      earliestDate
    )} to ${formatSriLankaDisplayDate(latestDate)}.`;
  }

  if (latestDate <= params.requestedDate) {
    return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
      earliestDate
    )} to ${formatSriLankaDisplayDate(latestDate)}, so it should arrive by ${formatSriLankaDisplayDate(
      params.requestedDate
    )}.`;
  }

  if (params.isDraft) {
    return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(
      params.referenceDate
    )}, delivery before ${formatSriLankaDisplayDate(params.requestedDate)} is not possible.`;
  }

  return `${intro} The expected delivery window is ${formatSriLankaDisplayDate(
    earliestDate
  )} to ${formatSriLankaDisplayDate(latestDate)}, so delivery before ${formatSriLankaDisplayDate(
    params.requestedDate
  )} cannot be guaranteed.`;
}

function buildGreetingReply(name?: string | null, brand?: string): string {
  const firstName = firstNameOf(name);

  if (firstName) {
    return `Hello ${firstName}. How can I assist you with your ${brand || 'store'} order today?`;
  }

  return `Hello. How can I assist you with your ${brand || 'store'} order today?`;
}

function isGreetingMessage(message: string): boolean {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(message.trim());
}

function isThanksMessage(message: string): boolean {
  return /^(thanks|thank you|thankyou|thx)\b[!. ]*$/i.test(message.trim());
}

function isNeutralAcknowledgement(message: string): boolean {
  return /^(ok|okay|alright|fine|noted|got it|understood)\b[!. ]*$/i.test(message.trim());
}

function extractExplicitOrderIdFromMessage(message: string): number | null {
  const hashMatch = message.match(/#\s*(\d+)/);

  if (hashMatch?.[1]) {
    return Number.parseInt(hashMatch[1], 10);
  }

  const orderMatch = message.match(/\border\s*#?\s*(\d+)\b/i);

  if (orderMatch?.[1]) {
    return Number.parseInt(orderMatch[1], 10);
  }

  const checkMatch = normalizeText(message).match(/^check\s+(\d+)$/);

  if (checkMatch?.[1]) {
    return Number.parseInt(checkMatch[1], 10);
  }

  return null;
}

function looksLikeOrderDetailsRequest(message: string): boolean {
  return /\border details?\b|\border summary\b|\bsummary of\b|\bdetails? of\b|\bsend me .*details?\b/i.test(
    message
  );
}

function looksLikeMissingOrderFollowUp(message: string): boolean {
  return /\bfind\b|\bdatabase\b|\bcheck again\b|\bstatus\b|\bdetails?\b|\bthe order\b/i.test(message);
}

function looksLikeExplicitOrderLookup(message: string): boolean {
  return /\b(find|check|status|details?|summary|show|send)\b/i.test(message);
}

function looksLikeOrderStatusRequest(message: string): boolean {
  return (
    /\border status\b|\bstatus of\b|\bwhat is the status\b|\bcheck(?: again)?\b|\btrack\b|\bwhere is my order\b/i.test(
      message
    ) && !looksLikeOrderDetailsRequest(message)
  );
}

function looksLikeCancellationRequest(message: string): boolean {
  return /\bcancel\b|\bdelete\b|\bremove\b/i.test(message);
}

function looksLikeQuantityUpdateRequest(message: string): boolean {
  return /\b(?:increase|decrease|reduce|lower|change|update|edit|set)\b.*\b(?:quantity|count)\b|\bquantity\b.*\bto\s+\d+\b|\border count\b.*\bto\s+\d+\b/i.test(
    message
  );
}

function looksLikePaymentQuestion(message: string): boolean {
  return /\bonline transfer\b|\bbank transfer\b|\bpayment method\b|\bpay\b/i.test(message);
}

function looksLikeExchangeQuestion(message: string): boolean {
  return /\bexchange\b|\bwrong size\b|\bsize is wrong\b|\bchange the size\b/i.test(message);
}

function looksLikeHumanSupportRequest(message: string): boolean {
  return /\b(agent|human|real person|team member|customer care|customer support|support team|talk to someone|speak to someone|support number|your phone number|call your team|contact your team)\b/i.test(
    message
  );
}

function looksLikeDeliveryComplaint(message: string): boolean {
  return (
    /\b(late|delayed|delay|not received|didn t receive|where is my parcel|where is my package|parcel not arrived|package not arrived|courier issue|still haven t received|still haven t got)\b/i.test(
      normalizeText(message)
    ) && !looksLikeDeliveryQuestion(message)
  );
}

function looksLikePaymentProblem(message: string): boolean {
  return /\b(payment failed|payment issue|payment problem|paid already|money deducted|charged twice|bank transfer issue|cannot pay|can t pay|cant pay)\b/i.test(
    normalizeText(message)
  );
}

function looksLikeRefundOrDamageIssue(message: string): boolean {
  return /\b(refund|damaged|broken|defective|wrong item|wrong product|return this|return my money)\b/i.test(
    normalizeText(message)
  );
}

function looksLikeClarificationBreakdown(message: string): boolean {
  return /\b(not clear|unclear|confusing|don t understand|do not understand|you don t understand|you do not understand)\b/i.test(
    normalizeText(message)
  );
}

function inferSupportIssueReason(message: string): SupportIssueReason | null {
  if (looksLikeHumanSupportRequest(message)) {
    return 'human_request';
  }

  if (looksLikePaymentProblem(message)) {
    return 'payment_issue';
  }

  if (looksLikeRefundOrDamageIssue(message)) {
    return 'refund_or_damage';
  }

  if (looksLikeDeliveryComplaint(message)) {
    return 'delivery_issue';
  }

  if (looksLikeClarificationBreakdown(message)) {
    return 'unclear_request';
  }

  return null;
}

function looksLikeGiftRequest(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    /\bgift wrap\b|\bpack(?: it| this| the order)? as a gift\b|\bsend(?: it| this)? as a gift\b|\bgift note\b|\bspecial note\b|\bhappy birthday\b/.test(
      normalized
    ) ||
    ((/\bgift\b/.test(normalized) || /\bnote\b/.test(normalized)) &&
      /\b(pack|wrap|send|add|include|write|attach|birthday)\b/.test(normalized))
  );
}

function looksLikeGiftFollowUp(message: string): boolean {
  return /^(yes|yeah|yep|okay|ok|do it|add it|apply it|use that|use it)\b/i.test(
    message.trim()
  );
}

function looksLikeGiftUpdateInstruction(message: string): boolean {
  const normalized = normalizeText(message);

  return (
    looksLikeGiftRequest(message) &&
    /\b(pack|wrap|add|include|update|set|apply|put|write|attach)\b/.test(normalized)
  );
}

function assistantOfferedGiftOptions(message: string): boolean {
  return /\bpack it as a gift\b|\binclude the note\b/i.test(message);
}

function extractGiftNoteFromText(message: string): string | null {
  const quotedMatch = message.match(/\bnote\s+"([^"]+)"/i) || message.match(/\bnote\s+'([^']+)'/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  if (/happy birthday/i.test(message)) {
    return 'Happy Birthday';
  }

  return null;
}

function looksLikeDeliveryQuestion(message: string): boolean {
  return /\bhow long\b|\bdelivery\b|\barrive\b|\bbefore\b|\bwhen can i get\b|\bwhen will it arrive\b/i.test(
    message
  );
}

function looksLikeTotalQuestion(message: string): boolean {
  return /\btotal\b|\bwith delivery\b|\bdelivery charges?\b|\bfinal amount\b|\bhow much altogether\b/i.test(
    message
  );
}

function looksLikeCatalogQuestion(message: string): boolean {
  return /\bavailable items?\b|\bavailable products?\b|\bwhat are the available\b|\bwhat do you have\b|\bavailable dresses?\b|\bavailable tops?\b|\bavailable pants\b|\bavailable skirts?\b|\bdo you have\b.*\b(dress|dresses|top|tops|pant|pants|skirt|skirts)\b|\bdon['’]?t you have\b.*\b(dress|dresses|top|tops|pant|pants|skirt|skirts)\b/i.test(message);
}

function looksLikeSizeChartQuestion(message: string): boolean {
  return /\bsize chart\b|\bmeasurement chart\b|\bmeasurements?\b/i.test(message);
}

function looksLikeSameItemMessage(message: string): boolean {
  return /\bsame item\b|\bsame size\b|\bsame product\b|\bsame one\b|\bsame top\b/i.test(message);
}

function messageReferencesExistingOrder(message: string): boolean {
  return /\bmy order\b|\blast order\b|\bprevious order\b|\bthat order\b|\border\s*#?\s*\d+\b/i.test(
    message
  );
}

function mentionsRelativeOrderReference(message: string): boolean {
  return /\blast order\b|\bprevious order\b|\bthat order\b|\bmy order\b/i.test(message);
}

function extractMaximumQuantityFromAssistantMessage(message: string): number | null {
  const match = message.match(/\bup to\s+(\d+)\s+item/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function isLowerQuantityPrompt(message: string): boolean {
  return /please send a lower quantity|please tell me the quantity you want/i.test(message);
}

function extractRequestedProductTypes(message: string): SizeChartCategory[] {
  const normalized = normalizeText(message);
  const result: SizeChartCategory[] = [];

  if (/\btop\b|\btops\b|\bshirt\b|\bshirts\b|\bblouse\b|\bblouses\b|\bcrop top\b/.test(normalized)) {
    result.push('tops');
  }

  if (/\bdress\b|\bdresses\b|\bgown\b|\bgowns\b/.test(normalized)) {
    result.push('dresses');
  }

  if (/\bpant\b|\bpants\b|\btrouser\b|\btrousers\b|\bjean\b|\bjeans\b|\blegging\b|\bleggings\b/.test(normalized)) {
    result.push('pants');
  }

  if (/\bskirt\b|\bskirts\b/.test(normalized)) {
    result.push('skirts');
  }

  return [...new Set(result)];
}

function buildProductTypeUnavailableReply(category: SizeChartCategory): string {
  const label = getSizeChartDefinition(category).label.toLowerCase();
  return `We do not have any ${label} available right now.`;
}

function buildSizeChartSelectionReply(categories: SizeChartCategory[]): string {
  const labels = categories.map((category) => getSizeChartDefinition(category).label).join(', ');
  return `Sure. Which item type would you like the size chart for? Available types: ${labels}.`;
}

function buildSizeChartReply(categories: SizeChartCategory[], specificProductName?: string | null): {
  reply: string;
  imagePaths: string[];
} {
  const uniqueCategories = [...new Set(categories)];
  const imagePaths = uniqueCategories.map(
    (category) => getSizeChartDefinition(category).imagePath
  );

  if (specificProductName && uniqueCategories.length === 1) {
    return {
      reply: `Sure. Here is the size chart for ${specificProductName}.`,
      imagePaths,
    };
  }

  if (uniqueCategories.length === 1) {
    const label = getSizeChartDefinition(uniqueCategories[0]).label;
    return {
      reply: `Sure. Here is our ${label} size chart.`,
      imagePaths,
    };
  }

  const labels = uniqueCategories.map((category) => getSizeChartDefinition(category).label);
  const joinedLabels = labels.length === 2 ? `${labels[0]} and ${labels[1]}` : labels.join(', ');

  return {
    reply: `Sure. Here are our ${joinedLabels} size charts.`,
    imagePaths,
  };
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

async function updateOrderGiftInstructions(orderId: number, giftNote: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      giftWrap: true,
      giftNote,
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

async function upsertCustomerContact(params: {
  senderId: string;
  channel: string;
  preferredBrand?: string;
  currentCustomerId?: number;
  currentName?: string | null;
  currentPhone?: string | null;
  contact: ContactDetails;
}) {
  const nextName = params.contact.name || cleanStoredContactValue(params.currentName);
  const nextPhone = params.contact.phone || cleanStoredContactValue(params.currentPhone);

  if (!nextName && !nextPhone && !params.currentCustomerId) {
    return null;
  }

  if (params.currentCustomerId) {
    return prisma.customer.update({
      where: { id: params.currentCustomerId },
      data: {
        name: nextName || cleanStoredContactValue(params.currentName) || '',
        phone: nextPhone || null,
        channel: params.channel,
        preferredBrand: params.preferredBrand || undefined,
      },
    });
  }

  return prisma.customer.create({
    data: {
      externalId: params.senderId,
      name: nextName || '',
      phone: nextPhone || null,
      channel: params.channel,
      preferredBrand: params.preferredBrand || null,
    },
  });
}

export async function routeCustomerMessage(
  input: CustomerMessageInput
): Promise<CustomerMessageResult> {
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
  const products = await prisma.product.findMany({
    where: brandFilter ? { brand: brandFilter, status: 'active' } : { status: 'active' },
    include: {
      inventory: true,
    },
    orderBy: { createdAt: 'asc' },
  });

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
    reply: string;
    nextState?: Partial<ConversationStateData>;
    imagePath?: string;
    imagePaths?: string[];
    orderId?: number | null;
  }): Promise<CustomerMessageResult> {
    const nextState = params.nextState
      ? await saveConversationState(input.senderId, input.channel, {
          ...state,
          ...params.nextState,
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

    return {
      reply: params.reply,
      imagePath: params.imagePath ?? params.imagePaths?.[0],
      imagePaths: params.imagePaths ?? (params.imagePath ? [params.imagePath] : undefined),
      orderId: params.orderId ?? null,
    };
  }

  async function escalateToSupport(reason: SupportIssueReason, orderId?: number | null) {
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
      nextState: {
        ...clearPendingConversationState(state),
        lastReferencedOrderId: orderId ?? state.lastReferencedOrderId ?? null,
        lastMissingOrderId: null,
      },
    });
  }

  if (isThanksMessage(input.currentMessage)) {
    return finalizeReply({
      reply: 'You are welcome. Please let me know if you need anything else.',
      nextState: {
        lastMissingOrderId: null,
      },
    });
  }

  if (isGreetingMessage(input.currentMessage) && state.pendingStep === 'none') {
    return finalizeReply({
      reply: buildGreetingReply(mergedContact.name || customer?.name, brandFilter),
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
    Boolean(extractedContact.name || extractedContact.address || extractedContact.phone)
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

  const supportIssueReason = inferSupportIssueReason(input.currentMessage);
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

  if (looksLikeOrderDetailsRequest(input.currentMessage)) {
    effectiveAction = 'order_details';
  } else if (
    looksLikeOrderStatusRequest(input.currentMessage) ||
    (/^check again\b/i.test(input.currentMessage) &&
      Boolean(state.lastReferencedOrderId || state.lastMissingOrderId))
  ) {
    effectiveAction = 'order_status';
  } else if (looksLikeCancellationRequest(input.currentMessage)) {
    effectiveAction = 'cancel_order';
  } else if (looksLikeQuantityUpdateRequest(input.currentMessage)) {
    effectiveAction = 'update_order_quantity';
  } else if (looksLikeSizeChartQuestion(input.currentMessage)) {
    effectiveAction = 'size_chart';
  } else if (looksLikeExchangeQuestion(input.currentMessage)) {
    effectiveAction = 'exchange_question';
  } else if (looksLikePaymentQuestion(input.currentMessage)) {
    effectiveAction = 'payment_question';
  } else if (
    assistantOfferedGiftOptions(latestAssistantText) &&
    messageReferencesExistingOrder(input.currentMessage) &&
    looksLikeGiftFollowUp(input.currentMessage)
  ) {
    effectiveAction = 'gift_request';
  } else if (looksLikeGiftRequest(input.currentMessage)) {
    effectiveAction = 'gift_request';
  } else if (looksLikeDeliveryQuestion(input.currentMessage)) {
    effectiveAction = 'delivery_question';
  } else if (looksLikeCatalogQuestion(input.currentMessage)) {
    effectiveAction = 'catalog_list';
  } else if (
    explicitOrderId !== null &&
    looksLikeExplicitOrderLookup(input.currentMessage)
  ) {
    effectiveAction = looksLikeOrderStatusRequest(input.currentMessage)
      ? 'order_status'
      : 'order_details';
  } else if (followUpMissingOrderId !== null && looksLikeMissingOrderFollowUp(input.currentMessage)) {
    effectiveAction = looksLikeOrderStatusRequest(input.currentMessage)
      ? 'order_status'
      : 'order_details';
  }

  if (effectiveAction === 'confirm_pending' && !isClearConfirmation(input.currentMessage)) {
    effectiveAction = 'fallback';
  }

  switch (effectiveAction) {
    case 'greeting': {
      return finalizeReply({
        reply: buildGreetingReply(mergedContact.name || customer?.name, brandFilter),
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'catalog_list': {
      const filteredProducts =
        requestedProductTypes.length > 0
          ? products.filter((product) => {
              const category = getSizeChartCategoryFromStyle(product.style);
              return category ? requestedProductTypes.includes(category) : false;
            })
          : products;
      const availableFilteredProducts = filteredProducts.filter(
        (product) => (product.inventory?.availableQty ?? 0) > 0
      );

      if (requestedProductTypes.length === 1 && availableFilteredProducts.length === 0) {
        const availableProducts = products.filter((product) => (product.inventory?.availableQty ?? 0) > 0);
        const categoryLabel = getSizeChartDefinition(requestedProductTypes[0]).label.toLowerCase();
        const unavailableReply =
          filteredProducts.length > 0
            ? `We do not have any ${categoryLabel} available in ${brandFilter || 'this store'} right now.`
            : buildProductTypeUnavailableReply(requestedProductTypes[0]);

        return finalizeReply({
          reply:
            availableProducts.length > 0
              ? `${unavailableReply}\n\nCurrently available items are:\n\n${formatCatalogListReply(
                  availableProducts
                ).replace(/^We currently have the following items available:\n\n/, '')}`
              : unavailableReply,
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      return finalizeReply({
        reply: formatCatalogListReply(
          requestedProductTypes.length > 0 ? filteredProducts : products
        ),
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'product_question': {
      const selectedProduct =
        findProductByName(aiAction.productName) ||
        (state.orderDraft ? products.find((product) => product.id === state.orderDraft?.productId) || null : null);

      if (!selectedProduct) {
        if (requestedProductTypes.length === 1) {
          const filteredProducts = products.filter((product) => {
            const category = getSizeChartCategoryFromStyle(product.style);
            return category === requestedProductTypes[0];
          });
          const availableFilteredProducts = filteredProducts.filter(
            (product) => (product.inventory?.availableQty ?? 0) > 0
          );

          return finalizeReply({
            reply:
              availableFilteredProducts.length === 0
                ? buildProductTypeUnavailableReply(requestedProductTypes[0])
                : formatCatalogListReply(filteredProducts),
            nextState: {
              lastMissingOrderId: null,
            },
          });
        }

        return finalizeReply({
          reply: 'Please send the item name, and I will share the correct details for it.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      return finalizeReply({
        reply: buildProductQuestionReply(selectedProduct, aiAction.questionType),
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'size_chart': {
      const selectedProduct = findProductByName(aiAction.productName);
      const availableCategories = [
        ...new Set(
          products
            .map((product) => getSizeChartCategoryFromStyle(product.style))
            .filter((value): value is SizeChartCategory => Boolean(value))
        ),
      ];
      const categoriesToSend = requestedProductTypes.length > 0
        ? requestedProductTypes
        : aiAction.productType
          ? [aiAction.productType]
          : getSizeChartCategoryFromText(input.currentMessage)
            ? [getSizeChartCategoryFromText(input.currentMessage) as SizeChartCategory]
            : selectedProduct && getSizeChartCategoryFromStyle(selectedProduct.style)
              ? [getSizeChartCategoryFromStyle(selectedProduct.style) as SizeChartCategory]
              : [];

      if (categoriesToSend.length === 0) {
        if (availableCategories.length === 1) {
          const payload = buildSizeChartReply(availableCategories);
          return finalizeReply({
            reply: payload.reply,
            imagePaths: payload.imagePaths,
            nextState: {
              pendingStep: 'none',
              lastMissingOrderId: null,
              lastSizeChartCategory: availableCategories[0],
            },
          });
        }

        return finalizeReply({
          reply: buildSizeChartSelectionReply(
            availableCategories.length > 0
              ? availableCategories
              : ['tops', 'dresses', 'pants', 'skirts']
          ),
          nextState: {
            pendingStep: 'size_chart_selection',
            lastMissingOrderId: null,
          },
        });
      }

      const payload = buildSizeChartReply(categoriesToSend, selectedProduct?.name || null);
      return finalizeReply({
        reply: payload.reply,
        imagePaths: payload.imagePaths,
        nextState: {
          pendingStep: 'none',
          lastMissingOrderId: null,
          lastSizeChartCategory: categoriesToSend[categoriesToSend.length - 1],
        },
      });
    }

    case 'place_order': {
      const existingDraft = state.orderDraft;
      const sourceProduct =
        findProductByName(aiAction.productName) ||
        (existingDraft ? products.find((product) => product.id === existingDraft.productId) || null : null);

      if (!sourceProduct) {
        return finalizeReply({
          reply: 'Please send the item name, size, and color you want so I can prepare the order correctly.',
          nextState: {
            pendingStep: 'order_draft',
            orderDraft: existingDraft,
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }

      const nextDraft = buildDraftFromSource(sourceProduct, existingDraft);
      const availableQty = sourceProduct.inventory?.availableQty ?? sourceProduct.stock;

      if (nextDraft.quantity > availableQty) {
        return finalizeReply({
          reply: `${sourceProduct.name} currently has ${availableQty} item(s) available. Please send a lower quantity.`,
          nextState: {
            pendingStep: 'order_draft',
            orderDraft: {
              ...nextDraft,
              quantity: existingDraft?.quantity || 1,
              total:
                sourceProduct.price * (existingDraft?.quantity || 1) +
                nextDraft.deliveryCharge,
            },
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }

      const missingVariantReply = buildVariantPrompt(
        nextDraft.productName,
        nextDraft.size,
        nextDraft.color,
        sourceProduct
      );

      if (missingVariantReply) {
        return finalizeReply({
          reply: missingVariantReply,
          nextState: {
            pendingStep: 'order_draft',
            orderDraft: nextDraft,
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }

      const missingContactFields = getMissingContactFields({
        name: nextDraft.name,
        address: nextDraft.address,
        phone: nextDraft.phone,
      });

      if (missingContactFields.length > 0) {
        return finalizeReply({
          reply: buildMissingContactPrompt(missingContactFields),
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
        nextState: {
          pendingStep: 'contact_confirmation',
          orderDraft: nextDraft,
          quantityUpdate: null,
          lastMissingOrderId: null,
        },
      });
    }

    case 'confirm_pending': {
      if (state.pendingStep === 'contact_confirmation' && state.orderDraft) {
        return finalizeReply({
          reply: buildOrderSummaryReply(state.orderDraft),
          nextState: {
            pendingStep: 'order_confirmation',
            orderDraft: state.orderDraft,
            quantityUpdate: null,
            lastMissingOrderId: null,
          },
        });
      }

      if (state.pendingStep === 'order_confirmation' && state.orderDraft) {
        try {
          const ensuredCustomer = await upsertCustomerContact({
            senderId: input.senderId,
            channel: input.channel,
            preferredBrand: state.orderDraft.brand,
            currentCustomerId: customer?.id,
            currentName: customer?.name,
            currentPhone: customer?.phone,
            contact: {
              name: state.orderDraft.name,
              address: state.orderDraft.address,
              phone: state.orderDraft.phone,
            },
          });

          if (!ensuredCustomer) {
            throw new OrderRequestError('Customer information is incomplete.');
          }

          const order = await createOrderFromCatalog(prisma, {
            customerId: ensuredCustomer.id,
            brand: state.orderDraft.brand,
            deliveryAddress: state.orderDraft.address,
            paymentMethod: state.orderDraft.paymentMethod,
            giftWrap: state.orderDraft.giftWrap,
            giftNote: state.orderDraft.giftNote,
            orderStatus: 'confirmed',
            items: [
              {
                productId: state.orderDraft.productId,
                quantity: state.orderDraft.quantity,
                size: state.orderDraft.size,
                color: state.orderDraft.color,
              },
            ],
          });

          return finalizeReply({
            reply: buildOrderPlacedReply(state.orderDraft, order.id),
            orderId: order.id,
            nextState: {
              ...clearPendingConversationState(state),
              lastReferencedOrderId: order.id,
              lastMissingOrderId: null,
            },
          });
        } catch (error: unknown) {
          if (error instanceof OrderRequestError) {
            return finalizeReply({
              reply: `Sorry, I could not confirm the order yet. ${error.message}`,
            });
          }

          return escalateToSupport(
            'unclear_request',
            state.lastReferencedOrderId ?? latestActiveOrder?.id ?? null
          );
        }
      }

      if (state.pendingStep === 'quantity_update_confirmation' && state.quantityUpdate) {
        try {
          await updateSingleItemOrderQuantityById(
            prisma,
            state.quantityUpdate.orderId,
            state.quantityUpdate.quantity
          );

          return finalizeReply({
            reply: buildQuantityUpdateSuccessReply(state.quantityUpdate),
            orderId: state.quantityUpdate.orderId,
            nextState: {
              ...clearPendingConversationState(state),
              lastReferencedOrderId: state.quantityUpdate.orderId,
              lastMissingOrderId: null,
            },
          });
        } catch (error: unknown) {
          if (error instanceof OrderRequestError) {
            return finalizeReply({
              reply: `Sorry, I could not update the order automatically. ${error.message}`,
            });
          }

          return escalateToSupport('unclear_request', state.quantityUpdate.orderId);
        }
      }

      if (state.pendingStep === 'contact_collection' && state.orderDraft) {
        const missingFields = getMissingContactFields({
          name: state.orderDraft.name,
          address: state.orderDraft.address,
          phone: state.orderDraft.phone,
        });

        return finalizeReply({
          reply: buildMissingContactPrompt(missingFields),
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      return finalizeReply({
        reply: 'Please send the order details you want me to confirm.',
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'cancel_order': {
      if (!customer) {
        return finalizeReply({
          reply: 'I could not find an order for this conversation yet.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      const requestedOrderId =
        explicitOrderId ??
        followUpMissingOrderId ??
        aiAction.orderId ??
        state.lastReferencedOrderId ??
        latestOrder?.id ??
        null;
      const targetOrder =
        explicitOrderId !== null || followUpMissingOrderId !== null
          ? await findCustomerOrderById(requestedOrderId)
          : (await findCustomerOrderById(requestedOrderId)) || latestOrder;

      if (!targetOrder) {
        return finalizeReply({
          reply: requestedOrderId
            ? `I could not find order #${requestedOrderId} for this conversation.`
            : 'I could not find an order for this conversation yet.',
          nextState: {
            lastMissingOrderId: requestedOrderId,
          },
        });
      }

      if (targetOrder.orderStatus === 'cancelled') {
        return finalizeReply({
          reply: buildOrderAlreadyCancelledReply(targetOrder.id),
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      }

      try {
        await cancelOrderById(prisma, targetOrder.id);

        return finalizeReply({
          reply: buildCancellationSuccessReply(targetOrder.id),
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      } catch (error: unknown) {
        if (error instanceof OrderRequestError) {
          return finalizeReply({
            reply: `Sorry, I could not cancel the order automatically. ${error.message}`,
          });
        }

        return escalateToSupport('unclear_request', targetOrder.id);
      }
    }

    case 'reorder_last': {
      const sourceOrder =
        explicitOrderId !== null
          ? await findCustomerOrderById(explicitOrderId)
          : (await findCustomerOrderById(aiAction.orderId || state.lastReferencedOrderId)) || latestOrder;

      if (!sourceOrder || sourceOrder.orderItems.length === 0) {
        return finalizeReply({
          reply: 'Please send the product name, size, and color you want, and I will prepare the order summary right away.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      const sourceItem = sourceOrder.orderItems[0];
      const deliveryCharge = getDeliveryChargeForAddress(sourceOrder.deliveryAddress || '');
      const nextDraft: ResolvedOrderDraft = {
        productId: sourceItem.productId,
        productName: sourceItem.product.name,
        brand: sourceOrder.brand || sourceItem.product.brand,
        quantity: sourceItem.quantity,
        size: sourceItem.size || undefined,
        color: sourceItem.color || undefined,
        price: sourceItem.price,
        deliveryCharge,
        total: sourceItem.price * sourceItem.quantity + deliveryCharge,
        paymentMethod: sourceOrder.paymentMethod || 'COD',
        giftWrap: sourceOrder.giftWrap,
        giftNote: sourceOrder.giftNote || undefined,
        deliveryEstimate: getDeliveryEstimateForAddress(sourceOrder.deliveryAddress || ''),
        name: cleanStoredContactValue(customer?.name) || sourceOrder.customer.name,
        address: sourceOrder.deliveryAddress || '',
        phone: cleanStoredContactValue(customer?.phone) || sourceOrder.customer.phone || '',
      };

      return finalizeReply({
        reply: buildContactConfirmationReply(nextDraft.name, nextDraft.address, nextDraft.phone),
        nextState: {
          pendingStep: 'contact_confirmation',
          orderDraft: nextDraft,
          quantityUpdate: null,
          lastReferencedOrderId: sourceOrder.id,
          lastMissingOrderId: null,
        },
      });
    }

    case 'order_status': {
      if (!customer) {
        return finalizeReply({
          reply: 'I could not find any orders for this conversation yet.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      const targetOrder =
        explicitOrderId !== null || followUpMissingOrderId !== null
          ? await findCustomerOrderById(explicitOrderId ?? followUpMissingOrderId)
          : (await findCustomerOrderById(aiAction.orderId || state.lastReferencedOrderId)) || latestOrder;

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
        nextState: {
          ...clearPendingConversationState(state),
          lastReferencedOrderId: targetOrder.id,
          lastMissingOrderId: null,
        },
      });
    }

    case 'order_details': {
      if (!customer) {
        return finalizeReply({
          reply: 'I could not find any orders for this conversation yet.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      const targetOrder =
        explicitOrderId !== null || followUpMissingOrderId !== null
          ? await findCustomerOrderById(explicitOrderId ?? followUpMissingOrderId)
          : (await findCustomerOrderById(aiAction.orderId || state.lastReferencedOrderId)) || latestOrder;

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
        nextState: {
          ...clearPendingConversationState(state),
          lastReferencedOrderId: targetOrder.id,
          lastMissingOrderId: null,
        },
      });
    }

    case 'update_order_quantity': {
      if (!customer) {
        return finalizeReply({
          reply: 'I could not find an active order to update for this conversation.',
          nextState: {
            lastMissingOrderId: null,
          },
        });
      }

      const targetOrder =
        explicitOrderId !== null || followUpMissingOrderId !== null
          ? await findCustomerOrderById(explicitOrderId ?? followUpMissingOrderId)
          : (await findCustomerOrderById(aiAction.orderId || state.lastReferencedOrderId)) ||
            latestActiveOrder;

      if (!targetOrder) {
        return finalizeReply({
          reply: explicitOrderId || followUpMissingOrderId || aiAction.orderId
            ? `I could not find an active order #${explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId} to update for this conversation.`
            : 'I could not find an active order to update for this conversation.',
          nextState: {
            lastMissingOrderId: explicitOrderId ?? followUpMissingOrderId ?? aiAction.orderId ?? null,
          },
        });
      }

      if (targetOrder.orderStatus === 'cancelled') {
        return finalizeReply({
          reply: `Order #${targetOrder.id} is already cancelled, so it cannot be updated.`,
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      }

      if (targetOrder.orderItems.length !== 1) {
        return escalateToSupport('human_request', targetOrder.id);
      }

      const nextQuantity = aiAction.quantity;

      if (!nextQuantity) {
        return finalizeReply({
          reply: 'Please tell me the quantity you want for your order, and I will prepare the update summary.',
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      }

      const item = targetOrder.orderItems[0];
      const maxAvailableQuantity = item.quantity + (item.product.inventory?.availableQty ?? 0);

      if (nextQuantity > maxAvailableQuantity) {
        return finalizeReply({
          reply: `I can update order #${targetOrder.id} up to ${maxAvailableQuantity} item(s) based on current stock. Please send a lower quantity.`,
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      }

      if (nextQuantity === item.quantity) {
        return finalizeReply({
          reply: `Order #${targetOrder.id} already has quantity ${item.quantity}. Please send a different quantity if you want to update it.`,
          orderId: targetOrder.id,
          nextState: {
            ...clearPendingConversationState(state),
            lastReferencedOrderId: targetOrder.id,
            lastMissingOrderId: null,
          },
        });
      }

      const deliveryCharge = calculateOrderDeliveryCharge(targetOrder);
      const summary: QuantityUpdateSummary = {
        orderId: targetOrder.id,
        productName: item.product.name,
        quantity: nextQuantity,
        size: item.size,
        color: item.color,
        price: item.price,
        deliveryCharge,
        total: item.price * nextQuantity + deliveryCharge,
        paymentMethod: targetOrder.paymentMethod || 'COD',
        name: targetOrder.customer.name,
        address: targetOrder.deliveryAddress || '',
        phone: targetOrder.customer.phone || '',
        giftWrap: targetOrder.giftWrap,
        giftNote: targetOrder.giftNote,
      };

      return finalizeReply({
        reply: buildQuantityUpdateSummaryReply(summary),
        orderId: targetOrder.id,
        nextState: {
          pendingStep: 'quantity_update_confirmation',
          orderDraft: null,
          quantityUpdate: summary,
          lastReferencedOrderId: targetOrder.id,
          lastMissingOrderId: null,
        },
      });
    }

    case 'delivery_question': {
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
        }),
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'payment_question': {
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

    case 'exchange_question': {
      return finalizeReply({
        reply: `If there is a size issue, please message us as soon as you receive the parcel and we will help you with the exchange process, subject to stock availability. If the issue needs a person, ${buildSupportContactLine().toLowerCase()}`,
        nextState: {
          lastMissingOrderId: null,
        },
      });
    }

    case 'gift_request': {
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

    case 'fallback':
    default: {
      const reply = await getAiStockReply(
        input.currentMessage,
        input.senderId,
        input.channel,
        brandFilter,
        mergedContact.name || customer?.name || input.customerName,
        input.customerGender,
        { persistConversation: false }
      );

      if (
        reply.includes('I have also flagged this conversation for a team follow-up.') ||
        reply.includes('Something went wrong') ||
        reply.includes('AI is currently unavailable')
      ) {
        await upsertSupportEscalation({
          senderId: input.senderId,
          channel: input.channel,
          customerId: customer?.id,
          orderId: state.lastReferencedOrderId ?? latestActiveOrder?.id ?? null,
          brand: brandFilter || null,
          contactName: mergedContact.name || customer?.name || input.customerName || null,
          contactPhone: mergedContact.phone || customer?.phone || null,
          latestCustomerMessage: input.currentMessage,
          reason: 'unclear_request',
          summary: buildSupportConversationSummary({
            reason: 'unclear_request',
            currentMessage: input.currentMessage,
            recentMessages: [...recentMessages].reverse(),
            orderId: state.lastReferencedOrderId ?? latestActiveOrder?.id ?? null,
          }),
        });
      }

      return finalizeReply({ reply });
    }
  }
}
