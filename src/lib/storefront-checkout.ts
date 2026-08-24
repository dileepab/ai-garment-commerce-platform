/**
 * Validation for orders arriving from the public storefront.
 *
 * Nothing here trusts the browser. Prices are never read from the request —
 * they are looked up from the catalogue when the order is built — because the
 * request comes from a page anyone can edit before sending.
 *
 * Kept free of path aliases so it can be tested.
 */

/**
 * Whether an order of this size pays for delivery.
 *
 * The rates are the brand's own, from Settings, rather than literals here:
 * the storefront shows them in the cart and the order is built from them, so
 * a number baked into code would mean a deploy to change what a shopper owes.
 */
export function deliveryFeeFor(
  subtotal: number,
  rule: { flatFee: number; freeOver: number }
): number {
  return subtotal >= rule.freeOver ? 0 : rule.flatFee;
}

export const MAX_ITEMS_PER_ORDER = 20;
export const MAX_QUANTITY_PER_ITEM = 10;

/**
 * The slugs the storefront uses, mapped to the names the platform stores.
 *
 * A Map rather than an object literal: a plain object answers `__proto__`
 * with its prototype, which is truthy, so a lookup miss would read as a
 * valid brand.
 */
const BRAND_SLUGS = new Map<string, string>([
  ['happybuy', 'Happybuy'],
  ['cleopatra', 'Cleopatra'],
  ['modabella', 'Modabella'],
  ['deez', 'DEEZ'],
]);

export interface StorefrontOrderItem {
  productId: number;
  quantity: number;
  size?: string;
  color?: string;
}

export interface StorefrontOrder {
  brand: string;
  name: string;
  phone: string;
  streetAddress: string;
  city: string;
  district: string;
  paymentMethod: string;
  adClickId: string | null;
  items: StorefrontOrderItem[];
}

export type ParseResult =
  | { ok: true; value: StorefrontOrder }
  | { ok: false; error: string };

function text(value: unknown, limit = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * Reduces a Sri Lankan number to the 07XXXXXXXX form the couriers expect.
 *
 * Shoppers type +94, 0094, 94 and spaces or dashes interchangeably, and a
 * courier rejects the batch over it long after the sale is made.
 */
export function normaliseSriLankanPhone(raw: unknown): string | null {
  const digits = text(raw, 30).replace(/\D/g, '');
  if (!digits) return null;

  const local = digits.startsWith('0094')
    ? digits.slice(4)
    : digits.startsWith('94')
      ? digits.slice(2)
      : digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  // Nine digits beginning with 7 is every Sri Lankan mobile.
  if (!/^7\d{8}$/.test(local)) return null;
  return `0${local}`;
}

export function resolveBrandSlug(slug: unknown): string | null {
  const key = text(slug, 40).toLowerCase();
  return BRAND_SLUGS.get(key) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseStorefrontOrder(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, error: 'A request body is required.' };

  const brand = resolveBrandSlug(body.brand);
  if (!brand) return { ok: false, error: 'Unknown brand.' };

  const name = text(body.name, 120);
  if (name.length < 2) return { ok: false, error: 'A name is required.' };

  const phone = normaliseSriLankanPhone(body.phone);
  if (!phone) return { ok: false, error: 'A valid Sri Lankan mobile number is required.' };

  const streetAddress = text(body.streetAddress, 300);
  if (streetAddress.length < 4) return { ok: false, error: 'A delivery address is required.' };

  const city = text(body.city, 120);
  if (!city) return { ok: false, error: 'A city is required.' };

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return { ok: false, error: 'The cart is empty.' };
  if (rawItems.length > MAX_ITEMS_PER_ORDER) {
    return { ok: false, error: 'Too many items in one order.' };
  }

  const items: StorefrontOrderItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) return { ok: false, error: 'An item was not readable.' };

    const productId = Number(raw.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return { ok: false, error: 'An item was missing a product.' };
    }

    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, error: 'An item had an invalid quantity.' };
    }
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      return { ok: false, error: 'That quantity is too large to order online.' };
    }

    items.push({
      productId,
      quantity,
      size: text(raw.size, 40) || undefined,
      color: text(raw.color, 40) || undefined,
    });
  }

  return {
    ok: true,
    value: {
      brand,
      name,
      phone,
      streetAddress,
      city,
      district: text(body.district, 120) || city,
      // Cash on delivery is the only method the business actually settles,
      // so an online order claiming anything else would be a false record.
      paymentMethod: 'cod',
      // Carries the ad click through checkout so the sale can be credited to
      // the ad that produced it.
      adClickId: text(body.adClickId, 200) || null,
      items,
    },
  };
}
