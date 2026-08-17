/**
 * The one canonical smallest-to-largest size order.
 *
 * There were three of these: one for post captions, one for the product form,
 * and one for the storefront API. They disagreed — different size ranges,
 * different handling of values none of them recognised — so the same product
 * could list "S, M, L" in its Facebook caption and a different order on the
 * storefront. A shopper reads a size list as a range, and an unsorted one reads
 * as a mistake; two differently-sorted lists read the same way.
 *
 * Kept free of path aliases so it can be tested directly.
 */

/** Smallest to largest. Index is the rank, so order here is the order shown. */
const LETTERED_SIZES = [
  '4XS', '3XS', '2XS', 'XS', 'XS/S', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL',
  'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
];

/**
 * Everything that means the same size, normalised to the names above. Customers
 * and staff type these interchangeably on the product row.
 */
const SIZE_ALIASES: Record<string, string> = {
  XXXXS: '4XS',
  XXXS: '3XS',
  XXS: '2XS',
  XXL: '2XL',
  '2X': '2XL',
  '1X': 'XL',
  XXXL: '3XL',
  '3X': '3XL',
  XXXXL: '4XL',
  '4X': '4XL',
  XXXXXL: '5XL',
  '5X': '5XL',
  '6X': '6XL',
  SMALL: 'S',
  MEDIUM: 'M',
  LARGE: 'L',
  'EXTRA SMALL': 'XS',
  'EXTRA LARGE': 'XL',
};

/**
 * Sizes that are not a point on the scale. They sort after both the lettered
 * and numeric runs, because "Free Size" belongs at the end of "S, M, L" and at
 * the end of "8, 10, 12" alike.
 */
const CATCH_ALL_SIZES: Record<string, number> = {
  'FREE SIZE': 0,
  FREE: 0,
  'ONE SIZE': 1,
  OS: 1,
  CUSTOM: 2,
  'MADE-TO-ORDER': 3,
  'MADE TO ORDER': 3,
};

function normalizeKey(size: string): string {
  return size.toUpperCase().replace(/[\s.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Rank among the lettered sizes, or -1 when it is not one of them. */
export function sizeRank(size: string): number {
  const spaced = normalizeKey(size);
  const compact = spaced.replace(/\s/g, '');
  const canonical = SIZE_ALIASES[spaced] ?? SIZE_ALIASES[compact] ?? compact;
  return LETTERED_SIZES.indexOf(canonical);
}

function catchAllRank(size: string): number | null {
  const spaced = normalizeKey(size);
  const rank = CATCH_ALL_SIZES[spaced] ?? CATCH_ALL_SIZES[spaced.replace(/\s/g, '')];
  return rank === undefined ? null : rank;
}

function numericValue(size: string): number | null {
  return /^\d+(\.\d+)?$/.test(size.trim()) ? Number(size.trim()) : null;
}

/**
 * Canonical order: lettered sizes, then numeric ones ascending, then Free Size
 * and its kin, then anything unrecognised in the order it was entered — an
 * unfamiliar value is never dropped, only moved to the end.
 */
export function sortSizes(sizes: string[]): string[] {
  const decorated = sizes.map((size, index) => {
    const lettered = sizeRank(size);
    const numeric = numericValue(size);
    const catchAll = catchAllRank(size);

    const bucket = lettered >= 0 ? 0 : numeric !== null ? 1 : catchAll !== null ? 2 : 3;
    const weight = lettered >= 0 ? lettered : (numeric ?? catchAll ?? 0);

    return { size, index, bucket, weight };
  });

  decorated.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    // Unrecognised values keep the order they were entered in.
    if (a.bucket === 3) return a.index - b.index;
    if (a.weight !== b.weight) return a.weight - b.weight;
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.size);
}
