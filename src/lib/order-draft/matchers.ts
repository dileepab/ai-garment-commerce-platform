import { ConversationMessage } from '@/lib/contact-profile';
import { getDefaultMerchantSettings, resolvePaymentMethod, type MerchantPaymentSettings } from '@/lib/runtime-config';
import { CatalogProduct } from './types';
import { normalizeText, splitCsv } from './formatters';
import {
  ORDER_COMPLETION_PATTERN, ORDER_CANCELLATION_PATTERN, ORDER_UPDATE_COMPLETION_PATTERN,
  ORDER_SUMMARY_PATTERN, CONTACT_CONFIRMATION_HINT_PATTERN,
  SAME_ITEM_PATTERNS, SIZE_PATTERN, GIFT_PATTERN, HAPPY_BIRTHDAY_PATTERN, ONLINE_TRANSFER_PATTERN
} from './constants';

export function getRecentCustomerText(messages: ConversationMessage[]): string[] {
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

export function getActiveOrderWindowMessages(messages: ConversationMessage[]): ConversationMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'assistant' && isTerminalAssistantOrderMessage(message.message)) {
      return messages.slice(index + 1);
    }
  }

  return messages;
}

export function detectSameItemIntent(messages: ConversationMessage[]): boolean {
  const latestUserMessages = getRecentCustomerText(messages).slice(0, 4);
  return latestUserMessages.some((message) =>
    SAME_ITEM_PATTERNS.some((pattern) => pattern.test(message))
  );
}

export function scoreProductMatch(product: CatalogProduct, text: string): number {
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

export function resolveProductFromMessages(
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

export function resolveSizeFromMessages(messages: ConversationMessage[], product?: CatalogProduct): string | undefined {
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

export function resolveColorFromMessages(messages: ConversationMessage[], product?: CatalogProduct): string | undefined {
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

export function resolveQuantityFromMessages(messages: ConversationMessage[]): number {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 6);
  const quantityPatterns = [
    /\bqty\s*[:\-]?\s*(\d+)\b/i,
    /\bquantity\s*[:\-]?\s*(\d+)\b/i,
    /\bto\s+(\d+)\b/i,
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

export function detectGiftWrap(messages: ConversationMessage[]): boolean {
  return getRecentCustomerText(messages).some((message) => GIFT_PATTERN.test(message));
}

export function extractGiftNote(messages: ConversationMessage[]): string | undefined {
  const recentUserMessages = getRecentCustomerText(messages).slice(0, 12);

  for (const message of recentUserMessages) {
    if (HAPPY_BIRTHDAY_PATTERN.test(message)) {
      return 'Happy Birthday';
    }
  }

  return undefined;
}

export function detectPaymentMethod(
  messages: ConversationMessage[],
  settings?: MerchantPaymentSettings
): string {
  const paymentSettings = settings ?? getDefaultMerchantSettings().payment;
  const recentMessages = getRecentCustomerText(messages);
  const onlineMethod = paymentSettings.methods.find(
    (method) =>
      method.toLowerCase() === paymentSettings.onlineTransferLabel.toLowerCase() ||
      ONLINE_TRANSFER_PATTERN.test(method)
  );

  if (onlineMethod && recentMessages.some((message) => ONLINE_TRANSFER_PATTERN.test(message))) {
    return onlineMethod;
  }

  const codMessage = recentMessages.find((message) => /\bcod\b|cash on delivery/i.test(message));
  if (codMessage) {
    return resolvePaymentMethod(null, codMessage, {
      ...getDefaultMerchantSettings(),
      payment: paymentSettings,
    });
  }

  return paymentSettings.methods.includes(paymentSettings.defaultMethod)
    ? paymentSettings.defaultMethod
    : paymentSettings.methods[0] || 'COD';
}
