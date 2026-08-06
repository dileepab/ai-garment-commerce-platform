/**
 * Item codes in customer conversations.
 *
 * Product names are long and easy to mistype ("Tie-Strap Smocked Sundress —
 * Cream Red Floral"), and several colourways of one design share almost the
 * whole name. Quoting the code instead lets a customer point at exactly one
 * product, so replies carry the code and incoming messages are matched against
 * it as well as the name.
 *
 * Codes are compared loosely because customers retype them by hand: "HAP-0002",
 * "hap 0002", "HAP0002" and "#hap-0002" all refer to the same product. Matching
 * is still exact on the compacted form — a bare number like "0002" is ignored,
 * since sizes, quantities and phone digits would collide with it constantly.
 */

const ITEM_CODE_PATTERN = /([a-z]{2,5})[\s\-_/]*([0-9]{2,6})/gi;

export interface ItemCodeProduct {
  id?: number;
  brand?: string | null;
  sku?: string | null;
}

/** Strips separators and case so hand-typed codes compare equal. */
export function compactItemCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * The code shown to customers. Mirrors displayProductSku, but tolerates the
 * partial product shapes the chat layer passes around and returns null rather
 * than inventing a code when there is nothing to derive one from.
 */
export function productItemCode(product: ItemCodeProduct): string | null {
  const stored = product.sku?.trim();
  if (stored) return stored;

  // Legacy rows predate stored SKUs, so derive the same code displayProductSku
  // shows in the admin. Without a brand and id there is nothing to derive from,
  // and a made-up code would be worse than none.
  const brand = product.brand?.trim();
  if (!brand || product.id === undefined) return null;

  const prefix = brand.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
  if (!prefix) return null;

  return `${prefix}-${String(product.id).padStart(4, '0')}`;
}

/** Every code-shaped token in a customer message, compacted for comparison. */
export function extractItemCodes(message: string): string[] {
  const codes = new Set<string>();

  for (const match of message.matchAll(ITEM_CODE_PATTERN)) {
    codes.add(compactItemCode(`${match[1]}${match[2]}`));
  }

  return [...codes];
}

/** Whether the message quotes this product's item code. */
export function messageMentionsItemCode(
  message: string,
  product: ItemCodeProduct
): boolean {
  const code = productItemCode(product);
  if (!code) return false;

  const compacted = compactItemCode(code);
  if (!compacted) return false;

  return extractItemCodes(message).includes(compacted);
}
