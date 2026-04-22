/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

const typesTs = `import type { SizeChartCategory } from '@/lib/size-charts';

export interface CatalogProduct {
  name: string;
  price: number;
  sizes: string;
  colors?: string;
  style?: string;
}

export type SupportIntent =
  | 'order_intake'
  | 'size_chart'
  | 'delivery_charge'
  | 'total'
  | 'online_transfer'
  | 'order_online'
  | 'exchange'
  | 'gift'
  | 'delivery_timing';

export interface ShoppingSupportParams {
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
`;

const textMatchingTs = `import { ConversationMessage } from '@/lib/contact-profile';
import { CatalogProduct } from './types';

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

export function splitCsv(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

  return normalizedName
    .split(' ')
    .filter((token) => token.length > 2)
    .reduce((score, token) => (normalizedText.includes(token) ? score + 1 : score), 0);
}

export function resolveLikelyProduct(
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

export function resolveExplicitProduct(
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

export function messageMentionsKnownColor(message: string, product?: CatalogProduct | null): boolean {
  if (!product?.colors) {
    return false;
  }

  const normalizedMessage = normalizeText(message);
  return splitCsv(product.colors).some((color) =>
    normalizedMessage.includes(normalizeText(color))
  );
}

export function messageMentionsSize(message: string): boolean {
  return /\\b(XXL|XL|XS|S|M|L)\\b/i.test(message);
}
`;

const intentDetectionTs = `import { CatalogProduct, SupportIntent } from './types';
import { ConversationMessage } from '@/lib/contact-profile';
import { isContactConfirmationMessage, isOrderSummaryMessage } from '@/lib/order-draft';
import { messageMentionsKnownColor, messageMentionsSize } from './text-matching';

export const TOTAL_PATTERN = /\\btotal\\b|\\bhow much altogether\\b|\\bfinal amount\\b|\\btotal amount\\b/i;
export const SIZE_CHART_PATTERN = /\\bsize chart\\b|\\bmeasurement(?:s)?\\b/i;
export const ONLINE_TRANSFER_PATTERN = /\\bonline transfer\\b|\\bbank transfer\\b|\\btransfer the money\\b/i;
export const ORDER_INTENT_PATTERN = /\\b(order|buy|need|want|would like|get|take)\\b/i;
export const ORDER_ONLINE_PATTERN = /\\bcan i do online\\b|\\bcan i order online\\b|\\bplace (?:the )?order online\\b|\\bdo this online\\b/i;
export const DELIVERY_CHARGE_PATTERN = /\\bdelivery charge(?:s)?\\b|\\bshipping charge(?:s)?\\b|\\bshipping fee\\b|\\bdelivery fee\\b/i;
export const EXCHANGE_PATTERN = /\\bexchanges?\\b|\\bsize issue\\b|\\bwrong size\\b|\\bchange the size\\b/i;
export const GIFT_PATTERN = /\\bgift\\b|\\bgift wrap\\b|\\bspecial note\\b|\\bhappy birthday\\b/i;
export const DELIVERY_TIMING_PATTERN = /\\bhow long\\b|\\bwhen (?:will|can)\\b.*\\b(?:receive|get|arrive|deliver)\\b|\\bbefore\\b.*\\b(?:\\d{1,2}(?:st|nd|rd|th)?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\\b|\\bdelivery time\\b|\\bdelivery date\\b/i;
export const NEW_ORDER_PATTERN = /\\bnew order\\b|\\bplace (?:a |the )?new order\\b|\\bplace (?:an |the )?order\\b|\\bi want to place\\b|\\bi want to order\\b|\\bi need\\b|\\bi would like to order\\b/i;

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
    /\\b(?:delivery(?:\\s+\\w+){0,3}\\s+to|deliver(?:y)?\\s+to)\\s+([^?.,]+(?:,\\s*[^?.,]+)*)/i,
    /\\bhow long does delivery take to\\s+([^?.,]+(?:,\\s*[^?.,]+)*)/i,
    /\\bdelivery time to\\s+([^?.,]+(?:,\\s*[^?.,]+)*)/i,
    /\\bcan i get it before\\b.*\\bto\\s+([^?.,]+(?:,\\s*[^?.,]+)*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}
`;

const dateParsingTs = `import { ConversationMessage } from '@/lib/contact-profile';

export const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parseRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayMonthMatch = message.match(
    /\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b/i
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

export function parseDayOnlyRequestedDate(message: string, referenceDate: Date): Date | null {
  const dayOnlyMatch = message.match(/\\bbefore\\b.*\\b(\\d{1,2})(?:st|nd|rd|th)?\\b/i);

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

export function resolveRequestedDeliveryDate(
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
`;

const replyBuildersTs = `import { CatalogProduct } from './types';
import { SizeChartCategory, getSizeChartCategoryFromStyle, getSizeChartDefinition } from '@/lib/size-charts';
import { ContactField, collectContactDetailsFromMessages } from '@/lib/contact-profile';
import { splitCsv } from './text-matching';
import { formatSriLankaDisplayDate } from '@/lib/delivery-calendar';

export function buildVariantPrompt(productName: string, size?: string, color?: string, product?: CatalogProduct | null): string {
  const prompts: string[] = [];

  if (!size) {
    const sizeOptions = splitCsv(product?.sizes);
    prompts.push(
      sizeOptions.length > 0
        ? \`Please let me know the size you need for \${productName}. Available sizes: \${sizeOptions.join(', ')}.\`
        : \`Please let me know the size you need for \${productName}.\`
    );
  }

  if (!color) {
    const colorOptions = splitCsv(product?.colors);
    prompts.push(
      colorOptions.length > 0
        ? \`Please let me know the color you need for \${productName}. Available colors: \${colorOptions.join(', ')}.\`
        : \`Please let me know the color you need for \${productName}.\`
    );
  }

  return prompts.join('\\n');
}

export function buildSizeChartSelectionReply(products: CatalogProduct[]): string {
  const allCategories: SizeChartCategory[] = ['tops', 'dresses', 'pants', 'skirts'];
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];
  const categoriesToShow = uniqueCategories.length > 0 ? uniqueCategories : allCategories;
  const categoryLabels = categoriesToShow
    .map((category) => getSizeChartDefinition(category).label)
    .join(', ');

  return \`Sure. Which item type would you like the size chart for? Available types: \${categoryLabels}.\`;
}

export function getSingleCatalogChartCategory(products: CatalogProduct[]): SizeChartCategory | null {
  const mappedCategories = products
    .map((product) => getSizeChartCategoryFromStyle(product.style))
    .filter((category): category is SizeChartCategory => Boolean(category));
  const uniqueCategories = [...new Set(mappedCategories)];

  return uniqueCategories.length === 1 ? uniqueCategories[0] : null;
}

export function buildMissingFieldLabels(missingFields: ContactField[]): string {
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
    .join('\\n');
}

export function buildMissingContactPrompt(missingFields: ContactField[]): string {
  if (missingFields.length === 0) {
    return '';
  }

  return [
    'To proceed with the order, please share:',
    buildMissingFieldLabels(missingFields),
  ].join('\\n');
}

export function buildSummaryReplyWithIntro(intro: string, summary: string): string {
  return \`\${intro}\\n\\n\${summary}\`;
}

export function describeOrderStatus(status: string): string {
  if (status === 'packed') {
    return 'Your order is already packed.';
  }
  if (status === 'confirmed') {
    return 'Your order is already confirmed.';
  }
  return 'Your order is already placed.';
}

export function buildDeliveryWindowReply(
  intro: string,
  earliestDate: Date,
  latestDate: Date,
  requestedDate: Date | null,
  isDraft: boolean,
  referenceDate: Date
): string {
  const windowText = \`\${formatSriLankaDisplayDate(earliestDate)} to \${formatSriLankaDisplayDate(latestDate)}\`;

  if (requestedDate) {
    if (latestDate <= requestedDate) {
      return \`\${intro} The expected delivery window is \${windowText}, so it should arrive by \${formatSriLankaDisplayDate(requestedDate)}.\`;
    }
    if (isDraft) {
      return \`\${intro} If the order is confirmed on \${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is \${windowText}, so delivery before \${formatSriLankaDisplayDate(requestedDate)} is not possible.\`;
    }
    return \`\${intro} The expected delivery window is \${windowText}, so delivery before \${formatSriLankaDisplayDate(requestedDate)} cannot be guaranteed.\`;
  }

  if (isDraft) {
    return \`\${intro} If the order is confirmed on \${formatSriLankaDisplayDate(referenceDate)}, the expected delivery window is \${windowText}.\`;
  }

  return \`\${intro} The expected delivery window is \${windowText}.\`;
}

export function buildNewOrderNextStepReply(
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
`;

fs.writeFileSync('src/lib/shopping-support/types.ts', typesTs);
fs.writeFileSync('src/lib/shopping-support/text-matching.ts', textMatchingTs);
fs.writeFileSync('src/lib/shopping-support/intent-detection.ts', intentDetectionTs);
fs.writeFileSync('src/lib/shopping-support/date-parsing.ts', dateParsingTs);
fs.writeFileSync('src/lib/shopping-support/reply-builders.ts', replyBuildersTs);

const fileBuffer = fs.readFileSync('src/lib/shopping-support.ts', 'utf-8');
const searchString = 'export async function tryHandleShoppingSupport';
const splitIndex = fileBuffer.indexOf(searchString);

if (splitIndex !== -1) {
    const mainFunction = fileBuffer.substring(splitIndex);

    const newContent = `import prisma from '@/lib/prisma';
import {
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

import { ShoppingSupportParams, ShoppingSupportResult, CatalogProduct, SupportIntent } from './shopping-support/types';
import { resolveExplicitProduct, resolveLikelyProduct } from './shopping-support/text-matching';
import { detectSupportIntent, looksLikeOrderIntakeMessage, isSizeChartFollowUpPrompt, extractDeliveryLocationHint, isDraftDeliveryConversation, isNewOrderIntentMessage, hasRecentNewOrderIntent } from './shopping-support/intent-detection';
import { resolveRequestedDeliveryDate } from './shopping-support/date-parsing';
import { buildVariantPrompt, buildSizeChartSelectionReply, getSingleCatalogChartCategory, buildMissingContactPrompt, buildSummaryReplyWithIntro, describeOrderStatus, buildDeliveryWindowReply, buildNewOrderNextStepReply } from './shopping-support/reply-builders';

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

${mainFunction}
`;

    fs.writeFileSync('src/lib/shopping-support.ts', newContent);
    console.log("Refactor completed successfully.");
} else {
    console.error("Could not find the tryHandleShoppingSupport function.");
}
