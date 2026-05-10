import type { Prisma, PrismaClient } from '@prisma/client';

type ProductSkuClient = PrismaClient | Prisma.TransactionClient;

export function productSkuPrefix(brand: string): string {
  const prefix = brand.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
  return prefix || 'SKU';
}

export function formatProductSku(brand: string, sequence: number): string {
  return `${productSkuPrefix(brand)}-${String(sequence).padStart(4, '0')}`;
}

export function displayProductSku(product: { id: number; brand: string; sku?: string | null }): string {
  return product.sku?.trim() || formatProductSku(product.brand, product.id);
}

export async function nextProductSku(tx: ProductSkuClient, brand: string): Promise<string> {
  const normalizedBrand = brand.trim();
  const prefix = productSkuPrefix(normalizedBrand);
  const existing = await tx.product.findMany({
    where: { brand: normalizedBrand },
    select: { sku: true },
  });

  let max = 0;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
  for (const row of existing) {
    const match = row.sku?.trim().match(pattern);
    if (!match) continue;
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric)) max = Math.max(max, numeric);
  }

  return formatProductSku(normalizedBrand, max + 1);
}
