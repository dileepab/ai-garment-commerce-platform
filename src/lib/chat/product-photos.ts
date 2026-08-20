/**
 * The photographs that go with a product reply.
 *
 * Lifted out of catalog.ts so the ad opener can use the same resolver. A
 * customer who taps a picture in an ad and receives a paragraph of prose
 * leaves — four of them did in one day — and the fix was never new code, only
 * these helpers being reachable from the other reply path.
 */
import { creativeImagePath, CATALOG_TTL_SECONDS } from '@/lib/creative-image-token';
import { productItemCode } from '@/lib/product-item-code';
import { productDisplayImageUrls } from '@/lib/product-display-images';
import { getPublicAssetUrl } from '@/lib/runtime-config';

export type ProductImageSource = {
  imageUrl?: string | null;
  colorImages?: Array<{
    color: string;
    imageUrl: string;
  }>;
  creatives?: Array<{
    id: number;
    status?: string | null;
    publishedAt?: Date | string | null;
    viewAngle?: string | null;
    sourceImageUrl?: string | null;
    imageUrl?: string | null;
    createdAt?: Date | string | null;
  }>;
};

export function absoluteImageUrl(imageUrl?: string | null): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return getPublicAssetUrl(imageUrl) ?? undefined;
}

export function creativeImageUrl(creative: { id: number; imageUrl?: string | null }): string | undefined {
  // Blob-backed creatives are already on a public CDN. Older rows serve from
  // the app route, which Meta fetches without a session, so that link has to
  // carry its own signature.
  const blobUrl = creative.imageUrl?.trim();
  if (blobUrl) return blobUrl;
  return getPublicAssetUrl(creativeImagePath(creative.id, CATALOG_TTL_SECONDS)) ?? undefined;
}

export function productImageUrls(product: ProductImageSource, limit = 4, preferredColor?: string | null): string[] {
  // The shared resolver compares sourceImageUrl against the stored colour photo
  // URL, so it has to run before anything is made absolute; only the chosen
  // URLs get an origin prefixed.
  return productDisplayImageUrls(product, { limit, preferredColor, resolveCreativeUrl: creativeImageUrl })
    .map((url) => absoluteImageUrl(url))
    .filter((url): url is string => Boolean(url));
}

export function productPrimaryImageUrl(product: ProductImageSource): string | undefined {
  return productImageUrls(product, 1)[0];
}

/**
 * The photographs that belong with an answer, and a caption for each.
 *
 * A merged answer names every matching product, but the pictures used to come
 * from the selected one alone — so "red sundress and flower sundress pictures
 * please" sent two photographs of the grey dress. When the answer covers
 * several products they get one photograph each: enough to tell them apart
 * without turning a question into six downloads on a phone.
 */
export type AnsweredProduct = ProductImageSource & {
  name: string;
  style?: string | null;
  id?: number;
};

/**
 * Four is the same ceiling a single product's gallery uses. Without it the
 * catalogue listing below would answer "dress pictures" with a photograph of
 * every dress in the brand — the flood this reply path was trimmed back from
 * in the first place.
 */
export const MAX_ANSWER_PHOTOS = 4;

export function photosForAnsweredProducts(
  answeredProducts: AnsweredProduct[],
  preferredColor?: string | null
): { urls: string[]; captions: string[] } {
  if (answeredProducts.length <= 1) {
    const only = answeredProducts[0];
    if (!only) return { urls: [], captions: [] };
    const urls = productImageUrls(only, 4, preferredColor);
    // One product, several angles of it — the reply text already names it, so
    // repeating the name on every photograph would only be noise.
    return { urls, captions: urls.map(() => '') };
  }

  const urls: string[] = [];
  const captions: string[] = [];

  for (const product of answeredProducts) {
    if (urls.length >= MAX_ANSWER_PHOTOS) break;
    const [url] = productImageUrls(product, 1, preferredColor);
    if (!url) continue;
    urls.push(url);
    const itemCode = productItemCode(product as Parameters<typeof productItemCode>[0]);
    captions.push(itemCode ? `${product.name} (${itemCode})` : product.name);
  }

  return { urls, captions };
}
