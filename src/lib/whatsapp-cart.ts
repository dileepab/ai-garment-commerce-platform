/**
 * WhatsApp cart messages.
 *
 * Tapping "Add to cart" on a catalog card and sending it produces a message of
 * type "order" carrying the retailer ids the customer chose. Nothing read that,
 * so a cart arrived as an empty message and the bot fell back to inferring a
 * product from earlier text — which is how a customer asking about one dress was
 * quoted another, at a size they never picked.
 *
 * A cart is the least ambiguous thing a customer can send: they picked the exact
 * catalog rows. Reading it removes the guessing entirely.
 */

export interface WhatsAppCartItem {
  retailerId: string;
  quantity: number;
  /** Unit price as WhatsApp reported it, for cross-checking against our own. */
  itemPrice?: number;
  currency?: string;
}

export interface WhatsAppCart {
  catalogId?: string;
  /** Any note the customer typed alongside the cart. */
  note?: string;
  items: WhatsAppCartItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function asPrice(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

/** Reads the cart out of a raw WhatsApp message, or null when it is not one. */
export function extractWhatsAppCart(message: unknown): WhatsAppCart | null {
  const record = asRecord(message);
  if (!record) return null;
  if (record.type !== undefined && record.type !== 'order') return null;

  const order = asRecord(record.order);
  if (!order) return null;

  const rawItems = Array.isArray(order.product_items) ? order.product_items : [];
  const items = rawItems
    .map((entry) => {
      const item = asRecord(entry);
      const retailerId = typeof item?.product_retailer_id === 'string'
        ? item.product_retailer_id.trim()
        : '';
      if (!retailerId) return null;

      const itemPrice = asPrice(item?.item_price);
      const currency = typeof item?.currency === 'string' ? item.currency : undefined;

      const cartItem: WhatsAppCartItem = {
        retailerId,
        quantity: asPositiveInt(item?.quantity, 1),
        ...(itemPrice !== undefined ? { itemPrice } : {}),
        ...(currency ? { currency } : {}),
      };

      return cartItem;
    })
    .filter((item): item is WhatsAppCartItem => item !== null);

  // An order with no readable items is not something to act on — treating it as
  // a cart would replace a real message with silence.
  if (items.length === 0) return null;

  const note = typeof order.text === 'string' ? order.text.trim() : '';

  return {
    catalogId: typeof order.catalog_id === 'string' ? order.catalog_id : undefined,
    ...(note ? { note } : {}),
    items,
  };
}

export interface ParsedRetailerId {
  /** Variant row id, when the id was generated rather than taken from a SKU. */
  variantId: number | null;
  /** The id verbatim, which may be a variant SKU. */
  raw: string;
}

/**
 * Undoes buildMetaCatalogVariantRetailerId as far as is safe.
 *
 * That function emits either a variant's own SKU, or "{product}-V{variantId}".
 * A SKU could itself end in something resembling the suffix, so both readings
 * are returned and the database decides — guessing here would silently attach
 * an order to the wrong variant.
 */
export function parseCatalogRetailerId(retailerId: string): ParsedRetailerId {
  const raw = retailerId.trim();
  const suffix = raw.match(/-V(\d+)$/);
  const variantId = suffix ? Number.parseInt(suffix[1], 10) : NaN;

  return {
    variantId: Number.isSafeInteger(variantId) && variantId > 0 ? variantId : null,
    raw,
  };
}

export interface CartVariant {
  id: number;
  sku?: string | null;
  size: string;
  color: string;
}

export interface CartProduct {
  id: number;
  name: string;
  variants?: CartVariant[];
}

export interface ResolvedCartLine<P> {
  product: P;
  variant: CartVariant;
  quantity: number;
  retailerId: string;
}

export interface ResolvedCart<P> {
  /** Cart lines matched to a variant, in the order the customer added them. */
  lines: ResolvedCartLine<P>[];
  /** Ids no product in the catalog claimed — a retired or unlisted variant. */
  unresolvedRetailerIds: string[];
}

/**
 * Matches every cart line back to the variant it came from.
 *
 * buildMetaCatalogVariantRetailerId emits either a variant's own SKU or a
 * generated "{product}-V{id}", so both readings are tried and the loaded
 * catalog decides which one is real.
 *
 * Every line is returned, not just the first. The order flow still handles one
 * item at a time, but the caller needs to know the rest exist: dropping them
 * silently means a customer who added two dresses receives one and is never
 * told.
 */
export function resolveCartLines<P extends CartProduct>(
  products: P[],
  cart?: Array<{ retailerId: string; quantity: number }>
): ResolvedCart<P> {
  const resolved: ResolvedCart<P> = { lines: [], unresolvedRetailerIds: [] };
  if (!cart?.length) return resolved;

  for (const item of cart) {
    const { variantId, raw } = parseCatalogRetailerId(item.retailerId);

    let match: { product: P; variant: CartVariant } | null = null;
    for (const product of products) {
      const variant = (product.variants ?? []).find(
        (candidate) =>
          (variantId !== null && candidate.id === variantId) ||
          (candidate.sku ? candidate.sku === raw : false)
      );

      if (variant) {
        match = { product, variant };
        break;
      }
    }

    if (!match) {
      resolved.unresolvedRetailerIds.push(item.retailerId);
      continue;
    }

    // The same variant can arrive on two lines. Two orders for one dress is a
    // worse answer than one order for two.
    const existing = resolved.lines.find((line) => line.variant.id === match.variant.id);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }

    resolved.lines.push({
      product: match.product,
      variant: match.variant,
      quantity: item.quantity,
      retailerId: item.retailerId,
    });
  }

  return resolved;
}

/** A readable summary for the conversation log and the support inbox. */
export function describeCart(cart: WhatsAppCart): string {
  const lines = cart.items.map(
    (item) => `${item.quantity} × ${item.retailerId}`
  );
  return `Cart: ${lines.join(', ')}${cart.note ? ` — "${cart.note}"` : ''}`;
}
