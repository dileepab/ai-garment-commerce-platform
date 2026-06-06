import prisma from '@/lib/prisma';
import { canAccessBrand, canScope, getBrandScopedWhere, getBrandScopeValues } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { getBrandForecasts } from '@/lib/demand-forecasting';
import type { Product } from '@/components/ProductComponents';
import ProductsPageClient from './ProductsPageClient';

export const dynamic = 'force-dynamic';

function uniqueBrands(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

export default async function ProductsPage() {
  const scope = await requirePagePermission('products:view');
  const brandScope = getBrandScopeValues(scope);
  const [
    products,
    settingsBrands,
    channelBrands,
    productBrands,
    postBrands,
    creativeBrands,
  ] = await Promise.all([
    prisma.product.findMany({
      where: getBrandScopedWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: {
        variants: {
          include: { inventory: true },
          orderBy: [{ size: 'asc' }, { color: 'asc' }],
        },
        colorImages: {
          orderBy: { color: 'asc' },
        },
      },
    }),
    prisma.merchantSettings.findMany({ select: { brand: true } }),
    prisma.brandChannelConfig.findMany({ select: { brand: true } }),
    prisma.product.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.socialPost.findMany({ distinct: ['brand'], select: { brand: true } }),
    prisma.generatedCreative.findMany({ distinct: ['brand'], select: { brand: true } }),
  ]);
  const availableBrands =
    scope.brandAccess === 'limited'
      ? scope.brands
      : uniqueBrands([
        ...settingsBrands.map((row) => row.brand),
        ...channelBrands.map((row) => row.brand),
        ...productBrands.map((row) => row.brand),
        ...postBrands.map((row) => row.brand),
        ...creativeBrands.map((row) => row.brand),
      ]).filter((brand) => canAccessBrand(scope, brand));

  // Fetch forecast data
  const forecasts = await getBrandForecasts(brandScope);

  // Map forecast data to products
  const productsWithForecast: Product[] = products.map(p => {
    const forecast = forecasts.find(f => f.productId === p.id);
    return {
      ...p,
      forecast,
    };
  });

  // Derive totals from variant inventory where available; fall back to product.stock
  const totalProducts = productsWithForecast.length;
  const lowStock = productsWithForecast.filter(p => p.status === 'low-stock').length;
  const criticalStock = productsWithForecast.filter(p => p.status === 'critical').length;
  const inventoryValue = productsWithForecast.reduce((acc, p) => {
    const variantTotal = p.variants && p.variants.length > 0
      ? p.variants.reduce((s, v) => s + (v.inventory?.availableQty ?? 0), 0)
      : p.stock;
    return acc + variantTotal * p.price;
  }, 0);

  return (
    <ProductsPageClient
      initialProducts={productsWithForecast}
      stats={{
        totalProducts,
        lowStock,
        criticalStock,
        inventoryValue
      }}
      canManageProducts={canScope(scope, 'products:write')}
      availableBrands={availableBrands}
    />
  );
}
