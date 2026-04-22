import { ConversationMessage } from '@/lib/contact-profile';
import { CatalogProduct } from './types';

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
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
  return /\b(XXL|XL|XS|S|M|L)\b/i.test(message);
}
