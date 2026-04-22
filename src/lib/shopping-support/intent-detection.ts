import { CatalogProduct, SupportIntent } from './types';
import { ConversationMessage } from '@/lib/contact-profile';
import { isContactConfirmationMessage, isOrderSummaryMessage } from '@/lib/order-draft';
import { messageMentionsKnownColor, messageMentionsSize } from './text-matching';

export const TOTAL_PATTERN = /\btotal\b|\bhow much altogether\b|\bfinal amount\b|\btotal amount\b/i;
export const SIZE_CHART_PATTERN = /\bsize chart\b|\bmeasurement(?:s)?\b/i;
export const ONLINE_TRANSFER_PATTERN = /\bonline transfer\b|\bbank transfer\b|\btransfer the money\b/i;
export const ORDER_INTENT_PATTERN = /\b(order|buy|need|want|would like|get|take)\b/i;
export const ORDER_ONLINE_PATTERN = /\bcan i do online\b|\bcan i order online\b|\bplace (?:the )?order online\b|\bdo this online\b/i;
export const DELIVERY_CHARGE_PATTERN = /\bdelivery charge(?:s)?\b|\bshipping charge(?:s)?\b|\bshipping fee\b|\bdelivery fee\b/i;
export const EXCHANGE_PATTERN = /\bexchanges?\b|\bsize issue\b|\bwrong size\b|\bchange the size\b/i;
export const GIFT_PATTERN = /\bgift\b|\bgift wrap\b|\bspecial note\b|\bhappy birthday\b/i;
export const DELIVERY_TIMING_PATTERN = /\bhow long\b|\bwhen (?:will|can)\b.*\b(?:receive|get|arrive|deliver)\b|\bbefore\b.*\b(?:\d{1,2}(?:st|nd|rd|th)?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b|\bdelivery time\b|\bdelivery date\b/i;
export const NEW_ORDER_PATTERN = /\bnew order\b|\bplace (?:a |the )?new order\b|\bplace (?:an |the )?order\b|\bi want to place\b|\bi want to order\b|\bi need\b|\bi would like to order\b/i;

export function detectSupportIntent(message: string): SupportIntent | null {
  if (TOTAL_PATTERN.test(message)) return 'total';
  if (DELIVERY_TIMING_PATTERN.test(message)) return 'delivery_timing';
  if (ONLINE_TRANSFER_PATTERN.test(message)) return 'online_transfer';
  if (ORDER_ONLINE_PATTERN.test(message)) return 'order_online';
  if (GIFT_PATTERN.test(message)) return 'gift';
  if (SIZE_CHART_PATTERN.test(message)) return 'size_chart';
  if (EXCHANGE_PATTERN.test(message)) return 'exchange';
  if (DELIVERY_CHARGE_PATTERN.test(message)) return 'delivery_charge';
  return null;
}

export function looksLikeOrderIntakeMessage(
  message: string,
  explicitProduct: CatalogProduct | null,
  likelyProduct: CatalogProduct | null
): boolean {
  const matchedProduct = explicitProduct || likelyProduct;
  if (!matchedProduct) return false;

  return (
    ORDER_INTENT_PATTERN.test(message) ||
    messageMentionsSize(message) ||
    messageMentionsKnownColor(message, matchedProduct)
  );
}

export function isSizeChartFollowUpPrompt(message?: string): boolean {
  return /which (?:item|item type) would you like the size chart for/i.test(message ?? '');
}

export function isDraftDeliveryConversation(message?: string): boolean {
  if (!message) return false;
  return isContactConfirmationMessage(message) || isOrderSummaryMessage(message);
}

export function isNewOrderIntentMessage(message: string): boolean {
  return NEW_ORDER_PATTERN.test(message);
}

export function hasRecentNewOrderIntent(messages: ConversationMessage[]): boolean {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.message)
    .slice(-5)
    .some((message) => isNewOrderIntentMessage(message));
}

export function extractDeliveryLocationHint(message: string): string | null {
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
