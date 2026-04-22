/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

const typesTs = `import type { PendingConversationStep } from '@/lib/conversation-state';
import type { SizeChartCategory } from '@/lib/size-charts';

export const ROUTED_ACTIONS = [
  'greeting',
  'catalog_list',
  'product_question',
  'size_chart',
  'place_order',
  'confirm_pending',
  'cancel_order',
  'reorder_last',
  'order_status',
  'order_details',
  'update_order_quantity',
  'delivery_question',
  'payment_question',
  'exchange_question',
  'gift_request',
  'fallback',
] as const;

export const PRODUCT_QUESTION_TYPES = ['colors', 'sizes', 'price', 'availability'] as const;
export const PAYMENT_METHODS = ['COD', 'Online Transfer'] as const;
export const PRODUCT_TYPES = ['tops', 'dresses', 'pants', 'skirts'] as const;

export type RoutedActionType = (typeof ROUTED_ACTIONS)[number];

export interface AiRoutedAction {
  action: RoutedActionType;
  confidence: number;
  orderId: number | null;
  productName: string | null;
  productType: SizeChartCategory | null;
  questionType: (typeof PRODUCT_QUESTION_TYPES)[number] | null;
  quantity: number | null;
  size: string | null;
  color: string | null;
  paymentMethod: (typeof PAYMENT_METHODS)[number] | null;
  giftWrap: boolean | null;
  giftNote: string | null;
  requestedDate: string | null;
  deliveryLocation: string | null;
  contact: {
    name: string | null;
    address: string | null;
    phone: string | null;
  };
}

export interface RouterProductContext {
  name: string;
  style: string;
  price: number;
  sizes: string;
  colors: string;
  availableQty: number;
}

export interface RouterInput {
  brand?: string;
  currentMessage: string;
  pendingStep: PendingConversationStep;
  knownContact: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  lastReferencedOrderId?: number | null;
  latestOrderId?: number | null;
  latestActiveOrderId?: number | null;
  recentMessages: Array<{
    role: string;
    message: string;
  }>;
  products: RouterProductContext[];
}

export interface ModelError {
  status?: number;
}
`;

const schemaTs = `import { ROUTED_ACTIONS, PRODUCT_QUESTION_TYPES, PAYMENT_METHODS, PRODUCT_TYPES } from './types';

export const ROUTER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'action',
    'confidence',
    'orderId',
    'productName',
    'productType',
    'questionType',
    'quantity',
    'size',
    'color',
    'paymentMethod',
    'giftWrap',
    'giftNote',
    'requestedDate',
    'deliveryLocation',
    'contact',
  ],
  properties: {
    action: {
      type: 'string',
      enum: [...ROUTED_ACTIONS],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    orderId: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
    },
    productName: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    productType: {
      anyOf: [{ type: 'string', enum: [...PRODUCT_TYPES] }, { type: 'null' }],
    },
    questionType: {
      anyOf: [{ type: 'string', enum: [...PRODUCT_QUESTION_TYPES] }, { type: 'null' }],
    },
    quantity: {
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
    },
    size: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    color: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    paymentMethod: {
      anyOf: [{ type: 'string', enum: [...PAYMENT_METHODS] }, { type: 'null' }],
    },
    giftWrap: {
      anyOf: [{ type: 'boolean' }, { type: 'null' }],
    },
    giftNote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    requestedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    deliveryLocation: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    contact: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'address', 'phone'],
      properties: {
        name: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        address: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        phone: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
    },
  },
} as const;
`;

const promptTs = `import { RouterInput } from './types';

export function buildRouterPrompt(input: RouterInput): string {
  const products = input.products
    .map(
      (product) =>
        \`- \${product.name} | Style: \${product.style || '-'} | Price: Rs \${product.price} | Sizes: \${product.sizes || '-'} | Colors: \${product.colors || '-'} | Available: \${product.availableQty}\`
    )
    .join('\\n');

  const chatHistory = input.recentMessages
    .slice(-8)
    .map((message) => \`\${message.role === 'user' ? 'Customer' : 'Assistant'}: \${message.message}\`)
    .join('\\n');

  return \`You are an intent router for a Sri Lankan online clothing store chat assistant.

Store brand: \${input.brand || 'the current store'}
Pending step: \${input.pendingStep}
Known contact:
- Name: \${input.knownContact.name || '-'}
- Address: \${input.knownContact.address || '-'}
- Phone: \${input.knownContact.phone || '-'}
- Last referenced order ID: \${input.lastReferencedOrderId ?? '-'}
- Latest order ID: \${input.latestOrderId ?? '-'}
- Latest active order ID: \${input.latestActiveOrderId ?? '-'}

Available catalog:
\${products || '- No products available'}

Recent conversation:
\${chatHistory || '- No recent messages'}

Current customer message:
\${input.currentMessage}

Choose exactly one action from this list:
- greeting: simple hello / thanks / casual greeting
- catalog_list: asking available items/products/dresses/tops in store
- product_question: asking colors, sizes, price, or availability of a specific product
- size_chart: asking for size chart / measurement chart
- place_order: starting a new order OR changing product/size/color/quantity/contact details for a pending new order
- confirm_pending: explicit confirmation of the currently pending contact block, order summary, or quantity-update summary
- cancel_order: cancel/delete/remove an existing order
- reorder_last: reorder same item / reopen previous order / restore previous purchase
- order_status: asking status / track / check status of an order
- order_details: asking for order details / order summary / details of order #id
- update_order_quantity: asking to increase/reduce/change quantity of an existing confirmed order
- delivery_question: asking delivery time, deadline, or delivery to a location
- payment_question: asking about online transfer / payment method
- exchange_question: asking about exchange or wrong size policy
- gift_request: asking for gift wrap or gift note
- fallback: none of the above

Routing rules:
- If Pending step is contact_confirmation, order_confirmation, or quantity_update_confirmation and the customer says yes/correct/confirm/proceed/no changes needed, use confirm_pending.
- Do not treat "ok", "okay", "thanks", "thank you", or a fresh greeting as confirmation.
- If the customer changes address, name, phone, size, color, or quantity for a pending new order, use place_order and return only the changed fields you can confidently extract.
- If the customer asks for order details, summary, or details of #12, use order_details instead of order_status.
- If the customer says "check order #11", "check again", "status of last order", or similar status wording, use order_status.
- If the customer asks to change quantity of "last order" or "previous order", use update_order_quantity.
- If the customer asks about total, delivery, payment, or gift instructions while a new order is pending, stay on that pending draft instead of switching to an older stored order.
- If the customer asks for available colors/sizes of a named product, use product_question and set questionType.
- If the customer asks for a size chart and the product type is obvious from the message or recent context, set productType.
- If the customer asks for a size chart without a clear item type, use size_chart and leave productType null so the app can ask which type they want.
- If the customer asks for available dresses, tops, pants, or skirts, use catalog_list.
- Do not invent product names, order IDs, dates, or contact values. Return null for anything unclear.
- Return quantity only when the customer clearly asked for a number.
- Return productName when the product can be inferred with high confidence from the message or recent context.
- Return paymentMethod only when the customer explicitly mentions it.
- Return giftWrap true when the message clearly requests gift packing.
- Return giftNote only when the note text is explicit.

Return JSON only.\`;
}
`;

const heuristicsTs = `import { RouterProductContext, RouterInput, AiRoutedAction } from './types';
import { extractContactDetailsFromText } from '@/lib/contact-profile';
import { SizeChartCategory } from '@/lib/size-charts';

export const SIZE_PATTERN = /\\b(XXL|XL|XS|S|M|L|small|medium|large|extra small|extra large)\\b/i;
export const QUANTITY_PATTERNS = [
  /\\bqty\\s*[:\\-]?\\s*(\\d+)\\b/i,
  /\\bquantity\\s*[:\\-]?\\s*(\\d+)\\b/i,
  /\\bto\\s+(\\d+)\\b/i,
  /\\b(?:need|want|order|buy|get|take)\\s+(\\d+)\\b/i,
  /\\b(\\d+)\\s*(?:x|items?|pieces?|pcs?)\\b/i,
];
export const CONFIRMATION_PHRASES = new Set([
  'yes',
  'yes correct',
  'correct',
  'confirmed',
  'confirm',
  'sure',
  'no changes needed',
  'looks good',
  'proceed',
  'yes please',
  'details are correct',
  'yes details are correct',
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function scoreProductMatch(product: RouterProductContext, text: string): number {
  const normalizedText = normalizeText(text);
  const candidates = [product.name, product.style || '']
    .map((value) => normalizeText(value))
    .filter(Boolean);

  let bestScore = 0;

  for (const candidate of candidates) {
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

export function findProductByMessage(
  products: RouterProductContext[],
  currentMessage: string,
  recentMessages: RouterInput['recentMessages']
): RouterProductContext | null {
  const messages = [
    currentMessage,
    ...recentMessages
      .filter((message) => message.role === 'user')
      .map((message) => message.message)
      .reverse(),
  ];

  let bestProduct: RouterProductContext | null = null;
  let bestScore = 0;

  for (const message of messages) {
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

export function normalizeSize(size: string | null, product?: RouterProductContext | null): string | null {
  if (!size) {
    return null;
  }

  const normalized = normalizeText(size);
  const sizeMap = {
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
  } as const;

  const mapped = sizeMap[normalized as keyof typeof sizeMap] || size.trim().toUpperCase();
  const allowedSizes = product ? splitCsv(product.sizes).map((value) => value.toUpperCase()) : [];

  if (allowedSizes.length === 0 || allowedSizes.includes(mapped)) {
    return mapped;
  }

  return null;
}

export function extractSizeFromMessage(message: string, product?: RouterProductContext | null): string | null {
  const match = message.match(SIZE_PATTERN);
  return match?.[1] ? normalizeSize(match[1], product) : null;
}

export function extractColorFromMessage(message: string, product?: RouterProductContext | null): string | null {
  if (!product) {
    return null;
  }

  const normalizedMessage = normalizeText(message);

  for (const color of splitCsv(product.colors)) {
    if (normalizedMessage.includes(normalizeText(color))) {
      return color;
    }
  }

  return null;
}

export function extractQuantityFromMessage(message: string): number | null {
  for (const pattern of QUANTITY_PATTERNS) {
    const match = message.match(pattern);

    if (match?.[1]) {
      const quantity = Number.parseInt(match[1], 10);
      if (Number.isInteger(quantity) && quantity > 0) {
        return quantity;
      }
    }
  }

  return null;
}

export function inferProductType(message: string): SizeChartCategory | null {
  const normalized = normalizeText(message);

  if (/\\btop\\b|\\btops\\b|\\bshirt\\b|\\bshirts\\b|\\bblouse\\b|\\bcrop top\\b/.test(normalized)) {
    return 'tops';
  }

  if (/\\bdress\\b|\\bdresses\\b|\\bgown\\b|\\bgowns\\b/.test(normalized)) {
    return 'dresses';
  }

  if (/\\bpant\\b|\\bpants\\b|\\btrouser\\b|\\btrousers\\b|\\bjean\\b|\\bjeans\\b|\\blegging\\b/.test(normalized)) {
    return 'pants';
  }

  if (/\\bskirt\\b|\\bskirts\\b/.test(normalized)) {
    return 'skirts';
  }

  return null;
}

export function buildHeuristicAction(
  input: RouterInput,
  product: RouterProductContext | null
): AiRoutedAction {
  const message = input.currentMessage;
  const normalized = normalizeText(message);
  const extractedContact = extractContactDetailsFromText(message);
  const quantity = extractQuantityFromMessage(message);
  const size = extractSizeFromMessage(message, product);
  const color = extractColorFromMessage(message, product);
  const giftNote = /happy birthday/i.test(message) ? 'Happy Birthday' : null;

  const base: AiRoutedAction = {
    action: 'fallback',
    confidence: 0.4,
    orderId: null,
    productName: product?.name || null,
    productType: inferProductType(message),
    questionType: null,
    quantity,
    size,
    color,
    paymentMethod: /\\bonline transfer\\b|\\bbank transfer\\b/.test(normalized)
      ? 'Online Transfer'
      : null,
    giftWrap: /\\bgift wrap\\b|\\bpack .* as a gift\\b|\\bsend .* as a gift\\b|\\bgift\\b/.test(normalized)
      ? true
      : null,
    giftNote,
    requestedDate: null,
    deliveryLocation: null,
    contact: {
      name: extractedContact.name || null,
      address: extractedContact.address || null,
      phone: extractedContact.phone || null,
    },
  };

  if (CONFIRMATION_PHRASES.has(normalized)) {
    return {
      ...base,
      action: 'confirm_pending',
      confidence: 0.95,
    };
  }

  if (
    ['contact_collection', 'contact_confirmation', 'order_confirmation'].includes(input.pendingStep) &&
    (base.contact.name || base.contact.address || base.contact.phone)
  ) {
    return {
      ...base,
      action: 'place_order',
      confidence: 0.92,
    };
  }

  if (/^check\\s+\\d+$/i.test(normalized) || /\\bstatus\\b|\\btrack\\b|\\bwhere is my order\\b/.test(normalized)) {
    return {
      ...base,
      action: 'order_status',
      confidence: 0.9,
    };
  }

  if (/\\border details?\\b|\\border summary\\b|\\bsummary of\\b|\\bdetails? of\\b/.test(normalized)) {
    return {
      ...base,
      action: 'order_details',
      confidence: 0.9,
    };
  }

  if (/\\bcancel\\b|\\bdelete\\b|\\bremove\\b/.test(normalized)) {
    return {
      ...base,
      action: 'cancel_order',
      confidence: 0.9,
    };
  }

  if (/\\bre order\\b|\\breorder\\b|\\bsame item\\b|\\bsame size\\b|\\bprevious order\\b/.test(normalized)) {
    return {
      ...base,
      action: 'reorder_last',
      confidence: 0.85,
    };
  }

  if (/\\b(?:increase|decrease|reduce|lower|change|update|edit|set)\\b.*\\b(?:quantity|count)\\b|\\bquantity\\b.*\\bto\\s+\\d+\\b|\\border count\\b.*\\bto\\s+\\d+\\b/.test(normalized)) {
    return {
      ...base,
      action: 'update_order_quantity',
      confidence: 0.9,
    };
  }

  if (/\\bsize chart\\b|\\bmeasurement chart\\b|\\bmeasurements?\\b/.test(normalized)) {
    return {
      ...base,
      action: 'size_chart',
      confidence: 0.9,
    };
  }

  if (/\\bavailable items?\\b|\\bavailable products?\\b|\\bwhat are the available\\b|\\bwhat do you have\\b|\\bavailable dresses?\\b|\\bavailable tops?\\b|\\bavailable pants\\b|\\bavailable skirts?\\b/.test(normalized)) {
    return {
      ...base,
      action: 'catalog_list',
      confidence: 0.9,
    };
  }

  if (product && /\\bwhat colors?\\b|\\bavailable colors?\\b|\\bwhat sizes?\\b|\\bavailable sizes?\\b|\\bprice\\b|\\bhow much\\b/.test(normalized)) {
    let questionType: AiRoutedAction['questionType'] = 'availability';

    if (/\\bcolor\\b/.test(normalized)) {
      questionType = 'colors';
    } else if (/\\bsize\\b/.test(normalized)) {
      questionType = 'sizes';
    } else if (/\\bprice\\b|\\bhow much\\b/.test(normalized)) {
      questionType = 'price';
    }

    return {
      ...base,
      action: 'product_question',
      confidence: 0.9,
      questionType,
    };
  }

  if (/\\bhow long\\b|\\bdelivery\\b|\\barrive\\b|\\bbefore\\b|\\bwhen can i get\\b|\\bwhen will it arrive\\b/.test(normalized)) {
    return {
      ...base,
      action: 'delivery_question',
      confidence: 0.85,
    };
  }

  if (/\\bonline transfer\\b|\\bbank transfer\\b|\\bpayment method\\b|\\bpay\\b/.test(normalized)) {
    return {
      ...base,
      action: 'payment_question',
      confidence: 0.9,
    };
  }

  if (/\\bexchange\\b|\\bwrong size\\b|\\bsize is wrong\\b|\\bchange the size\\b/.test(normalized)) {
    return {
      ...base,
      action: 'exchange_question',
      confidence: 0.85,
    };
  }

  if (/\\bgift wrap\\b|\\bpack .* as a gift\\b|\\bsend .* as a gift\\b|\\bgift\\b|\\bhappy birthday\\b|\\bgift note\\b|\\bspecial note\\b/.test(normalized)) {
    return {
      ...base,
      action: 'gift_request',
      confidence: 0.85,
    };
  }

  if (
    product &&
    (
      /\\bi want\\b|\\bi need\\b|\\bi would like\\b|\\border\\b|\\bbuy\\b|\\bget\\b/.test(normalized) ||
      input.pendingStep === 'order_draft'
    )
  ) {
    return {
      ...base,
      action: 'place_order',
      confidence: 0.92,
    };
  }

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\\b/.test(normalized)) {
    return {
      ...base,
      action: 'greeting',
      confidence: 0.9,
    };
  }

  return base;
}
`;

const mainTs = `import { GoogleGenAI } from '@google/genai';
import { SizeChartCategory } from '@/lib/size-charts';
import { AiRoutedAction, RouterInput, RoutedActionType, ROUTED_ACTIONS, PRODUCT_TYPES, PRODUCT_QUESTION_TYPES, PAYMENT_METHODS, ModelError } from './ai-router/types';
import { ROUTER_JSON_SCHEMA } from './ai-router/schema';
import { buildRouterPrompt } from './ai-router/prompt';
import { buildHeuristicAction, findProductByMessage } from './ai-router/heuristics';

const MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

export type { AiRoutedAction, RoutedActionType };

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as ModelError).status;
    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

function sanitizeJsonText(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('\`\`\`')) {
    return trimmed.replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '');
  }

  return trimmed;
}

function isRoutedActionType(value: string): value is RoutedActionType {
  return ROUTED_ACTIONS.includes(value as RoutedActionType);
}

function normalizeRoutedAction(value: unknown): AiRoutedAction | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Partial<AiRoutedAction>;

  if (!candidate.action || !isRoutedActionType(candidate.action)) {
    return null;
  }

  return {
    action: candidate.action,
    confidence:
      typeof candidate.confidence === 'number' && candidate.confidence >= 0
        ? Math.min(candidate.confidence, 1)
        : 0,
    orderId: typeof candidate.orderId === 'number' ? candidate.orderId : null,
    productName: typeof candidate.productName === 'string' ? candidate.productName.trim() || null : null,
    productType:
      candidate.productType && PRODUCT_TYPES.includes(candidate.productType)
        ? (candidate.productType as SizeChartCategory)
        : null,
    questionType:
      candidate.questionType && PRODUCT_QUESTION_TYPES.includes(candidate.questionType)
        ? candidate.questionType
        : null,
    quantity: typeof candidate.quantity === 'number' ? candidate.quantity : null,
    size: typeof candidate.size === 'string' ? candidate.size.trim() || null : null,
    color: typeof candidate.color === 'string' ? candidate.color.trim() || null : null,
    paymentMethod:
      candidate.paymentMethod && PAYMENT_METHODS.includes(candidate.paymentMethod)
        ? candidate.paymentMethod
        : null,
    giftWrap: typeof candidate.giftWrap === 'boolean' ? candidate.giftWrap : null,
    giftNote: typeof candidate.giftNote === 'string' ? candidate.giftNote.trim() || null : null,
    requestedDate:
      typeof candidate.requestedDate === 'string' ? candidate.requestedDate.trim() || null : null,
    deliveryLocation:
      typeof candidate.deliveryLocation === 'string'
        ? candidate.deliveryLocation.trim() || null
        : null,
    contact: {
      name:
        typeof candidate.contact?.name === 'string' ? candidate.contact.name.trim() || null : null,
      address:
        typeof candidate.contact?.address === 'string'
          ? candidate.contact.address.trim() || null
          : null,
      phone:
        typeof candidate.contact?.phone === 'string'
          ? candidate.contact.phone.trim() || null
          : null,
    },
  };
}

export async function routeCustomerMessageWithAi(
  input: RouterInput
): Promise<AiRoutedAction | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const shouldUseHeuristicFallback = process.env.CHAT_TEST_MODE === '1' || !apiKey;
  const heuristicProduct = findProductByMessage(
    input.products,
    input.currentMessage,
    input.recentMessages
  );

  if (shouldUseHeuristicFallback) {
    return buildHeuristicAction(input, heuristicProduct);
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildRouterPrompt(input);

  for (let index = 0; index < MODEL_CHAIN.length; index += 1) {
    const model = MODEL_CHAIN[index];

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: ROUTER_JSON_SCHEMA,
        },
      });

      const rawText = response.text;

      if (!rawText) {
        continue;
      }

      const parsed = JSON.parse(sanitizeJsonText(rawText));
      const normalized = normalizeRoutedAction(parsed);

      if (normalized) {
        return normalized;
      }
    } catch (error: unknown) {
      const status = getErrorStatus(error);

      if ((status === 429 || status === 503 || status === 404) && index < MODEL_CHAIN.length - 1) {
        continue;
      }

      console.error('[AI Router] Failed to route message:', error);
      return buildHeuristicAction(input, heuristicProduct);
    }
  }

  return buildHeuristicAction(input, heuristicProduct);
}
`;

fs.writeFileSync('src/lib/ai-router/types.ts', typesTs);
fs.writeFileSync('src/lib/ai-router/schema.ts', schemaTs);
fs.writeFileSync('src/lib/ai-router/prompt.ts', promptTs);
fs.writeFileSync('src/lib/ai-router/heuristics.ts', heuristicsTs);
fs.writeFileSync('src/lib/ai-action-router.ts', mainTs);

console.log("ai-action-router refactored successfully.");
