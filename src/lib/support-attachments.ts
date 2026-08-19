import prisma from '@/lib/prisma';
import { brandsMatch } from '@/lib/brand-aliases';
import {
  getDefaultSizeChartCategories,
  getSizeChartCategoryFromStyle,
  getSizeChartDefinition,
  getSizeChartImagePath,
  type SizeChartCategory,
} from '@/lib/size-charts';
import { productDisplayImageUrls } from '@/lib/product-display-images';
import { displayProductSku } from '@/lib/product-sku';

/**
 * What an operator can attach to a support reply.
 *
 * The bot promises a size chart and then sends nothing when no image resolves,
 * which is how a customer ended up answering "🤔🤔". Until that path is
 * trustworthy an operator needs to be able to send the chart themselves, and
 * sending the product photo is the same one-click problem.
 *
 * Options are resolved here rather than passed in from the browser: the action
 * takes an identifier and looks the URL up again, so a support login cannot be
 * used to push an arbitrary URL through the brand's WhatsApp number.
 */

export interface SupportAttachmentOption {
  id: string;
  label: string;
  imageUrl: string;
}

export interface SupportAttachmentCatalog {
  sizeCharts: SupportAttachmentOption[];
  products: SupportAttachmentOption[];
}

export function sizeChartAttachmentId(category: SizeChartCategory): string {
  return `chart:${category}`;
}

export function productSizeChartAttachmentId(productId: number): string {
  return `chart:product:${productId}`;
}

export function productAttachmentId(productId: number, index: number): string {
  return `product:${productId}:${index}`;
}

function absolute(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Every chart that has an image for this brand, plus every chart a product in
 * the brand's catalogue actually needs — a skort category is useless to
 * Cleopatra and confusing in the list.
 */
async function sizeChartOptions(
  brand: string | null,
  origin: string
): Promise<SupportAttachmentOption[]> {
  const products = await prisma.product.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      brand: true,
      style: true,
      sizeChart: { select: { id: true } },
    },
  });

  const scoped = brand
    ? products.filter((product) => brandsMatch(product.brand, brand))
    : products;

  const categories = new Set<SizeChartCategory>(getDefaultSizeChartCategories());
  for (const product of scoped) {
    const category = getSizeChartCategoryFromStyle(product.style);
    if (category) categories.add(category);
  }

  const options: SupportAttachmentOption[] = [];
  for (const category of categories) {
    const imagePath = getSizeChartImagePath(category, brand);
    // A category with no drawn chart is left out rather than offered and then
    // failing at send time.
    if (!imagePath) continue;
    options.push({
      id: sizeChartAttachmentId(category),
      label: getSizeChartDefinition(category).label,
      imageUrl: absolute(imagePath, origin),
    });
  }

  options.sort((a, b) => a.label.localeCompare(b.label));

  // Products that carry their own measurements get their own entry, listed
  // after the general charts. Only those — a product measuring exactly like its
  // type is already covered above, and one entry per product would bury the
  // list an operator is scanning mid-conversation.
  const productCharts = scoped
    .filter((product) => product.sizeChart)
    .map((product) => ({
      id: productSizeChartAttachmentId(product.id),
      label: `${product.name} · size chart`,
      imageUrl: absolute(`/api/size-charts/${product.id}/image`, origin),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...options, ...productCharts];
}

async function productOptions(
  brand: string | null,
  origin: string
): Promise<SupportAttachmentOption[]> {
  const products = await prisma.product.findMany({
    where: { status: 'active' },
    include: {
      colorImages: { orderBy: { color: 'asc' } },
      creatives: {
        where: { status: 'saved' },
        select: {
          id: true,
          status: true,
          publishedAt: true,
          viewAngle: true,
          sourceImageUrl: true,
          imageUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const scoped = brand
    ? products.filter((product) => brandsMatch(product.brand, brand))
    : products;

  const options: SupportAttachmentOption[] = [];
  for (const product of scoped) {
    const urls = productDisplayImageUrls(product, {
      limit: 4,
      resolveCreativeUrl: (creative) =>
        creative.imageUrl?.trim() || `${origin}/api/content/creatives/${creative.id}/image`,
    });

    const code = displayProductSku(product);
    urls.forEach((url, index) => {
      options.push({
        id: productAttachmentId(product.id, index),
        label: urls.length > 1
          ? `${product.name} (${code}) · ${index + 1}`
          : `${product.name} (${code})`,
        imageUrl: absolute(url, origin),
      });
    });
  }

  return options;
}

export async function loadSupportAttachmentCatalog(
  brand: string | null,
  origin: string
): Promise<SupportAttachmentCatalog> {
  const [sizeCharts, products] = await Promise.all([
    sizeChartOptions(brand, origin),
    productOptions(brand, origin),
  ]);

  return { sizeCharts, products };
}

/** Looks an option's URL up again from its identifier. Never trusts a URL. */
export async function resolveSupportAttachment(
  attachmentId: string,
  brand: string | null,
  origin: string
): Promise<SupportAttachmentOption | null> {
  const catalog = await loadSupportAttachmentCatalog(brand, origin);
  return (
    catalog.sizeCharts.find((option) => option.id === attachmentId) ||
    catalog.products.find((option) => option.id === attachmentId) ||
    null
  );
}
