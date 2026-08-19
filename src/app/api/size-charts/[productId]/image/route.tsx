/**
 * A product's size chart as an image.
 *
 * Public, because this is what WhatsApp fetches when the bot or an operator
 * sends a chart: Meta's servers pull the URL with no session cookie, so behind
 * auth this would deliver a picture of the login page. Nothing here is private
 * — the same measurements are already on the storefront product page — but an
 * archived product is not served, so a withdrawn line cannot be browsed by
 * walking the ids.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { renderSizeChartImage } from '@/lib/size-chart-image';
import { garmentTypeForProduct, resolveProductChart } from '@/lib/size-chart-store';
import { templateLabel } from '@/lib/size-chart-templates';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;
  const id = Number(productId);

  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse('Invalid product id', { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id, status: { notIn: ['archived', 'deleted'] } },
    select: { id: true, name: true, brand: true, style: true, sizes: true },
  });

  if (!product) {
    return new NextResponse('Product not found', { status: 404 });
  }

  const chart = await resolveProductChart(product);

  if (!chart) {
    return new NextResponse('No size chart for this product', { status: 404 });
  }

  const garmentType = garmentTypeForProduct(product.style);
  const typeLabel = garmentType ? templateLabel(garmentType) : 'Size Guide';

  return renderSizeChartImage({
    chart,
    brand: product.brand,
    subtitle: `${product.name} — ${typeLabel}`,
    headers: {
      // Short enough that a corrected measurement reaches customers the same
      // day, long enough that a chat burst does not re-render it every time.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
