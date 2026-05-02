import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';

export async function POST(request: Request) {
  try {
    const scope = await requireApiPermission('inventory:reserve');
    const { productId, quantity } = await request.json();
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { brand: true },
    });

    assertBrandAccess(scope, product?.brand, 'product');
    
    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.updateMany({
        where: {
          productId,
          availableQty: { gte: quantity },
        },
        data: {
          availableQty: { decrement: quantity },
          reservedQty: { increment: quantity }
        }
      });

      if (inventory.count !== 1) {
        const existingInventory = await tx.inventory.findUnique({ where: { productId } });

        if (!existingInventory) throw new Error("Inventory not found for product");
        throw new Error("OUT_OF_STOCK: Requested quantity is not available");
      }

      await tx.product.update({
        where: { id: productId },
        data: {
          stock: { decrement: quantity },
        },
      });

      return tx.inventory.findUnique({ where: { productId } });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    const message = getErrorMessage(error);

    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('OUT_OF_STOCK') ? 400 : 500 }
    );
  }
}
