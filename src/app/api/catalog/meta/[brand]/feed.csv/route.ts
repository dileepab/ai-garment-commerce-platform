import prisma from '@/lib/prisma';
import {
  buildMetaCatalogCsv,
  getMetaCatalogBrand,
  mapProductToMetaCatalogRows,
} from '@/lib/meta-catalog-feed';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ brand: string }> },
) {
  const { brand: brandParam } = await params;
  const brand = getMetaCatalogBrand(brandParam);

  if (!brand) {
    return new Response('Catalog brand not found.', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  try {
    const products = await prisma.product.findMany({
      where: {
        brand: {
          in: brand.databaseNames,
          mode: 'insensitive',
        },
        status: {
          notIn: ['archived', 'deleted'],
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        style: true,
        price: true,
        fabric: true,
        sizes: true,
        colors: true,
        stock: true,
        status: true,
        imageUrl: true,
        fitType: true,
        inventory: {
          select: { availableQty: true },
        },
        variants: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            priceOverride: true,
            status: true,
            inventory: {
              select: { availableQty: true },
            },
          },
          orderBy: { id: 'asc' },
        },
        colorImages: {
          select: { color: true, imageUrl: true },
          orderBy: { id: 'asc' },
        },
        creatives: {
          where: { status: 'saved' },
          select: { id: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'asc' },
    });

    const requestOrigin = new URL(request.url).origin;
    const publicAssetOrigin = process.env.APP_BASE_URL?.trim() || requestOrigin;
    const rows = products.flatMap((product) =>
      mapProductToMetaCatalogRows(product, brand, publicAssetOrigin),
    );
    const csv = buildMetaCatalogCsv(rows);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `inline; filename="${brand.key}-meta-catalog.csv"`,
        'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    console.error(`[Meta Catalog Feed] Failed to build ${brand.platformName} feed.`, error);
    return new Response('Catalog feed is temporarily unavailable.', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
