'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  accessDeniedResult,
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';

export interface VariantInput {
  id?: number;
  size: string;
  color: string;
  availableQty: number;
  reorderThreshold?: number | null;
  criticalThreshold?: number | null;
  sku?: string;
  priceOverride?: number | null;
  status?: string;
}

export interface ProductFormInput {
  name: string;
  brand: string;
  style: string;
  fabric?: string;
  price: number;
  status: string;
  imageUrl?: string | null;
  variants: VariantInput[];
}

export interface ProductActionResult {
  success: boolean;
  error?: string;
  productId?: number;
}

function deriveProductSizesColors(variants: VariantInput[]): { sizes: string; colors: string } {
  const sizes = [...new Set(variants.map((v) => v.size.trim()).filter(Boolean))].join(',');
  const colors = [...new Set(variants.map((v) => v.color.trim()).filter(Boolean))].join(',');
  return { sizes, colors };
}

function resolveVariantStatus(v: VariantInput): string {
  if (v.status && v.status !== '') return v.status;
  return (v.availableQty || 0) > 0 ? 'active' : 'out-of-stock';
}

function validateVariants(variants: VariantInput[]): string | null {
  if (variants.length === 0) return 'At least one variant is required.';
  const combos = new Set<string>();
  for (const v of variants) {
    if (!v.size.trim() || !v.color.trim()) return 'All variants must have a size and color.';
    const key = `${v.size.trim().toLowerCase()}:${v.color.trim().toLowerCase()}`;
    if (combos.has(key)) return `Duplicate variant: ${v.size} / ${v.color}.`;
    combos.add(key);
  }
  return null;
}

export async function createProduct(input: ProductFormInput): Promise<ProductActionResult> {
  try {
    const scope = await requireActionPermission('products:write');
    assertBrandAccess(scope, input.brand);

    const variantError = validateVariants(input.variants);
    if (variantError) return { success: false, error: variantError };

    const { sizes, colors } = deriveProductSizesColors(input.variants);
    const totalStock = input.variants.reduce((sum, v) => sum + (v.availableQty || 0), 0);

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: input.name.trim(),
          brand: input.brand.trim(),
          style: input.style.trim(),
          fabric: input.fabric?.trim() || null,
          price: Number(input.price),
          status: input.status || 'active',
          imageUrl: input.imageUrl?.trim() || null,
          sizes,
          colors,
          stock: totalStock,
          inventory: { create: { availableQty: totalStock } },
        },
      });

      for (const v of input.variants) {
        await tx.productVariant.create({
          data: {
            productId: created.id,
            size: v.size.trim(),
            color: v.color.trim(),
            sku: v.sku?.trim() || null,
            priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
            status: resolveVariantStatus(v),
            inventory: {
              create: {
                availableQty: v.availableQty || 0,
                reorderThreshold: v.reorderThreshold ? Number(v.reorderThreshold) : null,
                criticalThreshold: v.criticalThreshold ? Number(v.criticalThreshold) : null,
              },
            },
          },
        });
      }

      return created;
    });

    revalidatePath('/products');
    return { success: true, productId: product.id };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to create product. Please retry.' };
  }
}

export async function updateProduct(
  productId: number,
  input: ProductFormInput,
): Promise<ProductActionResult> {
  try {
    const scope = await requireActionPermission('products:write');
    assertBrandAccess(scope, input.brand);

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { brand: true, variants: { select: { id: true } } },
    });

    if (!existing) return { success: false, error: 'Product not found.' };
    assertBrandAccess(scope, existing.brand);

    // Only validate uniqueness among new (no-id) variants — existing ones are already stored uniquely
    const newVariants = input.variants.filter((v) => !v.id);
    const newVariantError = validateVariants(newVariants.length > 0 ? newVariants : input.variants);
    if (newVariantError && input.variants.length === 0) return { success: false, error: newVariantError };
    if (input.variants.length === 0) return { success: false, error: 'At least one variant is required.' };

    const { sizes, colors } = deriveProductSizesColors(input.variants);
    const totalStock = input.variants.reduce((sum, v) => sum + (v.availableQty || 0), 0);

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          name: input.name.trim(),
          brand: input.brand.trim(),
          style: input.style.trim(),
          fabric: input.fabric?.trim() || null,
          price: Number(input.price),
          status: input.status || 'active',
          imageUrl: input.imageUrl?.trim() || null,
          sizes,
          colors,
          stock: totalStock,
        },
      });

      // Keep product-level inventory in sync as derived total
      await tx.inventory.upsert({
        where: { productId },
        create: { productId, availableQty: totalStock },
        update: { availableQty: totalStock },
      });

      const submittedIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));

      for (const v of input.variants) {
        if (v.id) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              size: v.size.trim(),
              color: v.color.trim(),
              sku: v.sku?.trim() || null,
              priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
              status: resolveVariantStatus(v),
            },
          });
          await tx.variantInventory.upsert({
            where: { variantId: v.id },
            create: {
              variantId: v.id,
              availableQty: v.availableQty || 0,
              reorderThreshold: v.reorderThreshold ? Number(v.reorderThreshold) : null,
              criticalThreshold: v.criticalThreshold ? Number(v.criticalThreshold) : null,
            },
            update: {
              availableQty: v.availableQty || 0,
              reorderThreshold: v.reorderThreshold ? Number(v.reorderThreshold) : null,
              criticalThreshold: v.criticalThreshold ? Number(v.criticalThreshold) : null,
            },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId,
              size: v.size.trim(),
              color: v.color.trim(),
              sku: v.sku?.trim() || null,
              priceOverride: v.priceOverride ? Number(v.priceOverride) : null,
              status: resolveVariantStatus(v),
              inventory: {
                create: {
                  availableQty: v.availableQty || 0,
                  reorderThreshold: v.reorderThreshold ? Number(v.reorderThreshold) : null,
                  criticalThreshold: v.criticalThreshold ? Number(v.criticalThreshold) : null,
                },
              },
            },
          });
        }
      }

      // Variants that existed before but are absent from the submission → deactivate & zero out
      const removedIds = existing.variants.map((v) => v.id).filter((id) => !submittedIds.has(id));

      if (removedIds.length > 0) {
        await tx.productVariant.updateMany({
          where: { id: { in: removedIds } },
          data: { status: 'out-of-stock' },
        });
        await tx.variantInventory.updateMany({
          where: { variantId: { in: removedIds } },
          data: { availableQty: 0 },
        });
      }
    });

    revalidatePath('/products');
    return { success: true, productId };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to update product. Please retry.' };
  }
}
