import { NextResponse, after } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { getBrandScopedWhere } from '@/lib/access-control';
import { nextProductSku } from '@/lib/product-sku';
import { syncWhatsAppCatalogProduct } from '@/lib/whatsapp-catalog-sync';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('products:view');
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');

    if (brand) {
      assertBrandAccess(scope, brand, 'brand');
    }

    const whereClause = brand ? { brand } : getBrandScopedWhere(scope);

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        inventory: true,
        variants: {
          include: { inventory: true },
          orderBy: [{ size: 'asc' }, { color: 'asc' }],
        },
        colorImages: {
          orderBy: { color: 'asc' },
        },
      },
    });
    return NextResponse.json({ success: true, data: products });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireApiPermission('products:write');
    const data = await request.json();
    assertBrandAccess(scope, data.brand, 'brand');

    const sizesStr = Array.isArray(data.sizes) ? data.sizes.join(',') : data.sizes;
    const colorsStr = Array.isArray(data.colors) ? data.colors.join(',') : data.colors;
    const variantInputs: Array<{
      size: string;
      color: string;
      sku?: string;
      priceOverride?: number;
      status?: string;
      availableQty?: number;
    }> = Array.isArray(data.variants) ? data.variants : [];

    const initialStock = variantInputs.length > 0
      ? variantInputs.reduce((sum, v) => sum + (v.availableQty || 0), 0)
      : (data.stock || 0);

    const product = await prisma.$transaction(async (tx) => {
      const productSku = await nextProductSku(tx, data.brand);
      const created = await tx.product.create({
        data: {
          sku: productSku,
          name: data.name,
          brand: data.brand,
          style: data.style,
          price: data.price,
          fabric: data.fabric ?? null,
          sizes: sizesStr,
          colors: colorsStr,
          stock: initialStock,
          status: data.status || 'active',
          inventory: {
            create: { availableQty: initialStock },
          },
        },
      });

      for (const v of variantInputs) {
        const qty = v.availableQty || 0;
        await tx.productVariant.create({
          data: {
            productId: created.id,
            size: v.size,
            color: v.color,
            sku: v.sku || null,
            priceOverride: v.priceOverride || null,
            status: v.status || (qty > 0 ? 'active' : 'out-of-stock'),
            inventory: { create: { availableQty: qty } },
          },
        });
      }

      return created;
    });

    after(async () => {
      try {
        const catalogSync = await syncWhatsAppCatalogProduct(product.id);
        if (catalogSync.configured && !catalogSync.ok) {
          console.warn('[Products API] WhatsApp catalog sync failed after create.', {
            brand: catalogSync.brand,
            productId: product.id,
            error: catalogSync.error,
          });
        }
      } catch (catalogError) {
        console.warn('[Products API] WhatsApp catalog sync could not run after create.', {
          productId: product.id,
          error: catalogError instanceof Error ? catalogError.message : 'Unexpected catalog sync error.',
        });
      }
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
