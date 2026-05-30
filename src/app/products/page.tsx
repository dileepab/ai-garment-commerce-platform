import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere, getBrandScopeValues } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { getBrandForecasts } from '@/lib/demand-forecasting';
import ProductsPageClient from './ProductsPageClient';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const scope = await requirePagePermission('products:view');
  const products = await prisma.product.findMany({
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
  });

  // Fetch forecast data
  const forecasts = await getBrandForecasts(getBrandScopeValues(scope));

  // Map forecast data to products
  const productsWithForecast = products.map(p => {
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
    const variantTotal = p.variants.length > 0
      ? p.variants.reduce((s, v) => s + (v.inventory?.availableQty ?? 0), 0)
      : p.stock;
    return acc + variantTotal * p.price;
  }, 0);

  return (
    <ProductsPageClient
      initialProducts={productsWithForecast as any}
      stats={{
        totalProducts,
        lowStock,
        criticalStock,
        inventoryValue
      }}
      canManageProducts={canScope(scope, 'products:write')}
    />
  );
}

