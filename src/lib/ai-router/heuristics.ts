import { RouterProductContext, RouterInput, AiRoutedAction } from './types';
import { extractContactDetailsFromText } from '@/lib/contact-profile';
import { SizeChartCategory } from '@/lib/size-charts';

export const SIZE_PATTERN = /\b(XXL|XL|XS|S|M|L|small|medium|large|extra small|extra large)\b/i;
export const QUANTITY_PATTERNS = [
  /\bqty\s*[:\-]?\s*(\d+)\b/i,
  /\bquantity\s*[:\-]?\s*(\d+)\b/i,
  /\bto\s+(\d+)\b/i,
  /\b(?:need|want|order|buy|get|take)\s+(\d+)\b/i,
  /\b(\d+)\s*(?:x|items?|pieces?|pcs?)\b/i,
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

const SUPPORT_CONTACT_PATTERNS = [
  /\b(?:support|customer care|customer support|support center|help center|customer service)\b.*\b(?:contact|phone|mobile|telephone|whatsapp)\b/i,
  /\b(?:contact|phone|mobile|telephone|whatsapp)\b.*\b(?:support|team|center|customer care|customer support|customer service)\b/i,
  /\b(?:support|customer care|customer support|support center|help center|customer service)\b.*\bnumber\b/i,
  /\b(?:can i have|can you give|give me|send me|i need|need)\b.*\b(?:contact|phone|mobile|telephone|whatsapp)\b.*\bnumber\b/i,
];

const THANKS_PATTERN =
  /\b(thanks|thank you|thankyou|many thanks|okay thank you|ok thank you|alright thank you)\b/i;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
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

  if (/\btop\b|\btops\b|\bshirt\b|\bshirts\b|\bblouse\b|\bcrop top\b/.test(normalized)) {
    return 'tops';
  }

  if (/\bdress\b|\bdresses\b|\bgown\b|\bgowns\b/.test(normalized)) {
    return 'dresses';
  }

  if (/\bpant\b|\bpants\b|\btrouser\b|\btrousers\b|\bjean\b|\bjeans\b|\blegging\b/.test(normalized)) {
    return 'pants';
  }

  if (/\bskirt\b|\bskirts\b/.test(normalized)) {
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
    paymentMethod: /\bonline transfer\b|\bbank transfer\b/.test(normalized)
      ? 'Online Transfer'
      : null,
    giftWrap: /\bgift wrap\b|\bpack .* as a gift\b|\bsend .* as a gift\b|\bgift\b/.test(normalized)
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

  if (SUPPORT_CONTACT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      ...base,
      action: 'support_contact_request',
      confidence: 0.92,
    };
  }

  if (THANKS_PATTERN.test(normalized)) {
    return {
      ...base,
      action: 'thanks_acknowledgement',
      confidence: 0.88,
    };
  }

  if (/^check\s+\d+$/i.test(normalized) || /\bstatus\b|\btrack\b|\bwhere is my order\b/.test(normalized)) {
    return {
      ...base,
      action: 'order_status',
      confidence: 0.9,
    };
  }

  if (/\border details?\b|\border summary\b|\bsummary of\b|\bdetails? of\b/.test(normalized)) {
    return {
      ...base,
      action: 'order_details',
      confidence: 0.9,
    };
  }

  if (/\bcancel\b|\bdelete\b|\bremove\b/.test(normalized)) {
    return {
      ...base,
      action: 'cancel_order',
      confidence: 0.9,
    };
  }

  if (/\bre order\b|\breorder\b|\bsame item\b|\bsame size\b|\bprevious order\b/.test(normalized)) {
    return {
      ...base,
      action: 'reorder_last',
      confidence: 0.85,
    };
  }

  if (/\b(?:increase|decrease|reduce|lower|change|update|edit|set)\b.*\b(?:quantity|count)\b|\bquantity\b.*\bto\s+\d+\b|\border count\b.*\bto\s+\d+\b/.test(normalized)) {
    return {
      ...base,
      action: 'update_order_quantity',
      confidence: 0.9,
    };
  }

  if (/\bsize chart\b|\bmeasurement chart\b|\bmeasurements?\b/.test(normalized)) {
    return {
      ...base,
      action: 'size_chart',
      confidence: 0.9,
    };
  }

  if (/\bavailable items?\b|\bavailable products?\b|\bwhat are the available\b|\bwhat do you have\b|\bavailable dresses?\b|\bavailable tops?\b|\bavailable pants\b|\bavailable skirts?\b/.test(normalized)) {
    return {
      ...base,
      action: 'catalog_list',
      confidence: 0.9,
    };
  }

  if (product && /\bwhat colors?\b|\bavailable colors?\b|\bwhat sizes?\b|\bavailable sizes?\b|\bprice\b|\bhow much\b/.test(normalized)) {
    let questionType: AiRoutedAction['questionType'] = 'availability';

    if (/\bcolor\b/.test(normalized)) {
      questionType = 'colors';
    } else if (/\bsize\b/.test(normalized)) {
      questionType = 'sizes';
    } else if (/\bprice\b|\bhow much\b/.test(normalized)) {
      questionType = 'price';
    }

    return {
      ...base,
      action: 'product_question',
      confidence: 0.9,
      questionType,
    };
  }

  if (/\bhow long\b|\bdelivery\b|\barrive\b|\bbefore\b|\bwhen can i get\b|\bwhen will it arrive\b/.test(normalized)) {
    return {
      ...base,
      action: 'delivery_question',
      confidence: 0.85,
    };
  }

  if (/\bonline transfer\b|\bbank transfer\b|\bpayment method\b|\bpay\b/.test(normalized)) {
    return {
      ...base,
      action: 'payment_question',
      confidence: 0.9,
    };
  }

  if (/\bexchange\b|\bwrong size\b|\bsize is wrong\b|\bchange the size\b/.test(normalized)) {
    return {
      ...base,
      action: 'exchange_question',
      confidence: 0.85,
    };
  }

  if (/\bgift wrap\b|\bpack .* as a gift\b|\bsend .* as a gift\b|\bgift\b|\bhappy birthday\b|\bgift note\b|\bspecial note\b/.test(normalized)) {
    return {
      ...base,
      action: 'gift_request',
      confidence: 0.85,
    };
  }

  if (
    product &&
    (
      /\bi want\b|\bi need\b|\bi would like\b|\border\b|\bbuy\b|\bget\b/.test(normalized) ||
      input.pendingStep === 'order_draft'
    )
  ) {
    return {
      ...base,
      action: 'place_order',
      confidence: 0.92,
    };
  }

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(normalized)) {
    return {
      ...base,
      action: 'greeting',
      confidence: 0.9,
    };
  }

  return base;
}
