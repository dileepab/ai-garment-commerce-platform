import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import { nextProductSku } from '@/lib/product-sku';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const scope = await requireApiPermission('products:write');
    const { id } = await params;
    const productId = parseInt(id, 10);
    if (isNaN(productId)) {
      return NextResponse.json({ success: false, error: 'Invalid product ID.' }, { status: 400 });
    }

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { brand: true, sku: true, variants: { select: { id: true } } },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 });
    }
    assertBrandAccess(scope, existing.brand, 'product');

    const data = await request.json();

    if (data.brand) {
      assertBrandAccess(scope, data.brand, 'brand');
    }

    const variantInputs: Array<{
      id?: number;
      size: string;
      color: string;
      sku?: string | null;
      priceOverride?: number | null;
      status?: string;
      availableQty?: number;
    }> = Array.isArray(data.variants) ? data.variants : [];

    const totalStock = variantInputs.length > 0
      ? variantInputs.reduce((sum, v) => sum + (v.availableQty || 0), 0)
      : (data.stock ?? undefined);

    const product = await prisma.$transaction(async (tx) => {
      const nextBrand = data.brand ?? existing.brand;
      const productSku = nextBrand !== existing.brand
        ? await nextProductSku(tx, nextBrand)
        : existing.sku;
      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          sku: productSku,
          ...(data.name != null && { name: data.name }),
          ...(data.brand != null && { brand: data.brand }),
          ...(data.style != null && { style: data.style }),
          ...(data.fabric !== undefined && { fabric: data.fabric }),
          ...(data.price != null && { price: Number(data.price) }),
          ...(data.status != null && { status: data.status }),
          ...(totalStock != null && { stock: totalStock }),
          ...(data.sizes != null && {
            sizes: Array.isArray(data.sizes) ? data.sizes.join(',') : data.sizes,
          }),
          ...(data.colors != null && {
            colors: Array.isArray(data.colors) ? data.colors.join(',') : data.colors,
          }),
        },
      });

      if (totalStock != null) {
        await tx.inventory.upsert({
          where: { productId },
          create: { productId, availableQty: totalStock },
          update: { availableQty: totalStock },
        });
      }

      const submittedIds = new Set(variantInputs.filter((v) => v.id).map((v) => v.id!));

      for (const v of variantInputs) {
        const qty = v.availableQty || 0;
        const status = v.status || (qty > 0 ? 'active' : 'out-of-stock');
        if (v.id) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              size: v.size,
              color: v.color,
              sku: v.sku ?? null,
              priceOverride: v.priceOverride ?? null,
              status,
            },
          });
          await tx.variantInventory.upsert({
            where: { variantId: v.id },
            create: { variantId: v.id, availableQty: qty },
            update: { availableQty: qty },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId,
              size: v.size,
              color: v.color,
              sku: v.sku || null,
              priceOverride: v.priceOverride || null,
              status,
              inventory: { create: { availableQty: qty } },
            },
          });
        }
      }

      if (variantInputs.length > 0) {
        const removedIds = existing.variants
          .map((v) => v.id)
          .filter((id) => !submittedIds.has(id));

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
      }

      return updated;
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
