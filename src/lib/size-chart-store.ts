/**
 * Reading and writing size charts.
 *
 * Three layers, most specific first:
 *
 *   1. the product's own chart, measured off the finished garment
 *   2. the brand's template for that garment type
 *   3. the built-in defaults, which are the numbers the printed charts carried
 *
 * A product created before charts became data has no row of its own, so it
 * falls through to its brand's template rendered for the sizes it is actually
 * made in. That is better than the PNG it used to get and needs no backfill.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { normalizeBrandKey } from '@/lib/brand-aliases';
import { getSizeChartCategoryFromStyle, type SizeChartCategory } from '@/lib/size-charts';
import {
  GARMENT_TYPES,
  buildChartForSizes,
  chartHasValues,
  defaultTemplateChart,
  parseStoredChart,
  serializeColumns,
  serializeRows,
  type SizeChartData,
} from '@/lib/size-chart-templates';

export interface ProductChartSubject {
  id: number;
  brand: string;
  style: string;
  sizes: string;
}

export function parseProductSizes(sizes: string): string[] {
  return sizes
    .split(',')
    .map((size) => size.trim())
    .filter(Boolean);
}

export function garmentTypeForProduct(style: string): SizeChartCategory | null {
  return getSizeChartCategoryFromStyle(style);
}

/** What a new product of this brand and type starts from. */
export async function resolveTemplate(
  brand: string | null | undefined,
  garmentType: SizeChartCategory,
): Promise<SizeChartData> {
  const brandKey = normalizeBrandKey(brand);
  if (!brandKey) return defaultTemplateChart(garmentType);

  const stored = await prisma.sizeChartTemplate.findUnique({
    where: { brandKey_garmentType: { brandKey, garmentType } },
  });

  if (!stored) return defaultTemplateChart(garmentType);
  return parseStoredChart(stored) ?? defaultTemplateChart(garmentType);
}

export interface BrandTemplateView {
  garmentType: SizeChartCategory;
  chart: SizeChartData;
  /** False when this is still the built-in default rather than the brand's own. */
  saved: boolean;
  updatedAt: Date | null;
}

/** Every garment type for one brand, saved or not, for the settings screen. */
export async function listBrandTemplates(brand: string): Promise<BrandTemplateView[]> {
  const brandKey = normalizeBrandKey(brand);
  const stored = brandKey
    ? await prisma.sizeChartTemplate.findMany({ where: { brandKey } })
    : [];

  return GARMENT_TYPES.map((garmentType) => {
    const row = stored.find((entry) => entry.garmentType === garmentType);
    const parsed = row ? parseStoredChart(row) : null;
    return {
      garmentType,
      chart: parsed ?? defaultTemplateChart(garmentType),
      saved: Boolean(parsed),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function saveTemplate(brand: string, chart: SizeChartData): Promise<void> {
  const brandKey = normalizeBrandKey(brand);
  if (!brandKey) throw new Error('A template needs a brand.');

  const data = {
    unit: chart.unit,
    columnsJson: serializeColumns(chart.columns),
    rowsJson: serializeRows(chart.rows),
    footerNote: chart.footerNote,
  };

  await prisma.sizeChartTemplate.upsert({
    where: { brandKey_garmentType: { brandKey, garmentType: chart.garmentType } },
    create: { brandKey, garmentType: chart.garmentType, ...data },
    update: data,
  });
}

export async function resetTemplate(brand: string, garmentType: SizeChartCategory): Promise<void> {
  const brandKey = normalizeBrandKey(brand);
  if (!brandKey) return;

  await prisma.sizeChartTemplate.deleteMany({ where: { brandKey, garmentType } });
}

/** The product's own stored chart, if it has one. */
export async function getStoredProductChart(productId: number): Promise<SizeChartData | null> {
  const stored = await prisma.productSizeChart.findUnique({ where: { productId } });
  return stored ? parseStoredChart(stored) : null;
}

/**
 * The chart to show for a product: its own if it has one, otherwise its brand's
 * template cut down to the sizes the product is actually made in.
 */
export async function resolveProductChart(
  product: ProductChartSubject,
): Promise<SizeChartData | null> {
  const stored = await getStoredProductChart(product.id);
  if (stored && chartHasValues(stored)) return stored;

  const garmentType = garmentTypeForProduct(product.style);
  if (!garmentType) return null;

  const template = await resolveTemplate(product.brand, garmentType);
  const sizes = parseProductSizes(product.sizes);
  const chart = sizes.length > 0 ? buildChartForSizes(template, sizes) : template;

  return chartHasValues(chart) ? chart : null;
}

type ChartWriter = PrismaClient | Prisma.TransactionClient;

/**
 * Written inside the product's own transaction, so a chart never survives a
 * failed save. A chart with nothing measured in it is deleted rather than
 * stored — an empty table on the storefront reads as a broken page.
 */
export async function writeProductChart(
  tx: ChartWriter,
  productId: number,
  chart: SizeChartData | null,
): Promise<void> {
  if (!chart || !chartHasValues(chart)) {
    await tx.productSizeChart.deleteMany({ where: { productId } });
    return;
  }

  const data = {
    garmentType: chart.garmentType,
    unit: chart.unit,
    columnsJson: serializeColumns(chart.columns),
    rowsJson: serializeRows(chart.rows),
    footerNote: chart.footerNote,
  };

  await tx.productSizeChart.upsert({
    where: { productId },
    create: { productId, ...data },
    update: data,
  });
}
