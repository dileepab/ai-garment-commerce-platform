/**
 * Whether a customer can actually buy a variant.
 *
 * Stock on hand is the source of truth here, not `status`. A variant's status
 * goes stale easily: "out-of-stock" is what auto-derivation writes for a
 * variant created empty, and the product form resubmits that stored value
 * verbatim on every save, so a restocked variant keeps reporting out-of-stock
 * long after the stock arrived. Trusting status meant the shop bot told
 * customers an item was unavailable while the product page showed 20 in stock.
 *
 * Nothing is lost by ignoring status. Only "active" and "out-of-stock" are ever
 * persisted (see VARIANT_STATUSES in ProductFormModal), so there is no way to
 * express "in stock but deliberately unavailable" — the combination can only be
 * stale data. Retiring a variant zeroes its quantity as well as setting the
 * status, so retired variants are still excluded by the quantity check alone.
 *
 * The write side applies the matching rule in resolveVariantStatus, which
 * rewrites a stocked "out-of-stock" variant to "active" on save.
 */
export interface AvailabilityVariant {
  status?: string | null;
  inventory?: { availableQty: number } | null;
}

export function variantAvailableQty(variant: AvailabilityVariant): number {
  return Math.max(0, variant.inventory?.availableQty ?? 0);
}

export function isVariantAvailable(variant: AvailabilityVariant): boolean {
  return variantAvailableQty(variant) > 0;
}
