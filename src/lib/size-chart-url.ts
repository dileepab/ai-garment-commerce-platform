/**
 * The public URL of a product's rendered size chart.
 *
 * Absolute rather than a bare path, because the Messenger and WhatsApp senders
 * treat a relative path as a file under public/ and try to read it off disk
 * first. This one is rendered on request, so it has no file — handing over the
 * full URL takes the send straight down the "fetch this URL" branch.
 *
 * Null when no public base URL is configured. Callers fall back to the brand's
 * drawn chart in that case: an outdated chart beats no answer.
 */

import { getPublicAssetUrl } from '@/lib/runtime-config';

export function productSizeChartUrl(productId?: number | null): string | null {
  if (!productId || !Number.isInteger(productId) || productId <= 0) return null;
  return getPublicAssetUrl(`/api/size-charts/${productId}/image`);
}
