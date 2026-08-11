/**
 * The answer to a message naming several item codes at once.
 *
 * Our multi-item post captions prefill "Details HAP-0001 HAP-0002 HAP-0003",
 * so the customer's first message names every dress in the carousel they were
 * looking at. Left to the router, one of them gets a full write-up and the
 * other two are never mentioned — the shopper has to ask again for items they
 * already pointed at.
 *
 * The reply is deliberately compact: one line each, enough to choose between
 * them. Depth belongs in the follow-up, once they have picked one.
 *
 * Kept free of prisma and path aliases so the wording can be tested.
 */
import { formatRsPrice, formatSizes } from '../post-item-details.ts';

export interface MultiCodeProduct {
  name: string;
  /** Null only for a product with no code at all; the line then omits it. */
  itemCode?: string | null;
  price: number;
  sizes?: string | null;
  /** Null when stock is unknown; 0 or less is treated as sold out. */
  availableQty?: number | null;
}

function isSoldOut(product: MultiCodeProduct): boolean {
  return typeof product.availableQty === 'number' && product.availableQty <= 0;
}

export function buildMultiCodeReply(products: MultiCodeProduct[]): string {
  const lines = products.map((product) => {
    const code = product.itemCode?.trim();
    const parts = [code ? `${product.name} (${code})` : product.name];

    // A sold-out item is named rather than dropped — the customer asked about
    // it, and silence reads as us ignoring one of the three.
    if (isSoldOut(product)) {
      parts.push('Sold out');
      return parts.join(' — ');
    }

    parts.push(formatRsPrice(product.price));
    const sizes = formatSizes(product.sizes);
    if (sizes) parts.push(`Sizes: ${sizes}`);

    return parts.join(' — ');
  });

  const closing = products.some((product) => !isSoldOut(product))
    ? 'Which one would you like?'
    : 'Would you like me to let you know when these are back in stock?';

  return `Here are the items you asked about:\n\n${lines.join('\n')}\n\n${closing}`;
}
