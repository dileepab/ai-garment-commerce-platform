import prisma from '@/lib/prisma';
import {
  ContactField,
  ConversationMessage,
  collectContactDetailsFromMessages,
  getMissingContactFields,
} from '@/lib/contact-profile';
import {
  buildContactConfirmationReply,
  buildOrderSummaryReply,
  getDeliveryChargeForAddress,
  getDeliveryEstimateForAddress,
  getMissingDraftFields,
  isContactConfirmationMessage,
  isOrderSummaryMessage,
  resolveDraftFromConversation,
} from '@/lib/order-draft';
import { isClearConfirmation } from '@/lib/order-confirmation';
import {
  SizeChartCategory,
  getSizeChartCategoryFromStyle,
  getSizeChartCategoryFromText,
  getSizeChartDefinition,
} from '@/lib/size-charts';
import {
  addSriLankaWorkingDays,
  formatSriLankaDisplayDate,
  getSriLankaDateOnly,
  getSriLankaToday,
} from '@/lib/delivery-calendar';

interface ShoppingSupportParams {
  senderId: string;
  channel: string;
  currentMessage: string;
  brand?: string;
}

export interface ShoppingSupportResult {
  handled: boolean;
  reply?: string;
  imagePath?: string;
}

interface CatalogProduct {
  name: string;
  price: number;
  sizes: string;
  colors?: string;
  style?: string;
}

type SupportIntent =
  | 'order_intake'
  | 'size_chart'
  | 'delivery_charge'
  | 'total'
  | 'online_transfer'
  | 'order_online'
  | 'exchange'
  | 'gift'
  | 'delivery_timing';

const TOTAL_PATTERN =
  /\btotal\b|\bhow much altogether\b|\bfinal amount\b|\btotal amount\b/i;
const SIZE_CHART_PATTERN = /\bsize chart\b|\bmeasurement(?:s)?\b/i;
const ONLINE_TRANSFER_PATTERN =
  /\bonline transfer\b|\bbank transfer\b|\btransfer the money\b/i;
const ORDER_INTENT_PATTERN =
  /\b(order|buy|need|want|would like|get|take)\b/i;
const ORDER_ONLINE_PATTERN =
  /\bcan i do online\b|\bcan i order online\b|\bplace (?:the )?order online\b|\bdo this online\b/i;
const DELIVERY_CHARGE_PATTERN =
  /\bdelivery charge(?:s)?\b|\bshipping charge(?:s)?\b|\bshipping fee\b|\bdelivery fee\b/i;
const EXCHANGE_PATTERN =
  /\bexchanges?\b|\bsize issue\b|\bwrong size\b|\bchange the size\b/i;
const GIFT_PATTERN =
  /\bgift\b|\bgift wrap\b|\bspecial note\b|\bhappy birthday\b/i;
const DELIVERY_TIMING_PATTERN =
  /\bhow long\b|\bwhen (?:will|can)\b.*\b(?:receive|get|arrive|deliver)\b|\bbefore\b.*\b(?:\d{1,2}(?:st|nd|rd|th)?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b|\bdelivery time\b|\bdelivery date\b/i;
const NEW_ORDER_PATTERN =
  /\bnew order\b|\bplace (?:a |the )?new order\b|\bplace (?:an |the )?order\b|\bi want to place\b|\bi want to order\b|\bi need\b|\bi would like to order\b/i;

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

function scoreProductMatch(product: CatalogProduct, text: string): number {
  const normalizedText = normalizeText(text);
  const normalizedName = normalizeText(product.name);

  if (!normalizedText) {
    return 0;
  }

  if (normalizedText.includes(normalizedName) || normalizedName.includes(normalizedText)) {
    return 100;
  }

  return normalizedName
    .split(' ')
    .filter((token) => token.length > 2)
    .reduce((score, token) => (normalizedText.includes(token) ? score + 1 : score), 0);
}

function resolveLikelyProduct(
  products: CatalogProduct[],
  messages: ConversationMessage[]
): CatalogProduct | null {
  const recentUserMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .slice(-8)
    .reverse();

  let bestProduct: CatalogProduct | null = null;
  let bestScore = 0;

  for (const message of recentUserMessages) {
    for (const product of products) {
      const score = scoreProductMatch(product, message);

      if (score > bestScore) {
        bestScore = score;
        bestProduct = product;
      }
    }

    if (bestScore >= 100) {
      break;
    }
  }

  return bestScore > 0 ? bestProduct : null;
}

function resolveExplicitProduct(
  products: CatalogProduct[],
  message: string
): CatalogProduct | null {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    return null;
  }

  let bestProduct: CatalogProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    const score = scoreProductMatch(product, message);

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  if (!bestProduct) {
    return null;
  }

  const exactMatch = normalizeText(bestProduct.name);

  if (normalizedMessage.includes(exactMatch) || bestScore >= 2) {
    return bestProduct;
  }

  return null;
}

function splitCsv(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function messageMentionsKnownColor(message: string, product?: CatalogProduct | null): boolean {
  if (!product?.colors) {
    return false;
  }

  const normalizedMessage = normalizeText(message);
  return splitCsv(product.colors).some((color) =>
    normalizedMessage.includes(normalizeText(color))
  );
}

function messageMentionsSize(message: string): boolean {
  return /\b(XXL|XL|XS|S|M|L)\b/i.test(message);
}

function looksLikeOrderIntakeMessage(
  message: string,
  explicitProduct: CatalogProduct | null,
  likelyProduct: CatalogProduct | null
): boolean {
  const matchedProduct = explicitProduct || likelyProduct;

  if (!matchedProduct) {
    return false;
  }

  return (
    ORDER_INTENT_PATTERN.test(message) ||
    messageMentionsSize(message) ||
    messageMentionsKnownColor(message, matchedProduct)
  );
}

function buildVariantPrompt(productName: string, size?: string, color?: string, product?: CatalogProduct | null): string {
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

function isSizeChartFollowUpPrompt(message?: string): boolean {
  return /which (?:item|item type) would you like the size chart for/i.test(message ?? '');
}

function buildSizeChartSelectionReply(products: CatalogProduct[]): string {
  const allCategories: SizeChartCategory[] = ['tops', 'dresses', 'pants', 'skirts'];
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];
  const categoriesToShow = uniqueCategories.length > 0 ? uniqueCategories : allCategories;
  const categoryLabels = categoriesToShow
    .map((category) => getSizeChartDefinition(category).label)
    .join(', ');

  return `Sure. Which item type would you like the size chart for? Available types: ${categoryLabels}.`;
}

function getSingleCatalogChartCategory(products: CatalogProduct[]): SizeChartCategory | null {
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];

  return uniqueCategories.length === 1 ? uniqueCategories[0] : null;
}

function detectSupportIntent(message: string): SupportIntent | null {
  if (TOTAL_PATTERN.test(message)) {
    return 'total';
  }

  if (DELIVERY_TIMING_PATTERN.test(message)) {
    return 'delivery_timing';
  }

  if (ONLINE_TRANSFER_PATTERN.test(message)) {
    return 'online_transfer';
  }

  if (ORDER_ONLINE_PATTERN.test(message)) {
    return 'order_online';
  }

  if (GIFT_PATTERN.test(message)) {
    return 'gift';
  }

  if (SIZE_CHART_PATTERN.test(message)) {
    return 'size_chart';
  }

  if (EXCHANGE_PATTERN.test(message)) {
    return 'exchange';
  }

  if (DELIVERY_CHARGE_PATTERN.test(message)) {
    return 'delivery_charge';
  }

  return null;
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
  if (missingFields.length === 0) {
    return '';
  }

  return [
    'To proceed with the order, please share:',
    buildMissingFieldLabels(missingFields),
  ].join('\n');
}

function isDraftDeliveryConversation(message?: string): boolean {
  if (!message) {
    return false;
  }

  return isContactConfirmationMessage(message) || isOrderSummaryMessage(message);
}

function isNewOrderIntentMessage(message: string): boolean {
  return NEW_ORDER_PATTERN.test(message);
}

function hasRecentNewOrderIntent(messages: ConversationMessage[]): boolean {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .slice(-5)
    .some((message) => isNewOrderIntentMessage(message));
}

function parseRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayMonthMatch = message.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );

  if (!dayMonthMatch?.[1] || !dayMonthMatch[2]) {
    return null;
  }

  const day = Number.parseInt(dayMonthMatch[1], 10);
  const month = MONTH_MAP[dayMonthMatch[2].toLowerCase()];

  if (!Number.isInteger(day) || month === undefined) {
    return null;
  }

  const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), month, day));

  if (candidate < referenceDate) {
    return new Date(Date.UTC(referenceDate.getUTCFullYear() + 1, month, day));
  }

  return candidate;
}

function parseDayOnlyRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayOnlyMatch = message.match(/\bbefore\b.*\b(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (!dayOnlyMatch?.[1]) {
    return null;
  }

  const day = Number.parseInt(dayOnlyMatch[1], 10);

  if (!Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), day)
  );

  if (candidate < referenceDate) {
    return new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, day)
    );
  }

  return candidate;
}

function resolveRequestedDeliveryDate(
  currentMessage: string,
  messages: ConversationMessage[],
  referenceDate: Date
): Date | null {
  const explicitDate = parseRequestedDate(currentMessage, referenceDate);

  if (explicitDate) {
    return explicitDate;
  }

  const dayOnlyDate = parseDayOnlyRequestedDate(currentMessage, referenceDate);

  if (dayOnlyDate) {
    return dayOnlyDate;
  }

  const recentUserMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .slice()
    .reverse();

  for (const message of recentUserMessages) {
    const priorDate = parseRequestedDate(message, referenceDate);

    if (priorDate) {
      return priorDate;
    }
  }

  return null;
}

function buildSummaryReplyWithIntro(intro: string, summary: string): string {
  return `${intro}\n\n${summary}`;
}

function describeOrderStatus(status: string): string {
  if (status === 'packed') {
    return 'Your order is already packed.';
  }

  if (status === 'confirmed') {
    return 'Your order is already confirmed.';
  }

  return 'Your order is already placed.';
}

function buildDeliveryWindowReply(
  intro: string,
  earliestDate: Date,
  latestDate: Date,
  requestedDate: Date | null,
  isDraft: boolean,
  referenceDate: Date
): string {
  const windowText = `${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}`;

  if (requestedDate) {
    if (latestDate <= requestedDate) {
      return `${intro} The expected delivery window is ${windowText}, so it should arrive by ${formatSriLankaDisplayDate(requestedDate)}.`;
    }

    if (isDraft) {
      return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${windowText}, so delivery before ${formatSriLankaDisplayDate(requestedDate)} is not possible.`;
    }

    return `${intro} The expected delivery window is ${windowText}, so delivery before ${formatSriLankaDisplayDate(requestedDate)} cannot be guaranteed.`;
  }

  if (isDraft) {
    return `${intro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${windowText}.`;
  }

  return `${intro} The expected delivery window is ${windowText}.`;
}

function buildNewOrderNextStepReply(
  contacts: ReturnType<typeof collectContactDetailsFromMessages>,
  missingFields: ContactField[]
): string {
  if (missingFields.length > 0) {
    return buildMissingContactPrompt(missingFields);
  }

  if (contacts.name && contacts.address && contacts.phone) {
    return 'If you would still like to place a new order, please tell me the item, size, and color you need.';
  }

  return 'If you would still like to place a new order, please tell me the item, size, and color you need.';
}

function extractDeliveryLocationHint(message: string): string | null {
  const patterns = [
    /\b(?:delivery(?:\s+\w+){0,3}\s+to|deliver(?:y)?\s+to)\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bhow long does delivery take to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bdelivery time to\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
    /\bcan i get it before\b.*\bto\s+([^?.,]+(?:,\s*[^?.,]+)*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
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

export async function tryHandleShoppingSupport(
  params: ShoppingSupportParams
): Promise<ShoppingSupportResult> {
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      senderId: params.senderId,
      channel: params.channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      role: true,
      message: true,
    },
  });

  const chronologicalMessages = [...recentMessages].reverse();
  const conversationMessages = [
    ...chronologicalMessages,
    { role: 'user', message: params.currentMessage },
  ];
  const latestAssistantMessage = [...recentMessages].find((message) => message.role === 'assistant');
  const latestAssistantText = latestAssistantMessage?.message ?? '';
  const activeDraftConversation = isDraftDeliveryConversation(latestAssistantMessage?.message);
  const confirmationReplyInProgress =
    Boolean(latestAssistantText) &&
    isClearConfirmation(params.currentMessage) &&
    (isContactConfirmationMessage(latestAssistantText) ||
      isOrderSummaryMessage(latestAssistantText));
  const activeNewOrderConversation =
    isNewOrderIntentMessage(params.currentMessage) || hasRecentNewOrderIntent(conversationMessages);
  const shouldDeferToConfirmation =
    confirmationReplyInProgress && isClearConfirmation(params.currentMessage);
  const followUpSizeChartRequest = isSizeChartFollowUpPrompt(latestAssistantMessage?.message);
  const explicitChartCategory = getSizeChartCategoryFromText(params.currentMessage);

  if (shouldDeferToConfirmation) {
    return { handled: false };
  }

  const customer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
    select: {
      id: true,
      name: true,
      phone: true,
      preferredBrand: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          deliveryAddress: true,
        },
      },
    },
  });

  const latestActiveOrder = customer?.id
    ? await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          ...(params.brand ? { brand: params.brand } : {}),
          orderStatus: { not: 'cancelled' },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      })
    : null;

  const products = await prisma.product.findMany({
    where: params.brand
      ? { brand: params.brand }
      : customer?.preferredBrand
        ? { brand: customer.preferredBrand }
        : undefined,
    select: {
      name: true,
      price: true,
      sizes: true,
      colors: true,
      style: true,
    },
  });

  const explicitProduct = resolveExplicitProduct(products, params.currentMessage);
  const likelyProduct = resolveLikelyProduct(products, conversationMessages);
  let intent = detectSupportIntent(params.currentMessage);

  if (!intent && followUpSizeChartRequest && (explicitProduct || explicitChartCategory)) {
    intent = 'size_chart';
  }

  if (
    !intent &&
    !confirmationReplyInProgress &&
    looksLikeOrderIntakeMessage(params.currentMessage, explicitProduct, likelyProduct)
  ) {
    intent = 'order_intake';
  }

  if (!intent) {
    return { handled: false };
  }

  const contacts = collectContactDetailsFromMessages(conversationMessages, {
    name: customer?.name ?? undefined,
    phone: customer?.phone ?? undefined,
    address: customer?.orders[0]?.deliveryAddress ?? undefined,
  });
  const missingFields = getMissingContactFields(contacts);
  const { draft } = await resolveDraftFromConversation(
    params.senderId,
    params.channel,
    params.brand,
    params.currentMessage
  );

  let reply = '';
  let imagePath: string | undefined;

  if (intent === 'order_intake') {
    const selectedProduct = explicitProduct || likelyProduct;

    if (!selectedProduct) {
      return { handled: false };
    }

    if (missingFields.length > 0) {
      reply = buildMissingContactPrompt(missingFields);
    } else if (draft) {
      if (isOrderSummaryMessage(latestAssistantText)) {
        const missingDraftFields = getMissingDraftFields(draft);

        if (missingDraftFields.length === 0) {
          reply = buildOrderSummaryReply(draft);
        } else {
          reply = buildVariantPrompt(
            draft.productName,
            draft.size,
            draft.color,
            selectedProduct
          );
        }
      } else {
      const contactReply = buildContactConfirmationReply(draft.name, draft.address, draft.phone);
      const variantPrompt = buildVariantPrompt(
        draft.productName,
        draft.size,
        draft.color,
        selectedProduct
      );

      reply = variantPrompt ? `${contactReply}\n\n${variantPrompt}` : contactReply;
      }
    } else {
      reply = buildMissingContactPrompt(missingFields);
    }
  } else if (intent === 'size_chart') {
    const singleCatalogChartCategory = getSingleCatalogChartCategory(products);
    const chartCategory =
      explicitChartCategory ||
      getSizeChartCategoryFromStyle(explicitProduct?.style) ||
      (products.length === 1 ? getSizeChartCategoryFromStyle(products[0]?.style) : null) ||
      singleCatalogChartCategory;

    if (!explicitProduct && !explicitChartCategory && !singleCatalogChartCategory && products.length !== 1) {
      reply = buildSizeChartSelectionReply(products);
    } else if (chartCategory) {
      const chart = getSizeChartDefinition(chartCategory);

      if (explicitProduct) {
        reply = `Sure. Here is the size chart for ${explicitProduct.name}.`;
      } else if (singleCatalogChartCategory && !explicitChartCategory) {
        reply = `Sure. Here is our ${chart.label} size chart.`;
      } else {
        reply = `Sure. Here is our ${chart.label} size chart.`;
      }

      imagePath = chart.imagePath;
    } else {
      reply = buildSizeChartSelectionReply(products);
    }
  } else if (intent === 'exchange') {
    reply =
      'If there is a size issue, please message us as soon as you receive the parcel and we will help you with the exchange process, subject to stock availability.';
  } else if (intent === 'order_online') {
    const baseReply = 'Yes, you can place the order here through chat.';
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'online_transfer') {
    const baseReply = 'Yes, online transfer is accepted, and I have noted the payment method as Online Transfer.';
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'gift') {
    const giftNote = /happy birthday/i.test(params.currentMessage)
      ? 'Happy Birthday'
      : 'your requested note';
    const baseReply = `Yes, we can pack it as a gift and include the note "${giftNote}". I have added that instruction.`;
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(baseReply, buildOrderSummaryReply(draft));
    } else {
      const missingPrompt = buildMissingContactPrompt(missingFields);
      reply = missingPrompt ? `${baseReply}\n\n${missingPrompt}` : baseReply;
    }
  } else if (intent === 'delivery_charge') {
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(
        `Delivery to ${draft.address} is Rs ${draft.deliveryCharge}.`,
        buildOrderSummaryReply(draft)
      );
    } else if (contacts.address) {
      reply = `Delivery to ${contacts.address} is Rs ${getDeliveryChargeForAddress(contacts.address)}.`;
    } else {
      reply = 'Delivery charges are Rs 150 within Colombo and Rs 200 outside Colombo.';
    }
  } else if (intent === 'total') {
    const shouldAttachOrderSummary = Boolean(draft) && (activeDraftConversation || activeNewOrderConversation);

    if (shouldAttachOrderSummary && draft) {
      reply = buildSummaryReplyWithIntro(
        `The total for your order is Rs ${draft.total}, including Rs ${draft.deliveryCharge} delivery.`,
        buildOrderSummaryReply(draft)
      );
    } else if (likelyProduct && contacts.address) {
      const deliveryCharge = getDeliveryChargeForAddress(contacts.address);
      reply = `The ${likelyProduct.name} is Rs ${likelyProduct.price}, delivery to ${contacts.address} is Rs ${deliveryCharge}, and the current total is Rs ${likelyProduct.price + deliveryCharge}.`;
    } else if (likelyProduct) {
      reply = `The ${likelyProduct.name} is Rs ${likelyProduct.price}. Delivery is Rs 150 within Colombo and Rs 200 outside Colombo.`;
    } else {
      reply = 'Please tell me the product you want, and I will confirm the exact total with delivery.';
    }
  } else if (intent === 'delivery_timing') {
    const today = getSriLankaToday();
    const useDraftEstimate = Boolean(draft) && activeDraftConversation;
    const explicitDeliveryLocation = extractDeliveryLocationHint(params.currentMessage);
    const referenceDate = useDraftEstimate
      ? today
      : latestActiveOrder
        ? getSriLankaDateOnly(latestActiveOrder.createdAt)
        : today;
    const address = explicitDeliveryLocation
      ? explicitDeliveryLocation
      : useDraftEstimate
        ? draft?.address
        : latestActiveOrder?.deliveryAddress || contacts.address;
    const estimate = getDeliveryEstimateForAddress(address);
    const businessDays = estimate === '1-2 business days' ? [1, 2] : [2, 3];
    const earliestDate = addSriLankaWorkingDays(referenceDate, businessDays[0]);
    const latestDate = addSriLankaWorkingDays(referenceDate, businessDays[1]);
    const requestedDate = resolveRequestedDeliveryDate(
      params.currentMessage,
      conversationMessages,
      today
    );

    if (useDraftEstimate && draft?.address) {
      const preOrderIntro = `Delivery to ${draft.address} usually takes ${draft.deliveryEstimate}, excluding weekends and Sri Lankan public holidays.`;
      reply = buildDeliveryWindowReply(
        preOrderIntro,
        earliestDate,
        latestDate,
        requestedDate,
        true,
        referenceDate
      );
    } else if ((activeNewOrderConversation || explicitDeliveryLocation) && address) {
      const preOrderIntro = `Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

      if (requestedDate) {
        reply = buildDeliveryWindowReply(
          preOrderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          true,
          referenceDate
        );
      } else {
        reply = `${preOrderIntro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}.`;
      }

      if (activeNewOrderConversation) {
        reply = `${reply}\n\n${buildNewOrderNextStepReply(contacts, missingFields)}`;
      }
    } else if (latestActiveOrder && address) {
      const orderIntro = `${describeOrderStatus(latestActiveOrder.orderStatus)} Delivery to ${address} usually takes ${estimate}, excluding weekends and Sri Lankan public holidays.`;

      if (latestDate < today) {
        const windowText = `${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}`;
        reply = `${orderIntro} The original expected delivery window was ${windowText}. If you have not received it yet, please let us know and we will check it for you.`;
      } else {
        reply = buildDeliveryWindowReply(
          orderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          false,
          referenceDate
        );
      }
    } else if (contacts.address) {
      const preOrderEstimate = getDeliveryEstimateForAddress(contacts.address);
      const preOrderIntro = `Delivery to ${contacts.address} usually takes ${preOrderEstimate}, excluding weekends and Sri Lankan public holidays.`;

      if (requestedDate) {
        reply = buildDeliveryWindowReply(
          preOrderIntro,
          earliestDate,
          latestDate,
          requestedDate,
          true,
          referenceDate
        );
      } else {
        reply = `${preOrderIntro} If the order is confirmed on ${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is ${formatSriLankaDisplayDate(earliestDate)} to ${formatSriLankaDisplayDate(latestDate)}.`;
      }

      if (activeNewOrderConversation) {
        reply = `${reply}\n\n${buildNewOrderNextStepReply(contacts, missingFields)}`;
      }
    } else {
      reply =
        'Delivery usually takes 1-2 business days within Colombo and 2-3 business days outside Colombo, excluding weekends and Sri Lankan public holidays.';
    }
  }

  if (!reply) {
    return { handled: false };
  }

  await saveConversationPair(params.senderId, params.channel, params.currentMessage, reply);
  return { handled: true, reply, imagePath };
}
