import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export const revalidate = 60;

const BRAND_SLUG_TO_PLATFORM: Record<string, string> = {
  happybuy: 'Happyby',
  happyby: 'Happyby',
  cleopatra: 'Cleopatra',
  modabella: 'Modabella',
};

const PLATFORM_TO_BRAND_SLUG: Record<string, string> = {
  Happyby: 'happybuy',
  Cleopatra: 'cleopatra',
  Modabella: 'modabella',
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
    creatives: {
      select: {
        id: true;
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
    colorImages: Array<{ imageUrl: string }>;
    creatives: Array<{ id: number; sourceImageUrl: string | null }>;
  },
  origin: string
): string | null {
  const directImage =
    product.imageUrl ||
    product.colorImages[0]?.imageUrl ||
    product.creatives[0]?.sourceImageUrl;

  if (directImage) {
    return toAbsoluteUrl(directImage, origin);
  }

  if (product.creatives[0]?.id) {
    return `${origin}/api/content/creatives/${product.creatives[0].id}/image`;
  }

  return null;
}

function mapProductForStorefront(
  product: StorefrontProductRecord,
  origin: string
) {
  const sizes = parseList(product.sizes);
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
  const image = publicProductImage(product, origin);
  const slug = `${slugify(product.name)}-${product.id}`;
  const swatchA = colorHex(colors[0], '#D9A899');
  const swatchB = colorHex(colors[1], '#9DB09A');

  return {
    id: product.id,
    sku: product.sku,
    slug,
    brand: PLATFORM_TO_BRAND_SLUG[product.brand] || slugify(product.brand),
    platformBrand: product.brand,
    title: product.name,
    price: formatPrice(product.price),
    priceNumber: product.price,
    tag: stockQty <= 0 ? { label: 'Sold out' } : undefined,
    swatchA,
    swatchB,
    desc: describeProduct(product),
    stock: stockQty > 0 ? `In stock - ${stockQty} available` : 'Sold out',
    stockQty,
    style: product.style,
    fabric: product.fabric,
    sizes,
    colors,
    image,
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

    const products = await prisma.product.findMany({
      where: {
        brand,
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
        creatives: {
          where: { status: 'saved' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            sourceImageUrl: true,
            viewAngle: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const response = NextResponse.json({
      success: true,
      data: {
        brand: PLATFORM_TO_BRAND_SLUG[brand],
        platformBrand: brand,
        products: products.map((product) => mapProductForStorefront(product, origin)),
      },
    });
    response.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return response;
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
