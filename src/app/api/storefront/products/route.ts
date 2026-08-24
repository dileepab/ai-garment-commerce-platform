import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getMerchantSettings } from '@/lib/runtime-config';
import { getErrorMessage } from '@/lib/error-message';
import { productDisplayImageUrls, type DisplayCreative } from '@/lib/product-display-images';
import { sortSizes } from '@/lib/size-order';
import {
  getSizeChartCategoryFromStyle,
  getSizeChartDefinition,
  getSizeChartImagePath,
  type SizeChartCategory,
} from '@/lib/size-charts';
import { listBrandTemplates } from '@/lib/size-chart-store';
import {
  buildChartForSizes,
  chartHasValues,
  parseStoredChart,
  type SizeChartData,
} from '@/lib/size-chart-templates';

export const revalidate = 60;

const BRAND_SLUG_TO_PLATFORM: Record<string, string> = {
  happybuy: 'Happybuy',
  happyby: 'Happybuy',
  cleopatra: 'Cleopatra',
  modabella: 'Modabella',
};

const PLATFORM_TO_BRAND_SLUG: Record<string, string> = {
  Happybuy: 'happybuy',
  Happyby: 'happybuy',
  Cleopatra: 'cleopatra',
  Modabella: 'modabella',
};

const PLATFORM_BRAND_ALIASES: Record<string, string[]> = {
  Happybuy: ['Happybuy', 'Happyby', 'Happy Buy', 'happybuy', 'happyby'],
  Cleopatra: ['Cleopatra', 'cleopatra'],
  Modabella: ['Modabella', 'modabella'],
};

const COLOR_HEX: Record<string, string> = {
  beige: '#D9A899',
  black: '#1F1A14',
  blue: '#2E6F8E',
  champagne: '#C9B89D',
  charcoal: '#3A332C',
  coral: '#D94B26',
  cream: '#ECE5D8',
  emerald: '#2E3B36',
  navy: '#2A2118',
  orange: '#D94B26',
  pink: '#D9A899',
  red: '#6B3A2E',
  sage: '#9DB09A',
  stone: '#C9B89D',
  white: '#F2E9D6',
  wine: '#6B3A2E',
  yellow: '#F4C95D',
};

type StorefrontProductRecord = Prisma.ProductGetPayload<{
  include: {
    inventory: true;
    variants: {
      include: { inventory: true };
    };
    colorImages: true;
    sizeChart: true;
    creatives: {
      select: {
        id: true;
        status: true;
        publishedAt: true;
        imageUrl: true;
        sourceImageUrl: true;
        viewAngle: true;
        createdAt: true;
      };
    };
  };
}>;

function parseList(value?: string | null): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatColorName(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeBrand(value?: string | null): string | null {
  const compact = (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact ? BRAND_SLUG_TO_PLATFORM[compact] || null : null;
}

function storefrontBrandSlug(value: string): string {
  const canonical = normalizeBrand(value);
  return canonical ? PLATFORM_TO_BRAND_SLUG[canonical] : slugify(value);
}

function toAbsoluteUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) {
    return null;
  }

  if (/^(https?:|data:)/i.test(value)) {
    return value;
  }

  return value.startsWith('/') ? `${origin}${value}` : value;
}

function colorHex(color: string | undefined, fallback: string): string {
  if (!color) {
    return fallback;
  }

  return COLOR_HEX[color.trim().toLowerCase()] || fallback;
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-LK', { maximumFractionDigits: 0 });
}

function describeProduct(product: {
  fabric: string | null;
  fitType: string | null;
  sleeveType: string | null;
  neckline: string | null;
  patternDetails: string | null;
}): string {
  const details = [
    product.fabric ? `${product.fabric}.` : null,
    product.fitType ? `${product.fitType} fit.` : null,
    product.sleeveType ? `${product.sleeveType} sleeves.` : null,
    product.neckline ? `${product.neckline} neckline.` : null,
    product.patternDetails ? product.patternDetails : null,
  ].filter(Boolean);

  return details.length > 0 ? details.join(' ') : 'Tap through for sizes, colors, and availability.';
}

function publicProductImage(
  product: {
    imageUrl: string | null;
    colorImages: Array<{ color?: string | null; imageUrl: string }>;
    creatives: Array<DisplayCreative & { sourceImageUrl: string | null }>;
  },
  origin: string,
  preferredColor?: string | null
): string | null {
  // Creatives first — the stored photos are dummy shots taken on a phone, so
  // they are reference material rather than something to show a shopper.
  const images = productDisplayImageUrls(product, {
    limit: 1,
    preferredColor,
    resolveCreativeUrl: (creative) =>
      creative.imageUrl?.trim() || `${origin}/api/content/creatives/${creative.id}/image`,
  });

  const chosen = images[0];
  return chosen ? toAbsoluteUrl(chosen, origin) : null;
}

/**
 * Every image worth showing, best first.
 *
 * The storefront card swaps to the second on hover and the product page builds
 * its thumbnail strip from the rest. Both were falling back to a single photo
 * because this route only ever sent one, even though the resolver ranks four.
 */
function publicProductImages(
  product: {
    imageUrl: string | null;
    colorImages: Array<{ color?: string | null; imageUrl: string }>;
    creatives: Array<DisplayCreative & { sourceImageUrl: string | null }>;
  },
  origin: string,
  preferredColor?: string | null
): string[] {
  const images = productDisplayImageUrls(product, {
    limit: 4,
    preferredColor,
    resolveCreativeUrl: (creative) =>
      creative.imageUrl?.trim() || `${origin}/api/content/creatives/${creative.id}/image`,
  });

  const seen = new Set<string>();
  const absolute: string[] = [];
  for (const image of images) {
    const url = toAbsoluteUrl(image, origin);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    absolute.push(url);
  }
  return absolute;
}

/**
 * The chart to publish for one product: its own measurements when it has them,
 * otherwise its brand's template cut down to the sizes it is actually made in.
 * Products created before charts became data have no row of their own, so the
 * template path is the normal one for them rather than a fallback.
 */
function storefrontChart(
  product: StorefrontProductRecord,
  sizes: string[],
  templates: Map<SizeChartCategory, SizeChartData>
): SizeChartData | null {
  const stored = product.sizeChart ? parseStoredChart(product.sizeChart) : null;
  if (stored && chartHasValues(stored)) return stored;

  const category = getSizeChartCategoryFromStyle(product.style);
  const template = category ? templates.get(category) : null;
  if (!template) return null;

  const chart = sizes.length > 0 ? buildChartForSizes(template, sizes) : template;
  return chartHasValues(chart) ? chart : null;
}

function mapProductForStorefront(
  product: StorefrontProductRecord,
  origin: string,
  templates: Map<SizeChartCategory, SizeChartData>
) {
  const sizes = sortSizes(parseList(product.sizes));
  const colors = parseList(product.colors).map(formatColorName);
  const variants = product.variants
    .filter((variant) => variant.status !== 'archived')
    .map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      sku: variant.sku,
      price: variant.priceOverride ?? product.price,
      availableQty: variant.inventory?.availableQty ?? 0,
      reservedQty: variant.inventory?.reservedQty ?? 0,
      inProductionQty: variant.inventory?.inProductionQty ?? 0,
      status: variant.status,
    }));
  const variantStock = variants.reduce((sum, variant) => sum + variant.availableQty, 0);
  const stockQty = variants.length > 0
    ? variantStock
    : product.inventory?.availableQty ?? product.stock;
  const images = publicProductImages(product, origin);
  const image = images[0] ?? publicProductImage(product, origin);
  const sizeChartCategory = getSizeChartCategoryFromStyle(product.style);
  const sizeChartImagePath = sizeChartCategory
    ? getSizeChartImagePath(sizeChartCategory, product.brand)
    : null;
  const chart = storefrontChart(product, sizes, templates);
  const slug = `${slugify(product.name)}-${product.id}`;
  const swatchA = colorHex(colors[0], '#D9A899');
  const swatchB = colorHex(colors[1], '#9DB09A');

  return {
    id: product.id,
    sku: product.sku,
    slug,
    brand: storefrontBrandSlug(product.brand),
    platformBrand: product.brand,
    title: product.name,
    price: formatPrice(product.price),
    priceNumber: product.price,
    tag: stockQty <= 0 ? { label: 'Sold out' } : undefined,
    swatchA,
    swatchB,
    desc: describeProduct(product),
    // Just the state, not the number. A live count invites "only 3 left?" and
    // goes stale between the page render and the order.
    stock: stockQty > 0 ? 'In stock' : 'Sold out',
    stockQty,
    style: product.style,
    fabric: product.fabric,
    sizes,
    colors,
    image,
    images,
    // Measurements, not a picture. The image URL stays on the payload — it is
    // what every storefront reads today — but it now renders this product's own
    // chart rather than one drawing shared by everything the brand sells.
    sizeChart: chart
      ? {
          // The chart's own type, not the style's. A product restyled after its
          // chart was saved would otherwise be labelled "Dresses" over a table
          // of inseams.
          category: chart.garmentType,
          label: getSizeChartDefinition(chart.garmentType).label,
          unit: chart.unit,
          imageUrl: toAbsoluteUrl(`/api/size-charts/${product.id}/image`, origin),
          columns: chart.columns,
          rows: chart.rows,
          footerNote: chart.footerNote,
          // The hand-drawn brand chart, while storefronts move across.
          legacyImageUrl: sizeChartImagePath ? toAbsoluteUrl(sizeChartImagePath, origin) : null,
        }
      : null,
    colorImages: product.colorImages.map((entry) => ({
      color: entry.color,
      imageUrl: toAbsoluteUrl(entry.imageUrl, origin),
    })),
    variants,
    garmentDetails: {
      garmentLengthCm: product.garmentLengthCm,
      sleeveLengthCm: product.sleeveLengthCm,
      sleeveType: product.sleeveType,
      fitType: product.fitType,
      neckline: product.neckline,
      closureDetails: product.closureDetails,
      hasSideSlit: product.hasSideSlit,
      sideSlitHeightCm: product.sideSlitHeightCm,
      hemDetails: product.hemDetails,
      sleeveHemDetails: product.sleeveHemDetails,
      patternDetails: product.patternDetails,
      referenceModelHeightCm: product.referenceModelHeightCm,
      wornLengthNote: product.wornLengthNote,
    },
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const brand = normalizeBrand(searchParams.get('brand'));

    if (!brand) {
      return NextResponse.json(
        { success: false, error: 'Valid brand is required.' },
        { status: 400 }
      );
    }

    const { delivery } = await getMerchantSettings(brand);

    const products = await prisma.product.findMany({
      where: {
        brand: {
          in: PLATFORM_BRAND_ALIASES[brand] ?? [brand],
          mode: 'insensitive',
        },
        status: { notIn: ['archived', 'deleted'] },
      },
      include: {
        inventory: true,
        variants: {
          include: { inventory: true },
          orderBy: [{ size: 'asc' }, { color: 'asc' }],
        },
        colorImages: {
          orderBy: { color: 'asc' },
        },
        sizeChart: true,
        creatives: {
          where: { status: 'saved' },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            status: true,
            publishedAt: true,
            imageUrl: true,
            sourceImageUrl: true,
            viewAngle: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    // One read for the whole brand rather than one per product.
    const templates = new Map(
      (await listBrandTemplates(brand)).map((entry) => [entry.garmentType, entry.chart] as const)
    );

    const response = NextResponse.json({
      success: true,
      data: {
        brand: PLATFORM_TO_BRAND_SLUG[brand],
        platformBrand: brand,
        // The storefront cart quotes delivery before checkout, and the order
        // is built from the same rule, so it has to read it rather than keep
        // its own copy that can drift.
        delivery: {
          flatFee: delivery.colomboCharge,
          freeOver: delivery.freeDeliveryOver,
          colomboEstimate: delivery.colomboEstimate,
          outsideColomboEstimate: delivery.outsideColomboEstimate,
        },
        products: products.map((product) => mapProductForStorefront(product, origin, templates)),
      },
    });
    response.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return response;
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
