import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
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

  // Derive totals from variant inventory where available; fall back to product.stock
  const totalProducts = products.length;
  const lowStock = products.filter(p => p.status === 'low-stock').length;
  const criticalStock = products.filter(p => p.status === 'critical').length;
  const inventoryValue = products.reduce((acc, p) => {
    const variantTotal = p.variants.length > 0
      ? p.variants.reduce((s, v) => s + (v.inventory?.availableQty ?? 0), 0)
      : p.stock;
    return acc + variantTotal * p.price;
  }, 0);

  return (
    <ProductsPageClient
      initialProducts={products}
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
