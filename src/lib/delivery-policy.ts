export const PRIMARY_COURIER_PROVIDER = 'RoyalExpress';
export const ROYALEXPRESS_FLAT_DELIVERY_CHARGE = 425;

/**
 * Fallback free-delivery threshold for a brand that has not set its own.
 *
 * Each brand overrides this in Settings, because the number is a margin
 * decision and differs between a Rs 1,690 skort and a Rs 62,000 lehenga.
 */
export const DEFAULT_FREE_DELIVERY_OVER = 7000;
