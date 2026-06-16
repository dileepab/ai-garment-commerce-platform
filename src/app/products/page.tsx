import prisma from '@/lib/prisma';
import { canScope } from '@/lib/access-control';
import { getSelectedBrandScopedWhere, getSelectedBrandScopeValues } from '@/lib/brand-context';
import { getAvailableBrands } from '@/lib/available-brands';
import { requirePagePermission } from '@/lib/authz';
import { getBrandForecasts } from '@/lib/demand-forecasting';
import type { Product } from '@/components/ProductComponents';
import ProductsPageClient from './ProductsPageClient';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const scope = await requirePagePermission('products:view');
  const { brand } = await searchParams;
  const brandScope = getSelectedBrandScopeValues(scope, brand);
  const [products, availableBrands] = await Promise.all([
    prisma.product.findMany({
      where: getSelectedBrandScopedWhere(scope, brand),
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
    getAvailableBrands(scope),
  ]);

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
