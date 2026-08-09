/**
 * Taking the rest of a cart, one item at a time.
 *
 * A cart can hold several items; an order draft holds one. The first item is
 * turned into a draft as soon as the cart arrives and the rest wait in
 * conversation state. After each confirmation the next one is picked up here
 * and drafted against the same delivery details, so the customer confirms
 * rather than re-types everything.
 *
 * Availability is re-checked at that moment. A cart can sit through a whole
 * conversation, and the last thing to do is confirm an order for something that
 * sold out in between.
 */

import type { PendingCartItem } from './conversation-state.ts';
import type { ResolvedOrderDraft } from './order-draft/types.ts';

export interface CartFollowupVariant {
  id: number;
  size: string;
  color: string;
  inventory?: { availableQty: number } | null;
}

export interface CartFollowupProduct {
  id: number;
  name: string;
  brand: string;
  price: number;
  variants?: CartFollowupVariant[];
}

export interface CartFollowupResult {
  /** The next item drafted against the previous order's delivery details. */
  draft: ResolvedOrderDraft | null;
  /** Items still waiting behind the drafted one. */
  remaining: PendingCartItem[];
  /** Items passed over because they are gone or out of stock. */
  unavailable: PendingCartItem[];
}

/**
 * Builds a draft for the next cart item that can still be ordered.
 *
 * Everything but the item itself is inherited from the order just confirmed —
 * name, address, phone, payment method, delivery charge — because it is the
 * same customer, same cart, same delivery.
 */
export function takeNextCartItemDraft(
  pendingItems: PendingCartItem[],
  products: CartFollowupProduct[],
  previousDraft: ResolvedOrderDraft
): CartFollowupResult {
  const unavailable: PendingCartItem[] = [];

  for (let index = 0; index < pendingItems.length; index += 1) {
    const item = pendingItems[index];
    const product = products.find((candidate) => candidate.id === item.productId);
    const variant = product?.variants?.find((candidate) => candidate.id === item.variantId);
    const availableQty = Math.max(0, variant?.inventory?.availableQty ?? 0);

    if (!product || !variant || availableQty <= 0) {
      unavailable.push(item);
      continue;
    }

    // Never draft more than is on the shelf — the confirmation would fail at
    // order creation, after the customer has already been asked to say yes.
    const quantity = Math.min(item.quantity, availableQty);

    return {
      draft: {
        ...previousDraft,
        productId: product.id,
        productName: product.name,
        brand: product.brand,
        variantId: variant.id,
        requiresExplicitVariantChoice: false,
        quantity,
        size: variant.size,
        color: variant.color,
        price: product.price,
        total: product.price * quantity + previousDraft.deliveryCharge,
      },
      remaining: pendingItems.slice(index + 1),
      unavailable,
    };
  }

  return { draft: null, remaining: [], unavailable };
}

/** How a cart item reads back to the customer: "Floral Midi — Blue, size M × 2". */
export function describePendingCartItem(item: PendingCartItem): string {
  const details = [item.color, item.size ? `size ${item.size}` : ''].filter(Boolean).join(', ');
  const quantity = item.quantity > 1 ? ` × ${item.quantity}` : '';

  return `${item.productName}${details ? ` — ${details}` : ''}${quantity}`;
}

/**
 * The line that tells a customer their other cart items were seen.
 *
 * Sent once, when the cart arrives. Silence here is the failure this exists to
 * prevent: someone adds two dresses, is quoted one, and finds out when a single
 * parcel turns up.
 */
export function buildRemainingCartNote(items: PendingCartItem[]): string | null {
  if (items.length === 0) return null;

  const list = items.map((item) => `• ${describePendingCartItem(item)}`).join('\n');

  return [
    items.length === 1
      ? 'I also have this from your cart:'
      : `I also have these ${items.length} items from your cart:`,
    list,
    "I'll take them one at a time — we'll sort this order out first.",
  ].join('\n');
}

/** The line explaining why a cart item was skipped rather than offered. */
export function buildUnavailableCartNote(items: PendingCartItem[]): string | null {
  if (items.length === 0) return null;

  const list = items.map((item) => describePendingCartItem(item)).join(', ');

  return items.length === 1
    ? `${list} from your cart is out of stock now, so I have left it off.`
    : `These items from your cart are out of stock now, so I have left them off: ${list}.`;
}
