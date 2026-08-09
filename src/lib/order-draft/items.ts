/**
 * An order draft holds several items.
 *
 * The draft's top-level product fields are the item currently being specified;
 * anything settled before it lives in previousItems. That split exists so the
 * variant prompts, stock checks and quantity rules keep operating on exactly
 * one item — they were never written for a list — while the order itself can
 * carry as many lines as the customer wants.
 *
 * Read the draft through draftItems() rather than the top-level fields when you
 * mean "everything in this order". Totals in particular: pricing one item and
 * calling it the total is how a customer gets charged for one dress and sent
 * two.
 */

import type { OrderDraftItem, ResolvedOrderDraft } from './types.ts';

/** The item the draft's top-level fields describe. */
export function currentDraftItem(draft: ResolvedOrderDraft): OrderDraftItem {
  return {
    productId: draft.productId,
    productName: draft.productName,
    brand: draft.brand,
    ...(draft.variantId !== undefined ? { variantId: draft.variantId } : {}),
    quantity: draft.quantity,
    ...(draft.size ? { size: draft.size } : {}),
    ...(draft.color ? { color: draft.color } : {}),
    price: draft.price,
  };
}

/** Every item in the order, in the order the customer chose them. */
export function draftItems(draft: ResolvedOrderDraft): OrderDraftItem[] {
  return [...(draft.previousItems ?? []), currentDraftItem(draft)];
}

export function draftItemCount(draft: ResolvedOrderDraft): number {
  return (draft.previousItems?.length ?? 0) + 1;
}

/** Two lines are the same item when they are the same variant of the same product. */
export function isSameDraftItem(a: OrderDraftItem, b: OrderDraftItem): boolean {
  if (a.productId !== b.productId) return false;
  if (a.variantId !== undefined && b.variantId !== undefined) {
    return a.variantId === b.variantId;
  }

  return (a.size ?? '') === (b.size ?? '') && (a.color ?? '') === (b.color ?? '');
}

export function draftItemsSubtotal(draft: ResolvedOrderDraft): number {
  return draftItems(draft).reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * What the customer pays: every item, plus one delivery charge.
 *
 * Delivery is charged per order, not per item — the parcel goes to one address
 * either way, and billing it twice for a two-item order is a real overcharge.
 */
export function calculateDraftTotal(draft: ResolvedOrderDraft): number {
  return draftItemsSubtotal(draft) + draft.deliveryCharge;
}

/** Recomputes the stored total after anything about the items changes. */
export function withDraftTotal(draft: ResolvedOrderDraft): ResolvedOrderDraft {
  return { ...draft, total: calculateDraftTotal(draft) };
}

/**
 * Moves the current item into the settled list, ready for a new one.
 *
 * When the new item repeats one already in the order, its quantity is added to
 * that line instead of starting a duplicate — a customer asking for "one more"
 * of the same dress means two of that dress, not two order lines that a picker
 * has to reconcile.
 */
export function settleCurrentDraftItem(draft: ResolvedOrderDraft): OrderDraftItem[] {
  const settled = [...(draft.previousItems ?? [])];
  const current = currentDraftItem(draft);
  const duplicate = settled.findIndex((item) => isSameDraftItem(item, current));

  if (duplicate >= 0) {
    settled[duplicate] = {
      ...settled[duplicate],
      quantity: settled[duplicate].quantity + current.quantity,
    };
    return settled;
  }

  settled.push(current);
  return settled;
}

/**
 * Files the current item away and clears the slot for a new one.
 *
 * `keepVariant` is for "also in L" — same dress, so the colour already chosen
 * still applies and only the size is being restated. When the customer names a
 * different product, the old size and colour must not follow it across.
 */
export function startNewDraftItem(
  draft: ResolvedOrderDraft,
  options: { quantity?: number | null; keepVariant: boolean }
): ResolvedOrderDraft {
  const quantity =
    typeof options.quantity === 'number' && options.quantity > 0 ? options.quantity : 1;

  return {
    ...draft,
    previousItems: settleCurrentDraftItem(draft),
    requiresExplicitVariantChoice: false,
    quantity,
    ...(options.keepVariant
      ? {}
      : { size: undefined, color: undefined, variantId: undefined }),
  };
}

/** Every distinct brand in the order — a mixed-brand order needs a human. */
export function draftBrands(draft: ResolvedOrderDraft): string[] {
  return Array.from(new Set(draftItems(draft).map((item) => item.brand).filter(Boolean)));
}

/** "Cream Red Floral Dress (Blue, M) × 2" */
export function describeDraftItem(item: OrderDraftItem): string {
  const variant = [item.color, item.size].filter(Boolean).join(', ');
  const quantity = item.quantity > 1 ? ` × ${item.quantity}` : '';

  return `${item.productName}${variant ? ` (${variant})` : ''}${quantity}`;
}

/** The item lines of an order summary, priced per line so the total adds up on screen. */
export function buildDraftItemLines(draft: ResolvedOrderDraft): string[] {
  return draftItems(draft).map(
    (item) => `- ${describeDraftItem(item)} — Rs ${item.price * item.quantity}`
  );
}
