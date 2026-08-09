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

/** A readable summary for the conversation log and the support inbox. */
export function describeCart(cart: WhatsAppCart): string {
  const lines = cart.items.map(
    (item) => `${item.quantity} × ${item.retailerId}`
  );
  return `Cart: ${lines.join(', ')}${cart.note ? ` — "${cart.note}"` : ''}`;
}
