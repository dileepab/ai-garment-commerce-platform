import prisma from '@/lib/prisma';
import {
  collectContactDetailsFromMessages,
  ConversationMessage,
  formatContactBlock,
  getMissingContactFields,
} from '@/lib/contact-profile';

interface CatalogProduct {
  id: number;
  name: string;
  brand: string;
  price: number;
  sizes: string;
  colors: string;
}

export interface ResolvedOrderDraft {
  productId: number;
  productName: string;
  brand: string;
  quantity: number;
  size?: string;
  color?: string;
  price: number;
  deliveryCharge: number;
  total: number;
  paymentMethod: string;
  giftWrap: boolean;
  giftNote?: string;
  deliveryEstimate: string;
  name: string;
  address: string;
  phone: string;
}

export interface ConversationContext {
  messages: ConversationMessage[];
  customerId?: number;
}

const SIZE_PATTERN = /\b(XXL|XL|XS|S|M|L)\b/i;
const SAME_ITEM_PATTERNS = [
  /\bsame item\b/i,
  /\bsame top\b/i,
  /\bsame size\b/i,
  /\bsame one\b/i,
  /\bsame product\b/i,
  /\bre[\s-]?order\b/i,
  /\border again\b/i,
  /\breplace it\b/i,
  /\breplace the order\b/i,
  /\badd this order\b/i,
  /\beka(?:mai)?\b/i,
];

const ORDER_SUMMARY_PATTERN = /\border summary\b/i;
const CONTACT_CONFIRMATION_HINT_PATTERN =
  /name:\s*.+\naddress:\s*.+\nphone number:\s*.+/i;
const GIFT_PATTERN = /\bgift\b/i;
const HAPPY_BIRTHDAY_PATTERN = /\bhappy birthday\b/i;
const ONLINE_TRANSFER_PATTERN = /\bonline transfer\b|\bbank transfer\b/i;
const ORDER_COMPLETION_PATTERN =
  /\border id:\s*#\d+\b/i;
const ORDER_CANCELLATION_PATTERN =
  /\bcancelled order id:\s*#\d+\b/i;
const ORDER_UPDATE_COMPLETION_PATTERN =
  /\byour order has been updated successfully\b/i;

function formatSizeForDisplay(size?: string): string {
  if (!size) {
    return 'Not specified';
  }

  const normalized = size.trim().toUpperCase();
  const sizeMap: Record<string, string> = {
    XS: 'Extra Small',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    XL: 'Extra Large',
    XXL: 'Double Extra Large',
  };

  return sizeMap[normalized] || size;
}

function formatColorForDisplay(color?: string): string {
  return color || 'Not specified';
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRecentCustomerText(messages: ConversationMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .reverse();
}

export function isTerminalAssistantOrderMessage(message: string): boolean {
  return (
    ORDER_COMPLETION_PATTERN.test(message) ||
    ORDER_CANCELLATION_PATTERN.test(message) ||
    ORDER_UPDATE_COMPLETION_PATTERN.test(message)
  );
}

function getActiveOrderWindowMessages(messages: ConversationMessage[]): ConversationMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'assistant' && isTerminalAssistantOrderMessage(message.message)) {
      return messages.slice(index + 1);
    }
  }

  return messages;
}

function detectSameItemIntent(messages: ConversationMessage[]): boolean {
  const latestUserMessages = getRecentCustomerText(messages).slice(0, 4);
  return latestUserMessages.some((message) =>
    SAME_ITEM_PATTERNS.some((pattern) => pattern.test(message))
  );
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

  const tokens = normalizedName
    .split(' ')
    .filter((token) => token.length > 2);

  if (tokens.length === 0) {
    return 0;
  }

  return tokens.reduce((score, token) => (normalizedText.includes(token) ? score + 1 : score), 0);
}

function resolveProductFromMessages(
  products: CatalogProduct[],
  messages: ConversationMessage[]
): CatalogProduct | null {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 8);

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

function resolveSizeFromMessages(messages: ConversationMessage[], product?: CatalogProduct): string | undefined {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 8);
  const allowedSizes = product ? splitCsv(product.sizes).map((size) => size.toUpperCase()) : [];

  for (const message of recentUserMessages) {
    const match = message.match(SIZE_PATTERN);

    if (!match?.[1]) {
      continue;
    }

    const size = match[1].toUpperCase();

    if (allowedSizes.length === 0 || allowedSizes.includes(size)) {
      return size;
    }
  }

  if (allowedSizes.length === 1) {
    return allowedSizes[0];
  }

  return undefined;
}

function resolveColorFromMessages(messages: ConversationMessage[], product?: CatalogProduct): string | undefined {
  if (!product) {
    return undefined;
  }

  const recentUserMessages = getRecentCustomerText(messages).slice(0, 8).map(normalizeText);
  const colors = splitCsv(product.colors);

  for (const color of colors) {
    const normalizedColor = normalizeText(color);

    if (recentUserMessages.some((message) => message.includes(normalizedColor))) {
      return color;
    }
  }

  if (colors.length === 1) {
    return colors[0];
  }

  return undefined;
}

function resolveQuantityFromMessages(messages: ConversationMessage[]): number {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 6);
  const quantityPatterns = [
    /\bqty\s*[:\-]?\s*(\d+)\b/i,
    /\bquantity\s*[:\-]?\s*(\d+)\b/i,
    /\b(?:need|want|order|buy|get|take)\s+(\d+)\s*(?:items?|pieces?|pcs?|tops?|shirts?|dresses?|pants?|skirts?)?\b/i,
    /\b(\d+)\s*(?:x|items?|pieces?|pcs?)\b/i,
  ];

  for (const message of recentUserMessages) {
    for (const pattern of quantityPatterns) {
      const match = message.match(pattern);

      if (!match?.[1]) {
        continue;
      }

      const quantity = Number.parseInt(match[1], 10);

      if (Number.isInteger(quantity) && quantity > 0) {
        return quantity;
      }
    }
  }

  return 1;
}

export function isOrderSummaryMessage(message: string): boolean {
  return ORDER_SUMMARY_PATTERN.test(message);
}

export function isContactConfirmationMessage(message: string): boolean {
  return !isOrderSummaryMessage(message) && CONTACT_CONFIRMATION_HINT_PATTERN.test(message);
}

export function getDeliveryChargeForAddress(address?: string): number {
  const normalized = normalizeText(address ?? '');

  if (!normalized) {
    return 0;
  }

  return normalized.includes('colombo') ? 150 : 200;
}

export function getDeliveryEstimateForAddress(address?: string): string {
  const normalized = normalizeText(address ?? '');

  if (normalized.includes('colombo')) {
    return '1-2 business days';
  }

  return '2-3 business days';
}

function detectGiftWrap(messages: ConversationMessage[]): boolean {
  return getRecentCustomerText(messages).some((message) => GIFT_PATTERN.test(message));
}

function extractGiftNote(messages: ConversationMessage[]): string | undefined {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 12);

  for (const message of recentUserMessages) {
    if (HAPPY_BIRTHDAY_PATTERN.test(message)) {
      return 'Happy Birthday';
    }
  }

  return undefined;
}

function detectPaymentMethod(messages: ConversationMessage[]): string {
  return getRecentCustomerText(messages).some((message) => ONLINE_TRANSFER_PATTERN.test(message))
    ? 'Online Transfer'
    : 'COD';
}

export function buildOrderSummaryReply(draft: ResolvedOrderDraft): string {
  const specialInstructions = [
    draft.giftWrap ? 'Gift wrap requested' : '',
    draft.giftNote ? `Gift Note: ${draft.giftNote}` : '',
  ].filter(Boolean);

  return [
    'Order Summary',
    `Product: ${draft.productName}`,
    `Quantity: ${draft.quantity}`,
    `Size: ${formatSizeForDisplay(draft.size)}`,
    `Color: ${formatColorForDisplay(draft.color)}`,
    `Price: Rs ${draft.price}`,
    `Delivery Charge: Rs ${draft.deliveryCharge}`,
    `Total: Rs ${draft.total}`,
    `Payment Method: ${draft.paymentMethod}`,
    `Name: ${draft.name}`,
    `Address: ${draft.address}`,
    `Phone Number: ${draft.phone}`,
    ...specialInstructions,
    '',
    'Is this summary correct? Please let me know if any changes are needed.',
  ].join('\n');
}

export function getMissingDraftFields(draft: ResolvedOrderDraft): Array<'size' | 'color'> {
  const missingFields: Array<'size' | 'color'> = [];

  if (!draft.size) {
    missingFields.push('size');
  }

  if (!draft.color) {
    missingFields.push('color');
  }

  return missingFields;
}

export async function resolveDraftFromConversation(
  senderId: string,
  channel: string,
  brand?: string,
  currentMessage?: string
): Promise<{ draft: ResolvedOrderDraft | null; context: ConversationContext }> {
  const messages = await prisma.chatMessage.findMany({
    where: {
      senderId,
      channel,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      role: true,
      message: true,
    },
  });

  const chronologicalMessages = [...messages].reverse();
  const conversationMessages = currentMessage
    ? [...chronologicalMessages, { role: 'user', message: currentMessage }]
    : chronologicalMessages;

  const customer = await prisma.customer.findUnique({
    where: { externalId: senderId },
    select: {
      id: true,
      name: true,
      phone: true,
      preferredBrand: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  const latestOrder = customer?.orders[0];
  const catalogBrand = brand || customer?.preferredBrand || undefined;
  const latestRelevantOrder = customer?.id
    ? await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          ...(catalogBrand ? { brand: catalogBrand } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      })
    : null;
  const products = await prisma.product.findMany({
    where: catalogBrand ? { brand: catalogBrand } : undefined,
    select: {
      id: true,
      name: true,
      brand: true,
      price: true,
      sizes: true,
      colors: true,
    },
  });

  const contacts = collectContactDetailsFromMessages(conversationMessages, {
    name: customer?.name ?? undefined,
    phone: customer?.phone ?? undefined,
    address: latestRelevantOrder?.deliveryAddress ?? latestOrder?.deliveryAddress ?? undefined,
  });
  const activeOrderMessages = getActiveOrderWindowMessages(conversationMessages);

  const deliveryCharge = getDeliveryChargeForAddress(contacts.address);
  const paymentMethod = detectPaymentMethod(activeOrderMessages);
  const giftWrap = detectGiftWrap(activeOrderMessages);
  const giftNote = extractGiftNote(activeOrderMessages);
  const deliveryEstimate = getDeliveryEstimateForAddress(contacts.address);

  if (getMissingContactFields(contacts).length > 0) {
    return {
        draft: null,
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  if (detectSameItemIntent(activeOrderMessages) && latestRelevantOrder?.orderItems[0]) {
    const latestItem = latestRelevantOrder.orderItems[0];

    return {
      draft: {
        productId: latestItem.productId,
        productName: latestItem.product.name,
        brand: latestRelevantOrder.brand || latestItem.product.brand,
        quantity: latestItem.quantity,
        size: latestItem.size || undefined,
        color: latestItem.color || undefined,
        price: latestItem.price,
        deliveryCharge,
        total: latestItem.price * latestItem.quantity + deliveryCharge,
        paymentMethod,
        giftWrap,
        giftNote,
        deliveryEstimate,
        name: contacts.name,
        address: contacts.address,
        phone: contacts.phone,
      },
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  const product = resolveProductFromMessages(products, activeOrderMessages);

  if (!product) {
    return {
        draft: null,
      context: {
        messages: conversationMessages,
        customerId: customer?.id,
      },
    };
  }

  return {
    draft: {
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      quantity: resolveQuantityFromMessages(activeOrderMessages),
      size: resolveSizeFromMessages(activeOrderMessages, product),
      color: resolveColorFromMessages(activeOrderMessages, product),
      price: product.price,
      deliveryCharge,
      total: product.price * resolveQuantityFromMessages(activeOrderMessages) + deliveryCharge,
      paymentMethod,
      giftWrap,
      giftNote,
      deliveryEstimate,
      name: contacts.name,
      address: contacts.address,
      phone: contacts.phone,
    },
    context: {
      messages: conversationMessages,
      customerId: customer?.id,
    },
  };
}

export function buildContactConfirmationReply(name: string, address: string, phone: string): string {
  return [
    'Please confirm if these delivery details are correct:',
    '',
    formatContactBlock({ name, address, phone }),
    '',
    'If anything should be changed, please send the correction.',
  ].join('\n');
}
