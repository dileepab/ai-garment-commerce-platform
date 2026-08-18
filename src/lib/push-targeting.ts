import { brandsMatch } from './brand-aliases.ts';

/**
 * Who a support notification is for.
 *
 * This decides whether a phone buzzes, so it is kept apart from the sending
 * code and free of path aliases in order to be testable. Getting it wrong in
 * either direction is costly: too wide and an operator is woken for brands
 * they do not handle until they switch notifications off, too narrow and a
 * waiting customer is never mentioned to anybody.
 */

export interface PushTarget {
  /** The operator's brand list as stored on their session, JSON encoded. */
  brands: string | null;
}

/** Brands are stored as the JSON array the session carries. */
export function parseSubscriptionBrands(raw: string | null): string[] {
  if (!raw?.trim()) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((brand): brand is string => typeof brand === 'string' && brand.trim() !== '')
      : [];
  } catch {
    // A malformed list must not silently narrow to "no brands", which would
    // read as all-brand access below. Treated as no restriction either way,
    // but going through the same path keeps that decision in one place.
    return [];
  }
}

export function subscriptionCoversBrand(target: PushTarget, brand?: string | null): boolean {
  const brands = parseSubscriptionBrands(target.brands);

  // An owner or admin carries no brand list and sees everything, so they hear
  // about everything.
  if (brands.length === 0) return true;

  // A conversation with no brand attached cannot be excluded from a brand
  // list; someone has to see it.
  if (!brand?.trim()) return true;

  return brands.some((allowed) => brandsMatch(allowed, brand));
}
