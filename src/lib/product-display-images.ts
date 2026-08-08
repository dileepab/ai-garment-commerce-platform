/**
 * Which image a customer sees for a product.
 *
 * The source photos are phone shots on a dummy against whatever background was
 * to hand, so they are reference material, not shopfront material. Once a post
 * using a creative publishes, that creative is adopted as the product's
 * customer-facing image everywhere: catalog feed, storefront, chat, WhatsApp.
 *
 * Adoption is a pointer, never a replacement. The original photo stays exactly
 * where it is, because it is the grounding reference the generator locks onto
 * for each angle — regenerating from an AI image instead would compound
 * artifacts every round — and because creatives are paired back to a colourway
 * by matching sourceImageUrl against the original photo's URL.
 *
 * Order of preference:
 *   1. published creatives  (a post using them went live)
 *   2. saved creatives      (kept, but never posted)
 *   3. the colour photo, then the product photo
 * Within each tier: the requested colourway first, then front/side/back/detail,
 * then most recent.
 *
 * Admin screens deliberately keep showing the raw photos, so the real garment
 * stays visible to whoever is merchandising it.
 */

const ANGLE_PRIORITY: Record<string, number> = {
  front: 0,
  side: 1,
  back: 2,
  closeup: 3,
};

export interface DisplayCreative {
  id: number;
  status?: string | null;
  publishedAt?: Date | string | null;
  viewAngle?: string | null;
  sourceImageUrl?: string | null;
  imageUrl?: string | null;
  createdAt?: Date | string | null;
}

export interface DisplayColorImage {
  color?: string | null;
  imageUrl: string;
}

export interface DisplayImageProduct {
  imageUrl?: string | null;
  colorImages?: DisplayColorImage[];
  creatives?: DisplayCreative[];
}

function timeValue(value?: Date | string | null): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function isSaved(creative: DisplayCreative): boolean {
  const status = creative.status?.trim().toLowerCase();
  return !status || status === 'saved';
}

export function isPublishedCreative(creative: DisplayCreative): boolean {
  return Boolean(creative.publishedAt);
}

/** The stored photo for a colourway, used as the fallback when no creative fits. */
export function colorPhotoUrl(
  product: DisplayImageProduct,
  preferredColor?: string | null
): string | undefined {
  const colorImages = product.colorImages ?? [];
  if (colorImages.length === 0) return undefined;

  const preferred = preferredColor?.trim().toLowerCase();
  if (!preferred) return colorImages[0]?.imageUrl;

  return colorImages.find((image) => image.color?.trim().toLowerCase() === preferred)?.imageUrl;
}

/**
 * Every stored photo of a colourway.
 *
 * A colour has one photo per angle — front, side, back, detail — and a creative
 * records whichever one it was generated from. Pairing against a single photo
 * silently dropped creatives grounded in the colour's other angles, so a
 * product with real creatives fell back to the phone photo depending on which
 * angle happened to sort first.
 */
function colorPhotoUrls(
  product: DisplayImageProduct,
  preferredColor?: string | null
): Set<string> {
  const preferred = preferredColor?.trim().toLowerCase();
  if (!preferred) return new Set();

  return new Set(
    (product.colorImages ?? [])
      .filter((image) => image.color?.trim().toLowerCase() === preferred)
      .map((image) => image.imageUrl)
      .filter(Boolean)
  );
}

/**
 * Creatives that may stand in for the product photo, best first. When a
 * colourway is requested, creatives generated from another colour's photo are
 * dropped rather than reordered — showing the wrong colour is worse than
 * showing the original photo.
 */
export function rankDisplayCreatives(
  product: DisplayImageProduct,
  preferredColor?: string | null
): DisplayCreative[] {
  const candidates = (product.creatives ?? []).filter(isSaved);
  if (candidates.length === 0) return [];

  // Match against every photo of the colourway, not just one of its angles.
  const colorUrls = colorPhotoUrls(product, preferredColor);
  const scoped = colorUrls.size > 0
    ? candidates.filter(
        (creative) => creative.sourceImageUrl && colorUrls.has(creative.sourceImageUrl)
      )
    : candidates;

  return [...scoped].sort((left, right) => {
    const publishedDiff = Number(isPublishedCreative(right)) - Number(isPublishedCreative(left));
    if (publishedDiff !== 0) return publishedDiff;

    const angleLeft = ANGLE_PRIORITY[left.viewAngle ?? ''] ?? 9;
    const angleRight = ANGLE_PRIORITY[right.viewAngle ?? ''] ?? 9;
    if (angleLeft !== angleRight) return angleLeft - angleRight;

    const publishedAtDiff = timeValue(right.publishedAt) - timeValue(left.publishedAt);
    if (publishedAtDiff !== 0) return publishedAtDiff;

    return timeValue(right.createdAt) - timeValue(left.createdAt);
  });
}

/**
 * Display images best-first, as URLs.
 *
 * Each surface resolves a creative to a URL differently — a blob URL is already
 * public, while older rows need a signed app-route link whose origin only the
 * caller knows — so the mapping is passed in. Returning null from it skips that
 * creative.
 */
export function productDisplayImageUrls(
  product: DisplayImageProduct,
  options: {
    resolveCreativeUrl: (creative: DisplayCreative) => string | null | undefined;
    preferredColor?: string | null;
    limit?: number;
  }
): string[] {
  const { resolveCreativeUrl, preferredColor, limit = 4 } = options;

  const creativeUrls = rankDisplayCreatives(product, preferredColor)
    .map(resolveCreativeUrl)
    .filter((url): url is string => Boolean(url && url.trim()))
    .slice(0, limit);

  if (creativeUrls.length > 0) return creativeUrls;

  const fallback = colorPhotoUrl(product, preferredColor) ?? product.imageUrl ?? undefined;
  return fallback ? [fallback] : [];
}
